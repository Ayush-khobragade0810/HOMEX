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
    getPaymentMethods
} from "../controllers/paymentController.js";

const router = express.Router();

router.get("/employee/:empId/dashboard", getPaymentDashboard);
router.get("/employee/:empId/filter", getFilteredPayments);
router.get("/employee/:empId/statistics", getEarningsStatistics);
router.get("/employee/:empId/export", exportPayments);
router.get("/employee/:empId/methods", getPaymentMethods); // New route
router.post("/employee/:empId/withdraw", requestWithdrawal); // New route
router.post("/employee/:empId/methods", addPaymentMethod); // New route

router.get("/:id", getPaymentById);
router.post("/", createPayment);
router.patch("/:id/status", updatePaymentStatus);

export default router;