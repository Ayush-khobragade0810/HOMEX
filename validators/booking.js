import { Joi, objectId, email, phoneLoose, isoDate, timeSlot, money, pagination } from './common.js';

/**
 * Request schemas for the bookings area (/api/bookings and /api/admin/bookings).
 *
 * They mirror what the frontend actually sends (src/components/Booking.jsx,
 * pages/admin/AdminBookingDetails.jsx, src/components/admin/adminBookings.jsx):
 * optional fields accept '' / null because the UI sends blanks for them.
 */

// Optional free text that the UI may send as '' or null.
const optionalText = (max) => Joi.string().trim().max(max).allow('', null);

const PAYMENT_METHODS = ['online', 'cash', 'wallet', 'card']; // Booking model enum
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];       // Booking model enum

/* ------------------------------------------------------------------ */
/* Customer                                                            */
/* ------------------------------------------------------------------ */

/** POST /api/bookings and POST /api/bookings/user/create */
const createBooking = Joi.object({
    // Catalogue services are sent without an id ("temp_" ids are stripped by the UI).
    serviceId: objectId().allow('', null).label('Service'),

    serviceDetails: Joi.object({
        title: Joi.string().trim().min(1).max(200).required().label('Service name'),
        price: money().required().label('Service price'),
        category: optionalText(100),
        subTitle: optionalText(200),
        description: optionalText(2000),
        duration: Joi.number().min(0).max(24 * 60).allow('', null).label('Service duration')
    }).required().label('Service details'),

    schedule: Joi.object({
        preferredDate: isoDate().required().label('Preferred date'),
        timeSlot: timeSlot().required().label('Time slot')
    }).required().label('Schedule'),

    location: Joi.object({
        country: optionalText(100),
        state: optionalText(100),
        city: optionalText(100),
        // Either an Area _id or a manually typed area name.
        area: optionalText(200),
        areaId: optionalText(64),
        areaName: optionalText(200),
        completeAddress: Joi.string().trim().min(1).max(500).required().label('Complete address'),
        address: optionalText(500)
    }).required().label('Location'),

    areaId: optionalText(64),

    contactInfo: Joi.object({
        fullName: Joi.string().trim().min(2).max(100).required().label('Full name'),
        // The form is free text: allow "+91 98765 43210", "98765-43210", ...
        phoneNumber: phoneLoose().required().label('Phone number'),
        email: email().required().label('Email')
    }).required().label('Contact information'),

    payment: Joi.object({
        method: Joi.string().trim().lowercase().valid(...PAYMENT_METHODS).required().label('Payment method'),
        amount: money().required().label('Payment amount'),
        status: optionalText(30),
        currency: optionalText(10),
        transactionId: optionalText(200)
    }).required().label('Payment'),

    paymentMethod: optionalText(30),
    notes: optionalText(1000),
    specialInstructions: optionalText(1000)
});

/** GET /api/bookings/available-slots?date=YYYY-MM-DD&serviceId=&country=&... */
const availableSlotsQuery = Joi.object({
    date: isoDate().required().label('Date'),
    serviceId: optionalText(64),
    country: optionalText(100),
    state: optionalText(100),
    city: optionalText(100),
    area: optionalText(200)
});

/** PUT /api/bookings/user/:id — reschedule */
const reschedule = Joi.object({
    date: isoDate().required().label('Date'),
    timeSlot: timeSlot().required().label('Time slot')
});

/** PATCH|PUT /api/bookings/:id/cancel — the dashboard sends no body. */
const cancel = Joi.object({
    reason: optionalText(1000).label('Cancellation reason')
});

/** POST /api/bookings/:id/review */
const review = Joi.object({
    rating: Joi.number().min(1).max(5).required().label('Rating')
        .messages({ 'number.min': 'Rating must be between 1 and 5', 'number.max': 'Rating must be between 1 and 5' }),
    review: optionalText(1000).label('Review')
});

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

/** GET /api/admin/bookings and GET /api/bookings (admin list) */
const listQuery = Joi.object({
    ...pagination,
    status: optionalText(40),
    search: optionalText(100)
});

/**
 * PUT /api/admin/bookings/:id/status and PUT /api/bookings/:id/status
 * The status value itself (and all its aliases: "confirmed", "in progress",
 * "reopen", ...) is checked in the controller with normalizeStatus().
 */
const updateStatus = Joi.object({
    status: Joi.string().trim().min(1).max(40).required().label('Status'),
    notes: optionalText(1000),
    cancellationReason: optionalText(500).label('Cancellation reason'),
    updatedBy: Joi.string().valid('admin', 'user', 'technician', 'system')
});

/** PUT /api/admin/bookings/:id and PUT /api/bookings/:id (notes / priority only) */
const adminUpdate = Joi.object({
    adminNotes: optionalText(5000),
    notes: optionalText(5000),
    technicianNotes: optionalText(5000),
    customerNotes: optionalText(5000),
    priority: Joi.string().trim().lowercase().valid(...PRIORITIES).label('Priority')
});

/** PUT /api/admin/bookings/:id/assign and PUT /api/bookings/:id/assign */
const assign = Joi.object({
    employeeId: objectId().required().label('Employee')
        .messages({ 'any.required': 'Employee ID is required', 'string.empty': 'Employee ID is required' })
});

export const bookingSchemas = {
    createBooking,
    availableSlotsQuery,
    reschedule,
    cancel,
    review,
    listQuery,
    updateStatus,
    adminUpdate,
    assign
};

export default bookingSchemas;
