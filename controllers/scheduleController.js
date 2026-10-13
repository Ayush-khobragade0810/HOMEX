import Booking from "../models/Booking.js";
import Service from "../models/Service.js";
import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import moment from "moment";
import { computeBilling, bookingTotals } from "../utils/billing.js";

import { chargeForStatusChange, employeeCancellationFields } from "../services/serviceFeeService.js";
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

const getServiceFullAddress = (s) => {
    if (!s?.customer) return '';

    const customer = s.customer;

    const parts = [
        customer.completeAddress || customer.address,
        customer.areaName || customer.area?.areaName || customer.area?.name,
        customer.city || customer.area?.city,
        customer.state || customer.area?.state,
        customer.country || customer.area?.country
    ].filter(Boolean);

    return [...new Set(parts)].join(', ');
};

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

const getDateRangeForView = (view, dateInput, dateFilter) => {
    // agenda sub-filters mapping
    let effectiveView = view;
    if (view === 'agenda') {
        if (dateFilter === 'today') effectiveView = 'day';
        else if (dateFilter === 'week') effectiveView = 'week';
        else if (dateFilter === 'month') effectiveView = 'month';
        else return null; 
    }

    const refDate = dateInput ? moment(dateInput) : moment();
    if (!refDate.isValid()) return null;

    let start, end;

    if (effectiveView === 'day') {
        start = refDate.clone().startOf('day');
        end = refDate.clone().endOf('day');
    } else if (effectiveView === 'week') {
        start = refDate.clone().startOf('week');
        end = refDate.clone().endOf('week');
    } else if (effectiveView === 'month') {
        start = refDate.clone().startOf('month');
        end = refDate.clone().endOf('month');
    } else {
        return null;
    }

    // Apply +/- 24h buffer for timezone safety
    return {
        start: start.subtract(24, 'hours').toDate(),
        end: end.add(24, 'hours').toDate()
    };
};

const toValidDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Helper: Resolve any ID (Employee Numeric, Employee ObjectId, or User ObjectId) to User ObjectId
const resolveToUserId = async (idInput) => {
    try {
        const { default: User } = await import('../models/User.js');
        const { default: Employee } = await import('../models/adminEmployee.js');

        // Case 1: ObjectId (could be Employee._id or User._id)
        if (mongoose.Types.ObjectId.isValid(idInput)) {
            // Only the email is needed; `avatar` can be a large inline image.
            const emp = await Employee.findById(idInput).select('email').lean();
            if (emp) {
                const user = await User.findOne({ email: emp.email }).select('_id').lean();
                if (user) return user._id;
            }
            const user = await User.findById(idInput).select('_id').lean();
            if (user) return user._id;
        }

        // Case 2: Numeric ID (empId string or number)
        const numericId = parseInt(idInput);
        if (!isNaN(numericId)) {
            const emp = await Employee.findOne({ empId: numericId }).select('email').lean();
            if (emp) {
                const user = await User.findOne({ email: emp.email }).select('_id').lean();
                if (user) return user._id;
            }
        }

        return idInput;
    } catch (err) {
        console.error("Error resolving user ID:", err);
        return idInput;
    }
};

// Unified Schedule Controller (Best Practice)
// Uses req.user from protect middleware
export const getSchedules = async (req, res, next, overrides = {}) => {
    try {
        // Prevent caching
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const { view, date, includeCompleted, dateFilter } = {
            ...req.query,
            ...(overrides && typeof overrides === 'object' ? overrides : {})
        };
        
        // req.user is populated by protect middleware
        // id is the Employee ObjectId, empId is the numeric ID (e.g. 101)
        const employeeId = req.user.id; 
        const numericEmpId = req.user.empId;

        // --- QUERY 1: BOOKINGS (New System) ---
        const bookingStatuses = [
            'pending', 'PENDING', 'confirmed', 'CONFIRMED', 'assigned', 'ASSIGNED',
            'scheduled', 'SCHEDULED', 'accepted', 'ACCEPTED', 'in_progress', 'IN_PROGRESS',
            'navigating', 'NAVIGATING', 'started', 'STARTED', 'completed', 'COMPLETED',
            'cancelled', 'CANCELLED'
        ];

        const filteredBookingStatuses = String(includeCompleted) === 'false'
            ? bookingStatuses.filter(s => !['completed', 'COMPLETED'].includes(s.toUpperCase()))
            : bookingStatuses;

        const bookingQuery = {
            $and: [
                { $or: [
                    { 'assignedTo.technicianId': employeeId },
                    { assignedTo: employeeId }
                ]},
                { status: { $in: filteredBookingStatuses } }
            ]
        };

        // --- QUERY 2: SERVICES (Legacy System) ---
        const baseServiceStatuses = ['assigned', 'scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled'];
        const serviceStatuses = String(includeCompleted) === 'false'
            ? baseServiceStatuses.filter(s => s !== 'completed')
            : baseServiceStatuses;
        
        const allServiceStatuses = [...serviceStatuses, ...serviceStatuses.map(s => s.toUpperCase())];

        const serviceQuery = {
            empId: numericEmpId,
            status: { $in: allServiceStatuses }
        };

        // --- DATE RANGE ---
        const period = getDateRangeForView(view, date, dateFilter);
        if (period) {
            if (String(includeCompleted) === 'true') {
                bookingQuery.$and.push({
                    $or: [
                        { 'schedule.preferredDate': { $gte: period.start, $lte: period.end } },
                        { 'completedAt': { $gte: period.start, $lte: period.end } }
                    ]
                });
            } else {
                bookingQuery['schedule.preferredDate'] = { $gte: period.start, $lte: period.end };
            }
            
            // Apply period to Legacy Service Query too! (Root cause of slowness)
            serviceQuery.scheduledDate = { $gte: period.start, $lte: period.end };
        }

        // --- EXECUTE ---
        const [bookings, services] = await Promise.all([
            Booking.find(bookingQuery)
                // assignedTo.avatar is unused and can hold a large inline image.
                .select('-assignedTo.avatar')
                .populate('userId', 'name phone address location')
                .populate('location.area')
                .lean(),
            numericEmpId ? Service.find(serviceQuery).lean() : Promise.resolve([])
        ]);


        // --- MAP & MERGE ---
        let mappedBookings = bookings.map(booking => {
            return {
                _id: booking._id,
                serviceId: booking.bookingId,
                bookingId: booking.bookingId,
                status: booking.status,
                scheduledDate: booking.status?.toUpperCase() === 'COMPLETED'
                    ? (booking.completedAt || booking.schedule?.preferredDate || booking.createdAt)
                    : (booking.schedule?.preferredDate || booking.completedAt || booking.createdAt),
                time: booking.schedule?.timeSlot || booking.time || '09:00 AM',
                serviceName: booking.serviceDetails?.title || 'Service',
                serviceType: booking.serviceDetails?.category || 'General',
                duration: booking.serviceDetails?.duration || 60,
                // Always send both base and updated total. Recomputed from
                // serviceDetails.price + extraServices, so a stale persisted
                // `billing` block can never surface an outdated total.
                ...bookingTotals(booking),
                customer: {
                    name: booking.userId?.name || booking.contactIdInfo?.fullName || 'Customer',
                    phone: booking.userId?.phone || booking.contactIdInfo?.phoneNumber,
                    address: getFullAddress(booking)
                },
                notes: booking.notes,
                source: 'booking',
                location: getFormattedLocation(booking)
            };
        });

        let mappedServices = services.map(s => {
            const effectiveDate = toValidDate(s.scheduledDate) ||
                toValidDate(s.date) ||
                toValidDate(s.completedDate) ||
                toValidDate(s.createdAt);

            return {
                _id: s._id,
                serviceId: s.serviceId,
                bookingId: s.serviceId,
                status: s.status?.toUpperCase(),
                scheduledDate: effectiveDate,
                time: s.time || '09:00 AM',
                serviceName: s.title || s.serviceType || 'Service',
                serviceType: s.serviceType || 'General',
                duration: s.duration || 1,
                estimatedEarnings: s.estimatedEarnings || 0,
                customer: {
                    name: s.customer?.name || 'Customer',
                    phone: s.customer?.phone,
                    address: getServiceFullAddress(s) || 'No address'
                },
                notes: s.notes,
                source: 'service',
                location: s.customer ? {
                    area: s.customer.area
                        ? {
                            _id: s.customer.area?._id || s.customer.area,
                            area: s.customer.areaName || s.customer.area?.areaName || s.customer.area?.name || '',
                            areaName: s.customer.areaName || s.customer.area?.areaName || s.customer.area?.name || '',
                            city: s.customer.city || s.customer.area?.city || '',
                            state: s.customer.state || s.customer.area?.state || '',
                            country: s.customer.country || s.customer.area?.country || '',
                            pincode: s.customer.pincode || s.customer.area?.pincode || ''
                        }
                        : null,
                    address: s.customer.completeAddress || s.customer.address || '',
                    completeAddress: s.customer.completeAddress || s.customer.address || '',
                    pincode: s.customer.pincode || '',
                    landmark: s.customer.landmark || '',
                    coordinates: s.customer.coordinates || null
                } : null
            };
        });

        // Pruning filtered results after mapping (consistent with timezone buffer strategy)
        if (period) {
            const exactRef = date ? moment(date) : moment();
            let ev = view === 'agenda' ? (dateFilter === 'all' ? null : dateFilter) : view;

            const pruneByRange = (items) => {
                if (!ev) return items;
                const start = exactRef.clone().startOf(ev);
                const end = exactRef.clone().endOf(ev);
                return items.filter(item => {
                    const d = toValidDate(item.scheduledDate);
                    return d ? moment(d).isBetween(start, end, null, '[]') : false;
                });
            };

            mappedBookings = pruneByRange(mappedBookings);
            mappedServices = pruneByRange(mappedServices);
        }

        const combined = [...mappedBookings, ...mappedServices];
        combined.sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));

        // --- STATS ---
        const stats = {
            total: combined.length,
            assigned: 0, accepted: 0, in_progress: 0, completed: 0, cancelled: 0
        };

        combined.forEach(item => {
            const s = item.status?.toUpperCase();
            if (['ASSIGNED', 'PENDING', 'SCHEDULED'].includes(s)) stats.assigned++;
            if (['ACCEPTED', 'CONFIRMED'].includes(s)) stats.accepted++;
            if (['IN_PROGRESS', 'STARTED', 'NAVIGATING'].includes(s)) stats.in_progress++;
            if (['COMPLETED'].includes(s)) stats.completed++;
            if (['CANCELLED'].includes(s)) stats.cancelled++;
        });

        combined.forEach(item => {
        });

        res.status(200).json({
            success: true,
            services: combined,
            stats: stats
        });

    } catch (err) {
        console.error('Schedule Error:', err);
        next(err);
    }
};

// Legacy Compatibility Wrapper 
export const getEmployeeSchedule = (req, res, next) => getSchedules(req, res, next);

// Get schedule statistics (Best Practice)
export const getScheduleStats = async (req, res, next) => {
    try {
        const employeeObjectId = req.user?.id || req.params.empId;
        if (!mongoose.Types.ObjectId.isValid(employeeObjectId)) {
            throw ApiError.badRequest('Invalid employee ID format');
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const stats = await Booking.aggregate([
            {
                $match: {
                    'assignedTo.technicianId': new mongoose.Types.ObjectId(employeeObjectId),
                    'schedule.preferredDate': { $gte: today }
                }
            },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 },
                    totalEarnings: { $sum: "$serviceDetails.price" }
                }
            }
        ]);

        res.json({
            today: stats.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {}),
            totalUpcoming: stats.reduce((sum, curr) => sum + curr.count, 0),
            totalEarnings: stats.reduce((sum, curr) => sum + (curr.totalEarnings || 0), 0)
        });
    } catch (err) {
        next(err);
    }
};

const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED', 'CANCELED', 'REJECTED'];
const isTerminal = (status) => TERMINAL_STATUSES.includes(String(status || '').trim().toUpperCase());
const isEmployeeRequest = (req) => req?.user?.empId !== undefined && req?.user?.empId !== null;

/** The fee service's error bodies carry `message` only; add `error` for the frontend. */
const sendFeeError = (res, fee) =>
    res.status(fee.status).json({ ...fee.body, error: fee.body?.error || fee.body?.message });

/**
 * Finds the Booking (by _id or bookingId) or legacy Service (by _id or numeric
 * serviceId) an action route refers to. 404 when neither exists.
 */
const loadTarget = async (id) => {
    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    const booking = await Booking.findOne(isObjectId ? { _id: id } : { bookingId: String(id) })
        .select('-assignedTo.avatar')
        .lean();
    if (booking) return { kind: 'booking', doc: booking };

    const numeric = Number(id);
    const serviceQuery = isObjectId ? { _id: id } : Number.isFinite(numeric) ? { serviceId: numeric } : null;
    const service = serviceQuery ? await Service.findOne(serviceQuery).lean() : null;
    if (service) return { kind: 'service', doc: service };

    throw ApiError.notFound('Service/Booking not found');
};

/** Employees may only act on work assigned to them; admins may act on anything. */
const assertCanAct = (req, target) => {
    if (!isEmployeeRequest(req) || req.user.role === 'admin') return;
    const { kind, doc } = target;
    const me = String(req.user.id);
    const mine = kind === 'booking'
        // assignedTo is normally { technicianId, … }; very old bookings stored the id directly.
        ? String(doc.assignedTo?.technicianId ?? '') === me || String(doc.assignedTo ?? '') === me
        : String(doc.empId) === String(req.user.empId);
    if (!mine) {
        throw ApiError.forbidden('This service is not assigned to you.', { code: 'NOT_ASSIGNED' });
    }
};

/** Completed / cancelled / rejected work cannot change any more. */
const assertNotFinished = (target) => {
    const current = target.doc.status;
    if (isTerminal(current)) {
        throw ApiError.conflict(`This service is already ${String(current).toLowerCase()} and can no longer be changed`);
    }
};

// Update service status
export const updateServiceStatus = async (req, res) => {
    const { id } = req.params;
    const { status, notes, actualEarnings } = req.body;

    const target = await loadTarget(id);
    assertCanAct(req, target);
    assertNotFinished(target);

    const fee = await chargeForStatusChange(req, id, status);
    if (!fee.ok) return sendFeeError(res, fee);

    const updateData = {
        status: status?.toUpperCase(),
        updatedAt: new Date(),
        ...employeeCancellationFields(req, status?.toUpperCase())
    };
    if (notes) updateData.notes = notes;
    if (actualEarnings !== undefined && actualEarnings !== null && actualEarnings !== '') {
        // `actualEarnings` is what the technician COLLECTED, which already
        // includes any extra services. It must never be written back to
        // serviceDetails.price — that is the base rate, and overwriting it
        // made the next computeBilling() add the extras a second time.
        const collected = Number(actualEarnings);
        if (!Number.isFinite(collected) || collected < 0) {
            throw ApiError.badRequest('Actual earnings must be a non-negative number');
        }
        updateData['payment.amount'] = collected;
    }
    if (status?.toUpperCase() === 'COMPLETED') {
        updateData.completedAt = new Date();
        updateData['payment.status'] = 'paid';
    }

    let result;
    if (target.kind === 'booking') {
        // Keep the persisted invoice breakdown in step with the booking.
        updateData.billing = computeBilling(target.doc);
        result = await Booking.findOneAndUpdate({ _id: target.doc._id }, updateData, { new: true });
    } else {
        const serviceUpdate = { ...updateData };
        if (serviceUpdate.status) serviceUpdate.status = serviceUpdate.status.toLowerCase();
        result = await Service.findOneAndUpdate({ _id: target.doc._id }, serviceUpdate, { new: true });
    }

    if (!result) throw ApiError.notFound('Service/Booking not found');
    res.json(result);
};

// Start service
export const startService = async (req, res) => {
    const { id } = req.params;

    const target = await loadTarget(id);
    assertCanAct(req, target);
    assertNotFinished(target);

    const fee = await chargeForStatusChange(req, id, 'IN_PROGRESS');
    if (!fee.ok) return sendFeeError(res, fee);

    const result = target.kind === 'booking'
        ? await Booking.findOneAndUpdate({ _id: target.doc._id }, { status: 'IN_PROGRESS', startedAt: new Date(), updatedAt: new Date() }, { new: true })
        : await Service.findOneAndUpdate({ _id: target.doc._id }, { status: 'in_progress', updatedAt: new Date() }, { new: true });
    if (!result) throw ApiError.notFound('Service not found');
    res.json(result);
};

// Complete service
export const completeService = async (req, res) => {
    const { id } = req.params;
    const { actualEarnings, notes } = req.body;

    const target = await loadTarget(id);
    assertCanAct(req, target);
    assertNotFinished(target);

    const fee = await chargeForStatusChange(req, id, 'COMPLETED');
    if (!fee.ok) return sendFeeError(res, fee);

    const reported = Number(actualEarnings);
    const hasReported =
        actualEarnings !== undefined && actualEarnings !== null && actualEarnings !== '' &&
        Number.isFinite(reported) && reported >= 0;

    let result;
    if (target.kind === 'booking') {
        // Recompute the invoice so extras added during the job are reflected in
        // the stored breakdown. When the technician does not report a collected
        // figure, bill the computed grand total rather than writing `undefined`.
        const billing = computeBilling(target.doc);
        const collected = hasReported ? reported : billing?.grandTotal;

        const bookingUpdate = { status: 'COMPLETED', completedAt: new Date(), 'payment.status': 'paid', technicianNotes: notes, updatedAt: new Date() };
        if (billing) bookingUpdate.billing = billing;
        if (collected !== undefined) bookingUpdate['payment.amount'] = collected;

        result = await Booking.findOneAndUpdate({ _id: target.doc._id }, bookingUpdate, { new: true });
    } else {
        result = await Service.findOneAndUpdate(
            { _id: target.doc._id },
            { status: 'completed', completedDate: new Date(), actualEarnings: hasReported ? reported : undefined, paymentStatus: 'paid', notes },
            { new: true }
        );
    }
    if (!result) throw ApiError.notFound('Service not found');
    res.json(result);
};

const MAX_RESCHEDULES = 2; // mirrors schedule.rescheduledCount `max` on the Booking model

// Reschedule service
export const rescheduleService = async (req, res) => {
    const { id } = req.params;
    const { scheduledDate, time } = req.body;

    const target = await loadTarget(id);
    if (target.kind !== 'booking') throw ApiError.notFound('Booking not found');
    assertCanAct(req, target);
    assertNotFinished(target);

    if ((target.doc.schedule?.rescheduledCount || 0) >= MAX_RESCHEDULES) {
        throw ApiError.conflict(`This booking has already been rescheduled ${MAX_RESCHEDULES} times and cannot be rescheduled again`);
    }

    const update = {
        'schedule.preferredDate': new Date(scheduledDate),
        status: 'PENDING',
        updatedAt: new Date(),
        $inc: { 'schedule.rescheduledCount': 1 }
    };
    // The slot used to be written to `schedule.type`, which is not in the
    // Booking schema, so it was silently dropped.
    if (time) update['schedule.timeSlot'] = String(time).trim();

    const result = await Booking.findOneAndUpdate({ _id: target.doc._id }, update, { new: true });
    if (!result) throw ApiError.notFound('Booking not found');
    res.json(result);
};

// Today's schedule
// (Express 5 re-parses req.query on every access, so assigning req.query.view
// was lost; the view is passed to getSchedules as an override instead.)
export const getTodaySchedule = (req, res, next) =>
    getSchedules(req, res, next, { view: 'day', date: new Date().toISOString() });

// Upcoming services
export const getUpcomingServices = (req, res, next) => getSchedules(req, res, next, { view: 'week' });

// Dedicated APIs
export const getScheduleByDay = (req, res, next) => getSchedules(req, res, next, { view: 'day' });
export const getScheduleByWeek = (req, res, next) => getSchedules(req, res, next, { view: 'week' });
export const getScheduleByMonth = (req, res, next) => getSchedules(req, res, next, { view: 'month' });
