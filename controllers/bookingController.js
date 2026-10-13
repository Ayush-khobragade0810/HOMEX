import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Country from '../models/Country.js';
import State from '../models/State.js';
import City from '../models/City.js';
import Area from '../models/Area.js';

import {
  sendNotification,
  emitBookingUpdate,
  emitTechnicianAssigned,
  validateTimeSlot,
  calculateETA,
  generateSecureBookingId
} from '../utils/helpers.js';
import logger from '../utils/logger.js';
import socketService from '../socket/socketService.js';
import { ApiError } from '../utils/ApiError.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const requesterId = (req) => String(req.user?.userId || req.user?._id || req.user?.id || '');

// A slot holds at most this many active bookings (shared by available-slots,
// create and reschedule so the three always agree).
const MAX_PER_SLOT = 5;
// Bookings that occupy their slot. Both casings exist in the DB.
const SLOT_OCCUPYING_STATUSES = [
  'confirmed', 'assigned', 'in_progress',
  'CONFIRMED', 'ACCEPTED', 'ASSIGNED', 'NAVIGATING', 'IN_PROGRESS'
];

const dayBounds = (date) => {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return { startOfDay, endOfDay };
};

const countBookingsInSlot = async (date, timeSlot, excludeId) => {
  const { startOfDay, endOfDay } = dayBounds(date);
  const query = {
    'schedule.preferredDate': { $gte: startOfDay, $lte: endOfDay },
    'schedule.timeSlot': timeSlot,
    status: { $in: SLOT_OCCUPYING_STATUSES }
  };
  if (excludeId) query._id = { $ne: excludeId };
  return Booking.countDocuments(query);
};

// Turns a failed validateTimeSlot() result into the right HTTP error.
const slotError = (slotValidation) => {
  const reason = slotValidation.reason || 'Invalid time slot';
  if (/past/i.test(reason)) {
    return ApiError.badRequest('The selected date and time slot is in the past. Please choose a later slot.');
  }
  if (/already has a booking/i.test(reason)) return ApiError.conflict(reason);
  return ApiError.badRequest(`Invalid time slot: ${reason}`);
};

const assertSlotHasRoom = async (date, timeSlot, excludeId) => {
  if ((await countBookingsInSlot(date, timeSlot, excludeId)) >= MAX_PER_SLOT) {
    throw ApiError.conflict('This time slot is fully booked. Please choose another slot.', { code: 'SLOT_UNAVAILABLE' });
  }
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


// @desc    Create new booking
// @route   POST /api/bookings
// @access  Private
export const createBooking = async (req, res) => {

  // Set explicit timeout for this request
  req.setTimeout(10000, () => {
    console.error('⏰ REQUEST TIMEOUT triggered in controller');
  });

  try {

    const {
      serviceId,
      serviceDetails,
      schedule,
      location,
      contactInfo,
      payment
    } = req.body;

    // Validate inputs
    // We allow serviceId to be missing if serviceDetails are fully provided (for custom/temp services)
    if ((!serviceId && !serviceDetails) || !schedule || !location || !payment) {
      throw ApiError.badRequest('Missing required booking information (service, schedule, location and payment are required)');
    }

    // Validate time slot: in the past -> 400, slot full -> 409
    const slotValidation = await validateTimeSlot(schedule.preferredDate, schedule.timeSlot);
    if (!slotValidation.valid) {
      throw slotError(slotValidation);
    }
    await assertSlotHasRoom(schedule.preferredDate, schedule.timeSlot);
    const durationFromTimeSlot = calculateDurationFromTimeSlot(schedule.timeSlot);

    // Validate location by Area ID or manual name (Production-Level Fix)

    const targetAreaId = req.body.areaId || (location && location.areaId);
    const manualAreaName = req.body.areaName || (location && (location.areaName || location.area)) || req.body.area;
    const country = (location && location.country) || req.body.country;
    const state = (location && location.state) || req.body.state;
    const city = (location && location.city) || req.body.city;

    if (!targetAreaId && !manualAreaName) {
      throw ApiError.badRequest("Area is required. Please select a valid location from the list or enter manually.");
    }

    // Check if Area exists by ID
    let areaDoc;
    if (targetAreaId && mongoose.Types.ObjectId.isValid(targetAreaId)) {
      try {
        areaDoc = await Area.findById(targetAreaId);
      } catch (e) {
      }
    }

    // Handle manual area entry if ID not found/provided
    if (!areaDoc && manualAreaName && country && state && city) {
      areaDoc = await Area.findOne({
        // Escaped: names like "Sector (5)" are literal text, not regex syntax.
        areaName: { $regex: new RegExp(`^${escapeRegex(manualAreaName.trim())}$`, 'i') },
        city: { $regex: new RegExp(`^${escapeRegex(city.trim())}$`, 'i') },
        state: { $regex: new RegExp(`^${escapeRegex(state.trim())}$`, 'i') },
        country: { $regex: new RegExp(`^${escapeRegex(country.trim())}$`, 'i') }
      });

      if (!areaDoc) {
        areaDoc = await Area.create({
          areaName: manualAreaName.trim(),
          city: city.trim(),
          state: state.trim(),
          country: country.trim()
        });
      }
    }

    if (!areaDoc) {
      throw ApiError.badRequest("Location details incomplete. Please provide Country, State, and City if entering Area manually.");
    }

    const actualUserId = req.user.userId || req.user._id || req.user.id;

    if (!actualUserId) {
      console.error('🚨 CRITICAL ERROR: actualUserId evaluate to undefined! req.user payload:', req.user);
      throw new Error('User ID could not be determined from authentication payload.');
    }

    // Create booking object
    const bookingData = {
      userId: actualUserId,
      serviceId: serviceId, // can be null/undefined for custom
      serviceDetails: {
        ...serviceDetails,
        duration: durationFromTimeSlot || serviceDetails?.duration || 60,
        price: serviceDetails.price || 0
      },
      schedule: {
        preferredDate: new Date(schedule.preferredDate),
        timeSlot: schedule.timeSlot,
        originalDate: new Date(schedule.preferredDate)
      },
      location: {
        area: areaDoc._id,
        address: location.completeAddress || location.address || "",
        completeAddress: location.completeAddress || location.address || ""
      },
      // Persist customer contact in schema-compatible field
      contactIdInfo: contactInfo || {
        fullName: req.user.name,
        phoneNumber: req.user.phone,
        email: req.user.email
      },
      payment: {
        method: payment.method,
        amount: payment.amount,
        status: payment.status || 'pending',
        transactionId: payment.transactionId
      },
      status: 'pending',
      metadata: {
        source: 'web',
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip
      }
    };

    // Race between booking creation and timeout. Mongoose ValidationErrors
    // propagate to the global handler (400 with per-field errors).
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ApiError(504, 'Server is taking too long to save the booking. Please try again.')), 5000);
    });

    // Execute only once to avoid unhandled rejections or ghost creates
    const bookingPromise = Booking.create(bookingData);
    const booking = await Promise.race([bookingPromise, timeoutPromise]).finally(() => clearTimeout(timer));

    // Update user stats (optional, catch error to not fail booking)
    User.findByIdAndUpdate(req.user._id, {
      $inc: { 'stats.totalBookings': 1 }
    }).catch(err => console.error('Error updating user stats:', err));

    // Send notification (async, don't await blocking response)
    sendNotification(actualUserId, {
      title: 'Booking Confirmed',
      message: `Your booking for ${serviceDetails.title} has been received.`,
      type: 'BOOKING_CONFIRMED',
      relatedId: booking._id,
      priority: 'high'
    }).catch(e => console.error('Notification error', e));

    // Emit socket event
    socketService.emitToRoom('admin', 'booking:new', {
      bookingId: booking.bookingId,
      service: serviceDetails.title,
      customer: req.user.name,
      amount: payment.amount
    });

    logger.audit('booking_created', req.user, `booking:${booking._id}`, {
      amount: payment.amount,
      serviceId
    });

    const response = {
      success: true,
      message: 'Booking created successfully',
      booking
    };

    // Ensure we return explicitly
    return res.status(201).json(response);

  } catch (error) {
    // Expected client errors (ApiError) are already logged by the request
    // logger; anything else is unexpected and worth the context.
    if (!error.isOperational) {
      logger.errorWithContext(
        { userId: requesterId(req) },
        'Create booking error',
        error
      );
    }
    // The global error handler picks the status and message.
    throw error;
  }
};

// @desc    Get single booking
// @route   GET /api/bookings/:id
// @access  Private
export const getBooking = async (req, res) => {
  const booking = await Booking.findById(req.params.id)
    .populate('userId', 'name email phone avatar')
    .populate('assignedTo.technicianId', 'name phone avatar rating')
    .populate('serviceId')
    .populate('location.area')
    .lean();

  if (!booking) {
    throw ApiError.notFound('Booking not found');
  }

  // Format location if populated
  if (booking.location) {
    let areaObj = null;

    if (booking.location.area) {
      if (typeof booking.location.area === 'object') {
        areaObj = {
          _id: booking.location.area._id,
          area: booking.location.area.areaName || booking.location.area.name || "",
          areaName: booking.location.area.areaName || booking.location.area.name || "",
          city: booking.location.area.city || "",
          state: booking.location.area.state || "",
          country: booking.location.area.country || "",
          pincode: booking.location.area.pincode || ""
        };
      }
    }

    booking.location = {
      area: areaObj || booking.location.area,
      address: booking.location.completeAddress || booking.location.address || "",
      completeAddress: booking.location.completeAddress || booking.location.address || "",
      pincode: booking.location.pincode || (areaObj ? areaObj.pincode : ""),
      landmark: booking.location.landmark || "",
      coordinates: booking.location.coordinates || null
    };
  }

  // Authorization check (the owner may have been deleted, so userId can be null)
  const ownerId = String(booking.userId?._id || booking.userId || '');
  if (ownerId !== requesterId(req) &&
    req.user.role !== 'admin' &&
    req.user.role !== 'technician') { // Add technician check logically later if needed
    throw ApiError.forbidden('You can only view your own bookings');
  }

  res.status(200).json({
    success: true,
    booking
  });
};

// Customers may not cancel once the job has started/finished (409), and not in
// the last hour before the slot (400). Mirrors Booking.cancelBlockReason().
const CUSTOMER_CANCELLABLE = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'ACCEPTED', 'RESCHEDULED'];

// @desc    Cancel booking
// @route   PUT /api/bookings/:id/cancel
// @access  Private
export const cancelBooking = async (req, res) => {
  const { reason } = req.body || {};
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    throw ApiError.notFound('Booking not found');
  }

  // Authorization
  if (booking.userId?.toString() !== requesterId(req) && req.user.role !== 'admin') {
    throw ApiError.forbidden('You can only cancel your own bookings');
  }

  // Business logic check
  const blocked = booking.cancelBlockReason();
  if (blocked) {
    const status = String(booking.status || '').toUpperCase();
    // Already cancelled / started / completed: the booking's state forbids it.
    if (!CUSTOMER_CANCELLABLE.includes(status)) throw ApiError.conflict(blocked);
    // Otherwise it's the "less than 1 hour before the slot" window.
    throw ApiError.badRequest(blocked);
  }

  const cancelledBy = req.user.role === 'admin' ? 'admin' : 'user';
  const feeWasCharged = booking.serviceFee?.status === 'charged';
  await booking.cancelBooking(typeof reason === 'string' ? reason.trim().slice(0, 300) : undefined, cancelledBy);

  // Notifications are best-effort: the booking IS cancelled at this point, so
  // a notification failure must not turn this into an error for the customer.
  const notify = async (userId, data) => {
    try {
      await sendNotification(userId, data);
    } catch (err) {
      logger.warn({ err: err.message, bookingId: booking.bookingId }, 'Cancellation notification failed');
    }
  };

  await notify(booking.userId, {
    title: 'Booking Cancelled',
    message: `Booking #${booking.bookingId} has been cancelled.`,
    type: 'booking',
    data: { bookingId: booking._id }
  });

  if (booking.assignedTo?.technicianId) {
    await notify(booking.assignedTo.technicianId, {
      title: 'Job Cancelled',
      message: `Job #${booking.bookingId} was cancelled by the ${cancelledBy === 'admin' ? 'admin' : 'customer'}.` +
        (feeWasCharged ? ` Your ₹${booking.serviceFee.amount} service fee has been refunded to your balance.` : ''),
      type: 'assignment',
      data: { bookingId: booking._id }
    });
  }

  // Emit socket update
  emitBookingUpdate(booking._id, { status: 'CANCELLED', cancelledBy });

  logger.audit('booking_cancelled', req.user, `booking:${booking._id}`, { reason });

  res.status(200).json({
    success: true,
    message: 'Booking cancelled successfully',
    booking
  });
};

// @desc    Reschedule booking
// @route   PUT /api/bookings/:id/reschedule
// @access  Private
export const rescheduleBooking = async (req, res) => {
  const { date, timeSlot } = req.body;
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    throw ApiError.notFound('Booking not found');
  }

  if (booking.userId?.toString() !== requesterId(req)) {
    throw ApiError.forbidden('You can only reschedule your own bookings');
  }

  // Same rules as Booking.canReschedule(), each with its own answer.
  if (!['pending', 'confirmed'].includes(booking.status)) {
    throw ApiError.conflict('Only pending or confirmed bookings can be rescheduled');
  }
  if ((booking.schedule?.rescheduledCount || 0) >= 2) {
    throw ApiError.conflict('This booking has already been rescheduled the maximum number of times (2)');
  }
  if (!booking.canReschedule()) {
    throw ApiError.badRequest('Bookings can only be rescheduled more than 2 hours before the scheduled time');
  }

  // Validate new slot: in the past -> 400, full -> 409
  const slotValidation = await validateTimeSlot(date, timeSlot);
  if (!slotValidation.valid) {
    throw slotError(slotValidation);
  }
  await assertSlotHasRoom(date, timeSlot, booking._id);

  await booking.rescheduleBooking(new Date(date), timeSlot);

  // Notifications are best-effort: the booking IS rescheduled at this point.
  const notify = (userId, data) =>
    sendNotification(userId, data).catch(err =>
      logger.warn({ err: err.message, bookingId: booking.bookingId }, 'Reschedule notification failed'));

  await notify(booking.userId, {
    title: 'Booking Rescheduled',
    message: `Booking #${booking.bookingId} rescheduled to ${date} at ${timeSlot}.`,
    type: 'BOOKING_RESCHEDULED',
    relatedId: booking._id
  });

  if (booking.assignedTo?.technicianId) {
    await notify(booking.assignedTo.technicianId, {
      title: 'Job Rescheduled',
      message: `Job #${booking.bookingId} has been rescheduled to ${date} ${timeSlot}.`,
      type: 'JOB_RESCHEDULED',
      relatedId: booking._id
    });
  }

  emitBookingUpdate(booking._id, {
    status: 'rescheduled',
    schedule: booking.schedule
  });

  logger.audit('booking_rescheduled', req.user, `booking:${booking._id}`);

  res.status(200).json({
    success: true,
    message: 'Booking rescheduled successfully',
    booking
  });
};

// @desc    Rate booking
// @route   POST /api/bookings/:id/rate
// @access  Private
export const rateBooking = async (req, res) => {
  const { rating, review } = req.body;
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    throw ApiError.notFound('Booking not found');
  }

  if (booking.userId?.toString() !== requesterId(req) && req.user.role !== 'admin') {
    throw ApiError.forbidden('You can only review your own bookings');
  }

  // Status casing varies ('completed' / 'COMPLETED').
  if (String(booking.status || '').toLowerCase() !== 'completed') {
    throw ApiError.conflict('You can only rate a booking after it has been completed');
  }

  booking.rating = {
    stars: Number(rating),
    review: typeof review === 'string' ? review.trim() : undefined,
    submittedAt: new Date()
  };

  // Only validate what changed — legacy bookings may predate required fields.
  await booking.save({ validateModifiedOnly: true });

  // Update technician stats if assigned
  if (booking.assignedTo?.technicianId) {
    const technician = await User.findById(booking.assignedTo.technicianId);
    if (technician) {
      // Simple moving average or similar logic could be implemented here
      // For now, just logging or updating if we had a proper stats model
      // await technician.updateRating(rating);
    }
  }

  logger.audit('booking_rated', req.user, `booking:${booking._id}`, { rating });

  res.status(200).json({
    success: true,
    message: 'Rating submitted successfully',
    booking
  });
};

// @desc    Get available time slots
// @route   GET /api/bookings/available-slots
// @access  Public
export const getAvailableSlots = async (req, res) => {
  const { date, serviceId, country, state, city, area } = req.query;

  if (!date) {
    throw ApiError.badRequest('Date is required');
  }

  const requestedDate = new Date(date);
  if (Number.isNaN(requestedDate.getTime())) {
    throw ApiError.badRequest('Date must be a valid date (YYYY-MM-DD)');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (requestedDate < today) {
    throw ApiError.badRequest('Cannot book a date in the past');
  }

  // Default slots - standardized to HH:mm-HH:mm
  const allSlots = [
    '09:00-11:00',
    '11:00-13:00',
    '13:00-15:00',
    '15:00-17:00',
    '17:00-19:00'
  ];

  // Find bookings for that date/location/service
  const { startOfDay, endOfDay } = dayBounds(date);

  const bookings = await Booking.find({
    'schedule.preferredDate': { $gte: startOfDay, $lte: endOfDay },
    status: { $in: SLOT_OCCUPYING_STATUSES }
  }).lean();

  const bookedCounts = {};
  bookings.forEach(b => {
    const slot = b.schedule?.timeSlot;
    bookedCounts[slot] = (bookedCounts[slot] || 0) + 1;
  });

  const availableSlots = allSlots.filter(slot => {
    // Logic could be expanded to check technician availability
    return (bookedCounts[slot] || 0) < MAX_PER_SLOT;
  });

  res.status(200).json({
    success: true,
    data: {
      date,
      availableSlots,
      bookedSlots: allSlots.filter(s => !availableSlots.includes(s))
    }
  });
};

export const getBookingAnalytics = async (req, res) => {
  res.json({ success: true, message: "Analytics Placeholder" });
};

// @desc    Assign employee to booking
// @route   PUT /api/bookings/:id/assign
// @access  Private/Admin
export const assignEmployee = async (req, res) => {
  const { id } = req.params;
  const { employeeId } = req.body;

  if (!employeeId) {
    throw ApiError.badRequest('Employee ID is required');
  }

  const booking = await Booking.findById(id);
  if (!booking) {
    throw ApiError.notFound('Booking not found');
  }

  const status = String(booking.status || '').toUpperCase();
  if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'CANCELED') {
    throw ApiError.conflict(`Cannot assign an employee to a ${status === 'COMPLETED' ? 'completed' : 'cancelled'} booking`);
  }

  const employee = await User.findById(employeeId);
  if (!employee) {
    throw ApiError.notFound('Employee not found');
  }

  booking.assignedTo = {
    technicianId: employee._id,
    name: employee.name,
    phone: employee.phone,
    avatar: employee.avatar,
    assignedAt: new Date()
  };
  booking.status = 'assigned';

  await booking.save();

  res.json({
    success: true,
    message: 'Assignment successful',
    booking
  });
};
