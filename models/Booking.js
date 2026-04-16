import mongoose from 'mongoose';
import AutoIncrementFactory from 'mongoose-sequence';
import logger from '../utils/logger.js';

const AutoIncrement = AutoIncrementFactory(mongoose);

// Booking status state machine
const ALLOWED_TRANSITIONS = {
  pending: ['confirmed', 'cancelled', 'rejected'],
  confirmed: ['assigned', 'cancelled'],
  assigned: ['ACCEPTED', 'IN_PROGRESS', 'cancelled'], // Added ACCEPTED/IN_PROGRESS for compatibility with frontend logic
  ACCEPTED: ['IN_PROGRESS', 'NAVIGATING', 'STARTED', 'cancelled'], // Added missing intermediate states
  NAVIGATING: ['STARTED', 'IN_PROGRESS', 'cancelled'],
  STARTED: ['IN_PROGRESS', 'current', 'completed', 'cancelled'],
  IN_PROGRESS: ['completed', 'cancelled'],
  in_progress: ['completed', 'cancelled'], // lowercase variant
  completed: [],
  cancelled: [],
  rejected: [],
  rescheduled: ['confirmed']
};

const bookingSchema = new mongoose.Schema({
  bookingId: {
    type: String,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: false // Changed to false to allow ad-hoc/custom bookings
  },
  serviceDetails: {
    title: { type: String, required: true },
    description: String,
    category: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    duration: { type: Number, required: true, min: 15 }, // in minutes
    image: String
  },
  schedule: {
    preferredDate: {
      type: Date,
      required: true,
      index: true
    },
    timeSlot: {
      type: String,
      required: true,
      // Relaxed validation to support legacy booking formats
      /* enum: [
        '09:00-11:00',
        '11:00-13:00',
        '13:00-15:00',
        '15:00-17:00',
        '17:00-19:00'
      ] */
    },
    rescheduledCount: {
      type: Number,
      default: 0,
      max: 2
    },
    originalDate: Date // Store original date for history
  },
  location: {
    area: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Area',
      required: true
    },
    address: String,
    pincode: String,
    landmark: String,
    completeAddress: String,
    coordinates: {
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 }
    }
  },
  contactIdInfo: {
    fullName: String,
    phoneNumber: String,
    email: String,
    alternatePhone: String
  },
  assignedTo: {
    technicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true
    },
    name: String,
    phone: String,
    avatar: String,
    rating: Number,
    assignedAt: Date
  },
  status: {
    type: String,
    // Accepting all variants to allow for migration/compatibility
    // enum: Object.keys(ALLOWED_TRANSITIONS), 
    default: 'pending',
    index: true
  },
  previousStatus: String, // For rollback capability
  payment: {
    method: {
      type: String,
      enum: ['online', 'cash', 'wallet', 'card'],
      default: 'online'
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
      default: 'pending'
    },
    amount: { type: Number, required: true, min: 0 },
    transactionId: String,
    gateway: String,
    paidAt: Date,
    refundedAt: Date,
    paymentMethodDetails: mongoose.Schema.Types.Mixed
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  notes: String,
  technicianNotes: String,
  customerNotes: String,
  cancellationReason: String,
  cancelledBy: {
    type: String,
    enum: ['user', 'technician', 'admin', 'system']
  },
  completedAt: Date,
  startedAt: Date,
  estimatedCompletion: Date,
  rating: {
    stars: {
      type: Number,
      min: 1,
      max: 5
    },
    review: String,
    submittedAt: Date,
    technicianResponse: String
  },
  estimatedArrival: Date,
  actualArrival: Date,
  history: [{
    status: String,
    updatedBy: {
      type: String,
      enum: ['user', 'technician', 'admin', 'system']
    },
    userId: mongoose.Schema.Types.ObjectId,
    timestamp: {
      type: Date,
      default: Date.now
    },
    notes: String,
    metadata: mongoose.Schema.Types.Mixed
  }],
  metadata: {
    source: { type: String, default: 'web' },
    ipAddress: String,
    userAgent: String,
    appVersion: String,
    referralCode: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Auto-increment bookingId
bookingSchema.plugin(AutoIncrement, {
  inc_field: 'bookingCounter',
  id: 'booking_seq',
  start_seq: 1000
});

// Performance indexes
bookingSchema.index({ userId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ status: 1, 'schedule.preferredDate': 1 });
bookingSchema.index({ 'assignedTo.technicianId': 1, status: 1 });
bookingSchema.index({ 'schedule.preferredDate': 1, status: 1 });
bookingSchema.index({ createdAt: -1 });
bookingSchema.index({ 'payment.transactionId': 1 });
bookingSchema.index({ 'metadata.source': 1 });
bookingSchema.index({ updatedAt: -1 });

// Generate bookingId before save
bookingSchema.pre('save', function (next) {
  if (!this.bookingId) {
    if (this.bookingCounter) {
      this.bookingId = `BK${String(this.bookingCounter).padStart(6, '0')}`;
    } else {
      // Robust Fallback: Avoid null unique key error at all costs
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substring(2, 6);
      this.bookingId = `BK-FBT-${timestamp}-${random}`.toUpperCase();

      logger.warn({
        generatedId: this.bookingId,
        userId: this.userId
      }, 'Booking counter missing - generated fallback bookingId');
    }
  }

  // Store original date on first save
  if (this.isNew && this.schedule.preferredDate && !this.schedule.originalDate) {
    this.schedule.originalDate = this.schedule.preferredDate;
  }

  // Add to history when status changes
  if (this.isModified('status')) {
    const oldStatus = this.previousStatus || 'new';

    // Validate status transition
    // Note: Relaxing validation for now to support various status casing/types in DB
    // if (!this.isNew && !ALLOWED_TRANSITIONS[oldStatus]?.includes(this.status)) { ... }

    this.history.push({
      status: this.status,
      updatedBy: this.cancelledBy || 'system',
      userId: this.userId,
      notes: this.cancellationReason || `Status changed from ${oldStatus} to ${this.status}`,
      metadata: {
        previousStatus: oldStatus,
        cancelledBy: this.cancelledBy
      }
    });

    this.previousStatus = oldStatus;
  }

  next();
});

// Post-save hook to log booking changes
bookingSchema.post('save', function (doc) {
  if (doc.isModified('status')) {
    logger.info({
      bookingId: doc.bookingId,
      userId: doc.userId,
      fromStatus: doc.previousStatus,
      toStatus: doc.status,
      action: 'status_change'
    }, 'Booking status updated');
  }
});

// Virtual for isUpcoming
bookingSchema.virtual('isUpcoming').get(function () {
  if (!this.schedule || !this.schedule.preferredDate) return false;
  const now = new Date();
  const bookingDate = new Date(this.schedule.preferredDate);
  return bookingDate > now &&
    ['pending', 'confirmed', 'assigned'].includes(this.status);
});

// Virtual for isActive
bookingSchema.virtual('isActive').get(function () {
  return this.status === 'in_progress';
});

// Virtual for isPast
bookingSchema.virtual('isPast').get(function () {
  return ['completed', 'cancelled', 'rejected'].includes(this.status);
});

// Virtual for timeUntilBooking (in hours)
bookingSchema.virtual('timeUntilBooking').get(function () {
  if (!this.schedule || !this.schedule.preferredDate) return 0;
  const now = new Date();
  const bookingDate = new Date(this.schedule.preferredDate);
  return Math.max(0, (bookingDate - now) / (1000 * 60 * 60));
});

// Methods for business logic
bookingSchema.methods.canReschedule = function () {
  if (!['pending', 'confirmed'].includes(this.status)) return false;
  if (this.schedule.rescheduledCount >= 2) return false;
  if (this.timeUntilBooking < 2) return false; // Less than 2 hours before
  return true;
};

bookingSchema.methods.canCancel = function () {
  if (!['pending', 'confirmed', 'assigned'].includes(this.status)) return false;
  if (this.timeUntilBooking < 1) return false; // Less than 1 hour before
  return true;
};

bookingSchema.methods.assignTechnician = function (technician) {
  if (this.status !== 'confirmed' && this.status !== 'pending') { // Relaxed for flexibility
    // throw new Error('Only confirmed bookings can be assigned');
  }

  this.assignedTo = {
    technicianId: technician._id,
    name: technician.name,
    phone: technician.phone,
    avatar: technician.avatar,
    rating: technician.stats.rating,
    assignedAt: new Date()
  };

  this.status = 'assigned';
  return this.save();
};

bookingSchema.methods.startService = function () {
  if (this.status !== 'assigned') {
    // throw new Error('Only assigned bookings can be started');
  }

  this.status = 'in_progress';
  this.startedAt = new Date();

  // Calculate estimated completion
  const estimatedCompletion = new Date();
  estimatedCompletion.setMinutes(estimatedCompletion.getMinutes() + this.serviceDetails.duration);
  this.estimatedCompletion = estimatedCompletion;

  return this.save();
};

bookingSchema.methods.completeService = function (notes) {
  if (this.status !== 'in_progress') {
    // throw new Error('Only in-progress bookings can be completed');
  }

  this.status = 'completed';
  this.completedAt = new Date();
  this.technicianNotes = notes;

  return this.save();
};

bookingSchema.methods.cancelBooking = function (reason, cancelledBy = 'user') {
  if (!this.canCancel()) {
    throw new Error('Booking cannot be cancelled at this time');
  }

  this.status = 'cancelled';
  this.cancellationReason = reason;
  this.cancelledBy = cancelledBy;

  return this.save();
};

bookingSchema.methods.rescheduleBooking = function (newDate, newTimeSlot) {
  if (!this.canReschedule()) {
    throw new Error('Booking cannot be rescheduled at this time');
  }

  const oldDate = this.schedule.preferredDate;
  const oldTimeSlot = this.schedule.timeSlot;

  this.schedule.preferredDate = newDate;
  this.schedule.timeSlot = newTimeSlot;
  this.schedule.rescheduledCount += 1;
  this.status = 'rescheduled';

  // Add to history
  this.history.push({
    status: 'rescheduled',
    updatedBy: 'user',
    userId: this.userId,
    notes: `Rescheduled from ${oldDate} ${oldTimeSlot} to ${newDate} ${newTimeSlot}`
  });

  return this.save();
};

// Static methods
bookingSchema.statics.findByBookingId = function (bookingId) {
  return this.findOne({ bookingId });
};

bookingSchema.statics.findUpcomingByUserId = function (userId) {
  return this.find({
    userId,
    status: { $in: ['pending', 'confirmed', 'assigned'] },
    'schedule.preferredDate': { $gt: new Date() }
  }).sort({ 'schedule.preferredDate': 1 });
};

bookingSchema.statics.findActiveByUserId = function (userId) {
  return this.find({
    userId,
    status: 'in_progress'
  });
};

bookingSchema.statics.findPastByUserId = function (userId) {
  return this.find({
    userId,
    status: { $in: ['completed', 'cancelled', 'rejected'] }
  }).sort({ 'schedule.preferredDate': -1 });
};

export default mongoose.model('Booking', bookingSchema);
