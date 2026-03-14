import express from 'express';
import {
    getNotifications,
    markNotificationAsRead,
    getUnreadCount,
    markAllNotificationsAsRead
} from '../controllers/notificationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth to all notification routes
router.use(protect);

// GET /api/notifications - Get all notifications for current user
router.get('/', getNotifications);

// GET /api/notifications/unread-count - Get count of unread notifications
router.get('/unread-count', getUnreadCount);

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', markNotificationAsRead);

// PUT /api/notifications/read-all - Mark ALL notifications as read
router.put('/read-all', markAllNotificationsAsRead);

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', async (req, res) => {
    try {
        // Implementation here
        res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
