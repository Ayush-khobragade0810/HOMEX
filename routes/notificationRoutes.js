import express from 'express';
import {
    getNotifications,
    markNotificationAsRead,
    getUnreadCount,
    markAllNotificationsAsRead,
    deleteNotification
} from '../controllers/notificationController.js';
import { protect } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { notificationIdParams } from '../validators/notification.js';

const router = express.Router();

// Apply auth to all notification routes
router.use(protect);

// GET /api/notifications - Get all notifications for current user
router.get('/', getNotifications);

// GET /api/notifications/unread-count - Get count of unread notifications
router.get('/unread-count', getUnreadCount);

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', validate({ params: notificationIdParams }), markNotificationAsRead);

// PUT /api/notifications/read-all - Mark ALL notifications as read
router.put('/read-all', markAllNotificationsAsRead);

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', validate({ params: notificationIdParams }), deleteNotification);

export default router;
