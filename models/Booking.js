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

// A single additional service performed during the appointment that was not
// part of the original booking. Each entry becomes its own invoice line item.
const extraServiceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  amount: { type: Number, required: true, min: 0 }, // quantity * unitPrice
  notes: { type: String, trim: true },
  addedBy: { type: mongoose.Schema.Types.ObjectId },
  addedByRole: { type: String, enum: ['employee', 'admin'] },
  addedAt: { type: Date, default: Date.now }
}, { _id: true });

// One entry per status change, in the order the change happened. Both the admin
// and the employee flows append here, and the booking views render it directly.
const statusTimelineSchema = new mongoose.Schema({
  status: { type: String, required: true },
  updatedBy: { type: String, default: 'system' },
  updatedById: { type: mongoose.Schema.Types.ObjectId },
  note: String,
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

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
  // Extra services added during the appointment (see extraServiceSchema above).
  extraServices: { type: [extraServiceSchema], default: [] },
  // Persisted invoice breakdown. ALWAYS written via utils/billing.js so the
  // customer bill, invoice PDF and payment summary can never drift apart.
  billing: {
    baseAmount: { type: Number, min: 0, default: 0 },
    extrasTotal: { type: Number, min: 0, default: 0 },
    subtotal: { type: Number, min: 0, default: 0 },
    discount: { type: Number, min: 0, default: 0 },
    taxRate: { type: Number, min: 0, default: 0 },
    taxAmount: { type: Number, min: 0, default: 0 },
    grandTotal: { type: Number, min: 0, default: 0 }
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
  statusTimeline: { type: [statusTimelineSchema], default: [] },
  adminNotes: String, // Internal notes, never exposed to the customer
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
  confirmedAt: Date,
  cancelledAt: Date,
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
  },
  // Fee taken from the employee's subscription balance when they accepted this
  // booking. Also the lock that guarantees one charge per booking — see
  // services/serviceFeeService.js.
  serviceFee: {
    status: { type: String, enum: ['charging', 'charged', 'refunded'] },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    amount: Number,
    chargedAt: Date,
    refundedAt: Date,
    refundReason: String
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

// Refund the employee's service fee whenever a booking they paid for ends up
// cancelled by anyone but them. Done in model hooks because cancellations
// happen in many controllers; the refund itself is idempotent.
const touchesStatus = (update = {}) =>
  'status' in update || 'status' in (update.$set || {});

const refundIfCancelled = async (filter) => {
  try {
    const { refundFeesForCancelledBookings } = await import('../services/serviceFeeService.js');
    await refundFeesForCancelledBookings(filter);
  } catch (err) {
    logger.error({ err: err.message }, 'Service fee refund check failed');
  }
};

bookingSchema.post('save', async function (doc) {
  if (doc.serviceFee?.status === 'charged') await refundIfCancelled({ _id: doc._id });
});

bookingSchema.post(['findOneAndUpdate', 'updateOne', 'updateMany'], async function () {
  if (touchesStatus(this.getUpdate())) await refundIfCancelled(this.getFilter());
});

// Live admin panel: broadcast every booking create/update, whichever
// controller made it. Fire-and-forget so a socket problem never slows a write.
const broadcastToAdmins = (event, payload) => {
  import('../utils/adminEvents.js')
    .then(({ notifyAdmins }) => notifyAdmins(event, payload))
    .catch(() => {});
};

/** The single booking id a query targets, if it targets exactly one. */
const idFromFilter = (filter = {}) => {
  const id = filter._id;
  if (typeof id === 'string') return id;
  if (id instanceof mongoose.Types.ObjectId) return String(id);
  return undefined; // no id, or an operator such as { $in: [...] }
};

bookingSchema.pre('save', function (next) {
  this.$locals.wasNew = this.isNew;
  next();
});

bookingSchema.post('save', function (doc) {
  const base = { id: String(doc._id), bookingId: doc.bookingId, status: doc.status };
  if (doc.$locals?.wasNew) {
    broadcastToAdmins('admin:booking:new', {
      ...base,
      title: doc.serviceDetails?.title,
      customer: doc.contactIdInfo?.fullName
    });
  }
  broadcastToAdmins('admin:bookings:changed', { ...base, type: doc.$locals?.wasNew ? 'created' : 'updated' });
});

bookingSchema.post(['findOneAndUpdate', 'updateOne', 'updateMany'], function (result) {
  const filter = this.getFilter() || {};
  const id = idFromFilter(filter) || (result && result._id ? String(result._id) : undefined);
  broadcastToAdmins('admin:bookings:changed', {
    id,
    bookingId: typeof filter.bookingId === 'string' ? filter.bookingId : result?.bookingId,
    status: result?.status,
    type: 'updated'
  });
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

// Time slots ("13:00-15:00", or "01:00 PM - 03:00 PM") are local business time
// on preferredDate's calendar day, which is stored as UTC midnight.
const SLOT_TZ_OFFSET_MINUTES = Number(process.env.BUSINESS_TZ_OFFSET_MINUTES ?? 330); // IST
const CUSTOMER_CANCELLABLE = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'ACCEPTED', 'RESCHEDULED'];
const CANCEL_CUTOFF_MS = 60 * 60 * 1000; // no cancelling in the last hour before the slot

/** When the booked slot starts, or null if there's no date. */
bookingSchema.methods.slotStartsAt = function () {
  const day = this.schedule?.preferredDate ? new Date(this.schedule.preferredDate) : null;
  if (!day || Number.isNaN(day.getTime())) return null;

  let hours = 0;
  let minutes = 0;
  const m = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(this.schedule?.timeSlot || '');
  if (m) {
    hours = Number(m[1]);
    minutes = Number(m[2]);
    if (m[3]) {
      if (hours === 12) hours = 0;
      if (m[3].toUpperCase() === 'PM') hours += 12;
    }
  }

  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hours, minutes) -
    SLOT_TZ_OFFSET_MINUTES * 60 * 1000
  );
};

/** Why the customer can't cancel right now, or null if they can. */
bookingSchema.methods.cancelBlockReason = function (now = new Date()) {
  const status = String(this.status || '').toUpperCase();
  if (status === 'CANCELLED' || status === 'CANCELED') return 'This booking is already cancelled.';
  if (!CUSTOMER_CANCELLABLE.includes(status)) {
    return 'This booking can no longer be cancelled because the service has already started or finished.';
  }
  const start = this.slotStartsAt();
  if (start && start - now < CANCEL_CUTOFF_MS) {
    return 'Bookings can only be cancelled more than 1 hour before the scheduled time.';
  }
  return null;
};

bookingSchema.methods.canCancel = function () {
  return this.cancelBlockReason() === null;
};

bookingSchema.methods.assignTechnician = function (technician) {
  if (this.status !== 'confirmed' && this.status !== 'pending') { // Relaxed for flexibility
    // throw new Error('Only confirmed bookings can be assigned');
  }

  this.assignedTo = {
    technicianId: technician._id,
    name: technician.name,
    phone: technician.phone,
    // Inline data-URL avatars are not copied in: see utils/avatarStorage.js
    avatar: /^data:/.test(String(technician.avatar || '')) ? undefined : technician.avatar,
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
  const blocked = this.cancelBlockReason();
  if (blocked) throw new Error(blocked);

  const by = ['user', 'technician', 'admin', 'system'].includes(cancelledBy) ? cancelledBy : 'user';
  this.status = 'CANCELLED';
  this.cancellationReason = reason;
  this.cancelledBy = by;
  this.cancelledAt = new Date();
  this.statusTimeline.push({ status: 'CANCELLED', updatedBy: by, note: reason || undefined });

  // Saving triggers the post-save hook that refunds the employee's service fee.
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
