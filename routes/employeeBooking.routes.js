
import express from "express";
import { updateBookingStatus } from "../controllers/employeeBooking.controller.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// Apply middleware to all routes in this file
router.use(protect);
router.use(authorize("employee"));

// Generic Status Update
router.put("/:bookingId/status", updateBookingStatus);
router.patch("/:bookingId/status", updateBookingStatus);

// Legacy Adapters for Backward Compatibility
router.put("/:bookingId/accept", (req, res, next) => {
    req.body.status = 'accepted';
    req.params.bookingId = req.params.bookingId || req.params.id; // ensure consistency
    next();
}, updateBookingStatus);

router.put("/:bookingId/start", (req, res, next) => {
    req.body.status = 'start';
    next();
}, updateBookingStatus);

router.put("/:bookingId/complete", (req, res, next) => {
    req.body.status = 'complete';
    next();
}, updateBookingStatus);
// Support navigating as well, though maybe not legacy
router.put("/:bookingId/navigate", (req, res, next) => {
    req.body.status = 'navigating';
    next();
}, updateBookingStatus);

export default router;
