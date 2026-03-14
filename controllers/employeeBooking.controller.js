
// employeeBooking.controller.js
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import UpcomingPayment from "../models/UpcomingPayment.js";
import Employee from "../models/adminEmployee.js";

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
    calculateDurationFromTimeSlot(booking.time || booking.schedule?.timeSlot) ||
    60;

// Helper for formatting response (duplicated from admin controller for independence)
const formatBookingResponse = (booking) => {
    return {
        _id: booking._id,
        bookingId: booking.bookingId,
        serviceName: booking.serviceName || booking.serviceDetails?.title || booking.service?.name,
        category: booking.category || booking.serviceDetails?.category,
        price: booking.price || booking.serviceDetails?.price || 0,
        userName: booking.userName || booking.customer?.name,
        userEmail: booking.userEmail || booking.customer?.email,
        userPhone: booking.userPhone || booking.contactIdInfo?.phoneNumber || booking.contactInfo?.phoneNumber,
        date: booking.date || booking.schedule?.preferredDate?.toISOString().split('T')[0],
        time: booking.time || booking.schedule?.timeSlot,
        status: booking.status === "in_progress" ? "in progress" : booking.status,

        // Timeline fields
        statusTimeline: booking.statusTimeline?.map(entry => ({
            status: entry.status,
            displayStatus: entry.status === 'IN_PROGRESS' ? 'in progress' : entry.status.toLowerCase(),
            updatedBy: entry.updatedBy,
            timestamp: entry.timestamp,
            note: entry.note
        })) || [],
        currentStep: booking.statusTimeline?.[booking.statusTimeline.length - 1]?.status || 'PENDING',

        assignedTo: booking.assignedTo,
        address: booking.location?.completeAddress || booking.address,
        specialInstructions: booking.notes || booking.adminNotes
    };
};

export const updateBookingStatus = async (req, res) => {
    try {
        const { bookingId } = req.params; // Note: user snippet uses bookingId from params
        // However, standard express route might be /:id. I'll check if it should be id or bookingId. 
        // Admin controller used `id`. Employee one might be different. 
        // User snippet says: const { bookingId } = req.params;

        const { status, notes } = req.body;
        const employeeId = req.user._id;

        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ success: false, error: 'Booking not found' });
        }

        // Check if employee is assigned to this booking
        if (booking.assignedTo?.toString() !== employeeId.toString()) {
            return res.status(403).json({ success: false, error: 'Not authorized to update this booking' });
        }

        const statusMap = {
            'navigating': 'NAVIGATING',
            'start': 'IN_PROGRESS',
            'in progress': 'IN_PROGRESS',
            'in_progress': 'IN_PROGRESS',
            'complete': 'COMPLETED',
            'completed': 'COMPLETED'
        };

        let dbStatus = statusMap[status.toLowerCase()] || status.toUpperCase();

        // Validate employee can only move through specific steps
        const allowedTransitions = {
            'ACCEPTED': ['NAVIGATING'],
            'NAVIGATING': ['IN_PROGRESS'],
            'IN_PROGRESS': ['COMPLETED']
        };

        const currentStatus = booking.status;
        if (!allowedTransitions[currentStatus]?.includes(dbStatus)) {
            // Allow re-sending same status? No, user logic fails if not allowed.
            // Maybe check if already in that status?
            if (currentStatus === dbStatus) {
                // Idempotent success
                return res.json({
                    success: true,
                    message: `Booking is already ${status.toLowerCase()}`,
                    booking: formatBookingResponse(booking)
                });
            }

            return res.status(400).json({
                success: false,
                error: `Cannot transition from ${currentStatus} to ${dbStatus}`
            });
        }

        // Update status and add to timeline
        booking.status = dbStatus;
        booking.statusTimeline.push({
            status: dbStatus,
            updatedBy: 'employee',
            note: notes || `Employee ${status.toLowerCase()}ed the job`
        });

        if (dbStatus === 'COMPLETED') {
            booking.completedAt = new Date();
            // Trigger Payment creation logic (simplified from original)
            // original completeBooking had payment creation. I should preserve it?
            // User snippet did NOT show payment logic. 
            // BUT deleting it would break payment creation.
            // I should reinstate the payment creation logic if dbStatus is COMPLETED.

            try {
                const employee = await Employee.findById(employeeId);
                if (employee) {
                    const lastPayment = await Payment.findOne().sort({ paymentId: -1 });
                    const newPaymentId = lastPayment ? lastPayment.paymentId + 1 : 1001;
                    const earnings = Number(booking.payment?.amount || booking.serviceDetails?.price || 0);
                    const commissionRate = 0.2;
                    const commission = earnings * commissionRate;

                    await Payment.create({
                        paymentId: newPaymentId,
                        empId: employee.empId,
                        serviceId: booking.bookingId,
                        customer: {
                            name: booking.contactIdInfo?.fullName || booking.contactInfo?.fullName,
                            email: booking.contactIdInfo?.email || booking.contactInfo?.email,
                            phone: booking.contactIdInfo?.phoneNumber || booking.contactInfo?.phoneNumber
                        },
                        serviceType: booking.serviceDetails?.title || 'Service',
                        amount: earnings,
                        commission: commission,
                        baseRate: earnings - commission,
                        hours: getBookingDuration(booking),
                        date: new Date(),
                        status: 'completed',
                        paymentMethod: booking.payment?.method || 'cash',
                        transactionId: `TXN-${Date.now()}`
                    });

                    // Remove from Upcoming Payments
                    await UpcomingPayment.findOneAndDelete({ serviceId: booking.bookingId });
                }
            } catch (err) {
                console.error("Error creating payment:", err);
            }
        }

        await booking.save();

        res.json({
            success: true,
            message: `Booking ${status.toLowerCase()} successfully`,
            booking: formatBookingResponse(booking)
        });

    } catch (error) {
        console.error('Employee update status error:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
};
