import express from 'express';
import {
    getAllBookings,
    updateBookingStatus,
    deleteBooking,
    assignBooking
} from '../controllers/adminBooking.controller.js';
import {
    getDashboardStats,
    getAllUsers,
    getUserStats,
    debugUsers
} from '../controllers/adminController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Protect all routes and restrict to admin
router.use(protect);
router.use(authorize('admin'));

router.get('/check', (req, res) => {
    res.json({
        success: true,
        message: 'Admin access confirmed',
        user: {
            id: req.user._id,
            role: req.user.role,
            email: req.user.email
        }
    });
});

router.route('/bookings')
    .get(getAllBookings);

router.route('/bookings/:id')
    .delete(deleteBooking);

router.route('/bookings/:id/status')
    .put(updateBookingStatus);

router.route('/bookings/:id/assign')
    .put(assignBooking);

router.route('/stats')
    .get(getDashboardStats);

router.route('/users')
    .get(getAllUsers);

router.route('/user-stats')
    .get(getUserStats);

router.route('/debug-users')
    .get(debugUsers);

export default router;
