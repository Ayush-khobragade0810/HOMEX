import Service from "../models/Service.js";
import ServiceNote from "../models/ServiceNote.js";
import Activity from "../models/Activity.js";
import Employee from "../models/adminEmployee.js";
import Payment from "../models/Payment.js";
import UpcomingPayment from "../models/UpcomingPayment.js";
import { emitBookingUpdate } from "../socket.js";
import mongoose from "mongoose";
import { computeBilling, normalizeExtraService, bookingTotals } from "../utils/billing.js";
import { chargeForStatusChange, employeeCancellationFields } from "../services/serviceFeeService.js";
import { ApiError, sendError } from "../utils/ApiError.js";

const parseClockToMinutes = (value) => {
    if (!value) return null;
    const raw = String(value).trim().toUpperCase();
    const ampmMatch = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (ampmMatch) {
        let hours = parseInt(ampmMatch[1], 10);
        const minutes = parseInt(ampmMatch[2], 10);
        const ampm = ampmMatch[3];
        if (hours === 12) hours = 0;
        if (ampm === 'PM') hours += 12;
        return (hours * 60) + minutes;
    }

    const twentyFourMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (twentyFourMatch) {
        const hours = parseInt(twentyFourMatch[1], 10);
        const minutes = parseInt(twentyFourMatch[2], 10);
        return (hours * 60) + minutes;
    }
    return null;
};

const calculateDurationFromTimeSlot = (timeSlot) => {
    if (!timeSlot) return null;
    const parts = String(timeSlot).split(/\s*-\s*/);
    if (parts.length !== 2) return null;
    const start = parseClockToMinutes(parts[0]);
    const end = parseClockToMinutes(parts[1]);
    if (start === null || end === null) return null;
    let diff = end - start;
    if (diff <= 0) diff += 24 * 60;
    return diff > 0 ? diff : null;
};

const getBookingDuration = (booking) =>
    booking.serviceDetails?.duration ||
    booking.serviceId?.duration ||
    calculateDurationFromTimeSlot(booking.schedule?.timeSlot) ||
    60;

// ---------------------------------------------------------------------------
// Shared guards for the employee job actions.
// ---------------------------------------------------------------------------

const bookingQueryFor = (id) =>
    mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };

const loadBooking = async (id) => {
    const { default: Booking } = await import('../models/Booking.js');
    const booking = await Booking.findOne(bookingQueryFor(id)).lean();
    if (!booking) throw ApiError.notFound('Booking not found');
    return { Booking, booking };
};

const isEmployeeRequest = (req) => req.user?.empId !== undefined && req.user?.empId !== null;

/** Statuses compared case-insensitively: "in progress" / "in-progress" -> IN_PROGRESS. */
const normStatus = (s) => String(s || '').trim().toUpperCase().replace(/[\s-]+/g, '_');

const ENDED = { COMPLETED: 'completed', CANCELLED: 'cancelled', CANCELED: 'cancelled', REJECTED: 'rejected' };
const STARTED = new Set(['IN_PROGRESS', 'STARTED', 'CURRENT']);
const UNDER_WAY = new Set([...STARTED, 'NAVIGATING', 'EN_ROUTE']);

/** Admins may act on any booking; employees only on bookings assigned to them. */
const assertCanActOn = (req, booking) => {
    if (isAdminRequest(req)) return;
    if (!isEmployeeRequest(req)) throw ApiError.forbidden('Only the assigned employee can update this service.');
    const techId = booking.assignedTo?.technicianId?._id || booking.assignedTo?.technicianId;
    if (!techId || String(techId) !== String(req.user.id)) {
        throw ApiError.forbidden('This service is not assigned to you.', { code: 'NOT_ASSIGNED' });
    }
};

/** 409 for a step that doesn't fit where the job is now. */
const assertTransition = (booking, action) => {
    const current = normStatus(booking.status);
    const conflict = (message) => ApiError.conflict(message, { code: 'INVALID_STATUS_TRANSITION' });

    if (ENDED[current]) throw conflict(`Cannot ${action} this service — it is already ${ENDED[current]}.`);

    if (action === 'accept' || action === 'confirm') {
        if (UNDER_WAY.has(current)) throw conflict('This service is already in progress.');
        if (current === 'ACCEPTED') throw conflict('This service has already been accepted.');
    }
    if (action === 'start' && STARTED.has(current)) {
        throw conflict('This service has already been started.');
    }
    if (action === 'complete' && !UNDER_WAY.has(current)) {
        throw conflict('Start the service before marking it complete.');
    }
};

/** Sends a failed service-fee check (402 INSUFFICIENT_BALANCE, 403 NOT_ASSIGNED, 409 FEE_CONFLICT...). */
const sendFeeError = (res, fee) => {
    // eslint-disable-next-line no-unused-vars
    const { message, success, ...extra } = fee.body || {};
    return sendError(res, fee.status, message || 'Could not take this service', extra);
};

/**
 * Applies `update` only if the booking is still in the status we checked, so
 * two concurrent actions can't both pass the transition check.
 */
const applyStatusUpdate = async (Booking, booking, update) => {
    const updated = await Booking.findOneAndUpdate(
        { _id: booking._id, status: booking.status ?? null },
        update,
        { new: true }
    ).populate('userId').populate('assignedTo.technicianId');
    if (!updated) {
        throw ApiError.conflict('This service was just updated by someone else. Refresh and try again.', { code: 'INVALID_STATUS_TRANSITION' });
    }
    return updated;
};

const STATUS_MAP = {
    'confirmed': 'ACCEPTED',
    'in_progress': 'IN_PROGRESS',
    'completed': 'COMPLETED',
    'cancelled': 'CANCELLED',
    'scheduled': 'PENDING',
    'en_route': 'NAVIGATING',
    'accepted': 'ACCEPTED'
};

// Update Status (Generic)
export const updateServiceStatus = async (req, res) => {
    const { id } = req.params;
    const status = String(req.body.status).trim();

    const { Booking, booking } = await loadBooking(id);
    assertCanActOn(req, booking);

    const current = normStatus(booking.status);
    if (ENDED[current]) {
        throw ApiError.conflict(`Cannot change the status of a booking that is already ${ENDED[current]}.`, { code: 'INVALID_STATUS_TRANSITION' });
    }

    const bookingStatus = STATUS_MAP[status.toLowerCase()] || status.toUpperCase();

    const fee = await chargeForStatusChange(req, id, bookingStatus);
    if (!fee.ok) return sendFeeError(res, fee);

    const updated = await applyStatusUpdate(Booking, booking, {
        status: bookingStatus, updatedAt: new Date(), ...employeeCancellationFields(req, bookingStatus)
    });

    emitBookingUpdate(updated.bookingId, bookingStatus, updated.toObject());
    res.json({ message: `Service status updated to ${status}`, service: { ...updated.toObject(), id: updated._id } });
};

// Confirm Service
export const confirmService = async (req, res) => {
    const { id } = req.params;
    const { Booking, booking } = await loadBooking(id);
    assertCanActOn(req, booking);
    assertTransition(booking, 'confirm');

    const fee = await chargeForStatusChange(req, id, 'ACCEPTED');
    if (!fee.ok) return sendFeeError(res, fee);

    const updated = await applyStatusUpdate(Booking, booking, { status: 'ACCEPTED', updatedAt: new Date() });

    emitBookingUpdate(updated.bookingId, 'ACCEPTED', updated.toObject());
    await Activity.create({
        empId: updated.assignedTo?.technicianId?._id || req.user.id,
        type: 'service_scheduled',
        message: `Confirmed service ${updated.serviceDetails?.title} for ${updated.userId?.name || 'Customer'}`,
        serviceId: updated._id
    });

    res.json({ message: "Service confirmed successfully", service: { ...updated.toObject(), id: updated._id } });
};

// Start Service
export const startService = async (req, res) => {
    const { id } = req.params;
    const { startTime } = req.body;
    const { Booking, booking } = await loadBooking(id);
    assertCanActOn(req, booking);
    assertTransition(booking, 'start');

    const fee = await chargeForStatusChange(req, id, 'IN_PROGRESS');
    if (!fee.ok) return sendFeeError(res, fee);

    const updated = await applyStatusUpdate(Booking, booking, {
        status: 'IN_PROGRESS', startedAt: startTime || new Date(), updatedAt: new Date()
    });

    emitBookingUpdate(updated.bookingId, 'IN_PROGRESS', updated.toObject());
    await Activity.create({
        empId: updated.assignedTo?.technicianId?._id || req.user.id,
        type: 'service_started',
        message: `Started ${updated.serviceDetails?.title} service for ${updated.userId?.name}`,
        serviceId: updated._id
    });

    res.json({ message: "Service started successfully", service: { ...updated.toObject(), id: updated._id } });
};

// Complete Service
export const completeService = async (req, res) => {
    const { id } = req.params;
    const { actualEarnings, notes, completionTime, extraServices } = req.body;

    const { Booking, booking: existing } = await loadBooking(id);
    assertCanActOn(req, existing);
    assertTransition(existing, 'complete');

    // Same rule as the extra-services endpoints (invoice already finalised).
    const denied = denyExtraServiceChange(existing, req);
    if (denied) throw new ApiError(denied.code, denied.message);

    const fee = await chargeForStatusChange(req, id, 'COMPLETED');
    if (!fee.ok) return sendFeeError(res, fee);

    // Append any extra services submitted alongside completion. Duplicates
    // are intentionally kept as separate line items (business rule).
    const nextExtras = [...(existing.extraServices || [])];
    if (Array.isArray(extraServices)) {
        for (const raw of extraServices) {
            const line = normalizeExtraService(raw || {});
            if (!line.name) continue;
            nextExtras.push({
                ...line,
                addedBy: req.user?.id,
                addedByRole: isAdminRequest(req) ? 'admin' : 'employee',
                addedAt: new Date()
            });
        }
    }

    // Recompute the invoice from the single source of truth.
    const billing = computeBilling(existing, { extraServices: nextExtras });

    // The employee records what was actually collected (which may include a
    // tip); fall back to the computed grand total when not supplied.
    const collected =
        actualEarnings !== undefined && actualEarnings !== null && actualEarnings !== ''
            ? Number(actualEarnings)
            : billing.grandTotal;

    const booking = await applyStatusUpdate(Booking, existing, {
        status: 'COMPLETED',
        completedAt: completionTime || new Date(),
        extraServices: nextExtras,
        billing,
        'payment.amount': collected,
        'payment.status': 'paid',
        technicianNotes: notes,
        updatedAt: new Date()
    });

    // Payment integration: create/update payment record for employee earnings
    try {
        const employeeUser = booking.assignedTo?.technicianId;
        let employeeRecord = null;
        if (employeeUser) {
            employeeRecord = await Employee.findOne({ email: employeeUser.email });
        }

        if (employeeRecord) {
            const lastPayment = await Payment.findOne().sort({ paymentId: -1 });
            const newPaymentId = lastPayment ? lastPayment.paymentId + 1 : 1001;

            const earnings = collected;
            const commissionRate = 30; // 30% default rate
            const commission = Math.round(earnings * (commissionRate / 100) * 100) / 100;
            const baseRate = Math.round((earnings - commission) * 100) / 100;

            const durationHours = getBookingDuration(booking) / 60;

            const paymentData = {
                paymentId: newPaymentId,
                empId: employeeRecord.empId,
                employee: employeeRecord._id,
                serviceId: booking.bookingId,
                customer: {
                    name: booking.contactIdInfo?.fullName || booking.contactInfo?.fullName || booking.userId?.name || 'Customer',
                    email: booking.contactIdInfo?.email || booking.contactInfo?.email || booking.userId?.email || '',
                    phone: booking.contactIdInfo?.phoneNumber || booking.contactInfo?.phoneNumber || booking.userId?.phone || '',
                    address: booking.location?.completeAddress || booking.location?.address || ''
                },
                serviceType: booking.serviceDetails?.title || 'Service',
                amount: earnings,
                commission: commission,
                commissionRate: commissionRate,
                baseRate: baseRate,
                hours: durationHours,
                date: new Date(),
                status: 'completed',
                paymentMethod: booking.payment?.method || 'cash',
                transactionId: booking.payment?.transactionId || `TXN-${Date.now()}`
            };

            let payment = await Payment.findOne({ serviceId: booking.bookingId });
            const oldAmount = payment ? (payment.status === 'completed' ? payment.baseRate : 0) : 0;

            if (payment) {
                payment.amount = earnings;
                payment.commission = commission;
                payment.baseRate = baseRate;
                payment.hours = durationHours;
                payment.status = 'completed';
                payment.paymentMethod = booking.payment?.method || 'cash';
                await payment.save();
            } else {
                payment = await Payment.create(paymentData);
            }

            // Update employee's wallet balance and earnings
            const balanceDiff = baseRate - oldAmount;
            employeeRecord.walletBalance = (employeeRecord.walletBalance || 0) + balanceDiff;
            employeeRecord.earnings = (employeeRecord.earnings || 0) + balanceDiff;
            await employeeRecord.save();
        }
    } catch (err) {
        console.error("Error creating/updating payment record:", err);
    }

    // Remove from Upcoming Payments
    try {
        await UpcomingPayment.findOneAndDelete({ serviceId: booking.bookingId });
    } catch (err) {
        console.error("Error deleting upcoming payment:", err);
    }

    emitBookingUpdate(booking.bookingId, 'COMPLETED', booking.toObject());
    await Activity.create({
        empId: booking.assignedTo?.technicianId?._id || req.user.id,
        type: 'service_completed',
        message: `Completed ${booking.serviceDetails?.title} service for ${booking.userId?.name}`,
        serviceId: booking._id,
        metadata: {
            earnings: collected,
            extrasTotal: billing.extrasTotal,
            grandTotal: billing.grandTotal
        }
    });

    res.json({
        message: "Service completed successfully",
        service: { ...booking.toObject(), id: booking._id },
        billing
    });
};

// ---------------------------------------------------------------------------
// Extra services — additional charges added during an ongoing appointment.
// Totals are always recomputed through utils/billing.js so the customer bill,
// invoice PDF and payment summary stay consistent.
// ---------------------------------------------------------------------------

const isAdminRequest = (req) => String(req.user?.role || '').toLowerCase() === 'admin';

/** Window in which an identical extra-service line is treated as a re-submit. */
const DUPLICATE_EXTRA_WINDOW_MS = 15_000;

/** Load a booking by ObjectId or human bookingId, as a plain object. */
const loadBookingForBilling = async (id) => {
    const { default: Booking } = await import('../models/Booking.js');
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };
    const booking = await Booking.findOne(query).lean();
    return { Booking, query, booking };
};

/**
 * Admins may correct a bill at any time. Employees may only change their own
 * booking, and only before the invoice is finalised (paid/completed/cancelled).
 * Returns null when allowed, or { code, message } when denied.
 */
const denyExtraServiceChange = (booking, req) => {
    if (isAdminRequest(req)) return null;

    const techId = booking.assignedTo?.technicianId?._id || booking.assignedTo?.technicianId;
    const candidates = [req.user?.id, req.user?.userId, req.user?._id]
        .filter(Boolean)
        .map(String);

    if (techId && !candidates.includes(String(techId))) {
        return { code: 403, message: 'You are not assigned to this booking.' };
    }

    const status = String(booking.status || '').toLowerCase();
    if (booking.payment?.status === 'paid' || status === 'completed') {
        return {
            code: 409,
            message: 'This invoice is already finalised. Extra services can no longer be changed.'
        };
    }
    if (status === 'cancelled') {
        return { code: 409, message: 'This booking is cancelled.' };
    }
    return null;
};

/** Persist a new extra-services array and its recomputed totals. */
const saveExtras = async (Booking, query, booking, nextExtras) => {
    const billing = computeBilling(booking, { extraServices: nextExtras });
    const updated = await Booking.findOneAndUpdate(
        query,
        { $set: { extraServices: nextExtras, billing, 'payment.amount': billing.grandTotal, updatedAt: new Date() } },
        { new: true }
    ).lean();

    return {
        bookingId: updated?.bookingId,
        extraServices: updated?.extraServices || [],
        billing: updated?.billing || billing
    };
};

/** Load a booking for the extra-services endpoints, or 404. */
const requireBookingForBilling = async (id) => {
    const loaded = await loadBookingForBilling(id);
    if (!loaded.booking) throw ApiError.notFound('Booking not found');
    return loaded;
};

/** Throws the 403/409 from denyExtraServiceChange, if any. */
const assertCanChangeExtras = (booking, req) => {
    // Only the assigned employee (or an admin) may change the bill.
    assertCanActOn(req, booking);
    const denied = denyExtraServiceChange(booking, req);
    if (denied) {
        throw new ApiError(denied.code, denied.message, denied.code === 403 ? { code: 'NOT_ASSIGNED' } : undefined);
    }
};

// GET /:id/extra-services — list extras with current totals
export const getExtraServices = async (req, res) => {
    const { booking } = await requireBookingForBilling(req.params.id);

    // Employees may only see the bill of a job assigned to them.
    if (isEmployeeRequest(req) && !isAdminRequest(req)) assertCanActOn(req, booking);

    res.json({
        success: true,
        bookingId: booking.bookingId,
        extraServices: booking.extraServices || [],
        // Recomputed on read so legacy bookings (saved before this feature)
        // still return a correct breakdown without a migration.
        billing: computeBilling(booking)
    });
};

// POST /:id/extra-services — add one extra service
export const addExtraService = async (req, res) => {
    const { Booking, query, booking } = await requireBookingForBilling(req.params.id);
    assertCanChangeExtras(booking, req);

    const line = normalizeExtraService(req.body);
    if (!line.name) throw ApiError.badRequest('Service name is required.');

    // Guard against accidental double-addition (double-tap, client retry,
    // a resubmitted form in a second tab). An identical line logged within
    // the last 15s is treated as the same request, while a deliberate
    // repeat of the same service later is still allowed through.
    const now = Date.now();
    const isRecentDuplicate = (booking.extraServices || []).some((e) => {
        const addedAt = e?.addedAt ? new Date(e.addedAt).getTime() : 0;
        return (
            String(e?.name || '').trim().toLowerCase() === line.name.toLowerCase() &&
            Number(e?.unitPrice) === line.unitPrice &&
            Number(e?.quantity) === line.quantity &&
            Number.isFinite(addedAt) &&
            now - addedAt < DUPLICATE_EXTRA_WINDOW_MS
        );
    });
    if (isRecentDuplicate) {
        throw ApiError.conflict('This extra service was just added. Refresh to see the current charges.', { code: 'DUPLICATE_EXTRA_SERVICE' });
    }

    const nextExtras = [
        ...(booking.extraServices || []),
        {
            ...line,
            addedBy: req.user?.id,
            addedByRole: isAdminRequest(req) ? 'admin' : 'employee',
            addedAt: new Date()
        }
    ];

    const result = await saveExtras(Booking, query, booking, nextExtras);
    res.status(201).json({ success: true, message: 'Extra service added', ...result });
};

// PUT /:id/extra-services/:extraId — edit an extra service
export const updateExtraService = async (req, res) => {
    const { Booking, query, booking } = await requireBookingForBilling(req.params.id);
    assertCanChangeExtras(booking, req);

    const { extraId } = req.params;
    const current = (booking.extraServices || []).find((e) => String(e._id) === String(extraId));
    if (!current) throw ApiError.notFound('Extra service not found');

    // Merge so callers can send a partial update.
    const line = normalizeExtraService({
        name: req.body.name ?? current.name,
        quantity: req.body.quantity ?? current.quantity,
        unitPrice: req.body.unitPrice ?? req.body.price ?? current.unitPrice,
        notes: req.body.notes ?? current.notes
    });
    if (!line.name) throw ApiError.badRequest('Service name is required.');

    const nextExtras = (booking.extraServices || []).map((e) =>
        String(e._id) === String(extraId) ? { ...e, ...line } : e
    );

    const result = await saveExtras(Booking, query, booking, nextExtras);
    res.json({ success: true, message: 'Extra service updated', ...result });
};

// DELETE /:id/extra-services/:extraId — remove an extra service
export const removeExtraService = async (req, res) => {
    const { Booking, query, booking } = await requireBookingForBilling(req.params.id);
    assertCanChangeExtras(booking, req);

    const { extraId } = req.params;
    const nextExtras = (booking.extraServices || []).filter(
        (e) => String(e._id) !== String(extraId)
    );
    if (nextExtras.length === (booking.extraServices || []).length) {
        throw ApiError.notFound('Extra service not found');
    }

    const result = await saveExtras(Booking, query, booking, nextExtras);
    res.json({ success: true, message: 'Extra service removed', ...result });
};

// Accept Assignment
export const acceptAssignment = async (req, res) => {
    const { id } = req.params;
    const { Booking, booking } = await loadBooking(id);
    assertCanActOn(req, booking);
    assertTransition(booking, 'accept');

    // Takes the service fee (402 INSUFFICIENT_BALANCE / 409 FEE_CONFLICT).
    const fee = await chargeForStatusChange(req, id, 'ACCEPTED');
    if (!fee.ok) return sendFeeError(res, fee);

    const updated = await applyStatusUpdate(Booking, booking, { status: 'ACCEPTED' });

    emitBookingUpdate(updated.bookingId, 'ACCEPTED', updated.toObject());
    res.json({ message: "Assignment accepted", service: { ...updated.toObject(), id: updated._id } });
};

/** Legacy Service records belong to one employee (numeric empId); admins see all. */
const assertOwnsLegacyService = (req, service) => {
    if (isAdminRequest(req)) return;
    if (!isEmployeeRequest(req) || Number(req.user.empId) !== Number(service.empId)) {
        throw ApiError.forbidden('This service is not assigned to you.', { code: 'NOT_ASSIGNED' });
    }
};

// Reschedule (legacy numeric Service records)
export const rescheduleService = async (req, res) => {
    const { id } = req.params;
    const { scheduledDate, time, notes } = req.body;

    const existing = await Service.findOne({ serviceId: parseInt(id) }).select('empId status').lean();
    if (!existing) throw ApiError.notFound('Service not found');
    assertOwnsLegacyService(req, existing);
    if (['completed', 'cancelled'].includes(String(existing.status).toLowerCase())) {
        throw ApiError.conflict(`Cannot reschedule a service that is already ${String(existing.status).toLowerCase()}.`, { code: 'INVALID_STATUS_TRANSITION' });
    }

    const service = await Service.findOneAndUpdate(
        { serviceId: parseInt(id) },
        { scheduledDate: new Date(scheduledDate), time: time, status: 'scheduled', updatedAt: new Date() },
        { new: true }
    );

    if (!service) throw ApiError.notFound('Service not found');

    if (notes) {
        const lastNote = await ServiceNote.findOne().sort({ noteId: -1 });
        await ServiceNote.create({
            noteId: lastNote ? lastNote.noteId + 1 : 6001,
            serviceId: parseInt(id),
            empId: service.empId,
            note: `Rescheduled to ${new Date(scheduledDate).toLocaleDateString()}: ${notes}`,
            type: 'general',
            priority: 'medium',
            createdBy: 'technician'
        });
    }

    await Activity.create({
        empId: service.empId,
        type: 'service_scheduled',
        message: `Rescheduled ${service.serviceType} for ${service.customer?.name || 'Customer'}`,
        serviceId: service.serviceId
    });

    res.json({ message: "Rescheduled", service });
};

// Helper to build full address containing area, city, state, country
const getFullAddress = (b) => {
    if (!b) return '';
    const loc = b.location;
    if (!loc) return b.userId?.address || '';
    const street = loc.completeAddress || loc.address || '';
    if (loc.area && typeof loc.area === 'object') {
        const areaName = loc.area.areaName || loc.area.name || '';
        const city = loc.area.city || '';
        const state = loc.area.state || '';
        const country = loc.area.country || '';
        const parts = [street, areaName, city, state, country].filter(Boolean);
        return parts.join(', ');
    }
    return street || b.userId?.address || '';
};

// Helper to get structured location details for frontend compatibility
const getFormattedLocation = (b) => {
    if (!b || !b.location) return null;
    let areaObj = null;
    if (b.location.area) {
        if (typeof b.location.area === 'object') {
            areaObj = {
                _id: b.location.area._id,
                area: b.location.area.areaName || b.location.area.name || "",
                areaName: b.location.area.areaName || b.location.area.name || "",
                city: b.location.area.city || "",
                state: b.location.area.state || "",
                country: b.location.area.country || "",
                pincode: b.location.area.pincode || ""
            };
        }
    }
    return {
        area: areaObj || b.location.area,
        address: b.location.completeAddress || b.location.address || "",
        completeAddress: b.location.completeAddress || b.location.address || "",
        pincode: b.location.pincode || (areaObj ? areaObj.pincode : ""),
        landmark: b.location.landmark || "",
        coordinates: b.location.coordinates || null
    };
};

// Fetch List Endpoints (Optimized)
export const getAssigned = async (req, res, next) => {
    try {
        const { default: Booking } = await import('../models/Booking.js');
        const bookings = await Booking.find({
            'assignedTo.technicianId': req.user.id,
            status: { $in: ['ACCEPTED', 'CONFIRMED', 'IN_PROGRESS', 'NAVIGATING', 'started', 'in_progress'] }
        })
        .select('-assignedTo.avatar')
        .populate('userId', 'name phone address')
        .populate('serviceId', 'title category price duration')
        .populate('location.area')
        .select('-history -metadata -technicianNotes')
        .sort({ 'schedule.preferredDate': 1 })
        .lean();

        res.json(bookings.map(b => ({
            _id: b._id,
            id: b.bookingId,
            serviceType: b.serviceDetails?.title || b.serviceId?.title || 'Service',
            category: b.serviceDetails?.category || b.category || 'General',
            status: b.status.toLowerCase(),
            customer: b.contactIdInfo?.fullName || b.contactInfo?.fullName || b.userId?.name || 'Guest',
            address: getFullAddress(b),
            landmark: b.location?.landmark || '',
            pincode: b.location?.pincode || '',
            customerPhone: b.contactIdInfo?.phoneNumber || b.contactInfo?.phoneNumber || b.userId?.phone || '',
            alternatePhone: b.contactIdInfo?.alternatePhone || '',
            scheduledDate: b.schedule?.preferredDate,
            time: b.schedule?.timeSlot || '09:00 AM',
            duration: getBookingDuration(b),
            // base price + extras breakdown + grand total
            ...bookingTotals(b),
            // Marks this as a Booking document (not a legacy Service). The
            // client uses it to decide whether /extra-services applies.
            source: 'booking',
            location: getFormattedLocation(b)
        })));
    } catch (err) {
        next(err);
    }
};

export const getPending = async (req, res, next) => {
    try {
        const { default: Booking } = await import('../models/Booking.js');
        const bookings = await Booking.find({
            'assignedTo.technicianId': req.user.id,
            status: { $in: ['ASSIGNED', 'assigned'] }
        })
        .select('-assignedTo.avatar')
        .populate('userId', 'name phone address')
        .populate('serviceId', 'title category')
        .populate('location.area')
        .select('-history -metadata -technicianNotes')
        .sort({ createdAt: -1 })
        .lean();

        res.json(bookings.map(b => ({
            id: b._id,
            serviceType: b.serviceDetails?.category || 'General',
            title: b.serviceDetails?.title || 'Service Task',
            category: b.serviceDetails?.category || 'General',
            status: 'pending',
            customer: b.contactIdInfo?.fullName || b.contactInfo?.fullName || b.userId?.name || 'Guest',
            address: getFullAddress(b) || 'No address',
            landmark: b.location?.landmark || '',
            pincode: b.location?.pincode || '',
            customerPhone: b.contactIdInfo?.phoneNumber || b.userId?.phone || '',
            alternatePhone: b.contactIdInfo?.alternatePhone || '',
            duration: getBookingDuration(b),
            // base price + extras breakdown + grand total
            ...bookingTotals(b),
            source: 'booking',
            location: getFormattedLocation(b)
        })));
    } catch (err) {
        next(err);
    }
};

export const getCompleted = async (req, res, next) => {
    try {
        const { default: Booking } = await import('../models/Booking.js');
        const bookings = await Booking.find({
            'assignedTo.technicianId': req.user.id,
            status: { $in: ['COMPLETED', 'completed'] }
        })
        .select('-assignedTo.avatar')
        .populate('userId', 'name phone address')
        .populate('serviceId', 'title category')
        .populate('location.area')
        .select('-history -metadata -technicianNotes')
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();

        res.json(bookings.map(b => ({
            id: b._id,
            serviceType: b.serviceDetails?.title || 'Service',
            category: b.serviceDetails?.category || 'General',
            status: 'completed',
            customer: b.contactIdInfo?.fullName || b.contactInfo?.fullName || b.userId?.name || 'Guest',
            address: getFullAddress(b),
            landmark: b.location?.landmark || '',
            pincode: b.location?.pincode || '',
            customerPhone: b.contactIdInfo?.phoneNumber || b.userId?.phone || '',
            alternatePhone: b.contactIdInfo?.alternatePhone || '',
            completedDate: b.completedAt || b.updatedAt,
            duration: getBookingDuration(b),
            // `payment` is what was actually collected (may include a tip);
            // `totalPrice` from bookingTotals is the invoiced amount.
            payment: b.payment?.amount || 0,
            ...bookingTotals(b),
            source: 'booking',
            location: getFormattedLocation(b)
        })));
    } catch (err) {
        next(err);
    }
};

export const getInProgress = async (req, res, next) => {
    try {
        const { default: Booking } = await import('../models/Booking.js');
        const employee = await Employee.findOne({ email: req.user.email }).select('empId').lean();
        const numericEmpId = employee?.empId;

        const [bookings, services] = await Promise.all([
            Booking.find({
                'assignedTo.technicianId': req.user.id,
                status: { $in: ['IN_PROGRESS', 'NAVIGATING', 'STARTED', 'in_progress', 'en_route'] }
            })
            .select('-assignedTo.avatar')
        .populate('userId', 'name phone address')
            .populate('serviceId', 'title category duration price')
            .populate('location.area')
            .select('-history -metadata')
            .lean(),
            numericEmpId ? Service.find({ empId: numericEmpId, status: { $regex: /progress|route|started/i } }).lean() : Promise.resolve([])
        ]);

        const mappedB = bookings.map(b => ({
            id: b.bookingId, _id: b._id, serviceType: b.serviceDetails?.title || 'Service',
            category: b.serviceDetails?.category || 'General',
            status: 'in_progress', customer: b.contactIdInfo?.fullName || b.userId?.name || 'Guest',
            address: getFullAddress(b),
            landmark: b.location?.landmark || '',
            pincode: b.location?.pincode || '',
            customerPhone: b.contactIdInfo?.phoneNumber || b.userId?.phone || '',
            alternatePhone: b.contactIdInfo?.alternatePhone || '',
            scheduledDate: b.schedule?.preferredDate, duration: getBookingDuration(b),
            // base price + extras breakdown + grand total
            ...bookingTotals(b),
            source: 'booking',
            location: getFormattedLocation(b)
        }));

        const mappedS = services.map(s => ({
            id: s.serviceId, _id: s._id, serviceType: s.serviceType || 'Service',
            status: 'in_progress', customer: s.customer?.name || 'Guest',
            address: s.customer?.address || '', customerPhone: s.customer?.phone || '',
            scheduledDate: s.scheduledDate, duration: s.duration || 1, estimatedEarnings: s.estimatedEarnings || 0,
            // Legacy Service document — has no Booking, so no extra services.
            source: 'service',
            location: s.customer ? {
                address: s.customer.address || '',
                completeAddress: s.customer.address || '',
                pincode: s.customer.pincode || '',
                landmark: s.customer.landmark || '',
                area: null
            } : null
        }));

        res.json([...mappedB, ...mappedS]);
    } catch (err) {
        next(err);
    }
};

export const getCustomerContact = async (req, res, next) => {
    try {
        const { id } = req.params;
        const service = await Service.findOne({ serviceId: parseInt(id) }).select('customer serviceType empId').lean();
        if (!service) throw ApiError.notFound("Service not found");
        assertOwnsLegacyService(req, service);
        res.json({ customer: service.customer, serviceType: service.serviceType });
    } catch (err) {
        next(err);
    }
};

export const getServiceQuickActions = async (req, res, next) => {
    try {
        const { id } = req.params;
        const service = await Service.findOne({ serviceId: parseInt(id) }).select('serviceId serviceType status customer scheduledDate time duration estimatedEarnings empId').lean();
        if (!service) throw ApiError.notFound("Service not found");
        assertOwnsLegacyService(req, service);
        res.json({
            id: service.serviceId, serviceId: service.serviceId, serviceType: service.serviceType,
            status: service.status, customer: service.customer?.name, customerPhone: service.customer?.phone,
            scheduledDate: service.scheduledDate, time: service.time, duration: service.duration,
            estimatedEarnings: service.estimatedEarnings, address: service.customer?.address
        });
    } catch (err) {
        next(err);
    }
};
