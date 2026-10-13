import express from "express";
import {
    getPaymentDashboard,
    getFilteredPayments,
    getPaymentById,
    createPayment,
    updatePaymentStatus,
    getEarningsStatistics,
    exportPayments,
    requestWithdrawal,
    addPaymentMethod,
    getPaymentMethods,
    downloadReceipt,
    reportPaymentIssue,
    getPaymentIssues
} from "../controllers/paymentController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { requireActiveSubscription } from "../middleware/subscriptionMiddleware.js";
import { validate } from "../middleware/validate.js";
import * as v from "../validators/payment.js";

const router = express.Router();

const emp = (extra = {}) => validate({ params: v.empIdParams, ...extra });
const paymentId = (extra = {}) => validate({ params: v.paymentIdParams, ...extra });

router.get("/employee/:empId/dashboard", protect, requireActiveSubscription, emp({ query: v.dashboardQuery }), getPaymentDashboard);
router.get("/employee/:empId/filter", protect, requireActiveSubscription, emp({ query: v.filterQuery }), getFilteredPayments);
router.get("/employee/:empId/statistics", protect, requireActiveSubscription, emp({ query: v.statisticsQuery }), getEarningsStatistics);
router.get("/employee/:empId/export", protect, requireActiveSubscription, emp({ query: v.exportQuery }), exportPayments);
router.get("/employee/:empId/methods", protect, requireActiveSubscription, emp(), getPaymentMethods); // New route
router.post("/employee/:empId/withdraw", protect, requireActiveSubscription, emp({ body: v.withdrawalBody }), requestWithdrawal); // New route
router.post("/employee/:empId/methods", protect, requireActiveSubscription, emp({ body: v.paymentMethodBody }), addPaymentMethod); // New route
router.get("/employee/:empId/issues", protect, requireActiveSubscription, emp(), getPaymentIssues);

// Single-payment actions (receipt download + issue reporting)
router.get("/:id/receipt", protect, paymentId(), downloadReceipt);
router.post("/:id/report-issue", protect, paymentId({ body: v.reportIssueBody }), reportPaymentIssue);

router.get("/:id", protect, paymentId(), getPaymentById);
// Recording payments and changing their status is an admin action (these
// were previously reachable without logging in).
router.post("/", protect, authorize("admin"), validate({ body: v.createPaymentBody }), createPayment);
router.patch("/:id/status", protect, authorize("admin"), paymentId({ body: v.updateStatusBody }), updatePaymentStatus);

export default router;