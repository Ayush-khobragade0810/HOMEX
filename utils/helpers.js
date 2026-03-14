import Notification from '../models/Notification.js';
import socketService from '../socket/socketService.js';
import logger from './logger.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';

// Send notification and emit via socket
export const sendNotification = async (userId, notificationData) => {
  try {
    // Save to database
    const notification = await Notification.create({
      userId,
      ...notificationData,
      metadata: {
        sentVia: ['database', 'socket'],
        sentAt: new Date()
      }
    });

    // Emit via socket if user is connected
    const socketSent = socketService.emitToUser(userId, 'notification:new', {
      id: notification._id,
      ...notification.toObject()
    });

    // Log notification
    logger.info({
      userId,
      notificationId: notification._id,
      type: notification.type,
      socketSent,
      title: notification.title
    }, 'Notification sent');

    return {
      notification,
      socketSent
    };
  } catch (error) {
    logger.error({
      userId,
      error: error.message,
      notificationData
    }, 'Failed to send notification');
    throw error;
  }
};

// Send booking update via socket
export const emitBookingUpdate = (bookingId, updates, source = 'system') => {
  try {
    const updateData = {
      bookingId,
      updates,
      source,
      timestamp: new Date().toISOString()
    };

    // Emit to booking room
    const roomName = `booking:${bookingId}`;
    const emitted = socketService.emitToRoom(roomName, 'booking:updated', updateData);

    logger.debug({
      bookingId,
      roomName,
      emitted,
      source,
      updates: Object.keys(updates)
    }, 'Booking update emitted');

    return emitted;
  } catch (error) {
    logger.error({
      bookingId,
      error: error.message
    }, 'Failed to emit booking update');
    return false;
  }
};

// Emit technician assignment
export const emitTechnicianAssigned = (bookingId, technician, bookingData) => {
  try {
    const assignmentData = {
      bookingId,
      technician: {
        id: technician._id,
        name: technician.name,
        phone: technician.phone,
        avatar: technician.avatar,
        rating: technician.stats.rating
      },
      booking: bookingData,
      assignedAt: new Date().toISOString()
    };

    // Emit to user
    const userId = bookingData.userId;
    const emitted = socketService.emitToUser(userId, 'technician:assigned', assignmentData);

    // Also emit to booking room
    socketService.emitToRoom(`booking:${bookingId}`, 'technician:assigned', assignmentData);

    logger.info({
      bookingId,
      technicianId: technician._id,
      userId,
      emitted
    }, 'Technician assignment emitted');

    return emitted;
  } catch (error) {
    logger.error({
      bookingId,
      error: error.message
    }, 'Failed to emit technician assignment');
    return false;
  }
};

// Emit location update
export const emitLocationUpdate = (bookingId, locationData, technicianId) => {
  try {
    const locationUpdate = {
      bookingId,
      location: locationData.location,
      coordinates: locationData.coordinates,
      eta: locationData.eta,
      timestamp: new Date().toISOString(),
      technicianId
    };

    // Emit to booking room
    const emitted = socketService.emitToRoom(`booking:${bookingId}`, 'location:updated', locationUpdate);

    logger.debug({
      bookingId,
      technicianId,
      emitted,
      eta: locationData.eta
    }, 'Location update emitted');

    return emitted;
  } catch (error) {
    logger.error({
      bookingId,
      error: error.message
    }, 'Failed to emit location update');
    return false;
  }
};

// Calculate ETA based on distance
export const calculateETA = (currentLocation, destinationLocation, trafficFactor = 1.2) => {
  try {
    if (!currentLocation || !destinationLocation) {
      return 30; // Default 30 minutes
    }

    // Haversine formula for distance calculation
    const toRad = (value) => (value * Math.PI) / 180;

    const R = 6371; // Earth's radius in km
    const lat1 = toRad(currentLocation.lat);
    const lat2 = toRad(destinationLocation.lat);
    const deltaLat = toRad(destinationLocation.lat - currentLocation.lat);
    const deltaLng = toRad(destinationLocation.lng - currentLocation.lng);

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in km

    // Assume average speed of 25 km/h in city with traffic factor
    const averageSpeed = 25 / trafficFactor; // km/h
    const timeInHours = distance / averageSpeed;
    const etaInMinutes = Math.ceil(timeInHours * 60);

    // Return between 5 and 120 minutes
    return Math.max(5, Math.min(etaInMinutes, 120));
  } catch (error) {
    logger.error({ error: error.message }, 'ETA calculation failed');
    return 30; // Fallback to 30 minutes
  }
};

// Format currency
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

// Generate booking summary
export const generateBookingSummary = (booking) => {
  return {
    id: booking._id,
    bookingId: booking.bookingId,
    service: booking.serviceDetails.title,
    date: booking.schedule.preferredDate,
    timeSlot: booking.schedule.timeSlot,
    status: booking.status,
    price: booking.serviceDetails.price,
    technician: booking.assignedTo?.name,
    address: booking.location.completeAddress,
    canCancel: booking.canCancel(),
    canReschedule: booking.canReschedule(),
    timeUntilBooking: booking.timeUntilBooking
  };
};

// Validate time slot availability
export const validateTimeSlot = async (date, timeSlot, technicianId = null) => {
  try {
    // Standardize split for "HH:mm-HH:mm" or "HH:mm - HH:mm"
    const [startTime, endTime] = timeSlot.includes(' - ') ? timeSlot.split(' - ') : timeSlot.split('-');

    // Check if time slot is in future
    const now = new Date();
    const bookingDate = new Date(date);
    const bookingDateTime = new Date(bookingDate);

    let hour, minute;

    // Check format: 12-hour (with AM/PM) or 24-hour
    if (startTime.match(/AM|PM/i)) {
      const match = startTime.match(/(\d+):(\d+)\s*(\w+)/);
      if (match) {
        const [_, h, m, modifier] = match;
        hour = parseInt(h);
        minute = parseInt(m);
        if (modifier.toUpperCase() === 'PM' && hour < 12) hour += 12;
        if (modifier.toUpperCase() === 'AM' && hour === 12) hour = 0;
      }
    } else {
      // 24-hour format "09:00"
      const [h, m] = startTime.split(':');
      hour = parseInt(h);
      minute = parseInt(m);
    }

    if (isNaN(hour) || isNaN(minute)) {
      throw new Error('Invalid time format');
    }

    bookingDateTime.setHours(hour, minute, 0, 0);

    if (bookingDateTime < now) {
      return {
        valid: false,
        reason: 'Time slot is in the past'
      };
    }

    // Check for existing bookings at same time (if technician is specified)
    if (technicianId) {
      const existingBooking = await Booking.findOne({
        'assignedTo.technicianId': technicianId,
        'schedule.preferredDate': bookingDate,
        'schedule.timeSlot': timeSlot,
        status: { $in: ['confirmed', 'assigned', 'in_progress'] }
      });

      if (existingBooking) {
        return {
          valid: false,
          reason: 'Technician already has a booking at this time',
          conflictingBooking: existingBooking.bookingId
        };
      }
    }

    return {
      valid: true,
      bookingDateTime
    };
  } catch (error) {
    logger.error({ date, timeSlot, error: error.message }, 'Time slot validation failed');
    return {
      valid: false,
      reason: 'Invalid time slot format'
    };
  }
};

// Cache helper with TTL
export class Cache {
  constructor() {
    this.cache = new Map();
  }

  set(key, value, ttl = 300000) { // 5 minutes default
    this.cache.set(key, {
      value,
      expiry: Date.now() + ttl
    });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      this.delete(key);
      return null;
    }
    return item.value;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }

  // Get with refresh function if expired
  async getOrSet(key, fetchFn, ttl = 300000) {
    const cached = this.get(key);
    if (cached !== null) {
      logger.debug({ key, hit: true }, 'Cache hit');
      return cached;
    }

    logger.debug({ key, hit: false }, 'Cache miss');
    const value = await fetchFn();
    this.set(key, value, ttl);
    return value;
  }
}

export const cache = new Cache();

// Generate secure booking ID (fallback)
export const generateSecureBookingId = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return `BK${timestamp}${random}`.toUpperCase();
};

// Check if user is online
export const isUserOnline = (userId) => {
  return socketService.isUserConnected(userId);
};

// Get user's socket connection info
export const getUserConnectionInfo = (userId) => {
  return socketService.getUserConnections(userId);
};

// Other exports from old helpers used elsewhere
export const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

export const validatePhone = (phone) => {
  const re = /^[6-9]\d{9}$/;
  return re.test(phone);
};