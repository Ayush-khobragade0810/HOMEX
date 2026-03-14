import express from "express";
import {
    acceptBooking,
    startBooking,
    completeBooking,
} from "../controllers/bookingController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect);
router.use(authorize("employee"));

// Check if these routes match frontend expectations
router.put("/:id/accept", acceptBooking);
router.put("/:id/start", startBooking);
router.put("/:id/complete", completeBooking);

export default router;
