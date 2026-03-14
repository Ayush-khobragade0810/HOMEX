import Notification from '../models/Notification.js';

// Get all notifications for current user
export const getNotifications = async (req, res) => {
    try {
        console.log('📢 Fetching notifications for user:', req.user.id);

        const notifications = await Notification.find({
            userId: req.user.id
        })
            .sort({ createdAt: -1 })
            .limit(20);

        console.log(`✅ Found ${notifications.length} notifications`);

        res.json({
            success: true,
            count: notifications.length,
            notifications
        });

    } catch (error) {
        console.error('❌ Get notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notifications'
        });
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
        res.status(500).json({
            success: false,
            message: 'Failed to get unread count'
        });
    }
};

// Mark notification as read
export const markNotificationAsRead = async (req, res) => {
    try {
        const { id } = req.params;

        const notification = await Notification.findByIdAndUpdate(
            id,
            {
                isRead: true,
                readAt: new Date(),
                updatedAt: new Date()
            },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        // Verify user owns this notification
        if (notification.userId.toString() !== req.user.id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to modify this notification'
            });
        }

        res.json({
            success: true,
            message: 'Notification marked as read',
            notification
        });

    } catch (error) {
        console.error('❌ Mark as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark notification as read'
        });
    }
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

        console.log(`📢 Notification created for user ${userId}: ${title}`);
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
        res.status(500).json({
            success: false,
            message: 'Failed to mark all notifications as read'
        });
    }
};
