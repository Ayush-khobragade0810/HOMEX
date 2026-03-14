import express from "express";
import { protect } from "../middleware/authMiddleware.js";
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
router.get("/", protect, getSchedules);
router.get("/stats", protect, getScheduleStats);
router.get("/day", protect, getScheduleByDay);
router.get("/week", protect, getScheduleByWeek);
router.get("/month", protect, getScheduleByMonth);
router.get("/today", protect, getTodaySchedule);
router.get("/upcoming", protect, getUpcomingServices);

// Legacy/Compatibility support (Still protected)
router.get("/employee/:empId", protect, getSchedules);
router.get("/employee/:empId/stats", protect, getScheduleStats);
router.get("/employee/:empId/day", protect, getScheduleByDay);
router.get("/employee/:empId/week", protect, getScheduleByWeek);
router.get("/employee/:empId/month", protect, getScheduleByMonth);

// Actions
router.patch("/:id/status", protect, updateServiceStatus);
router.patch("/:id/start", protect, startService);
router.patch("/:id/complete", protect, completeService);
router.patch("/:id/reschedule", protect, rescheduleService);

export default router;