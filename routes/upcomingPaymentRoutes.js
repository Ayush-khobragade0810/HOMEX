import express from "express";
import {
    getUpcomingPayments,
    createUpcomingPayment,
    updateUpcomingPaymentStatus,
    deleteUpcomingPayment
} from "../controllers/upcomingPaymentController.js";

const router = express.Router();

router.get("/employee/:empId", getUpcomingPayments);
router.post("/", createUpcomingPayment);
router.patch("/:id/status", updateUpcomingPaymentStatus);
router.delete("/:id", deleteUpcomingPayment);

export default router;