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
import { protect } from "../middleware/authMiddleware.js";
import { requireActiveSubscription } from "../middleware/subscriptionMiddleware.js";

const router = express.Router();

router.get("/employee/:empId/dashboard", protect, requireActiveSubscription, getPaymentDashboard);
router.get("/employee/:empId/filter", protect, requireActiveSubscription, getFilteredPayments);
router.get("/employee/:empId/statistics", protect, requireActiveSubscription, getEarningsStatistics);
router.get("/employee/:empId/export", protect, requireActiveSubscription, exportPayments);
router.get("/employee/:empId/methods", protect, requireActiveSubscription, getPaymentMethods); // New route
router.post("/employee/:empId/withdraw", protect, requireActiveSubscription, requestWithdrawal); // New route
router.post("/employee/:empId/methods", protect, requireActiveSubscription, addPaymentMethod); // New route
router.get("/employee/:empId/issues", protect, requireActiveSubscription, getPaymentIssues);

// Single-payment actions (receipt download + issue reporting)
router.get("/:id/receipt", protect, downloadReceipt);
router.post("/:id/report-issue", protect, reportPaymentIssue);

router.get("/:id", protect, getPaymentById);
router.post("/", createPayment);
router.patch("/:id/status", updatePaymentStatus);

export default router;