import mongoose from 'mongoose';
import Employee from '../models/adminEmployee.js';
import {
    validatePaymentRequest,
    describeSubscription,
    subscriptionState,
    SUBSCRIPTION_AMOUNT,
    SERVICE_FEE
} from '../utils/subscription.js';
import SubscriptionLedger from '../models/SubscriptionLedger.js';
import { creditBalance } from '../services/serviceFeeService.js';
import { sendNotification } from '../utils/helpers.js';
import logger from '../utils/logger.js';
import { sendError } from '../utils/ApiError.js';
import { notifyAdmins, ADMIN_EVENTS } from '../utils/adminEvents.js';

/** The logged-in employee, or null when the caller is not an employee. */
const currentEmployee = async (req) => {
    if (req.user?.empId === undefined || req.user?.empId === null) return null;
    // Never pull `avatar`: on older records it holds a large inline image.
    return Employee.findById(req.user.id).select('-avatar');
};

/**
 * Push a subscription change to the employee's open pages (live update).
 * Employees usually log in with their User account (linked by email), so we
 * address that user's socket room; their Employee id room is covered too.
 */
const pushToEmployee = async (employee, payload) => {
    try {
        const [{ default: socketService }, { default: User }] = await Promise.all([
            import('../socket/socketService.js'),
            import('../models/User.js')
        ]);
        const user = employee.email ? await User.findOne({ email: employee.email }).select('_id').lean() : null;
        const rooms = new Set([`user:${employee._id}`]);
        if (user) rooms.add(`user:${user._id}`);
        rooms.forEach((room) => socketService.emitToRoom(room, 'subscription:updated', payload));
    } catch (err) {
        logger.warn({ err: err.message }, 'Live subscription push to employee failed');
    }
};

const notifyEmployee = async (employee, title, message) => {
    try {
        await sendNotification(employee._id.toString(), { type: 'system', title, message });
    } catch (err) {
        // A failed notification must never undo an approval/rejection.
        console.error('Subscription notification failed:', err.message);
    }
};

// @desc    Current employee's subscription status
// @route   GET /api/subscription/me
// @access  Private (employee)
export const getMySubscription = async (req, res) => {
    try {
        const employee = await currentEmployee(req);
        if (!employee) {
            return sendError(res, 403, 'Only employees have subscriptions');
        }
        res.json({ success: true, subscription: describeSubscription(employee.subscription) });
    } catch (error) {
        logger.error('Get subscription error', error);
        sendError(res, 500, 'Could not load subscription');
    }
};

// @desc    Employee reports a payment for admin verification
// @route   POST /api/subscription/me/request
// @access  Private (employee)
export const submitPaymentRequest = async (req, res) => {
    try {
        const employee = await currentEmployee(req);
        if (!employee) {
            return sendError(res, 403, 'Only employees have subscriptions');
        }

        const { errors, value } = validatePaymentRequest(req.body);
        if (Object.keys(errors).length) {
            // `errors` stays keyed by field: the subscription page highlights each input.
            return sendError(res, 400, Object.values(errors)[0], { code: 'VALIDATION_ERROR', errors });
        }
        const { transactionId, paymentMethod, paidOn, note } = value;

        if (employee.subscription?.pendingRequest?.submittedAt) {
            return sendError(res, 409, 'You already have a payment awaiting approval');
        }

        // One transaction reference can only ever pay for one period.
        // (Cash may have no reference at all — nothing to compare then.)
        const reused = transactionId && await Employee.exists({
            $or: [
                { 'subscription.pendingRequest.transactionId': transactionId },
                { 'subscription.history': { $elemMatch: { action: 'approved', transactionId } } }
            ]
        });
        if (reused) {
            return sendError(res, 409, 'This transaction reference has already been used', {
                errors: { transactionId: 'This transaction reference has already been used' }
            });
        }

        const request = {
            transactionId,
            paymentMethod,
            amount: SUBSCRIPTION_AMOUNT,
            paidOn,
            note,
            submittedAt: new Date()
        };

        employee.subscription = employee.subscription || {};
        employee.subscription.pendingRequest = request;
        employee.subscription.history.push({
            action: 'submitted',
            transactionId,
            paymentMethod,
            amount: SUBSCRIPTION_AMOUNT,
            by: employee._id
        });
        await employee.save();

        logger.audit('subscription_payment_submitted', req.user, `employee:${employee._id}`, { transactionId, paymentMethod });
        notifyAdmins(ADMIN_EVENTS.SUBSCRIPTION_REQUEST, {
            employeeId: String(employee._id),
            name: employee.empName,
            amount: SUBSCRIPTION_AMOUNT,
            paymentMethod
        });

        res.status(201).json({
            success: true,
            message: 'Payment submitted. You will get access as soon as an admin verifies it.',
            subscription: describeSubscription(employee.subscription)
        });
    } catch (error) {
        logger.error('Submit subscription payment error', error);
        sendError(res, 500, 'Could not submit payment');
    }
};

// @desc    Employees' subscriptions for admin review
// @route   GET /api/subscription/admin/requests?state=pending|active|low_balance|none|rejected|all
// @access  Private (admin)
export const listSubscriptions = async (req, res) => {
    try {
        const state = String(req.query.state || 'pending').toLowerCase();

        const employees = await Employee.find({})
            .select('empId empName email phone status subscription')
            .sort({ 'subscription.pendingRequest.submittedAt': 1, empName: 1 })
            .lean();

        const rows = employees
            .map((emp) => ({
                _id: emp._id,
                empId: emp.empId,
                name: emp.empName,
                email: emp.email,
                phone: emp.phone,
                employeeStatus: emp.status,
                ...describeSubscription(emp.subscription),
                history: (emp.subscription?.history || []).slice(-10).reverse()
            }))
            .filter((row) => state === 'all' || row.state === state || (state === 'pending' && row.pendingRequest));

        const counts = employees.reduce((acc, emp) => {
            const s = subscriptionState(emp.subscription);
            acc[s] = (acc[s] || 0) + 1;
            // Top-ups from already-active employees also await approval.
            if (s !== 'pending' && emp.subscription?.pendingRequest?.submittedAt) acc.pending = (acc.pending || 0) + 1;
            return acc;
        }, {});

        // Fees actually kept = charged minus refunded.
        const [feeTotals] = await SubscriptionLedger.aggregate([
            { $match: { reason: { $in: ['service_fee', 'service_fee_refund'] } } },
            {
                $group: {
                    _id: null,
                    charged: { $sum: { $cond: [{ $eq: ['$reason', 'service_fee'] }, '$amount', 0] } },
                    refunded: { $sum: { $cond: [{ $eq: ['$reason', 'service_fee_refund'] }, '$amount', 0] } },
                    chargedCount: { $sum: { $cond: [{ $eq: ['$reason', 'service_fee'] }, 1, 0] } },
                    refundedCount: { $sum: { $cond: [{ $eq: ['$reason', 'service_fee_refund'] }, 1, 0] } }
                }
            }
        ]);

        const summary = {
            serviceFee: SERVICE_FEE,
            topUpAmount: SUBSCRIPTION_AMOUNT,
            feesCollected: (feeTotals?.charged || 0) - (feeTotals?.refunded || 0),
            servicesCharged: (feeTotals?.chargedCount || 0) - (feeTotals?.refundedCount || 0),
            totalBalance: rows.reduce((sum, r) => sum + (r.balance || 0), 0)
        };

        res.json({ success: true, data: rows, counts, summary });
    } catch (error) {
        logger.error('List subscriptions error', error);
        sendError(res, 500, 'Could not load subscriptions');
    }
};

// @desc    Approve an employee's reported payment and add it to their balance
// @route   PUT /api/subscription/admin/:employeeId/approve
// @access  Private (admin)
export const approvePayment = async (req, res) => {
    try {
        const { employeeId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(employeeId)) {
            return sendError(res, 400, 'Invalid employee id');
        }

        const existing = await Employee.findById(employeeId).select('subscription.pendingRequest').lean();
        if (!existing) return sendError(res, 404, 'Employee not found');

        const request = existing.subscription?.pendingRequest;
        if (!request?.submittedAt) {
            return sendError(res, 409, 'No payment is awaiting approval for this employee');
        }

        const adminId = req.user?._id || req.user?.id;
        const amount = Number(request.amount) || SUBSCRIPTION_AMOUNT;

        // Consume the request atomically first: two admins approving at once
        // can't both credit it.
        const consumed = await Employee.findOneAndUpdate(
            { _id: employeeId, 'subscription.pendingRequest.submittedAt': request.submittedAt },
            {
                $unset: { 'subscription.pendingRequest': '', 'subscription.lastRejection': '' },
                $min: { 'subscription.activatedAt': new Date() }, // keeps the first activation
                $push: {
                    'subscription.history': {
                        action: 'approved',
                        transactionId: request.transactionId,
                        paymentMethod: request.paymentMethod,
                        amount,
                        by: adminId
                    }
                }
            },
            { new: true, projection: { avatar: 0 } }
        );
        if (!consumed) {
            return sendError(res, 409, 'This payment was already processed');
        }

        const balance = await creditBalance(employeeId, amount, {
            reason: 'subscription_payment',
            transactionId: request.transactionId,
            by: adminId
        });
        consumed.subscription.balance = balance;

        notifyAdmins(ADMIN_EVENTS.SUBSCRIPTIONS_CHANGED, { employeeId: String(employeeId), type: 'approved' });
        pushToEmployee(consumed, { type: 'approved', amount, balance });
        logger.audit('subscription_approved', req.user, `employee:${employeeId}`, {
            transactionId: request.transactionId,
            amount,
            balance
        });

        await notifyEmployee(
            consumed,
            'Subscription payment approved',
            `₹${amount.toLocaleString('en-IN')} was added to your balance. New balance: ₹${balance.toLocaleString('en-IN')} (${Math.floor(balance / (SERVICE_FEE || 1))} services).`
        );

        res.json({ success: true, message: 'Payment approved', subscription: describeSubscription(consumed.subscription) });
    } catch (error) {
        logger.error('Approve subscription error', error);
        sendError(res, 500, 'Could not approve payment');
    }
};

// @desc    Reject an employee's reported payment
// @route   PUT /api/subscription/admin/:employeeId/reject
// @access  Private (admin)
export const rejectPayment = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const reason = String(req.body.reason || '').trim().slice(0, 300);

        if (!mongoose.Types.ObjectId.isValid(employeeId)) {
            return sendError(res, 400, 'Invalid employee id');
        }
        if (!reason) {
            return sendError(res, 400, 'Give the employee a reason so they can fix it');
        }

        const employee = await Employee.findById(employeeId).select('-avatar');
        if (!employee) return sendError(res, 404, 'Employee not found');

        const request = employee.subscription?.pendingRequest;
        if (!request?.submittedAt) {
            return sendError(res, 409, 'No payment is awaiting approval for this employee');
        }

        employee.subscription.lastRejection = { transactionId: request.transactionId, reason, at: new Date() };
        employee.subscription.history.push({
            action: 'rejected',
            transactionId: request.transactionId,
            paymentMethod: request.paymentMethod,
            amount: request.amount,
            reason,
            by: req.user?._id || req.user?.id
        });
        employee.subscription.pendingRequest = undefined;
        await employee.save();

        notifyAdmins(ADMIN_EVENTS.SUBSCRIPTIONS_CHANGED, { employeeId: String(employee._id), type: 'rejected' });
        pushToEmployee(employee, { type: 'rejected', reason });
        logger.audit('subscription_rejected', req.user, `employee:${employee._id}`, { transactionId: request.transactionId, reason });

        await notifyEmployee(employee, 'Subscription payment not verified', `Your payment could not be verified: ${reason}`);

        res.json({ success: true, message: 'Payment rejected', subscription: describeSubscription(employee.subscription) });
    } catch (error) {
        logger.error('Reject subscription error', error);
        sendError(res, 500, 'Could not reject payment');
    }
};

/** Newest-first page of ledger entries for one employee. */
const ledgerPage = async (employeeId, query) => {
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const [entries, total] = await Promise.all([
        SubscriptionLedger.find({ employee: employeeId })
            .sort({ createdAt: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        SubscriptionLedger.countDocuments({ employee: employeeId })
    ]);
    return { entries, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
};

// @desc    Current employee's balance history
// @route   GET /api/subscription/me/ledger?page=&limit=
// @access  Private (employee)
export const getMyLedger = async (req, res) => {
    try {
        const employee = await currentEmployee(req);
        if (!employee) {
            return sendError(res, 403, 'Only employees have subscriptions');
        }
        res.json({
            success: true,
            subscription: describeSubscription(employee.subscription),
            ...(await ledgerPage(employee._id, req.query))
        });
    } catch (error) {
        logger.error('Get ledger error', error);
        sendError(res, 500, 'Could not load balance history');
    }
};

// @desc    One employee's balance history, for admin
// @route   GET /api/subscription/admin/:employeeId/ledger?page=&limit=
// @access  Private (admin)
export const getEmployeeLedger = async (req, res) => {
    try {
        const { employeeId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(employeeId)) {
            return sendError(res, 400, 'Invalid employee id');
        }
        const employee = await Employee.findById(employeeId).select('subscription').lean();
        if (!employee) return sendError(res, 404, 'Employee not found');

        res.json({
            success: true,
            subscription: describeSubscription(employee.subscription),
            ...(await ledgerPage(employeeId, req.query))
        });
    } catch (error) {
        logger.error('Get employee ledger error', error);
        sendError(res, 500, 'Could not load balance history');
    }
};

// @desc    Services the employee already paid the fee for and hasn't finished.
//          Shown on the subscription page so a locked dashboard (balance too
//          low) never strands work in progress.
// @route   GET /api/subscription/me/open-jobs
// @access  Private (employee)
export const getMyOpenJobs = async (req, res) => {
    try {
        const employee = await currentEmployee(req);
        if (!employee) {
            return sendError(res, 403, 'Only employees have subscriptions');
        }

        const { default: Booking } = await import('../models/Booking.js');
        const bookings = await Booking.find({
            'serviceFee.employee': employee._id,
            'serviceFee.status': 'charged',
            status: { $not: /^(completed|cancel+ed|rejected)$/i }
        })
            .populate('userId', 'name phone')
            .populate('location.area', 'areaName city')
            .select('bookingId status serviceDetails.title schedule location contactIdInfo userId')
            .sort({ 'schedule.preferredDate': 1 })
            .lean();

        const jobs = bookings.map((b) => {
            const area = b.location?.area;
            const street = b.location?.completeAddress || b.location?.address || '';
            return {
                _id: b._id,
                bookingId: b.bookingId,
                title: b.serviceDetails?.title || 'Service',
                status: String(b.status || '').toUpperCase(),
                date: b.schedule?.preferredDate || null,
                timeSlot: b.schedule?.timeSlot || '',
                customerName: b.contactIdInfo?.fullName || b.userId?.name || 'Customer',
                customerPhone: b.contactIdInfo?.phoneNumber || b.userId?.phone || '',
                address: [street, area?.areaName, area?.city].filter(Boolean).join(', ')
            };
        });

        res.json({ success: true, jobs });
    } catch (error) {
        logger.error('Get open jobs error', error);
        sendError(res, 500, 'Could not load your open services');
    }
};
