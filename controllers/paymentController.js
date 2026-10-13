import paymentService from "../services/paymentService.js";
import analyticsService from "../services/analyticsService.js";
import exportService from "../services/exportService.js";
import Payment from "../models/Payment.js"; // Kept for direct simple queries if needed
import UpcomingPayment from "../models/UpcomingPayment.js"; // Kept for consistency
import PaymentIssue from "../models/PaymentIssue.js";
import Employee from "../models/adminEmployee.js";
import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";

const isNumericId = (value) => /^\d+$/.test(String(value ?? '').trim());

const resolveNumericEmpId = async (idInput) => {
    if (!idInput) return null;
    if (isNumericId(idInput)) {
        return parseInt(idInput, 10);
    }
    if (mongoose.Types.ObjectId.isValid(idInput)) {
        const emp = await Employee.findById(idInput).select('empId').lean();
        if (emp) return emp.empId;
    }
    return null;
};

/**
 * Resolves `:empId` to the numeric empId and checks the caller may act on it:
 * 400 for a malformed id, 404 for an unknown employee, 403 for someone else's.
 */
const resolveOwnEmpId = async (req, deniedMessage) => {
    const raw = req.params.empId;
    if (!isNumericId(raw) && !mongoose.Types.ObjectId.isValid(raw)) {
        throw ApiError.badRequest("Invalid employee ID format");
    }
    const empId = await resolveNumericEmpId(raw);
    if (!empId) throw ApiError.notFound("Employee not found");

    // Security check: only allow admin or the logged-in employee themselves
    if (req.user.role !== 'admin' && parseInt(req.user.empId) !== parseInt(empId)) {
        throw ApiError.forbidden(deniedMessage);
    }
    return empId;
};

// Resolve a payment from either its Mongo _id or its numeric paymentId
const findPaymentByAnyId = async (idInput) => {
    if (!idInput) return null;

    if (mongoose.Types.ObjectId.isValid(idInput) && String(new mongoose.Types.ObjectId(idInput)) === String(idInput).toLowerCase()) {
        const byObjectId = await Payment.findById(idInput);
        if (byObjectId) return byObjectId;
    }

    // Only a purely numeric id is a paymentId — parseInt("65ab…") would be 65.
    if (isNumericId(idInput)) {
        return await Payment.findOne({ paymentId: parseInt(idInput, 10) });
    }

    return null;
};

const assertOwnPayment = (req, payment, deniedMessage) => {
    if (req.user.role !== 'admin' && parseInt(req.user.empId) !== parseInt(payment.empId)) {
        throw ApiError.forbidden(deniedMessage);
    }
};

// Get payment dashboard data for employee
export const getPaymentDashboard = async (req, res) => {
    const empId = await resolveOwnEmpId(req, "Access denied. You can only view your own payment dashboard.");

    // Delegate to service layer
    const dashboardData = await paymentService.getDashboardData(empId, req.query);

    res.json(dashboardData);
};

// Get filtered payments
export const getFilteredPayments = async (req, res) => {
    const empId = await resolveOwnEmpId(req, "Access denied. You can only view your own payments.");

    const { timeFilter, statusFilter } = req.query;

    // Reuse export logic which supports filtering, or basic find
    // Creating a filter object compatible with paymentService
    const filters = {
        status: statusFilter && statusFilter !== 'all' ? statusFilter : undefined
    };

    // Mapping old 'timeFilter' (week, month, year) to service 'timeRange'
    if (timeFilter) filters.timeRange = timeFilter;

    const payments = await paymentService.exportPayments(empId, 'json', filters);
    res.json(payments);
};

// Get payment by ID
export const getPaymentById = async (req, res) => {
    const payment = await findPaymentByAnyId(req.params.id);

    if (!payment) throw ApiError.notFound("Payment not found");

    assertOwnPayment(req, payment, "Access denied. You can only view your own payments.");

    res.json(payment);
};

// Create new payment (when service is completed)
export const createPayment = async (req, res) => {
    const { empId, serviceId, amount, commission, baseRate, bonus, hours, paymentMethod, customer, serviceType } = req.body;

    // Numeric service ids are stored as their number string; others (e.g. "BK-…") as-is.
    const serviceRef = isNumericId(serviceId) ? String(parseInt(serviceId, 10)) : String(serviceId).trim();

    if (await Payment.exists({ serviceId: serviceRef })) {
        throw ApiError.conflict("A payment has already been recorded for this service");
    }

    // Find the highest paymentId to generate new one
    const lastPayment = await Payment.findOne().sort({ paymentId: -1 }).select('paymentId').lean();
    const newPaymentId = lastPayment ? lastPayment.paymentId + 1 : 1001;

    const payment = new Payment({
        paymentId: newPaymentId,
        empId: parseInt(empId, 10),
        serviceId: serviceRef,
        amount: Number(amount),
        commission: Number(commission),
        baseRate: Number(baseRate),
        bonus: Number(bonus) || 0,
        hours: Number(hours),
        paymentMethod,
        customer,
        serviceType,
        status: 'completed',
        date: new Date(),
        transactionId: `TXN-${Date.now()}` // Auto-generate if not provided
    });

    await payment.save();

    // Remove from upcoming payments if exists
    if (isNumericId(serviceId)) {
        await UpcomingPayment.findOneAndDelete({ serviceId: parseInt(serviceId, 10) });
    }

    res.status(201).json(payment);
};

// Update payment status
export const updatePaymentStatus = async (req, res) => {
    const status = String(req.body.status).trim().toLowerCase();

    const payment = await findPaymentByAnyId(req.params.id);
    if (!payment) throw ApiError.notFound("Payment not found");

    if (payment.status === status) {
        throw ApiError.conflict(`Payment is already ${status}`);
    }
    if (payment.status === 'refunded') {
        throw ApiError.conflict("This payment has been refunded and its status can no longer be changed");
    }

    // Atomic on the status we checked, so two concurrent updates can't both apply.
    const updated = await Payment.findOneAndUpdate(
        { _id: payment._id, status: payment.status },
        { status },
        { new: true }
    );
    if (!updated) throw ApiError.conflict("This payment was updated by someone else. Refresh and try again.");

    res.json(updated);
};

// Get earnings statistics
export const getEarningsStatistics = async (req, res) => {
    const empId = await resolveOwnEmpId(req, "Access denied. You can only view your own statistics.");

    const { period = 'month' } = req.query; // month, year, week

    if (period === 'month') {
        const stats = await analyticsService.getMonthlyAnalytics(empId, 6); // Default to 6 months
        res.json(stats);
    } else if (period === 'year') {
        const stats = await analyticsService.getYearlySummary(empId, new Date().getFullYear());
        res.json(stats);
    } else {
        const stats = await analyticsService.getMonthlyAnalytics(empId, 1);
        res.json(stats);
    }
};

// Export payments data
export const exportPayments = async (req, res) => {
    const empId = await resolveOwnEmpId(req, "Access denied. You can only export your own payments.");

    const { format = 'json', startDate, endDate, timeFilter, statusFilter } = req.query;

    const filters = {};
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (timeFilter) filters.timeRange = timeFilter;
    if (statusFilter) filters.status = statusFilter;

    const payments = await paymentService.exportPayments(empId, format, filters);

    if (format === 'csv') {
        const csvData = await exportService.generateCSV(payments);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=payments-${empId}.csv`);
        res.send(csvData);
    } else if (format === 'pdf') {
        const employeeInfo = { name: req.user.name || "Employee", employeeId: empId };
        const pdfBuffer = await exportService.generatePDF(payments, employeeInfo);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=payments-${empId}.pdf`);
        res.send(pdfBuffer);
    } else {
        res.json(payments);
    }
};

const formatRupees = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Request Withdrawal
export const requestWithdrawal = async (req, res) => {
    const empId = await resolveOwnEmpId(req, "Access denied. You can only request withdrawal for yourself.");

    const amount = Number(req.body.amount);
    const methodData = { ...req.body.methodData };

    // Saved methods use 'bank'; withdrawals record it as 'bank_transfer'.
    const type = String(methodData.type || '').trim().toLowerCase();
    methodData.type = type === 'upi' ? 'upi' : 'bank_transfer';
    // For UPI the saved method keeps the UPI ID in accountNumber.
    if (methodData.type === 'upi' && !methodData.upiId) methodData.upiId = methodData.accountNumber;

    const employee = await Employee.findOne({ empId }).select('walletBalance').lean();
    if (!employee) throw ApiError.notFound("Employee not found");

    const available = Number(employee.walletBalance) || 0;
    if (amount > available) {
        throw ApiError.badRequest(
            `Withdrawal amount (${formatRupees(amount)}) exceeds your available balance (${formatRupees(available)})`,
            { code: 'INSUFFICIENT_WALLET_BALANCE' }
        );
    }

    const withdrawal = await paymentService.requestWithdrawal(empId, amount, methodData);
    res.status(201).json(withdrawal);
};

// Add Payment Method
export const addPaymentMethod = async (req, res) => {
    const empId = await resolveOwnEmpId(req, "Access denied. You can only manage payment methods for yourself.");

    // Only the fields a payout method has — never client-supplied _id / isDefault / addedAt.
    const type = String(req.body.type).trim().toLowerCase();
    const methodData = {
        type,
        accountHolder: String(req.body.accountHolder).trim(),
        accountNumber: String(req.body.accountNumber).trim(),
        ifsc: type === 'bank' ? String(req.body.ifsc || '').trim().toUpperCase() : undefined,
        bankName: req.body.bankName ? String(req.body.bankName).trim() : undefined
    };

    const employee = await Employee.findOne({ empId }).select('paymentMethods').lean();
    if (!employee) throw ApiError.notFound("Employee not found");

    const duplicate = (employee.paymentMethods || []).some(m =>
        m.type === methodData.type &&
        String(m.accountNumber || '').trim().toLowerCase() === methodData.accountNumber.toLowerCase());
    if (duplicate) {
        throw ApiError.conflict(type === 'upi'
            ? "This UPI ID is already saved"
            : "This bank account is already saved");
    }

    const methods = await paymentService.addPaymentMethod(empId, methodData);
    res.status(201).json(methods);
};

// Get Payment Methods
export const getPaymentMethods = async (req, res) => {
    const empId = await resolveOwnEmpId(req, "Access denied. You can only view your own payment methods.");

    const methods = await paymentService.getEmployeePaymentMethods(empId);
    res.json(methods);
};

// Download a PDF receipt for a single payment
export const downloadReceipt = async (req, res) => {
    const payment = await findPaymentByAnyId(req.params.id);

    if (!payment) throw ApiError.notFound("Payment not found");

    assertOwnPayment(req, payment, "Access denied. You can only download your own receipts.");

    const employee = await Employee.findOne({ empId: payment.empId }).select('empName name email').lean();
    const employeeInfo = {
        name: employee?.empName || employee?.name || req.user.name || "Employee",
        empId: payment.empId,
        email: employee?.email || req.user.email
    };

    const pdfBuffer = await exportService.generateReceipt(payment.toObject(), employeeInfo);
    const fileId = payment.transactionId || payment.paymentId || String(payment._id).slice(-8);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt-${fileId}.pdf`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
};

// Report an issue against a payment
export const reportPaymentIssue = async (req, res) => {
    const payment = await findPaymentByAnyId(req.params.id);

    if (!payment) throw ApiError.notFound("Payment not found");

    assertOwnPayment(req, payment, "Access denied. You can only report issues on your own payments.");

    const { category, description } = req.body;

    if (!description || !String(description).trim()) {
        throw ApiError.badRequest("Please describe the issue.");
    }

    const issueCategory = category || 'other';
    const alreadyOpen = await PaymentIssue.exists({
        payment: payment._id,
        category: issueCategory,
        status: { $in: ['open', 'in_review'] }
    });
    if (alreadyOpen) {
        throw ApiError.conflict("You already have an open issue of this type for this payment. Our team is reviewing it.");
    }

    const issue = await PaymentIssue.create({
        paymentId: payment.paymentId,
        payment: payment._id,
        empId: payment.empId,
        reportedByName: req.user.name,
        reportedByEmail: req.user.email,
        category: issueCategory,
        description: String(description).trim(),
        paymentSnapshot: {
            amount: payment.amount,
            commission: payment.commission,
            status: payment.status,
            date: payment.date,
            transactionId: payment.transactionId
        }
    });

    res.status(201).json({
        message: "Issue reported successfully. Our team will review it shortly.",
        issue
    });
};

// List issues reported by an employee
export const getPaymentIssues = async (req, res) => {
    const empId = await resolveOwnEmpId(req, "Access denied. You can only view your own reported issues.");

    const issues = await PaymentIssue.find({ empId }).sort({ createdAt: -1 }).lean();
    res.json(issues);
};
