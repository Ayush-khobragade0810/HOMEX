import Notification from '../models/Notification.js';
import { ApiError, sendError } from '../utils/ApiError.js';

// Get all notifications for current user
export const getNotifications = async (req, res) => {
    try {

        const notifications = await Notification.find({
            userId: req.user.id
        })
            .sort({ createdAt: -1 })
            .limit(20);

        res.json({
            success: true,
            count: notifications.length,
            notifications
        });

    } catch (error) {
        console.error('❌ Get notifications error:', error);
        sendError(res, 500, 'Failed to fetch notifications');
    }
};

// Get count of unread notifications
export const getUnreadCount = async (req, res) => {
    try {
        const count = await Notification.countDocuments({
            userId: req.user.id,
            isRead: false
        });

        res.json({
            success: true,
            count
        });

    } catch (error) {
        console.error('❌ Get unread count error:', error);
        sendError(res, 500, 'Failed to get unread count');
    }
};

/**
 * The caller's notification, or a 404 / 403. Ownership is checked BEFORE any
 * change, so nobody can mark or delete another user's notifications.
 */
const findOwnNotification = async (req) => {
    const notification = await Notification.findById(req.params.id).select('userId').lean();
    if (!notification) throw ApiError.notFound('Notification not found');
    if (String(notification.userId) !== String(req.user.id)) {
        throw ApiError.forbidden('You can only manage your own notifications');
    }
    return notification;
};

// Mark notification as read
export const markNotificationAsRead = async (req, res) => {
    await findOwnNotification(req);

    const notification = await Notification.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.id },
        {
            isRead: true,
            readAt: new Date(),
            updatedAt: new Date()
        },
        { new: true }
    );
    if (!notification) throw ApiError.notFound('Notification not found');

    res.json({
        success: true,
        message: 'Notification marked as read',
        notification
    });
};

// Delete a notification
export const deleteNotification = async (req, res) => {
    await findOwnNotification(req);

    const result = await Notification.deleteOne({ _id: req.params.id, userId: req.user.id });
    if (!result.deletedCount) throw ApiError.notFound('Notification not found');

    res.json({ success: true, message: 'Notification deleted' });
};

// Helper function to create notifications (for other controllers)
export const createNotification = async (userId, type, title, message, data = {}) => {
    try {
        const notification = await Notification.create({
            userId,
            type,
            title,
            message,
            data,
            isRead: false,
            createdAt: new Date()
        });
        return notification;

    } catch (error) {
        console.error('❌ Create notification error:', error);
        return null;
    }
};

// Mark all notifications as read
export const markAllNotificationsAsRead = async (req, res) => {
    try {
        const result = await Notification.updateMany(
            {
                userId: req.user.id,
                isRead: false
            },
            {
                isRead: true,
                readAt: new Date(),
                updatedAt: new Date()
            }
        );

        res.json({
            success: true,
            message: 'All notifications marked as read',
            count: result.modifiedCount
        });

    } catch (error) {
        console.error('❌ Mark all read error:', error);
        sendError(res, 500, 'Failed to mark all notifications as read');
    }
};
