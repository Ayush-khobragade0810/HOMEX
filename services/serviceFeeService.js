/**
 * The per-service fee: SERVICE_FEE comes out of an employee's subscription
 * balance when they take a service, and goes back if the booking is later
 * cancelled by the customer or admin (not by the employee).
 *
 * Every balance change goes through here so the balance and the ledger never
 * disagree.
 *
 * Concurrency: `booking.serviceFee.status` is the lock. A charge first claims
 * the booking atomically (no active charge → 'charging'), then takes the money
 * with a conditional decrement (balance >= fee). Two simultaneous accepts can't
 * both charge, and a balance can never go below zero.
 */
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import Employee from '../models/adminEmployee.js';
import SubscriptionLedger from '../models/SubscriptionLedger.js';
import { SERVICE_FEE } from '../utils/subscription.js';
import logger from '../utils/logger.js';
import { notifyAdmins, ADMIN_EVENTS } from '../utils/adminEvents.js';

const CANCELLED = ['CANCELLED', 'cancelled', 'Cancelled', 'CANCELED', 'canceled'];

// Moving a booking into any of these means the employee has taken it. Start /
// complete count too, so skipping the accept step can't skip the fee.
const TAKEN = new Set([
    'ACCEPTED', 'CONFIRMED', 'NAVIGATING', 'EN_ROUTE', 'STARTED',
    'IN_PROGRESS', 'IN PROGRESS', 'COMPLETED'
]);

export const isTakingStatus = (status) => TAKEN.has(String(status || '').trim().toUpperCase());

const isEmployeeRequest = (req) => req?.user?.empId !== undefined && req?.user?.empId !== null;

const bookingQueryFor = (id) =>
    mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: String(id) };

/** Credit the balance (approved top-up, opening balance). */
export const creditBalance = async (employeeId, amount, { reason = 'subscription_payment', transactionId, note, by } = {}) => {
    const employee = await Employee.findByIdAndUpdate(
        employeeId,
        { $inc: { 'subscription.balance': amount } },
        { new: true }
    ).select('empId subscription.balance');

    await SubscriptionLedger.create({
        employee: employeeId,
        empId: employee.empId,
        type: 'credit',
        reason,
        amount,
        balanceAfter: employee.subscription.balance,
        transactionId,
        note,
        by
    });

    return employee.subscription.balance;
};

/**
 * Take the service fee for `booking` from `employee`.
 * Resolves { ok: true, charged } or { ok: false, status, body } ready to send.
 */
export const chargeServiceFee = async (employee, booking) => {
    // Grandfathered employees never paid in a balance, so there is nothing to take.
    if (employee.subscription?.exempt || SERVICE_FEE <= 0) return { ok: true, charged: false };

    const current = booking.serviceFee;
    if (current?.status === 'charged' || current?.status === 'charging') {
        if (String(current.employee) === String(employee._id)) return { ok: true, charged: false };
        // Charged to someone else and never refunded — shouldn't happen, since
        // reassignment refunds. Refuse rather than charge twice.
        return {
            ok: false,
            status: 409,
            body: { success: false, code: 'FEE_CONFLICT', message: 'This service is already taken by another employee.' }
        };
    }

    // 1. Claim the booking.
    const claimed = await Booking.findOneAndUpdate(
        { _id: booking._id, 'serviceFee.status': { $nin: ['charging', 'charged'] } },
        { $set: { serviceFee: { status: 'charging', employee: employee._id, amount: SERVICE_FEE, chargedAt: new Date() } } },
        { new: true }
    );
    if (!claimed) {
        // Lost a race to a concurrent request for the same booking.
        const fresh = await Booking.findById(booking._id).select('serviceFee').lean();
        return fresh?.serviceFee?.employee && String(fresh.serviceFee.employee) === String(employee._id)
            ? { ok: true, charged: false }
            : { ok: false, status: 409, body: { success: false, code: 'FEE_CONFLICT', message: 'This service is already taken by another employee.' } };
    }

    // 2. Take the money, only if the balance covers it.
    const debited = await Employee.findOneAndUpdate(
        { _id: employee._id, 'subscription.balance': { $gte: SERVICE_FEE } },
        { $inc: { 'subscription.balance': -SERVICE_FEE } },
        { new: true }
    ).select('empId subscription.balance');

    if (!debited) {
        // Release the claim, restoring any earlier (refunded) fee record.
        await Booking.updateOne(
            { _id: booking._id, 'serviceFee.status': 'charging' },
            current ? { $set: { serviceFee: current } } : { $unset: { serviceFee: '' } }
        );
        const balance = Number(employee.subscription?.balance) || 0;
        return {
            ok: false,
            status: 402,
            body: {
                success: false,
                code: 'INSUFFICIENT_BALANCE',
                message: `Your subscription balance is ₹${balance}. Each service needs ₹${SERVICE_FEE} — top up to accept new services.`,
                balance,
                serviceFee: SERVICE_FEE
            }
        };
    }

    // 3. Record it.
    await SubscriptionLedger.create({
        employee: employee._id,
        empId: debited.empId,
        type: 'debit',
        reason: 'service_fee',
        amount: SERVICE_FEE,
        balanceAfter: debited.subscription.balance,
        booking: booking._id,
        bookingRef: booking.bookingId,
        serviceTitle: booking.serviceDetails?.title || booking.serviceName
    });
    await Booking.updateOne({ _id: booking._id }, { $set: { 'serviceFee.status': 'charged' } });

    logger.info({ employee: String(employee._id), booking: String(booking._id), balance: debited.subscription.balance }, 'Service fee charged');
    notifyAdmins(ADMIN_EVENTS.SUBSCRIPTIONS_CHANGED, { employeeId: String(employee._id), type: 'fee', balance: debited.subscription.balance });
    return { ok: true, charged: true, balance: debited.subscription.balance };
};

/**
 * Give the fee back for one booking. Idempotent: only a booking still marked
 * 'charged' is refunded, and the status flip is the lock.
 */
export const refundServiceFee = async (bookingId, reason) => {
    const before = await Booking.findOneAndUpdate(
        { _id: bookingId, 'serviceFee.status': 'charged' },
        { $set: { 'serviceFee.status': 'refunded', 'serviceFee.refundedAt': new Date(), 'serviceFee.refundReason': reason } },
        { new: false }
    ).select('bookingId serviceDetails.title serviceFee').lean();

    if (!before) return false;

    const { employee: employeeId, amount } = before.serviceFee;
    const employee = await Employee.findByIdAndUpdate(
        employeeId,
        { $inc: { 'subscription.balance': amount } },
        { new: true }
    ).select('empId subscription.balance');
    if (!employee) return false;

    await SubscriptionLedger.create({
        employee: employeeId,
        empId: employee.empId,
        type: 'credit',
        reason: 'service_fee_refund',
        amount,
        balanceAfter: employee.subscription.balance,
        booking: before._id,
        bookingRef: before.bookingId,
        serviceTitle: before.serviceDetails?.title,
        note: reason
    });

    logger.info({ employee: String(employeeId), booking: String(before._id), reason }, 'Service fee refunded');
    notifyAdmins(ADMIN_EVENTS.SUBSCRIPTIONS_CHANGED, { employeeId: String(employeeId), type: 'refund', balance: employee.subscription.balance });
    return true;
};

/**
 * Called from the Booking model hooks after any status change: refunds every
 * charged booking in `filter` that is now cancelled — unless the employee
 * cancelled it themselves.
 */
export const refundFeesForCancelledBookings = async (filter = {}) => {
    const bookings = await Booking.find({
        ...filter,
        status: { $in: CANCELLED },
        'serviceFee.status': 'charged',
        cancelledBy: { $ne: 'technician' }
    }).select('_id cancelledBy').lean();

    for (const b of bookings) {
        await refundServiceFee(b._id, `Cancelled by ${b.cancelledBy || 'customer/admin'}`);
    }
};

/** Refund when admin moves a booking to a different employee. */
export const refundOnReassign = async (bookingId, newEmployeeId) => {
    const booking = await Booking.findById(bookingId).select('serviceFee').lean();
    const fee = booking?.serviceFee;
    if (fee?.status === 'charged' && String(fee.employee) !== String(newEmployeeId)) {
        await refundServiceFee(bookingId, 'Reassigned to another employee');
    }
};

const BOOKING_FIELDS = 'bookingId assignedTo serviceDetails.title serviceFee status';

/**
 * The booking behind an id from an employee endpoint. That id may be a booking
 * _id / bookingId, or a legacy Service record's id: admin assignment creates a
 * Service copy whose notes end "Booking Ref: <bookingId>", and the dashboard
 * accepts those through the schedule routes. Following the ref means accepting
 * the copy can't skip the fee.
 */
export const findBookingForId = async (id) => {
    const direct = await Booking.findOne(bookingQueryFor(id)).select(BOOKING_FIELDS).lean();
    if (direct) return direct;

    const { default: Service } = await import('../models/Service.js');
    const numeric = Number(id);
    const service = await Service.findOne(
        mongoose.Types.ObjectId.isValid(id) ? { _id: id } : Number.isFinite(numeric) ? { serviceId: numeric } : { _id: null }
    ).select('notes').lean();

    const ref = /Booking Ref:\s*(\S+)\s*$/i.exec(service?.notes || '')?.[1];
    return ref ? Booking.findOne({ bookingId: ref }).select(BOOKING_FIELDS).lean() : null;
};

/**
 * Gate for employee endpoints that move a booking forward. Call before the
 * status update:
 *
 *   const fee = await chargeForStatusChange(req, id, nextStatus);
 *   if (!fee.ok) return res.status(fee.status).json(fee.body);
 *
 * No-op for admins, for statuses that don't take the job, and for ids that
 * aren't bookings (legacy Service records). Also refuses bookings assigned to
 * someone else, which the accept endpoints previously didn't check.
 */
export const chargeForStatusChange = async (req, bookingId, nextStatus) => {
    if (!isEmployeeRequest(req) || !isTakingStatus(nextStatus)) return { ok: true };

    const booking = await findBookingForId(bookingId);
    if (!booking) return { ok: true }; // not linked to a booking; the handler deals with it

    const assignee = booking.assignedTo?.technicianId;
    if (!assignee || String(assignee) !== String(req.user.id)) {
        return {
            ok: false,
            status: 403,
            body: { success: false, code: 'NOT_ASSIGNED', message: 'This service is not assigned to you.' }
        };
    }

    const employee = await Employee.findById(req.user.id).select('empId subscription').lean();
    if (!employee) {
        return { ok: false, status: 404, body: { success: false, message: 'Employee profile not found' } };
    }

    return chargeServiceFee(employee, booking);
};

/** Mark a cancellation as the employee's own, so it isn't refunded. */
export const employeeCancellationFields = (req, nextStatus) =>
    isEmployeeRequest(req) && CANCELLED.includes(String(nextStatus || '').trim())
        ? { cancelledBy: 'technician', cancelledAt: new Date() }
        : {};
