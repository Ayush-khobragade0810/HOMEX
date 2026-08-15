import Service from "../models/Service.js";
import ServiceNote from "../models/ServiceNote.js";
import Activity from "../models/Activity.js";
import Employee from "../models/adminEmployee.js";
import Payment from "../models/Payment.js";
import UpcomingPayment from "../models/UpcomingPayment.js";
import { emitBookingUpdate } from "../socket.js";
import mongoose from "mongoose";
import { computeBilling, normalizeExtraService } from "../utils/billing.js";

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

// Update Status (Generic)
export const updateServiceStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;

        const { default: Booking } = await import('../models/Booking.js');

        const statusMap = {
            'confirmed': 'ACCEPTED',
            'in_progress': 'IN_PROGRESS',
            'completed': 'COMPLETED',
            'cancelled': 'CANCELLED',
            'scheduled': 'PENDING',
            'en_route': 'NAVIGATING',
            'accepted': 'ACCEPTED'
        };
        const bookingStatus = statusMap[status] || status.toUpperCase();
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOneAndUpdate(
            query,
            { status: bookingStatus, updatedAt: new Date() },
            { new: true }
        ).populate('userId');

        if (!booking) return res.status(404).json({ message: "Booking not found" });

        emitBookingUpdate(booking.bookingId, bookingStatus, booking.toObject());
        res.json({ message: `Service status updated to ${status}`, service: { ...booking.toObject(), id: booking._id } });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Confirm Service
export const confirmService = async (req, res) => {
    try {
        const { id } = req.params;
        const { default: Booking } = await import('../models/Booking.js');
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOneAndUpdate(
            query,
            { status: 'ACCEPTED', updatedAt: new Date() },
            { new: true }
        ).populate('userId').populate('assignedTo.technicianId');

        if (!booking) return res.status(404).json({ message: "Booking not found" });

        emitBookingUpdate(booking.bookingId, 'ACCEPTED', booking.toObject());
        await Activity.create({
            empId: booking.assignedTo?.technicianId?._id || req.user.id,
            type: 'service_scheduled',
            message: `Confirmed service ${booking.serviceDetails?.title} for ${booking.userId?.name || 'Customer'}`,
            serviceId: booking._id
        });

        res.json({ message: "Service confirmed successfully", service: { ...booking.toObject(), id: booking._id } });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Start Service
export const startService = async (req, res) => {
    try {
        const { id } = req.params;
        const { startTime } = req.body;
        const { default: Booking } = await import('../models/Booking.js');
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOneAndUpdate(
            query,
            { status: 'IN_PROGRESS', startedAt: startTime || new Date(), updatedAt: new Date() },
            { new: true }
        ).populate('userId').populate('assignedTo.technicianId');

        if (!booking) return res.status(404).json({ message: "Booking not found" });

        emitBookingUpdate(booking.bookingId, 'IN_PROGRESS', booking.toObject());
        await Activity.create({
            empId: booking.assignedTo?.technicianId?._id || req.user.id,
            type: 'service_started',
            message: `Started ${booking.serviceDetails?.title} service for ${booking.userId?.name}`,
            serviceId: booking._id
        });

        res.json({ message: "Service started successfully", service: { ...booking.toObject(), id: booking._id } });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Complete Service
export const completeService = async (req, res) => {
    try {
        const { id } = req.params;
        const { actualEarnings, notes, completionTime, extraServices } = req.body;
        const { default: Booking } = await import('../models/Booking.js');
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };

        const existing = await Booking.findOne(query).lean();
        if (!existing) return res.status(404).json({ message: "Booking not found" });

        // Append any extra services submitted alongside completion. Duplicates
        // are intentionally kept as separate line items (business rule).
        const nextExtras = [...(existing.extraServices || [])];
        if (Array.isArray(extraServices)) {
            for (const raw of extraServices) {
                const line = normalizeExtraService(raw);
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

        const booking = await Booking.findOneAndUpdate(
            query,
            {
                status: 'COMPLETED',
                completedAt: completionTime || new Date(),
                extraServices: nextExtras,
                billing,
                'payment.amount': collected,
                'payment.status': 'paid',
                technicianNotes: notes,
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId').populate('assignedTo.technicianId');

        if (!booking) return res.status(404).json({ message: "Booking not found" });

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
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// ---------------------------------------------------------------------------
// Extra services — additional charges added during an ongoing appointment.
// Totals are always recomputed through utils/billing.js so the customer bill,
// invoice PDF and payment summary stay consistent.
// ---------------------------------------------------------------------------

const isAdminRequest = (req) => String(req.user?.role || '').toLowerCase() === 'admin';

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
        { $set: { extraServices: nextExtras, billing, updatedAt: new Date() } },
        { new: true }
    ).lean();

    return {
        bookingId: updated?.bookingId,
        extraServices: updated?.extraServices || [],
        billing: updated?.billing || billing
    };
};

// GET /:id/extra-services — list extras with current totals
export const getExtraServices = async (req, res) => {
    try {
        const { booking } = await loadBookingForBilling(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        res.json({
            success: true,
            bookingId: booking.bookingId,
            extraServices: booking.extraServices || [],
            // Recomputed on read so legacy bookings (saved before this feature)
            // still return a correct breakdown without a migration.
            billing: computeBilling(booking)
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// POST /:id/extra-services — add one extra service
export const addExtraService = async (req, res) => {
    try {
        const { Booking, query, booking } = await loadBookingForBilling(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        const denied = denyExtraServiceChange(booking, req);
        if (denied) return res.status(denied.code).json({ message: denied.message });

        const line = normalizeExtraService(req.body);
        if (!line.name) {
            return res.status(400).json({ message: 'Service name is required.' });
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
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// PUT /:id/extra-services/:extraId — edit an extra service
export const updateExtraService = async (req, res) => {
    try {
        const { Booking, query, booking } = await loadBookingForBilling(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        const denied = denyExtraServiceChange(booking, req);
        if (denied) return res.status(denied.code).json({ message: denied.message });

        const { extraId } = req.params;
        const current = (booking.extraServices || []).find((e) => String(e._id) === String(extraId));
        if (!current) return res.status(404).json({ message: 'Extra service not found' });

        // Merge so callers can send a partial update.
        const line = normalizeExtraService({
            name: req.body.name ?? current.name,
            quantity: req.body.quantity ?? current.quantity,
            unitPrice: req.body.unitPrice ?? req.body.price ?? current.unitPrice,
            notes: req.body.notes ?? current.notes
        });
        if (!line.name) return res.status(400).json({ message: 'Service name is required.' });

        const nextExtras = (booking.extraServices || []).map((e) =>
            String(e._id) === String(extraId) ? { ...e, ...line } : e
        );

        const result = await saveExtras(Booking, query, booking, nextExtras);
        res.json({ success: true, message: 'Extra service updated', ...result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// DELETE /:id/extra-services/:extraId — remove an extra service
export const removeExtraService = async (req, res) => {
    try {
        const { Booking, query, booking } = await loadBookingForBilling(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        const denied = denyExtraServiceChange(booking, req);
        if (denied) return res.status(denied.code).json({ message: denied.message });

        const { extraId } = req.params;
        const nextExtras = (booking.extraServices || []).filter(
            (e) => String(e._id) !== String(extraId)
        );
        if (nextExtras.length === (booking.extraServices || []).length) {
            return res.status(404).json({ message: 'Extra service not found' });
        }

        const result = await saveExtras(Booking, query, booking, nextExtras);
        res.json({ success: true, message: 'Extra service removed', ...result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Accept Assignment
export const acceptAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const { default: Booking } = await import('../models/Booking.js');
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOneAndUpdate(
            query,
            { status: 'ACCEPTED' },
            { new: true }
        ).populate('userId').populate('assignedTo.technicianId');

        if (!booking) return res.status(404).json({ message: "Assignment not found" });

        emitBookingUpdate(booking.bookingId, 'ACCEPTED', booking.toObject());
        res.json({ message: "Assignment accepted", service: { ...booking.toObject(), id: booking._id } });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Reschedule
export const rescheduleService = async (req, res) => {
    try {
        const { id } = req.params;
        const { scheduledDate, time, notes } = req.body;
        if (!scheduledDate || !time) return res.status(400).json({ message: "Date and time required" });

        const service = await Service.findOneAndUpdate(
            { serviceId: parseInt(id) },
            { scheduledDate: new Date(scheduledDate), time: time, status: 'scheduled', updatedAt: new Date() },
            { new: true }
        );

        if (!service) return res.status(404).json({ message: "Service not found" });

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
            message: `Rescheduled ${service.serviceType} for ${service.customer.name}`,
            serviceId: service.serviceId
        });

        res.json({ message: "Rescheduled", service });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
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
export const getAssigned = async (req, res) => {
    try {
        const { default: Booking } = await import('../models/Booking.js');
        const bookings = await Booking.find({
            'assignedTo.technicianId': req.user.id,
            status: { $in: ['ACCEPTED', 'CONFIRMED', 'IN_PROGRESS', 'NAVIGATING', 'started', 'in_progress'] }
        })
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
            estimatedEarnings: b.serviceDetails?.price || 0,
            location: getFormattedLocation(b)
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getPending = async (req, res) => {
    try {
        const { default: Booking } = await import('../models/Booking.js');
        const bookings = await Booking.find({
            'assignedTo.technicianId': req.user.id,
            status: { $in: ['ASSIGNED', 'assigned'] }
        })
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
            estimatedEarnings: b.serviceDetails?.price || 0,
            duration: getBookingDuration(b),
            location: getFormattedLocation(b)
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getCompleted = async (req, res) => {
    try {
        const { default: Booking } = await import('../models/Booking.js');
        const bookings = await Booking.find({
            'assignedTo.technicianId': req.user.id,
            status: { $in: ['COMPLETED', 'completed'] }
        })
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
            payment: b.payment?.amount || 0,
            location: getFormattedLocation(b)
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getInProgress = async (req, res) => {
    try {
        const { default: Booking } = await import('../models/Booking.js');
        const employee = await Employee.findOne({ email: req.user.email }).lean();
        const numericEmpId = employee?.empId;

        const [bookings, services] = await Promise.all([
            Booking.find({
                'assignedTo.technicianId': req.user.id,
                status: { $in: ['IN_PROGRESS', 'NAVIGATING', 'STARTED', 'in_progress', 'en_route'] }
            })
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
            estimatedEarnings: b.serviceDetails?.price || 0,
            location: getFormattedLocation(b)
        }));

        const mappedS = services.map(s => ({
            id: s.serviceId, _id: s._id, serviceType: s.serviceType || 'Service',
            status: 'in_progress', customer: s.customer?.name || 'Guest',
            address: s.customer?.address || '', customerPhone: s.customer?.phone || '',
            scheduledDate: s.scheduledDate, duration: s.duration || 1, estimatedEarnings: s.estimatedEarnings || 0,
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
        res.status(500).json({ error: err.message });
    }
};

export const getCustomerContact = async (req, res) => {
    try {
        const { id } = req.params;
        const service = await Service.findOne({ serviceId: parseInt(id) }).select('customer serviceType').lean();
        if (!service) return res.status(404).json({ message: "Service not found" });
        res.json({ customer: service.customer, serviceType: service.serviceType });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getServiceQuickActions = async (req, res) => {
    try {
        const { id } = req.params;
        const service = await Service.findOne({ serviceId: parseInt(id) }).select('serviceId serviceType status customer scheduledDate time duration estimatedEarnings empId').lean();
        if (!service) return res.status(404).json({ message: "Service not found" });
        res.json({
            id: service.serviceId, serviceId: service.serviceId, serviceType: service.serviceType,
            status: service.status, customer: service.customer.name, customerPhone: service.customer.phone,
            scheduledDate: service.scheduledDate, time: service.time, duration: service.duration,
            estimatedEarnings: service.estimatedEarnings, address: service.customer.address
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
