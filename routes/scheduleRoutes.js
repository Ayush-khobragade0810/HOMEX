import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { requireActiveSubscription, requireSubscriptionOrPaidJob } from "../middleware/subscriptionMiddleware.js";
import {
    getSchedules,
    getScheduleStats,
    updateServiceStatus,
    startService,
    completeService,
    rescheduleService,
    getTodaySchedule,
    getUpcomingServices,
    getScheduleByDay,
    getScheduleByWeek,
    getScheduleByMonth
} from "../controllers/scheduleController.js";

const router = express.Router();

// New Unified & Authenticated Endpoints (Recommended)
router.get("/", protect, requireActiveSubscription, getSchedules);
router.get("/stats", protect, requireActiveSubscription, getScheduleStats);
router.get("/day", protect, requireActiveSubscription, getScheduleByDay);
router.get("/week", protect, requireActiveSubscription, getScheduleByWeek);
router.get("/month", protect, requireActiveSubscription, getScheduleByMonth);
router.get("/today", protect, requireActiveSubscription, getTodaySchedule);
router.get("/upcoming", protect, requireActiveSubscription, getUpcomingServices);

// Legacy/Compatibility support (Still protected)
router.get("/employee/:empId", protect, requireActiveSubscription, getSchedules);
router.get("/employee/:empId/stats", protect, requireActiveSubscription, getScheduleStats);
router.get("/employee/:empId/day", protect, requireActiveSubscription, getScheduleByDay);
router.get("/employee/:empId/week", protect, requireActiveSubscription, getScheduleByWeek);
router.get("/employee/:empId/month", protect, requireActiveSubscription, getScheduleByMonth);

// Actions
router.patch("/:id/status", protect, requireSubscriptionOrPaidJob, updateServiceStatus);
router.patch("/:id/start", protect, requireSubscriptionOrPaidJob, startService);
router.patch("/:id/complete", protect, requireSubscriptionOrPaidJob, completeService);
router.patch("/:id/reschedule", protect, requireSubscriptionOrPaidJob, rescheduleService);

export default router;