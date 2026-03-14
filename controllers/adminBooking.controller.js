import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { emitBookingUpdate, sendNotification } from "../utils/helpers.js";
import { sendEmail, getAssignmentEmailTemplate, getStatusUpdateEmailTemplate } from '../services/emailService.js';
import { generateInvoiceHTML } from '../utils/invoiceTemplate.js';

// ======================================
// HELPERS
// ======================================

const validateObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const sanitizeInput = (input) => {
    if (typeof input === 'string') return input.trim();
    return input;
};

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

const formatBookingResponse = (booking) => {
    const userName =
        booking.userName ||
        booking.userId?.name ||
        booking.customer?.name ||
        booking.contactInfo?.fullName ||
        booking.contactIdInfo?.fullName ||
        "Guest User";

    const serviceName =
        booking.serviceName ||                 // ✅ MAIN SOURCE
        booking.serviceDetails?.title ||       // ✅ BACKUP
        booking.serviceId?.name ||
        booking.serviceId?.title ||
        "Not specified";

    const duration =
        booking.duration ||
        booking.serviceDetails?.duration ||
        booking.serviceId?.duration ||
        calculateDurationFromTimeSlot(booking.time || booking.schedule?.timeSlot) ||
        null;

    return {
        _id: booking._id,
        bookingId: booking.bookingId,

        // ✅ SERVICE
        serviceName,
        category:
            booking.category ||
            booking.serviceDetails?.category ||
            booking.serviceId?.category ||
            "General",

        price:
            booking.price ||
            booking.serviceDetails?.price ||
            booking.payment?.amount ||
            0,

        // Add for frontend compatibility
        totalAmount:
            booking.price ||
            booking.serviceDetails?.price ||
            booking.payment?.amount ||
            0,

        // ✅ USER
        userName,
        customerName: userName, // Alias for frontend
        userEmail:
            booking.userEmail ||
            booking.userId?.email ||
            booking.customer?.email ||
            booking.contactInfo?.email ||
            booking.contactIdInfo?.email ||
            "",
        userPhone:
            booking.userPhone ||
            booking.userId?.phone ||
            booking.customer?.phone ||
            booking.contactInfo?.phoneNumber ||
            booking.contactIdInfo?.phoneNumber ||
            "",

        // ✅ DATE & TIME
        date: booking.date || (booking.schedule?.preferredDate ? booking.schedule.preferredDate.toISOString().split('T')[0] : 'N/A'),
        time: booking.time || booking.schedule?.timeSlot || "N/A",
        timeSlot: booking.time || booking.schedule?.timeSlot || "N/A", // Alias for frontend

        // ✅ STATUS
        status:
            booking.status === "in_progress"
                ? "in progress"
                : booking.status,

        // Add timeline for frontend
        statusTimeline: booking.statusTimeline?.map(entry => ({
            status: entry.status,
            displayStatus: entry.status === 'IN_PROGRESS' ? 'in progress' : entry.status.toLowerCase(),
            updatedBy: entry.updatedBy,
            timestamp: entry.timestamp,
            note: entry.note
        })) || [],

        // Track current step
        currentStep: booking.statusTimeline?.[booking.statusTimeline.length - 1]?.status || 'PENDING',

        // Add assigned employee info if exists
        assignedTo: booking.assignedTo,
        assignedEmployee: booking.assignedTo?.name || booking.assignedTo?.technicianId?.name || null,

        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,

        // Detailed Info
        address: booking.location?.completeAddress || booking.address,
        specialInstructions: booking.notes || booking.adminNotes,

        // Explicit fields used by admin modal
        duration,
        serviceDetails: booking.serviceDetails || null
    };
};

// ======================================
// CONTROLLERS
// ======================================

/**
 * @desc    Get all bookings with filters
 * @route   GET /api/admin/bookings
 * @access  Private/Admin
 */
export const getAllBookings = async (req, res) => {
    try {
        const {
            status,
            limit = 100,
            page = 1,
            search = ''
        } = req.query;

        const limitNum = Math.min(parseInt(limit), 200);
        const skipNum = (parseInt(page) - 1) * limitNum;

        // 1. Build Match Stage
        const matchStage = {};

        if (status && status !== 'all') {
            const sanitizedStatus = sanitizeInput(status).toLowerCase();
            const statusMap = {
                'pending': ['PENDING', 'pending', 'Pending'],
                'accepted': ['ACCEPTED', 'accepted', 'Accepted', 'CONFIRMED', 'confirmed'],
                'confirmed': ['ACCEPTED', 'accepted', 'Accepted', 'CONFIRMED', 'confirmed'],
                'assigned': ['ASSIGNED', 'assigned', 'Assigned'],
                'in progress': ['IN_PROGRESS', 'in_progress', 'In Progress', 'IN PROGRESS', 'STARTED', 'started', 'NAVIGATING', 'navigating'],
                'in_progress': ['IN_PROGRESS', 'in_progress', 'In Progress', 'IN PROGRESS', 'STARTED', 'started', 'NAVIGATING', 'navigating'],
                'navigating': ['NAVIGATING', 'navigating', 'Navigating'],
                'started': ['STARTED', 'started', 'Started', 'IN_PROGRESS'],
                'completed': ['COMPLETED', 'completed', 'Completed', 'DONE', 'done', 'FINISHED', 'finished'],
                'cancelled': ['CANCELLED', 'cancelled', 'Cancelled', 'CANCELED', 'canceled']
            };

            if (sanitizedStatus === 'assigned') {
                matchStage.$or = [
                    { status: { $in: statusMap.assigned || ['ASSIGNED'] } },
                    { assignedTo: { $exists: true, $ne: null }, status: { $nin: ['COMPLETED', 'CANCELLED'] } }
                ];
            } else {
                const targetStatuses = statusMap[sanitizedStatus] || [sanitizedStatus.toUpperCase(), sanitizedStatus.toLowerCase(), sanitizedStatus];
                matchStage.status = { $in: targetStatuses };
            }
        }

        if (search) {
            matchStage.$or = matchStage.$or || [];
            matchStage.$or.push(
                { bookingId: { $regex: search, $options: 'i' } },
                { "serviceDetails.title": { $regex: search, $options: 'i' } },
                { "userName": { $regex: search, $options: 'i' } }
            );
        }

        // 2. High Performance Aggregation Pipeline
        const pipeline = [
            { $match: matchStage },
            { $sort: { createdAt: -1 } },
            { $skip: skipNum },
            { $limit: limitNum },
            // Lookup Customer (User) - Project ONLY necessary fields to avoid bloat
            {
                $lookup: {
                    from: "users",
                    let: { userId: "$userId" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$_id", "$$userId"] } } },
                        { $project: { name: 1, email: 1, phone: 1 } } // Exclude avatar
                    ],
                    as: "customerInfo"
                }
            },
            { $unwind: { path: "$customerInfo", preserveNullAndEmptyArrays: true } },
            // Lookup Service
            {
                $lookup: {
                    from: "services",
                    localField: "serviceId",
                    foreignField: "_id",
                    as: "serviceInfo"
                }
            },
            { $unwind: { path: "$serviceInfo", preserveNullAndEmptyArrays: true } },
            // Lookup Assigned Technician (User) - Project ONLY necessary fields
            {
                $lookup: {
                    from: "users",
                    let: { techId: "$assignedTo.technicianId" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$_id", "$$techId"] } } },
                        { $project: { name: 1, email: 1, phone: 1 } } // Exclude avatar
                    ],
                    as: "technicianInfo"
                }
            },
            { $unwind: { path: "$technicianInfo", preserveNullAndEmptyArrays: true } },
            // Project and format - Final cleanup
            {
                $project: {
                    _id: 1,
                    bookingId: 1,
                    status: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    price: 1,
                    duration: 1,
                    serviceDetails: 1,
                    schedule: 1,
                    location: 1,
                    notes: 1,
                    payment: 1,
                    // Reconstruct assignedTo without the bloated avatar from the join
                    assignedTo: {
                        technicianId: "$assignedTo.technicianId",
                        name: { $ifNull: ["$assignedTo.name", "$technicianInfo.name"] },
                        phone: { $ifNull: ["$assignedTo.phone", "$technicianInfo.phone"] }
                        // Explicitly NOT including avatar here
                    },
                    userId: {
                        _id: "$customerInfo._id",
                        name: "$customerInfo.name",
                        email: "$customerInfo.email",
                        phone: "$customerInfo.phone"
                    }
                }
            }
        ];

        // 3. Robust Execution with Safety Timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database aggregation timeout (30s)')), 30000);
        });

        const aggregationPromise = Booking.aggregate(pipeline);
        const countPromise = Booking.countDocuments(matchStage);

        const [bookings, totalBookings] = await Promise.race([
            Promise.all([aggregationPromise, countPromise]),
            timeoutPromise
        ]);

        // 4. Final Formatting
        const formattedBookings = bookings.map(b => {
            const f = formatBookingResponse(b);
            if (f.status) f.status = f.status.toLowerCase();
            return f;
        });

        res.json({
            success: true,
            data: formattedBookings,
            total: totalBookings,
            page: parseInt(page),
            limit: limitNum,
            totalPages: Math.ceil(totalBookings / limitNum)
        });

    } catch (error) {
        console.error("Admin bookings aggregation error:", error);
        res.status(500).json({ 
            success: false, 
            error: "Failed to load bookings", 
            message: error.message 
        });
    }
};

/**
 * @desc    Get booking details by ID
 * @route   GET /api/admin/bookings/:id
 * @access  Private/Admin
 */
export const getBookingById = async (req, res) => {
    try {
        const bookingId = sanitizeInput(req.params.id);

        if (!validateObjectId(bookingId)) {
            return res.status(400).json({ success: false, error: 'Invalid booking ID format' });
        }

        const booking = await Booking.findById(bookingId)
            .populate('userId', 'name email phone address avatar')
            .populate('serviceId', 'name title category price description duration')
            .lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const formattedBooking = formatBookingResponse(booking);
        if (formattedBooking.status === 'in_progress') {
            formattedBooking.status = 'in progress';
        }

        res.json({ success: true, booking: formattedBooking });
    } catch (error) {
        console.error('Booking details error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

/**
 * @desc    Get bookings for a specific user (Admin View)
 * @route   GET /api/admin/bookings/user/:userId
 * @access  Private (Admin)
 */
export const getUserBookings = async (req, res) => {
    try {
        const bookings = await Booking.find({ userId: req.params.userId })
            .populate("assignedTo.technicianId", "name email")
            .populate("serviceId", "name category")
            .sort({ createdAt: -1 });

        res.json({ success: true, bookings });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @desc    Update booking status
 * @route   PUT/PATCH /api/admin/bookings/:id/status
 * @access  Private/Admin
 */
export const updateBookingStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes, cancellationReason, updatedBy = 'admin' } = req.body;

        if (!id || !status) {
            return res.status(400).json({ success: false, error: 'Booking ID and status are required' });
        }

        const statusMap = {
            'in progress': 'IN_PROGRESS',
            'processing': 'IN_PROGRESS',
            'in_progress': 'IN_PROGRESS',
            'navigating': 'NAVIGATING',
            'pending': 'PENDING',
            'confirmed': 'ACCEPTED',
            'accepted': 'ACCEPTED',
            'completed': 'COMPLETED',
            'cancelled': 'CANCELLED'
        };

        let dbStatus = statusMap[status.toLowerCase()] || status;
        dbStatus = dbStatus.toUpperCase();
        const validDbStatuses = ['PENDING', 'ACCEPTED', 'NAVIGATING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

        if (!validDbStatuses.includes(dbStatus)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }

        const booking = await Booking.findById(id);
        if (!booking) {
            return res.status(404).json({ success: false, error: 'Booking not found' });
        }

        const currentStatus = booking.status ? booking.status.toUpperCase() : 'PENDING';
        
        booking.status = dbStatus;
        if (!booking.statusTimeline) {
            booking.statusTimeline = [];
        }
        booking.statusTimeline.push({
            status: dbStatus,
            updatedBy: updatedBy,
            note: notes || (dbStatus === 'CANCELLED' ? cancellationReason : 'Status updated')
        });

        if (dbStatus === 'CANCELLED') {
            booking.cancelledAt = new Date();
            booking.cancellationBy = updatedBy;
            if (cancellationReason) booking.cancellationReason = cancellationReason;
        } else if (dbStatus === 'COMPLETED') {
            booking.completedAt = new Date();
        }

        booking.updatedAt = new Date();
        await booking.save();

        const updated = await Booking.findById(booking._id)
            .populate('userId')
            .populate('serviceId')
            .populate('assignedTo.technicianId', 'name email phone')
            .lean();

        emitBookingUpdate(booking.bookingId, formatBookingResponse(updated).status, formatBookingResponse(updated));

        // Side effects (Notifications, Emails)
        if (booking.assignedTo) {
            try {
                const assignedEmp = updated.assignedTo;
                if (assignedEmp && assignedEmp.email) {
                    const { subject, html } = getStatusUpdateEmailTemplate(booking.bookingId, dbStatus, notes);
                    await sendEmail({ to: assignedEmp.email, subject, html });
                }
            } catch (emailErr) {
                console.error('Failed to send status update email to employee:', emailErr);
            }
        }

        if (dbStatus === 'CANCELLED' && booking.userId) {
            try {
                const userEmail = updated.userId?.email || booking.userId.email;
                if (userEmail) {
                    await sendEmail({
                        to: userEmail,
                        subject: `Booking Cancelled - #${booking.bookingId}`,
                        html: `<p>Your booking #${booking.bookingId} has been cancelled.</p>`
                    });
                }
            } catch (userEmailErr) {
                console.error('Failed to send cancellation email to user:', userEmailErr);
            }
        }

        if (booking.userId) {
            try {
                await sendNotification(booking.userId, {
                    type: 'booking',
                    title: 'Booking Update',
                    message: `Your booking #${booking.bookingId} status has changed to ${dbStatus.toLowerCase()}`,
                    data: { bookingId: booking._id, status: dbStatus }
                });
            } catch (notifErr) {
                console.error('Failed to send dashboard notification to user:', notifErr);
            }
        }

        res.json({
            success: true,
            message: 'Status updated',
            booking: formatBookingResponse(updated)
        });

    } catch (error) {
        console.error('Update Status Error:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
};

/**
 * @desc    Update booking details
 * @route   PUT /api/admin/bookings/:id
 * @access  Private/Admin
 */
export const updateBooking = async (req, res) => {
    try {
        const bookingId = sanitizeInput(req.params.id);
        const updateData = { updatedAt: new Date(), ...req.body };
        const updated = await Booking.findByIdAndUpdate(bookingId, updateData, { new: true })
            .populate("userId")
            .populate("serviceId")
            .lean();

        if (!updated) return res.status(404).json({ success: false, error: "Booking not found" });

        res.json({ success: true, message: "Booking updated", booking: formatBookingResponse(updated) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @desc    Delete booking
 * @route   DELETE /api/admin/bookings/:id
 * @access  Private/Admin
 */
export const deleteBooking = async (req, res) => {
    try {
        const bookingId = sanitizeInput(req.params.id);
        const booking = await Booking.findById(bookingId);
        if (!booking) return res.status(404).json({ success: false, error: "Booking not found" });

        if (!['pending', 'cancelled', 'rejected', 'PENDING', 'CANCELLED'].includes(booking.status)) {
            return res.status(400).json({ success: false, error: "Cannot delete active booking" });
        }

        await Booking.findByIdAndDelete(bookingId);
        res.json({ success: true, message: "Booking deleted" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @desc    Assign booking to employee
 * @route   POST /api/admin/bookings/:id/assign
 * @access  Private/Admin
 */
export const assignBooking = async (req, res) => {
    try {
        const { id: bookingId } = req.params;
        const { employeeId } = req.body;
        const adminId = req.user?.id || req.user?._id;

        if (!employeeId) return res.status(400).json({ success: false, message: 'Employee ID is required' });

        const booking = await Booking.findById(bookingId);
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

        let employee = await User.findById(employeeId);
        if (!employee) {
            const { default: AdminEmployee } = await import('../models/adminEmployee.js');
            employee = await AdminEmployee.findById(employeeId);
        }

        if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

        const technicianDetails = {
            technicianId: employee._id,
            name: employee.name || employee.empName,
            phone: employee.phone,
            avatar: employee.avatar,
            rating: employee.stats?.rating || employee.rating || 5,
            assignedAt: new Date()
        };

        const updateOperation = {
            $set: { assignedTo: technicianDetails, status: 'ASSIGNED', updatedAt: new Date() },
            $push: { history: { status: 'ASSIGNED', updatedBy: 'admin', userId: adminId || null, notes: `Assigned to ${technicianDetails.name}`, timestamp: new Date() } }
        };

        const updatedBooking = await Booking.findByIdAndUpdate(bookingId, updateOperation, { new: true }).populate('userId').populate('serviceId');

        await sendNotification(employee._id.toString(), {
            type: 'assignment',
            title: 'New Service Assignment',
            message: `You have been assigned a new service: ${updatedBooking.serviceDetails?.title || 'Service'}`,
            bookingId: updatedBooking._id
        });

        res.json({ success: true, message: 'Employee assigned successfully', booking: formatBookingResponse(updatedBooking) });

    } catch (error) {
        console.error('Assignment error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

/**
 * @desc    Generate and send HTML invoice
 * @route   GET /api/admin/bookings/:id/invoice
 * @access  Private/Admin
 */
export const generateInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const booking = await Booking.findById(id).populate('userId').populate('serviceId').lean();
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

        const formattedData = formatBookingResponse(booking);
        formattedData.paymentStatus = booking.payment?.status || 'PENDING';
        const html = generateInvoiceHTML(formattedData);

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to generate invoice', error: error.message });
    }
};
