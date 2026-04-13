import Service from "../models/Service.js";
import ServiceNote from "../models/ServiceNote.js";
import Activity from "../models/Activity.js";
import Employee from "../models/adminEmployee.js";
import Payment from "../models/Payment.js";
import UpcomingPayment from "../models/UpcomingPayment.js";
import { emitBookingUpdate } from "../socket.js";
import mongoose from "mongoose";

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
        const { actualEarnings, notes, completionTime } = req.body;
        const { default: Booking } = await import('../models/Booking.js');
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOneAndUpdate(
            query,
            {
                status: 'COMPLETED',
                completedAt: completionTime || new Date(),
                'payment.amount': actualEarnings,
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
            metadata: { earnings: actualEarnings }
        });

        res.json({ message: "Service completed successfully", service: { ...booking.toObject(), id: booking._id } });
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
        .select('-history -metadata -technicianNotes')
        .sort({ 'schedule.preferredDate': 1 })
        .lean();

        res.json(bookings.map(b => ({
            _id: b._id,
            id: b.bookingId,
            serviceType: b.serviceDetails?.title || b.serviceId?.title || 'Service',
            status: b.status.toLowerCase(),
            customer: b.contactIdInfo?.fullName || b.contactInfo?.fullName || b.userId?.name || 'Guest',
            address: b.location?.completeAddress || b.userId?.address || '',
            customerPhone: b.contactIdInfo?.phoneNumber || b.contactInfo?.phoneNumber || b.userId?.phone || '',
            scheduledDate: b.schedule?.preferredDate,
            time: b.schedule?.timeSlot || '09:00 AM',
            duration: getBookingDuration(b),
            estimatedEarnings: b.serviceDetails?.price || 0
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
        .select('-history -metadata -technicianNotes')
        .sort({ createdAt: -1 })
        .lean();

        res.json(bookings.map(b => ({
            id: b._id,
            serviceType: b.serviceDetails?.category || 'General',
            title: b.serviceDetails?.title || 'Service Task',
            status: 'pending',
            customer: b.contactIdInfo?.fullName || b.contactInfo?.fullName || b.userId?.name || 'Guest',
            address: b.location?.completeAddress || 'No address',
            estimatedEarnings: b.serviceDetails?.price || 0,
            duration: getBookingDuration(b)
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
        .select('-history -metadata -technicianNotes')
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();

        res.json(bookings.map(b => ({
            id: b._id,
            serviceType: b.serviceDetails?.title || 'Service',
            status: 'completed',
            customer: b.contactIdInfo?.fullName || b.contactInfo?.fullName || b.userId?.name || 'Guest',
            completedDate: b.completedAt || b.updatedAt,
            duration: getBookingDuration(b),
            payment: b.payment?.amount || 0
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
            }).populate('userId', 'name phone address').populate('serviceId', 'title category duration price').select('-history -metadata').lean(),
            numericEmpId ? Service.find({ empId: numericEmpId, status: { $regex: /progress|route|started/i } }).lean() : Promise.resolve([])
        ]);

        const mappedB = bookings.map(b => ({
            id: b.bookingId, _id: b._id, serviceType: b.serviceDetails?.title || 'Service',
            status: 'in_progress', customer: b.contactIdInfo?.fullName || b.userId?.name || 'Guest',
            address: b.location?.completeAddress || b.userId?.address || '',
            customerPhone: b.contactIdInfo?.phoneNumber || b.userId?.phone || '',
            scheduledDate: b.schedule?.preferredDate, duration: getBookingDuration(b),
            estimatedEarnings: b.serviceDetails?.price || 0
        }));

        const mappedS = services.map(s => ({
            id: s.serviceId, _id: s._id, serviceType: s.serviceType || 'Service',
            status: 'in_progress', customer: s.customer?.name || 'Guest',
            address: s.customer?.address || '', customerPhone: s.customer?.phone || '',
            scheduledDate: s.scheduledDate, duration: s.duration || 1, estimatedEarnings: s.estimatedEarnings || 0
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
