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

import upload from '../middleware/uploadMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

router.route('/profile/me')
    .get((req, res, next) => {
        req.params.id = req.user._id.toString();
        next();
    }, getUserProfile)
    .put((req, res, next) => {
        req.params.id = req.user._id.toString();
        next();
    }, upload.single('avatar'), updateUserProfile);

router.get('/user/me', (req, res, next) => {
    req.params.id = req.user._id.toString();
    next();
}, getUserBookings);

router.route('/profile/:id')
    .get(getUserProfile)
    .put(updateUserProfile);

router.get('/user/:id', getUserBookings); // Maps to /api/users/user/:id based on server.js mount (check this)
// Wait, server.js mounts at /api/users. So /api/users/user/:id for bookings? 
// Ideally it should be /api/users/:id/bookings but matching controller logic.
// Controller was: router.get('/user/:id', getUserBookings); -> /api/my-bookings/user/:id in description
// In server.js: app.use('/api/users', userRoutes);
// So final url: /api/users/user/:id
// This matches the controller's expectation (User Dashboard likely calls this).

router.get('/:id/stats', getDashboardStats);
router.get('/:id/notifications', getNotifications);
router.put('/:userId/notifications/:notificationId/read', markNotificationAsRead);
router.put('/:id/notifications/read-all', markAllNotificationsAsRead);

export default router;
