import express from "express";
import { getEmployeePayments, exportPayments } from "../controllers/payment.controller.js";

const router = express.Router();

router.get("/employee/:employeeId/dashboard", getEmployeePayments);
router.get("/employee/:employeeId/export", exportPayments);

export default router;
