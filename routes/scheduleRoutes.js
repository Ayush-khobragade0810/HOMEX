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
import { validate } from "../middleware/validate.js";
import * as v from "../validators/schedule.js";

const router = express.Router();

const listQuery = validate({ query: v.listQuery });
const legacyList = validate({ params: v.empIdParams, query: v.listQuery });

// New Unified & Authenticated Endpoints (Recommended)
router.get("/", protect, requireActiveSubscription, listQuery, getSchedules);
router.get("/stats", protect, requireActiveSubscription, getScheduleStats);
router.get("/day", protect, requireActiveSubscription, listQuery, getScheduleByDay);
router.get("/week", protect, requireActiveSubscription, listQuery, getScheduleByWeek);
router.get("/month", protect, requireActiveSubscription, listQuery, getScheduleByMonth);
router.get("/today", protect, requireActiveSubscription, listQuery, getTodaySchedule);
router.get("/upcoming", protect, requireActiveSubscription, listQuery, getUpcomingServices);

// Legacy/Compatibility support (Still protected)
router.get("/employee/:empId", protect, requireActiveSubscription, legacyList, getSchedules);
router.get("/employee/:empId/stats", protect, requireActiveSubscription, validate({ params: v.empIdParams }), getScheduleStats);
router.get("/employee/:empId/day", protect, requireActiveSubscription, legacyList, getScheduleByDay);
router.get("/employee/:empId/week", protect, requireActiveSubscription, legacyList, getScheduleByWeek);
router.get("/employee/:empId/month", protect, requireActiveSubscription, legacyList, getScheduleByMonth);

// Actions
router.patch("/:id/status", protect, requireSubscriptionOrPaidJob, validate({ params: v.actionParams, body: v.statusBody }), updateServiceStatus);
router.patch("/:id/start", protect, requireSubscriptionOrPaidJob, validate({ params: v.actionParams, body: v.startBody }), startService);
router.patch("/:id/complete", protect, requireSubscriptionOrPaidJob, validate({ params: v.actionParams, body: v.completeBody }), completeService);
router.patch("/:id/reschedule", protect, requireSubscriptionOrPaidJob, validate({ params: v.actionParams, body: v.rescheduleBody }), rescheduleService);

export default router;