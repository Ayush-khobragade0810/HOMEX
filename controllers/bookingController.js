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
  console.log('🎯 [1] CREATE BOOKING STARTED');
  console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
  console.log('👤 User:', req.user?.email);

  // Set explicit timeout for this request
  req.setTimeout(10000, () => {
    console.error('⏰ REQUEST TIMEOUT triggered in controller');
  });

  try {
    console.log('🔍 [2] Validating input...');

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
      console.log('❌ [2A] Missing required fields');
      throw new Error('Missing required booking information');
    }

    console.log('✅ [2] Validation passed');
    console.log('⏰ [2B] Time slot being used:', schedule.timeSlot);

    // Validate time slot
    const slotValidation = await validateTimeSlot(schedule.preferredDate, schedule.timeSlot);
    if (!slotValidation.valid) {
      throw new Error(`Invalid time slot: ${slotValidation.reason}`);
    }
    const durationFromTimeSlot = calculateDurationFromTimeSlot(schedule.timeSlot);

    // Validate location by Area ID or manual name (Production-Level Fix)
    console.log('🌍 [DEBUG] Incoming Payload:', JSON.stringify({ 
      areaId: req.body.areaId, 
      location: req.body.location 
    }, null, 2));

    const targetAreaId = req.body.areaId || (location && location.areaId);
    const manualAreaName = req.body.areaName || (location && (location.areaName || location.area)) || req.body.area;
    const country = (location && location.country) || req.body.country;
    const state = (location && location.state) || req.body.state;
    const city = (location && location.city) || req.body.city;

    console.log('🔍 [DEBUG] Extracted:', { targetAreaId, manualAreaName, country, state, city });

    if (!targetAreaId && !manualAreaName) {
      console.log('❌ [DEBUG] Validation Failed: No areaId and no manualAreaName');
      throw new Error("Area is required. Please select a valid location from the list or enter manually.");
    }

    // Check if Area exists by ID
    let areaDoc;
    if (targetAreaId && mongoose.Types.ObjectId.isValid(targetAreaId)) {
      try {
        areaDoc = await Area.findById(targetAreaId);
      } catch (e) {
        console.warn('Invalid Area ID format:', targetAreaId);
      }
    }

    // Handle manual area entry if ID not found/provided
    if (!areaDoc && manualAreaName && country && state && city) {
      console.log('🔍 Searching for manual area:', manualAreaName);
      areaDoc = await Area.findOne({
        areaName: { $regex: new RegExp(`^${manualAreaName.trim()}$`, 'i') },
        city: { $regex: new RegExp(`^${city.trim()}$`, 'i') },
        state: { $regex: new RegExp(`^${state.trim()}$`, 'i') },
        country: { $regex: new RegExp(`^${country.trim()}$`, 'i') }
      });

      if (!areaDoc) {
        console.log('🆕 Creating new Master Area for manual entry...');
        areaDoc = await Area.create({
          areaName: manualAreaName.trim(),
          city: city.trim(),
          state: state.trim(),
          country: country.trim()
        });
      }
    }

    if (!areaDoc) {
      throw new Error("Location details incomplete. Please provide Country, State, and City if entering Area manually.");
    }

    const actualUserId = req.user.userId || req.user._id || req.user.id;

    if (!actualUserId) {
      console.error('🚨 CRITICAL ERROR: actualUserId evaluate to undefined! req.user payload:', req.user);
      throw new Error('User ID could not be determined from authentication payload.');
    }

    console.log('💾 [3] Creating booking object...');

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
        address: location.completeAddress || location.address || ""
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

    console.log('📝 [3A] Booking data prepared. Saving...');

    let booking;
    try {
      // Race between booking creation and timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Database operation timeout after 5s')), 5000);
      });

      // Execute only once to avoid unhandled rejections or ghost creates
      const bookingPromise = Booking.create(bookingData);
      booking = await Promise.race([bookingPromise, timeoutPromise]);
    } catch (creationError) {
      console.error('🚨 Mongoose creation failed:', creationError.message);
      return res.status(400).json({
        success: false,
        message: 'Debug Intercept: ' + creationError.message,
        actualUserId: typeof actualUserId === 'undefined' ? 'UNDEFINED' : actualUserId,
        bookingDataKeys: Object.keys(bookingData),
        userIdInBookingData: typeof bookingData.userId === 'undefined' ? 'UNDEFINED' : bookingData.userId
      });
    }

    console.log('✅ [3] Booking created successfully:', booking._id);

    // Update user stats (optional, catch error to not fail booking)
    User.findByIdAndUpdate(req.user._id, {
      $inc: { 'stats.totalBookings': 1 }
    }).catch(err => console.error('Error updating user stats:', err));

    console.log('📤 [4] Sending response...');

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

    console.log('📨 [4A] Response payload ready. Sending JSON.');

    // Ensure we return explicitly
    return res.status(201).json(response);

  } catch (error) {
    console.error('💥 [ERROR] Create booking failed:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);

    logger.errorWithContext(
      { userId: req.user.userId || req.user._id || req.user.id },
      'Create booking error',
      error
    );

    // Check if headers already sent
    if (res.headersSent) {
      console.error('⚠️ Headers already sent, cannot send error response');
      return;
    }

    return res.status(error.message?.includes('timeout') ? 504 : 400).json({
      success: false,
      message: error.message || 'Failed to create booking',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    console.log('🏁 [END] Create booking function completed');
  }
};

// @desc    Get single booking
// @route   GET /api/bookings/:id
// @access  Private
export const getBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('userId', 'name email phone avatar')
      .populate('assignedTo.technicianId', 'name phone avatar rating')
      .populate('serviceId')
      .lean();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Authorization check
    const requestUserId = (req.user.userId || req.user._id || req.user.id).toString();
    if (booking.userId._id.toString() !== requestUserId &&
      req.user.role !== 'admin' &&
      req.user.role !== 'technician') { // Add technician check logically later if needed
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking'
      });
    }

    res.status(200).json({
      success: true,
      booking
    });
  } catch (error) {
    logger.errorWithContext(
      { bookingId: req.params.id, userId: req.user._id },
      'Get booking error',
      error
    );
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Cancel booking
// @route   PUT /api/bookings/:id/cancel
// @access  Private
export const cancelBooking = async (req, res) => {
  try {
    const { reason } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Authorization
    const requestUserId = (req.user.userId || req.user._id || req.user.id).toString();
    if (booking.userId.toString() !== requestUserId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this booking'
      });
    }

    // Business logic check
    if (!booking.canCancel()) {
      return res.status(400).json({
        success: false,
        message: 'Booking cannot be cancelled at this stage'
      });
    }

    await booking.cancelBooking(reason, req.user.role);

    // Notify involved parties
    await sendNotification(booking.userId, {
      title: 'Booking Cancelled',
      message: `Booking #${booking.bookingId} has been cancelled.`,
      type: 'BOOKING_CANCELLED',
      relatedId: booking._id
    });

    if (booking.assignedTo?.technicianId) {
      await sendNotification(booking.assignedTo.technicianId, {
        title: 'Job Cancelled',
        message: `Job #${booking.bookingId} has been cancelled by the customer.`,
        type: 'JOB_CANCELLED',
        relatedId: booking._id
      });
    }

    // Emit socket update
    emitBookingUpdate(booking._id, { status: 'cancelled', cancelledBy: req.user.role });

    logger.audit('booking_cancelled', req.user, `booking:${booking._id}`, { reason });

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      booking
    });

  } catch (error) {
    logger.errorWithContext(
      { bookingId: req.params.id, userId: req.user.userId || req.user._id || req.user.id },
      'Cancel booking error',
      error
    );
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

// @desc    Reschedule booking
// @route   PUT /api/bookings/:id/reschedule
// @access  Private
export const rescheduleBooking = async (req, res) => {
  try {
    const { date, timeSlot } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const requestUserId = (req.user.userId || req.user._id || req.user.id).toString();
    if (booking.userId.toString() !== requestUserId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Validate new slot
    const slotValidation = await validateTimeSlot(date, timeSlot);
    if (!slotValidation.valid) {
      return res.status(400).json({
        success: false,
        message: slotValidation.reason
      });
    }

    await booking.rescheduleBooking(new Date(date), timeSlot);

    // Notify
    await sendNotification(booking.userId, {
      title: 'Booking Rescheduled',
      message: `Booking #${booking.bookingId} rescheduled to ${date} at ${timeSlot}.`,
      type: 'BOOKING_RESCHEDULED',
      relatedId: booking._id
    });

    if (booking.assignedTo?.technicianId) {
      await sendNotification(booking.assignedTo.technicianId, {
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

  } catch (error) {
    logger.errorWithContext(
      { bookingId: req.params.id, userId: req.user.userId || req.user._id || req.user.id },
      'Reschedule booking error',
      error
    );
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to reschedule'
    });
  }
};

// @desc    Rate booking
// @route   POST /api/bookings/:id/rate
// @access  Private
export const rateBooking = async (req, res) => {
  try {
    const { rating, review } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Can only rate completed bookings'
      });
    }

    booking.rating = {
      stars: rating,
      review,
      submittedAt: new Date()
    };

    await booking.save();

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

  } catch (error) {
    logger.errorWithContext(
      { bookingId: req.params.id, userId: req.user.userId || req.user._id || req.user.id },
      'Rate booking error',
      error
    );
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get available time slots
// @route   GET /api/bookings/available-slots
// @access  Public
export const getAvailableSlots = async (req, res) => {
  try {
    const { date, serviceId, country, state, city, area } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date is required'
      });
    }

    const requestedDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (requestedDate < today) {
      return res.status(400).json({
        success: false,
        message: 'Cannot book in the past'
      });
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
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const bookings = await Booking.find({
      'schedule.preferredDate': { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['confirmed', 'assigned', 'in_progress'] }
    }).lean();

    const bookedCounts = {};
    bookings.forEach(b => {
      const slot = b.schedule.timeSlot;
      bookedCounts[slot] = (bookedCounts[slot] || 0) + 1;
    });

    const MAX_PER_SLOT = 5; // simplified capacity

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

  } catch (error) {
    console.error('Error fetching slots:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch slots'
    });
  }
};

export const getBookingAnalytics = async (req, res) => {
  res.json({ success: true, message: "Analytics Placeholder" });
};

// @desc    Assign employee to booking
// @route   PUT /api/bookings/:id/assign
// @access  Private/Admin
export const assignEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId } = req.body;

    console.log(`Assigning booking ${id} to employee ${employeeId}`);

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
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
  } catch (error) {
    console.error('Assignment error:', error);
    res.status(500).json({ error: error.message });
  }
};
