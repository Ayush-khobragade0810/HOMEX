import express from 'express';
import {
    getAllBookings,
    updateBookingStatus,
    deleteBooking,
    updateBooking,
    assignBooking,
    getBookingById,
    generateInvoice
} from '../../controllers/adminBooking.controller.js';


import {
    getDashboardStats,
    getAllUsers,
    getUserStats,
    debugUsers
} from '../../controllers/adminController.js';
import { protect, authorize } from '../../middleware/authMiddleware.js';
import { validate, validateObjectId } from '../../middleware/validate.js';
import { bookingSchemas } from '../../validators/booking.js';

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
    .get(validate({ query: bookingSchemas.listQuery }), getAllBookings);

// Every /bookings/:id route below looks the booking up by its Mongo _id.
const bookingId = validateObjectId('id');

router.route('/bookings/:id')
    .get(bookingId, getBookingById)
    .put(bookingId, validate({ body: bookingSchemas.adminUpdate }), updateBooking)
    .delete(bookingId, deleteBooking);

router.route('/bookings/:id/status')
    .put(bookingId, validate({ body: bookingSchemas.updateStatus }), updateBookingStatus);

router.route('/bookings/:id/assign')
    .put(bookingId, validate({ body: bookingSchemas.assign }), assignBooking);

router.route('/bookings/:id/invoice')
    .get(bookingId, generateInvoice);

router.route('/stats')
    .get(getDashboardStats);

router.route('/users')
    .get(getAllUsers);

router.route('/user-stats')
    .get(getUserStats);

router.route('/debug-users')
    .get(debugUsers);

export default router;
