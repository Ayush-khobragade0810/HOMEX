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

const router = express.Router();

router.get("/employee/:empId/dashboard", protect, getPaymentDashboard);
router.get("/employee/:empId/filter", protect, getFilteredPayments);
router.get("/employee/:empId/statistics", protect, getEarningsStatistics);
router.get("/employee/:empId/export", protect, exportPayments);
router.get("/employee/:empId/methods", protect, getPaymentMethods); // New route
router.post("/employee/:empId/withdraw", protect, requestWithdrawal); // New route
router.post("/employee/:empId/methods", protect, addPaymentMethod); // New route
router.get("/employee/:empId/issues", protect, getPaymentIssues);

// Single-payment actions (receipt download + issue reporting)
router.get("/:id/receipt", protect, downloadReceipt);
router.post("/:id/report-issue", protect, reportPaymentIssue);

router.get("/:id", protect, getPaymentById);
router.post("/", createPayment);
router.patch("/:id/status", updatePaymentStatus);

export default router;