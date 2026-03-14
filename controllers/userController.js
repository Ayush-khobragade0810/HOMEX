import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Notification from '../models/Notification.js';
import { sendNotification, isUserOnline } from '../utils/helpers.js';
import logger from '../utils/logger.js';
import mongoose from 'mongoose';

// @desc    Get user profile (with authorization check)
// @route   GET /api/user/profile/:id
// @access  Private
export const getUserProfile = async (req, res) => {
    try {
        let userId = req.params.id;

        // Handle "me" alias
        if (userId === 'me') {
            if (req.user) {
                userId = (req.user._id || req.user.id).toString();
            } else {
                return res.status(401).json({ success: false, message: 'Unauthorized: No user found' });
            }
        }

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID format' });
        }

        // Handle "me" alias
        if (userId === 'me') {
            if (req.user && req.user._id) {
                userId = req.user._id.toString();
            } else {
                return res.status(401).json({ success: false, message: 'Unauthorized: No user found' });
            }
        }

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID format' });
        }

        // Authorization check
        if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
            logger.audit('unauthorized_profile_access', req.user, { attemptedUserId: userId });
            return res.status(403).json({
                success: false,
                message: 'Forbidden: You can only access your own profile'
            });
        }

        const user = await User.findById(userId)
            .select('-password -__v -refreshTokens');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Add online status
        const userWithStatus = {
            ...user.toObject(),
            isOnline: isUserOnline(userId)
        };

        logger.audit('profile_view', req.user, `user:${userId}`);

        res.status(200).json({
            success: true,
            user: userWithStatus
        });
    } catch (error) {
        logger.errorWithContext(
            { userId: req.params.id, user: req.user._id },
            'Get user profile error',
            error
        );
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// @desc    Update user profile (with authorization check)
// @route   PUT /api/user/profile/:id
// @access  Private
export const updateUserProfile = async (req, res) => {
    try {
        const userId = req.params.id;
        const { name, email, phone, address, preferences } = req.body;

        // Authorization check
        if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
            logger.audit('unauthorized_profile_update', req.user, { attemptedUserId: userId });
            return res.status(403).json({
                success: false,
                message: 'Forbidden: You can only update your own profile'
            });
        }

        // Build update object
        const updateData = {};
        if (name) updateData.name = name;
        if (email) updateData.email = email;
        if (phone) updateData.phone = phone;
        if (address) updateData.address = address;
        if (preferences) updateData.preferences = preferences;

        // Handle file upload
        if (req.file) {
            // Store relative path
            updateData.avatar = `/uploads/profiles/${req.file.filename}`;
        }

        const user = await User.findByIdAndUpdate(
            userId,
            updateData,
            { new: true, runValidators: true }
        ).select('-password -__v -refreshTokens');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        logger.audit('profile_update', req.user, `user:${userId}`, { updatedFields: Object.keys(updateData) });

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            user
        });
    } catch (error) {
        logger.errorWithContext(
            { userId: req.params.id, user: req.user._id },
            'Update profile error',
            error
        );
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// @desc    Get user bookings (with authorization check)
// @route   GET /api/my-bookings/user/:id
// @access  Private
export const getUserBookings = async (req, res) => {
    try {
        let userId = req.params.id;

        // Handle "me" alias
        if (userId === 'me') {
            if (req.user) {
                userId = (req.user._id || req.user.id).toString();
            } else {
                return res.status(401).json({ success: false, message: 'Unauthorized: No user found' });
            }
        }

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID format' });
        }

        // Handle "me" alias
        if (userId === 'me') {
            if (req.user && req.user._id) {
                userId = req.user._id.toString();
            } else {
                return res.status(401).json({ success: false, message: 'Unauthorized: No user found' });
            }
        }

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID format' });
        }

        // Authorization check
        if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
            logger.audit('unauthorized_bookings_access', req.user, { attemptedUserId: userId });
            return res.status(403).json({
                success: false,
                message: 'Forbidden: You can only access your own bookings'
            });
        }

        const { status, page = 1, limit = 20, search } = req.query;
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
                query.status = status;
            }
        }

        // Apply search filter
        if (search) {
            query.$or = [
                { bookingId: { $regex: search, $options: 'i' } },
                { 'serviceDetails.title': { $regex: search, $options: 'i' } },
                { 'serviceDetails.category': { $regex: search, $options: 'i' } }
            ];
        }

        const bookings = await Booking.find(query)
            .populate('serviceId', 'title category')
            .populate('assignedTo.technicianId', 'name phone avatar rating')
            .sort({ 'schedule.preferredDate': 1, createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Booking.countDocuments(query);

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
            currentPage: parseInt(page),
            data: bookings
        });
    } catch (error) {
        logger.errorWithContext(
            { userId: req.params.id, user: req.user._id },
            'Get bookings error',
            error
        );
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// @desc    Get user dashboard stats
// @route   GET /api/user/:id/stats
// @access  Private
export const getDashboardStats = async (req, res) => {
    try {
        let userId = req.params.id;

        // Handle "me" alias
        if (userId === 'me') {
            if (req.user) {
                userId = (req.user._id || req.user.id).toString();
            } else {
                return res.status(401).json({ success: false, message: 'Unauthorized: No user found' });
            }
        }

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID format' });
        }

        // Handle "me" alias
        if (userId === 'me') {
            if (req.user && req.user._id) {
                userId = req.user._id.toString();
            } else {
                return res.status(401).json({ success: false, message: 'Unauthorized: No user found' });
            }
        }

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID format' });
        }

        // Authorization check
        if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
            logger.audit('unauthorized_stats_access', req.user, { attemptedUserId: userId });
            return res.status(403).json({
                success: false,
                message: 'Forbidden: You can only access your own stats'
            });
        }

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
        logger.errorWithContext(
            { userId: req.params.id, user: req.user._id },
            'Get dashboard stats error',
            error
        );
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// @desc    Get user notifications
// @route   GET /api/user/:id/notifications
// @access  Private
export const getNotifications = async (req, res) => {
    try {
        let userId = req.params.id;

        // Handle "me" alias
        if (userId === 'me') {
            if (req.user) {
                userId = (req.user._id || req.user.id).toString();
            } else {
                return res.status(401).json({ success: false, message: 'Unauthorized: No user found' });
            }
        }

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID format' });
        }

        // Handle "me" alias
        if (userId === 'me') {
            if (req.user && req.user._id) {
                userId = req.user._id.toString();
            } else {
                return res.status(401).json({ success: false, message: 'Unauthorized: No user found' });
            }
        }

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user ID format' });
        }

        // Authorization check
        if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
            logger.audit('unauthorized_notifications_access', req.user, { attemptedUserId: userId });
            return res.status(403).json({
                success: false,
                message: 'Forbidden: You can only access your own notifications'
            });
        }

        const { unreadOnly = false, limit = 20, page = 1 } = req.query;
        const skip = (page - 1) * limit;

        let query = { userId: new mongoose.Types.ObjectId(userId) };
        if (unreadOnly === 'true' || unreadOnly === true) {
            query.isRead = false;
        }

        const notifications = await Notification.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

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
            currentPage: parseInt(page),
            notifications
        });
    } catch (error) {
        logger.errorWithContext(
            { userId: req.params.id, user: req.user._id },
            'Get notifications error',
            error
        );
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// @desc    Mark notification as read
// @route   PUT /api/user/:id/notifications/:notificationId/read
// @access  Private
export const markNotificationAsRead = async (req, res) => {
    try {
        const { userId, notificationId } = req.params;

        // Authorization check
        if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
            logger.audit('unauthorized_notification_mark', req.user, {
                attemptedUserId: userId,
                notificationId
            });
            return res.status(403).json({
                success: false,
                message: 'Forbidden'
            });
        }

        const notification = await Notification.findOneAndUpdate(
            {
                _id: notificationId,
                userId: new mongoose.Types.ObjectId(userId)
            },
            { isRead: true, readAt: new Date() },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
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
        logger.errorWithContext(
            { userId: req.params.userId, notificationId: req.params.notificationId },
            'Mark notification read error',
            error
        );
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

// @desc    Mark all notifications as read
// @route   PUT /api/user/:id/notifications/read-all
// @access  Private
export const markAllNotificationsAsRead = async (req, res) => {
    try {
        const userId = req.params.id;

        // Authorization check
        if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
            logger.audit('unauthorized_notifications_mark_all', req.user, { attemptedUserId: userId });
            return res.status(403).json({
                success: false,
                message: 'Forbidden'
            });
        }

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
        logger.errorWithContext(
            { userId: req.params.id, user: req.user._id },
            'Mark all notifications read error',
            error
        );
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};
