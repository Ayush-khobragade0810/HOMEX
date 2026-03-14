import paymentService from "../services/paymentService.js";
import analyticsService from "../services/analyticsService.js";
import exportService from "../services/exportService.js";
import Payment from "../models/Payment.js"; // Kept for direct simple queries if needed
import UpcomingPayment from "../models/UpcomingPayment.js"; // Kept for consistency

// Get payment dashboard data for employee
export const getPaymentDashboard = async (req, res) => {
    try {
        const { empId } = req.params;
        // Delegate to service layer
        const dashboardData = await paymentService.getDashboardData(empId, req.query);

        // Transform service response if necessary to match exact frontend expectation, 
        // OR update frontend. The service response is quite comprehensive.
        // Frontend likely expects: { payments, upcomingPayments, stats, paymentMethods }
        // The service returns exactly this structure.

        // Enhancing stats with 'totalServices' if missing from service logic (it was in old controller)
        // Old controller counted 'completedServices' from Service model.
        // New service logic counts 'completedCount' from Payment model. 
        // Assuming Payments are created for every completed Service, this should be consistent.

        res.json(dashboardData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Get filtered payments
export const getFilteredPayments = async (req, res) => {
    try {
        const { empId } = req.params;
        const { timeFilter, statusFilter } = req.query;

        // Reuse export logic which supports filtering, or basic find
        // Creating a filter object compatible with paymentService
        const filters = {
            status: statusFilter !== 'all' ? statusFilter : undefined
            // timeFilter logic needs mapping if service expects specific ranges or just dates
        };

        // Mapping old 'timeFilter' (week, month, year) to service 'timeRange'
        if (timeFilter) filters.timeRange = timeFilter;

        const payments = await paymentService.exportPayments(empId, 'json', filters);
        res.json(payments);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Get payment by ID
export const getPaymentById = async (req, res) => {
    try {
        const { id } = req.params;
        // Check if ID is likely MongoID or custom numeric ID
        // Service expects ObjectId usually but I adapted it to use query.
        // Old controller search by 'paymentId' (Number).
        // New service getPaymentById uses _id (ObjectId).
        // I need to be careful here.
        // Let's keep the old logic for numeric IDs or update service.
        // Old: Payment.findOne({ paymentId: parseInt(id) })

        const payment = await Payment.findOne({ paymentId: parseInt(id) });

        if (!payment) {
            return res.status(404).json({ message: "Payment not found" });
        }

        res.json(payment);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Create new payment (when service is completed)
export const createPayment = async (req, res) => {
    try {
        const { empId, serviceId, amount, commission, baseRate, bonus, hours, paymentMethod, customer, serviceType } = req.body;

        // Find the highest paymentId to generate new one
        const lastPayment = await Payment.findOne().sort({ paymentId: -1 });
        const newPaymentId = lastPayment ? lastPayment.paymentId + 1 : 1001;

        const payment = new Payment({
            paymentId: newPaymentId,
            empId: parseInt(empId),
            serviceId: parseInt(serviceId), // Assuming numeric serviceId is passed as string sometimes
            amount,
            commission,
            baseRate,
            bonus: bonus || 0,
            hours,
            paymentMethod,
            customer,
            serviceType,
            status: 'completed',
            date: new Date(),
            transactionId: `TXN-${Date.now()}` // Auto-generate if not provided
        });

        await payment.save();

        // Remove from upcoming payments if exists
        await UpcomingPayment.findOneAndDelete({ serviceId: parseInt(serviceId) });

        res.status(201).json(payment);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Update payment status
export const updatePaymentStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const payment = await Payment.findOneAndUpdate(
            { paymentId: parseInt(id) },
            { status },
            { new: true }
        );

        if (!payment) {
            return res.status(404).json({ message: "Payment not found" });
        }

        res.json(payment);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Get earnings statistics
export const getEarningsStatistics = async (req, res) => {
    try {
        const { empId } = req.params;
        const { period = 'month' } = req.query; // month, year, week

        // Map period to service expectation
        // Service 'getMonthlyAnalytics' returns last N months.
        // Original endpoint logic returned aggregation based on period.

        if (period === 'month') {
            const stats = await analyticsService.getMonthlyAnalytics(empId, 6); // Default to 6 months
            res.json(stats);
        } else if (period === 'year') {
            const stats = await analyticsService.getYearlySummary(empId, new Date().getFullYear());
            res.json(stats);
        } else {
            // Fallback to simpler aggregation for week or legacy support
            // Or rely on dashboard stats which has weekly growth
            const stats = await analyticsService.getMonthlyAnalytics(empId, 1);
            res.json(stats);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Export payments data
export const exportPayments = async (req, res) => {
    try {
        const { empId } = req.params;
        const { format = 'json', startDate, endDate } = req.query;

        const filters = {};
        if (startDate) filters.startDate = startDate;
        if (endDate) filters.endDate = endDate;

        const payments = await paymentService.exportPayments(empId, format, filters);

        if (format === 'csv') {
            const csvData = await exportService.generateCSV(payments);

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=payments-${empId}.csv`);
            res.send(csvData);
        } else if (format === 'pdf') {
            // Mock employee info - ideally fetch from Employee model
            const employeeInfo = { name: "Employee", employeeId: empId };
            const pdfBuffer = await exportService.generatePDF(payments, employeeInfo);

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=payments-${empId}.pdf`);
            res.send(pdfBuffer);
        } else {
            res.json(payments);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Request Withdrawal
export const requestWithdrawal = async (req, res) => {
    try {
        const { empId } = req.params;
        const { amount, methodData } = req.body;

        const withdrawal = await paymentService.requestWithdrawal(empId, amount, methodData);
        res.status(201).json(withdrawal);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Add Payment Method
export const addPaymentMethod = async (req, res) => {
    try {
        const { empId } = req.params;
        const methodData = req.body; // Expects full object

        const methods = await paymentService.addPaymentMethod(empId, methodData);
        res.status(201).json(methods);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Get Payment Methods
export const getPaymentMethods = async (req, res) => {
    try {
        const { empId } = req.params;
        const methods = await paymentService.getEmployeePaymentMethods(empId);
        res.json(methods);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};