import Service from "../models/Service.js";
import ServiceNote from "../models/ServiceNote.js";
import Activity from "../models/Activity.js";
import Employee from "../models/adminEmployee.js";
import Payment from "../models/Payment.js";
import UpcomingPayment from "../models/UpcomingPayment.js";
import { emitBookingUpdate } from "../socket.js";

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

// Confirm service
// Confirm service
// Confirm service (Using Booking ID)
// Confirm service (Using Booking ID or _id)
export const confirmService = async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        const { default: Booking } = await import('../models/Booking.js');
        const mongoose = (await import('mongoose')).default;

        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOneAndUpdate(
            query,
            {
                status: 'ACCEPTED',
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId').populate('assignedTo.technicianId');

        if (!booking) {
            return res.status(404).json({ message: "Booking not found" });
        }

        // Emit Socket Event
        emitBookingUpdate(booking.bookingId, 'ACCEPTED', booking.toObject());

        // Log activity
        await Activity.create({
            empId: booking.assignedTo?.technicianId?._id || req.user.id,
            type: 'service_scheduled',
            message: `Confirmed service ${booking.serviceDetails?.title} for ${booking.userId?.name || 'Customer'}`,
            serviceId: booking._id // Storing Booking ObjectId
        });

        res.json({
            message: "Service confirmed successfully",
            service: { ...booking.toObject(), id: booking._id }
        });
    } catch (err) {
        console.error("❌ Error confirming service:", err);
        res.status(400).json({ error: err.message });
    }
};

// Start service
// Start service (Using Booking ID)
// Start service (Using Booking ID or _id)
export const startService = async (req, res) => {
    try {
        const { id } = req.params;
        const { startTime, notes } = req.body;
        console.log(`🚀 Starting service (Booking) ${id}...`);

        const { default: Booking } = await import('../models/Booking.js');
        const mongoose = (await import('mongoose')).default;

        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOneAndUpdate(
            query,
            {
                status: 'IN_PROGRESS',
                startedAt: startTime || new Date(),
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId').populate('assignedTo.technicianId');

        if (!booking) {
            return res.status(404).json({ message: "Booking not found" });
        }

        emitBookingUpdate(booking.bookingId, 'IN_PROGRESS', booking.toObject());

        // Log activity
        await Activity.create({
            empId: booking.assignedTo?.technicianId?._id || req.user.id,
            type: 'service_started',
            message: `Started ${booking.serviceDetails?.title} service for ${booking.userId?.name}`,
            serviceId: booking._id
        });

        res.json({
            message: "Service started successfully",
            service: { ...booking.toObject(), id: booking._id }
        });
    } catch (err) {
        console.error(`❌ Error starting service ${req.params.id}:`, err);
        res.status(400).json({ error: err.message });
    }
};

// Complete service
// Complete service (Using Booking ID)
// Complete service (Using Booking ID or _id)
export const completeService = async (req, res) => {
    try {
        const { id } = req.params;
        const { actualEarnings, notes, completionTime, paymentMethod = 'cash' } = req.body;

        const { default: Booking } = await import('../models/Booking.js');
        const mongoose = (await import('mongoose')).default;

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

        if (!booking) {
            return res.status(404).json({ message: "Booking not found" });
        }

        emitBookingUpdate(booking.bookingId, 'COMPLETED', booking.toObject());

        await Activity.create({
            empId: booking.assignedTo?.technicianId?._id || req.user.id,
            type: 'service_completed',
            message: `Completed ${booking.serviceDetails?.title} service for ${booking.userId?.name}`,
            serviceId: booking._id,
            metadata: { earnings: actualEarnings }
        });

        res.json({
            message: "Service completed successfully",
            service: { ...booking.toObject(), id: booking._id }
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Get service customer contact info
export const getCustomerContact = async (req, res) => {
    try {
        const { id } = req.params;

        const service = await Service.findOne({ serviceId: parseInt(id) })
            .select('customer serviceType');

        if (!service) {
            return res.status(404).json({ message: "Service not found" });
        }

        res.json({
            customer: service.customer,
            serviceType: service.serviceType
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Update service status
// Update service status
// Update service status (Using Booking ID)
// Update service status (Using Booking ID or _id)
export const updateServiceStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;

        const { default: Booking } = await import('../models/Booking.js');
        const mongoose = (await import('mongoose')).default;

        // Map status to uppercase Backend Enum
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
            {
                status: bookingStatus,
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId');

        if (!booking) {
            return res.status(404).json({ message: "Booking not found" });
        }

        emitBookingUpdate(booking.bookingId, bookingStatus, booking.toObject());

        res.json({
            message: `Service status updated to ${status}`,
            service: { ...booking.toObject(), id: booking._id }
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Get service quick actions data
export const getServiceQuickActions = async (req, res) => {
    try {
        const { id } = req.params;

        const service = await Service.findOne({ serviceId: parseInt(id) })
            .select('serviceId serviceType status customer scheduledDate time duration estimatedEarnings empId');

        if (!service) {
            return res.status(404).json({ message: "Service not found" });
        }

        // Format response for frontend
        const serviceData = {
            id: service.serviceId,
            serviceId: service.serviceId,
            serviceType: service.serviceType,
            status: service.status,
            customer: service.customer.name,
            customerPhone: service.customer.phone,
            scheduledDate: service.scheduledDate,
            time: service.time,
            duration: service.duration,
            estimatedEarnings: service.estimatedEarnings,
            address: service.customer.address
        };

        res.json(serviceData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Reschedule service
export const rescheduleService = async (req, res) => {
    try {
        const { id } = req.params;
        const { scheduledDate, time, notes } = req.body;

        if (!scheduledDate || !time) {
            return res.status(400).json({ message: "Scheduled date and time are required" });
        }

        const service = await Service.findOneAndUpdate(
            { serviceId: parseInt(id) },
            {
                scheduledDate: new Date(scheduledDate),
                time: time,
                status: 'scheduled', // Reset to scheduled when rescheduling
                updatedAt: new Date()
            },
            { new: true }
        );

        if (!service) {
            return res.status(404).json({ message: "Service not found" });
        }

        // Add reschedule note if provided
        if (notes) {
            const lastNote = await ServiceNote.findOne().sort({ noteId: -1 });
            const newNoteId = lastNote ? lastNote.noteId + 1 : 6001;

            await ServiceNote.create({
                noteId: newNoteId,
                serviceId: parseInt(id),
                empId: service.empId,
                note: `Service rescheduled to ${new Date(scheduledDate).toLocaleDateString()} at ${time}: ${notes}`,
                type: 'general',
                priority: 'medium',
                createdBy: 'technician'
            });
        }

        // Log activity
        await Activity.create({
            empId: service.empId,
            type: 'service_scheduled',
            message: `Rescheduled ${service.serviceType} service for ${service.customer.name}`,
            serviceId: service.serviceId
        });

        res.json({
            message: "Service rescheduled successfully",
            service: service
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// GET /api/service-actions/assigned - Get assigned services for the logged-in employee
// export const getAssigned = async (req, res) => {
//     try {
//         const employee = await Employee.findOne({ email: req.user.email });
//         if (!employee) return res.status(404).json({ message: "Employee not found" });

//         const services = await Service.find({
//             empId: employee.empId,
//             status: { $in: ['scheduled', 'confirmed', 'in_progress'] }
//         });

//         // Format for frontend
//         const formatted = services.map(s => ({
//             id: s.serviceId,
//             serviceId: s.serviceId,
//             serviceType: s.serviceType,
//             status: s.status,
//             customer: s.customer.name,
//             address: s.customer.address,
//             customerPhone: s.customer.phone,
//             scheduledDate: s.scheduledDate,
//             time: s.time,
//             duration: s.duration,
//             estimatedEarnings: s.estimatedEarnings
//         }));

//         res.json(formatted);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// };

// GET /api/service-actions/assigned - Get assigned services for the logged-in employee
// GET /api/service-actions/assigned - Get assigned services for the logged-in employee (From Bookings)
export const getAssigned = async (req, res) => {
    try {
        // Use Booking model
        const { default: Booking } = await import('../models/Booking.js');

        // Find bookings where this user is assigned and status is active
        // req.user.id is from auth middleware (linked employee user)
        const bookings = await Booking.find({
            'assignedTo.technicianId': req.user.id,
            status: { $in: ['ACCEPTED', 'CONFIRMED', 'IN_PROGRESS', 'NAVIGATING', 'started', 'in_progress'] }
        })
            .populate('userId', 'name phone address')
            .populate('serviceId', 'title category price duration')
            .sort({ 'schedule.preferredDate': 1 });

        // Format for frontend
        const formatted = bookings.map(b => ({
            id: b.bookingId, // Use readable ID or _id depending on frontend expectation. Frontend uses .id for actions. Let's send booking _id as .id for API actions? 
            // Wait, previous controller used serviceId (int). Frontend actions like /service-actions/:id/confirm probably expect what we send here.
            // If we send readable bookingId (string), check if backend action handlers support it.
            // The action handlers in THIS file use `parseInt(id)`. Uh oh.
            // If I change fetch, I MUST change action handlers too.
            // OR I can use `_id` and update action handlers to use findById(_id).
            // Let's use `b._id` and I will update action handlers in next step.
            _id: b._id,
            serviceId: b.serviceId?._id, // Metadata

            // Layout fields
            serviceType: b.serviceDetails?.title || b.serviceId?.title || 'Service',
            status: b.status.toLowerCase(),
            customer: b.contactIdInfo?.fullName || b.contactInfo?.fullName || b.userId?.name || 'Guest',
            address: b.location?.completeAddress || b.userId?.address || '',
            customerPhone: b.contactIdInfo?.phoneNumber || b.contactInfo?.phoneNumber || b.userId?.phone || '',

            scheduledDate: b.schedule?.preferredDate,
            time: b.schedule?.timeSlot || '09:00 AM',
            duration: getBookingDuration(b),
            estimatedEarnings: (b.serviceDetails?.price || 0) * 0.8 // Dummy calc
        }));

        res.json(formatted);
    } catch (err) {
        console.error("❌ Error in getAssigned:", err);
        res.status(500).json({ error: err.message });
    }
};

// GET /api/service-actions/pending - Get pending assignments (From Bookings)
export const getPending = async (req, res) => {
    try {
        const { default: Booking } = await import('../models/Booking.js');

        const bookings = await Booking.find({
            'assignedTo.technicianId': req.user.id,
            status: { $in: ['ASSIGNED', 'assigned'] }
        })
            .populate('userId', 'name phone address')
            .populate('serviceId', 'title category')
            .sort({ createdAt: -1 });

        const formatted = bookings.map(b => ({
            id: b._id, // Use MongoDB _id
            serviceId: b.serviceId?._id,
            title: b.serviceDetails?.title || 'Service Task',
            serviceType: b.serviceDetails?.category || 'General',
            status: 'pending', // Frontend expects 'pending' for these
            customer: b.contactIdInfo?.fullName || b.contactInfo?.fullName || b.userId?.name || 'Guest',
            address: b.location?.completeAddress || 'No address',
            priority: 'medium',
            estimatedEarnings: (b.serviceDetails?.price || 0) * 0.8,
            duration: getBookingDuration(b)
        }));

        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// GET /api/service-actions/completed
export const getCompleted = async (req, res) => {
    try {
        const { default: Booking } = await import('../models/Booking.js');

        const bookings = await Booking.find({
            'assignedTo.technicianId': req.user.id,
            status: { $in: ['COMPLETED', 'completed'] }
        })
            .populate('userId', 'name phone address')
            .populate('serviceId', 'title category')
            .sort({ updatedAt: -1 })
            .limit(50);

        const formatted = bookings.map(b => ({
            id: b._id,
            serviceId: b.serviceId?._id,
            serviceType: b.serviceDetails?.title || 'Service',
            status: 'completed',
            customer: b.contactIdInfo?.fullName || b.contactInfo?.fullName || b.userId?.name || 'Guest',
            completedDate: b.completedAt || b.updatedAt,
            duration: getBookingDuration(b),
            payment: b.payment?.amount || 0
        }));

        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// PUT /api/service-actions/:serviceId/accept - Accept a service assignment
// PUT /api/service-actions/:serviceId/accept - Accept a service assignment
// Accept assignment (Using Booking ID)
// Accept assignment (Using Booking ID or _id)
export const acceptAssignment = async (req, res) => {
    try {
        const { id } = req.params;

        const { default: Booking } = await import('../models/Booking.js');
        const mongoose = (await import('mongoose')).default;

        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };

        const booking = await Booking.findOneAndUpdate(
            query,
            { status: 'ACCEPTED' },
            { new: true }
        ).populate('userId').populate('assignedTo.technicianId');

        if (!booking) {
            return res.status(404).json({ message: "Assignment (Booking) not found" });
        }

        // Emit Socket Event
        emitBookingUpdate(booking.bookingId, 'ACCEPTED', booking.toObject());

        res.json({
            message: "Assignment accepted",
            service: { ...booking.toObject(), id: booking._id }
        });
    } catch (err) {
        console.error("❌ Error accepting assignment:", err);
        res.status(400).json({ error: err.message });
    }
};
// GET /api/service-actions/in-progress
export const getInProgress = async (req, res) => {
    try {
        const { default: Booking } = await import('../models/Booking.js');
        const { default: Service } = await import('../models/Service.js');
        const Employee = (await import('../models/adminEmployee.js')).default;

        // 1. Get Numeric Emp ID for Legacy Services
        let numericEmpId = null;
        const employee = await Employee.findOne({ email: req.user.email });
        if (employee) numericEmpId = employee.empId;

        // 2. Fetch Bookings
        const bookings = await Booking.find({
            'assignedTo.technicianId': req.user.id,
            status: { $in: ['IN_PROGRESS', 'NAVIGATING', 'STARTED', 'in_progress', 'en_route'] }
        })
        .populate('userId', 'name phone address')
        .populate('serviceId', 'title category duration price');

        // 3. Fetch Legacy Services
        let services = [];
        if (numericEmpId) {
             services = await Service.find({
                empId: numericEmpId,
                status: { $regex: /progress|route|started/i } // Loose match
            });
        }

        // 4. Map Bookings
        const mappedBookings = bookings.map(b => ({
            id: b.bookingId,
            _id: b._id,
            serviceId: b.serviceId?._id,
            serviceType: b.serviceDetails?.title || 'Service',
            status: 'in_progress', // Normalize for frontend
            customer: b.contactIdInfo?.fullName || b.contactInfo?.fullName || b.userId?.name || 'Guest',
            address: b.location?.completeAddress || b.userId?.address || '',
            customerPhone: b.contactIdInfo?.phoneNumber || b.contactInfo?.phoneNumber || b.userId?.phone || '',
            scheduledDate: b.schedule?.preferredDate,
            duration: getBookingDuration(b),
            estimatedEarnings: b.serviceDetails?.price || 0
        }));

        // 5. Map Services
        const mappedServices = services.map(s => ({
            id: s.serviceId, // Legacy ID
            _id: s._id,
            serviceId: s.serviceId,
            serviceType: s.serviceType || 'Service',
            status: 'in_progress',
            customer: s.customer?.name || 'Guest',
            address: s.customer?.address || '',
            customerPhone: s.customer?.phone || '',
            scheduledDate: s.scheduledDate,
            duration: s.duration || 1,
            estimatedEarnings: s.estimatedEarnings || 0
        }));

        // 6. Merge & Send
        res.json([...mappedBookings, ...mappedServices]);

    } catch (err) {
        console.error('Error fetching in-progress:', err);
        res.status(500).json({ error: err.message });
    }
};
