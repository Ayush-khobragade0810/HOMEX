import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Notification from '../models/Notification.js';
import { sendNotification, isUserOnline } from '../utils/helpers.js';
import logger from '../utils/logger.js';
import mongoose from 'mongoose';
import { computeBilling } from '../utils/billing.js';
import { ApiError } from '../utils/ApiError.js';

// The signed-in account's User id. Employees authenticate with a plain object
// that has `userId` (their User record) and `id` (their Employee record) but no `_id`.
const ownId = (req) => String(req.user?._id || req.user?.userId || req.user?.id || '');

// Resolves `req.params[name]` ("me" = the caller) to a validated ObjectId string.
const resolveUserId = (req, name = 'id') => {
    let userId = req.params[name];
    if (userId === 'me') userId = ownId(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        throw ApiError.badRequest('Invalid user ID format', { code: 'INVALID_ID' });
    }
    return String(userId);
};

// Only the account owner or an admin may read or change a user's data.
const assertOwnerOrAdmin = (req, userId, auditEvent, message, details = {}) => {
    if (ownId(req) !== userId && req.user.role !== 'admin') {
        logger.audit(auditEvent, req.user, { attemptedUserId: userId, ...details });
        throw ApiError.forbidden(message);
    }
};

// Unexpected failures are logged with context; the global handler formats the response.
const fail = (next, error, context, label) => {
    if (!error.isOperational) logger.errorWithContext(context, label, error);
    return next(error);
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// page/limit arrive as query strings; fall back to the defaults when absent.
const toPositiveInt = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

// @desc    Get user profile (with authorization check)
// @route   GET /api/user/profile/:id
// @access  Private
export const getUserProfile = async (req, res, next) => {
    try {
        const userId = resolveUserId(req);
        assertOwnerOrAdmin(req, userId, 'unauthorized_profile_access', 'You can only access your own profile');

        const user = await User.findById(userId)
            .select('-password -__v -refreshTokens')
            .lean();

        if (!user) {
            throw ApiError.notFound('User not found');
        }

        // Add online status
        const userWithStatus = {
            ...user,
            isOnline: isUserOnline(userId)
        };

        logger.audit('profile_view', req.user, `user:${userId}`);

        res.status(200).json({
            success: true,
            user: userWithStatus
        });
    } catch (error) {
        return fail(next, error, { userId: req.params.id, user: ownId(req) }, 'Get user profile error');
    }
};

// @desc    Update user profile (with authorization check)
// @route   PUT /api/user/profile/:id
// @access  Private
export const updateUserProfile = async (req, res, next) => {
    try {
        const userId = resolveUserId(req);
        const { name, email, phone, address, preferences } = req.body || {};

        assertOwnerOrAdmin(req, userId, 'unauthorized_profile_update', 'You can only update your own profile');

        // Build update object (multipart bodies send blank fields as '')
        const updateData = {};
        if (typeof name === 'string' && name.trim()) updateData.name = name.trim();
        if (typeof email === 'string' && email.trim()) updateData.email = email.trim().toLowerCase();
        if (typeof phone === 'string' && phone.trim()) updateData.phone = phone.trim();
        // A form that echoes an address object back through FormData sends "[object Object]".
        if (address && address !== '[object Object]') updateData.address = address;
        if (preferences) {
            if (typeof preferences === 'string') {
                try {
                    updateData.preferences = JSON.parse(preferences);
                } catch {
                    throw ApiError.badRequest('Preferences must be valid JSON', {
                        errors: [{ field: 'preferences', message: 'Preferences must be valid JSON' }]
                    });
                }
            } else {
                updateData.preferences = preferences;
            }
        }

        // Handle file upload
        if (req.file) {
            // Store relative path
            updateData.avatar = `/uploads/profiles/${req.file.filename}`;
        }

        // Email and mobile number identify an account, so they must stay unique.
        if (updateData.email) {
            const taken = await User.exists({ email: updateData.email, _id: { $ne: userId } });
            if (taken) {
                throw ApiError.conflict('Email is already registered', {
                    code: 'DUPLICATE',
                    errors: [{ field: 'email', message: 'Email is already registered' }]
                });
            }
        }
        if (updateData.phone) {
            const taken = await User.exists({ phone: updateData.phone, _id: { $ne: userId } });
            if (taken) {
                throw ApiError.conflict('Mobile number is already registered', {
                    code: 'DUPLICATE',
                    errors: [{ field: 'phone', message: 'Mobile number is already registered' }]
                });
            }
        }

        const user = await User.findByIdAndUpdate(
            userId,
            updateData,
            { new: true, runValidators: true }
        ).select('-password -__v -refreshTokens');

        if (!user) {
            throw ApiError.notFound('User not found');
        }

        logger.audit('profile_update', req.user, `user:${userId}`, { updatedFields: Object.keys(updateData) });

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            user
        });
    } catch (error) {
        return fail(next, error, { userId: req.params.id, user: ownId(req) }, 'Update profile error');
    }
};

// @desc    Get user bookings (with authorization check)
// @route   GET /api/my-bookings/user/:id
// @access  Private
export const getUserBookings = async (req, res, next) => {
    try {
        const userId = resolveUserId(req);
        assertOwnerOrAdmin(req, userId, 'unauthorized_bookings_access', 'You can only access your own bookings');

        const { status, search } = req.query;
        const page = toPositiveInt(req.query.page, 1);
        const limit = toPositiveInt(req.query.limit, 20);
        const skip = (page - 1) * limit;

        let query = { userId: new mongoose.Types.ObjectId(userId) };

        // Apply status filter
        if (status) {
            if (status === 'upcoming') {
                query.status = { $in: ['pending', 'confirmed', 'assigned'] };
                query['schedule.preferredDate'] = { $gt: new Date() };
            } else if (status === 'active') {
                query.status = 'in_progress';
            } else if (status === 'past') {
                query.status = { $in: ['completed', 'cancelled', 'rejected'] };
            } else {
                query.status = String(status);
            }
        }

        // Apply search filter (escaped: user text is matched literally)
        if (search) {
            const pattern = escapeRegex(search);
            query.$or = [
                { bookingId: { $regex: pattern, $options: 'i' } },
                { 'serviceDetails.title': { $regex: pattern, $options: 'i' } },
                { 'serviceDetails.category': { $regex: pattern, $options: 'i' } }
            ];
        }

        const bookings = await Booking.find(query)
            .populate('serviceId', 'title category')
            .populate('assignedTo.technicianId', 'name phone avatar rating')
            .sort({ 'schedule.preferredDate': 1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const total = await Booking.countDocuments(query);

        // Recompute the invoice breakdown on read so the customer always sees
        // the current total (base + on-site extras), even for bookings created
        // before the billing feature or touched by a writer that did not
        // refresh the stored block.
        const data = bookings.map((b) => ({ ...b, billing: computeBilling(b) }));

        logger.audit('bookings_view', req.user, `user:${userId}`, {
            count: bookings.length,
            status,
            search,
            page
        });

        res.status(200).json({
            success: true,
            count: bookings.length,
            total,
            pages: Math.ceil(total / limit),
            currentPage: page,
            data
        });
    } catch (error) {
        return fail(next, error, { userId: req.params.id, user: ownId(req) }, 'Get bookings error');
    }
};

// @desc    Get user dashboard stats
// @route   GET /api/user/:id/stats
// @access  Private
export const getDashboardStats = async (req, res, next) => {
    try {
        const userId = resolveUserId(req);
        assertOwnerOrAdmin(req, userId, 'unauthorized_stats_access', 'You can only access your own stats');

        const stats = await Booking.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(userId) } },
            {
                $group: {
                    _id: null,
                    totalBookings: { $sum: 1 },
                    totalSpent: {
                        $sum: {
                            $cond: [
                                { $eq: ['$status', 'completed'] },
                                '$serviceDetails.price',
                                0
                            ]
                        }
                    },
                    completed: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                    },
                    active: {
                        $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] }
                    },
                    pending: {
                        $sum: { $cond: [{ $in: ['$status', ['pending', 'confirmed', 'assigned']] }, 1, 0] }
                    },
                    cancelled: {
                        $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
                    }
                }
            }
        ]);

        // Get monthly stats for last 6 months
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const monthlyStats = await Booking.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
                    createdAt: { $gte: sixMonthsAgo }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    count: { $sum: 1 },
                    amount: {
                        $sum: {
                            $cond: [
                                { $eq: ['$status', 'completed'] },
                                '$serviceDetails.price',
                                0
                            ]
                        }
                    },
                    completed: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                    }
                }
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } }
        ]);

        // Get favorite service category
        const favoriteCategory = await Booking.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(userId) } },
            {
                $group: {
                    _id: '$serviceDetails.category',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 1 }
        ]);

        const response = {
            success: true,
            stats: stats[0] || {
                totalBookings: 0,
                totalSpent: 0,
                completed: 0,
                active: 0,
                pending: 0,
                cancelled: 0
            },
            monthlyStats,
            favoriteCategory: favoriteCategory[0] || null
        };

        logger.audit('stats_view', req.user, `user:${userId}`);

        res.status(200).json(response);
    } catch (error) {
        return fail(next, error, { userId: req.params.id, user: ownId(req) }, 'Get dashboard stats error');
    }
};

// @desc    Get user notifications
// @route   GET /api/user/:id/notifications
// @access  Private
export const getNotifications = async (req, res, next) => {
    try {
        const userId = resolveUserId(req);
        assertOwnerOrAdmin(req, userId, 'unauthorized_notifications_access', 'You can only access your own notifications');

        const { unreadOnly = false } = req.query;
        const page = toPositiveInt(req.query.page, 1);
        const limit = toPositiveInt(req.query.limit, 20);
        const skip = (page - 1) * limit;

        let query = { userId: new mongoose.Types.ObjectId(userId) };
        if (unreadOnly === 'true' || unreadOnly === true) {
            query.isRead = false;
        }

        const notifications = await Notification.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const unreadCount = await Notification.countDocuments({
            userId: new mongoose.Types.ObjectId(userId),
            isRead: false
        });

        const total = await Notification.countDocuments(query);

        logger.audit('notifications_view', req.user, `user:${userId}`, {
            count: notifications.length,
            unreadCount,
            page
        });

        res.status(200).json({
            success: true,
            count: notifications.length,
            total,
            unreadCount,
            pages: Math.ceil(total / limit),
            currentPage: page,
            notifications
        });
    } catch (error) {
        return fail(next, error, { userId: req.params.id, user: ownId(req) }, 'Get notifications error');
    }
};

// @desc    Mark notification as read
// @route   PUT /api/user/:userId/notifications/:notificationId/read
// @access  Private
export const markNotificationAsRead = async (req, res, next) => {
    try {
        const userId = resolveUserId(req, 'userId');
        const { notificationId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(notificationId)) {
            throw ApiError.badRequest('Invalid notification ID format', { code: 'INVALID_ID' });
        }

        assertOwnerOrAdmin(req, userId, 'unauthorized_notification_mark',
            'You can only update your own notifications', { notificationId });

        const notification = await Notification.findOneAndUpdate(
            {
                _id: notificationId,
                userId: new mongoose.Types.ObjectId(userId)
            },
            { isRead: true, readAt: new Date() },
            { new: true }
        );

        if (!notification) {
            throw ApiError.notFound('Notification not found');
        }

        logger.audit('notification_mark_read', req.user, `notification:${notificationId}`, {
            userId,
            notificationType: notification.type
        });

        res.status(200).json({
            success: true,
            message: 'Notification marked as read',
            notification
        });
    } catch (error) {
        return fail(next, error,
            { userId: req.params.userId, notificationId: req.params.notificationId },
            'Mark notification read error');
    }
};

// @desc    Mark all notifications as read
// @route   PUT /api/user/:id/notifications/read-all
// @access  Private
export const markAllNotificationsAsRead = async (req, res, next) => {
    try {
        const userId = resolveUserId(req);
        assertOwnerOrAdmin(req, userId, 'unauthorized_notifications_mark_all', 'You can only update your own notifications');

        const result = await Notification.updateMany(
            {
                userId: new mongoose.Types.ObjectId(userId),
                isRead: false
            },
            {
                isRead: true,
                readAt: new Date()
            }
        );

        logger.audit('notifications_mark_all_read', req.user, `user:${userId}`, {
            modifiedCount: result.modifiedCount
        });

        res.status(200).json({
            success: true,
            message: 'All notifications marked as read',
            modifiedCount: result.modifiedCount
        });
    } catch (error) {
        return fail(next, error, { userId: req.params.id, user: ownId(req) }, 'Mark all notifications read error');
    }
};
