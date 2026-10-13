import express from 'express';
import {
    getUserProfile,
    updateUserProfile,
    getUserBookings,
    getDashboardStats,
    getNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead
} from '../controllers/userController.js';
import { protect } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import userSchemas from '../validators/user.js';

import upload from '../middleware/uploadMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// The signed-in account's User id. Employees authenticate with a plain object
// that carries the underlying User id as `userId` and has no `_id`.
const setOwnId = (req, res, next) => {
    req.params.id = String(req.user._id || req.user.userId || req.user.id);
    next();
};

const validateUserId = validate({ params: userSchemas.userIdParams });

router.route('/profile/me')
    .get(setOwnId, getUserProfile)
    // Multipart: validate after multer has parsed the text fields.
    .put(setOwnId, upload.single('avatar'), validate({ body: userSchemas.updateProfile }), updateUserProfile);

router.get('/user/me', setOwnId, validate({ query: userSchemas.bookingsQuery }), getUserBookings);

router.route('/profile/:id')
    .get(validateUserId, getUserProfile)
    .put(validateUserId, validate({ body: userSchemas.updateProfile }), updateUserProfile);

router.get('/user/:id', validate({ params: userSchemas.userIdParams, query: userSchemas.bookingsQuery }), getUserBookings);
// Wait, server.js mounts at /api/users. So /api/users/user/:id for bookings?
// Ideally it should be /api/users/:id/bookings but matching controller logic.
// Controller was: router.get('/user/:id', getUserBookings); -> /api/my-bookings/user/:id in description
// In server.js: app.use('/api/users', userRoutes);
// So final url: /api/users/user/:id
// This matches the controller's expectation (User Dashboard likely calls this).

router.get('/:id/stats', validateUserId, getDashboardStats);
router.get('/:id/notifications', validate({ params: userSchemas.userIdParams, query: userSchemas.notificationsQuery }), getNotifications);
router.put('/:userId/notifications/:notificationId/read', validate({ params: userSchemas.notificationParams }), markNotificationAsRead);
router.put('/:id/notifications/read-all', validateUserId, markAllNotificationsAsRead);

export default router;
