import express from 'express';
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Service from '../models/Service.js';
import Notification from '../models/Notification.js';
import Employee from '../models/adminEmployee.js';
import { adminAuth as authenticateAdmin } from '../middleware/authMiddleware.js';
import { canReceiveJobs, SUBSCRIPTION_ASSIGN_ERROR } from '../middleware/subscriptionMiddleware.js';
import { refundOnReassign } from '../services/serviceFeeService.js';
import { availabilityBlockReason } from '../utils/availability.js';
import { getDashboardStats, getUserStats, getAllUsers } from '../controllers/adminController.js';
import { validate, validateObjectId } from '../middleware/validate.js';
import { ApiError } from '../utils/ApiError.js';
import * as s from '../validators/admin.js';

const router = express.Router();

const sanitizeInput = (input) => {
  if (typeof input === 'string') return input.trim();
  return input;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');


// Re-exporting legacy handler if strictly needed by other routes not shown here, 
// but based on user request, we are shifting to new logic.
// For now, I'll comment it out to avoid confusion and enforce new routes.
// router.put("/bookings/:id", updateBookingStatusHandler); 
// router.patch("/bookings/:id/status", updateBookingStatusHandler);


// ======================================
// DASHBOARD ROUTES
// ======================================

/**
 * @desc    Get dashboard statistics
 * @route   GET /api/admin/stats
 * @access  Private/Admin
 */
/**
 * @desc    Get dashboard statistics
 * @route   GET /api/admin/stats
 * @access  Private/Admin
 */
router.get("/stats", authenticateAdmin, getDashboardStats);

// ======================================
// BOOKING MANAGEMENT ROUTES
// ======================================

// Booking management routes migrated to adminBooking.routes.js


// ======================================
// USER MANAGEMENT ROUTES
// ======================================

/**
 * @desc    Get user management statistics
 * @route   GET /api/admin/user-stats
 * @access  Private/Admin
 */
router.get("/user-stats", authenticateAdmin, getUserStats);

/**
 * @desc    Get all users with filters
 * @route   GET /api/admin/users
 * @access  Private/Admin
 */
router.get("/users", authenticateAdmin, validate({ query: s.listUsersQuery }), getAllUsers);

/**
 * @desc    Get user by ID with details
 * @route   GET /api/admin/users/:id
 * @access  Private/Admin
 */
router.get("/users/:id", authenticateAdmin, validateObjectId('id'), async (req, res, next) => {
  try {
    const userId = sanitizeInput(req.params.id);

    const user = await User.findById(userId)
      .select("-password")
      .lean();

    if (!user) {
      throw ApiError.notFound("User not found");
    }

    // Get user's bookings
    const bookings = await Booking.find({
      $or: [
        { userId: user._id },
        { 'contactIdInfo.email': user.email },
        { userEmail: user.email }
      ]
    })
      .populate('serviceId', 'title category price duration')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    // Get booking statistics
    const bookingStats = {
      total: bookings.length,
      pending: bookings.filter(b => b.status === 'pending').length,
      confirmed: bookings.filter(b => b.status === 'confirmed').length,
      completed: bookings.filter(b => b.status === 'completed').length,
      cancelled: bookings.filter(b => b.status === 'cancelled').length,
    };

    res.json({
      success: true,
      user: {
        ...user,
        bookings,
        bookingStats
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @desc    Update user (Admin only)
 * @route   PUT /api/admin/users/:id
 * @access  Private/Admin
 */
router.put("/users/:id", authenticateAdmin, validateObjectId('id'), validate({ body: s.updateUser }), async (req, res, next) => {
  try {
    const userId = sanitizeInput(req.params.id);

    const allowedUpdates = [
      'name',
      'email',
      'phone',
      'address',
      'role',
      'isActive',
      'avatar'
    ];

    const updateData = {};

    // Formats are checked by validate({ body: s.updateUser }) above.
    Object.keys(req.body || {}).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updateData[key] = sanitizeInput(req.body[key]);
      }
    });

    if (updateData.email) {
      const emailTaken = await User.exists({
        email: String(updateData.email).toLowerCase(),
        _id: { $ne: userId }
      });
      if (emailTaken) {
        throw ApiError.conflict("Email is already registered to another user");
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      throw ApiError.notFound("User not found");
    }

    res.json({
      success: true,
      message: "User updated successfully",
      user: updatedUser
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @desc    Update user status
 * @route   PUT /api/admin/users/:id/status
 * @access  Private/Admin
 */
router.put("/users/:id/status", authenticateAdmin, validateObjectId('id'), validate({ body: s.updateUserStatus }), async (req, res, next) => {
  try {
    const userId = sanitizeInput(req.params.id);
    const { isActive } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { isActive },
      { new: true }
    ).select("-password");

    if (!updatedUser) {
      throw ApiError.notFound("User not found");
    }

    res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      user: updatedUser
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @desc    Delete user (Admin only)
 * @route   DELETE /api/admin/users/:id
 * @access  Private/Admin
 */
router.delete("/users/:id", authenticateAdmin, validateObjectId('id'), async (req, res, next) => {
  try {
    const userId = sanitizeInput(req.params.id);

    const user = await User.findById(userId);

    if (!user) {
      throw ApiError.notFound("User not found");
    }

    // Check if user has bookings (Booking stores the owner in `userId`;
    // there is no `customer` field, so the old filter never matched).
    const userBookings = await Booking.countDocuments({
      userId: user._id
    });

    if (userBookings > 0) {
      throw ApiError.conflict(
        `Cannot delete this user because they have ${userBookings} booking${userBookings === 1 ? '' : 's'}. Deactivate the account instead.`,
        { code: 'USER_HAS_BOOKINGS', details: { bookingCount: userBookings } }
      );
    }

    await User.findByIdAndDelete(userId);

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    next(error);
  }
});

// ======================================
// SEARCH & FEEDBACK ROUTES
// ======================================

/**
 * @desc    Search all data (Global Search)
 * @route   GET /api/admin/search
 * @access  Private/Admin
 */
router.get("/search", authenticateAdmin, validate({ query: s.searchQuery }), async (req, res, next) => {
  try {
    const { query } = req.query;
    const sanitizedQuery = sanitizeInput(query || '');

    if (!sanitizedQuery || sanitizedQuery.trim() === '') {
      return res.json({
        success: true,
        results: {
          users: [],
          bookings: [],
          services: []
        }
      });
    }

    // Escaped so user input is matched literally (no regex injection / invalid patterns).
    const searchRegex = { $regex: escapeRegex(sanitizedQuery), $options: 'i' };

    // Search users
    const users = await User.find({
      $or: [
        { name: searchRegex },
        { email: searchRegex }
      ]
    })
      .select("name email phone role avatar")
      .limit(10)
      .lean();

    // Get user IDs for booking search
    const userIds = users.map(user => user._id);

    // Search bookings by customer reference or other fields
    const bookings = await Booking.find({
      $or: [
        { customer: { $in: userIds } },
        { userName: searchRegex },
        { userEmail: searchRegex },
        { userPhone: searchRegex },
        { serviceName: searchRegex },
        { bookingId: searchRegex }
      ]
    })
      .populate('customer', 'name email')
      .populate('service', 'name')
      .select("serviceName status date time bookingId")
      .limit(10)
      .lean();

    // Format bookings for search results
    const formattedBookings = bookings.map(b => ({
      _id: b._id,
      bookingId: b.bookingId,
      serviceName: b.serviceName || b.service?.name || "Service",
      userName: b.userName || b.customer?.name || "Guest",
      status: b.status === 'in_progress' ? 'in progress' : b.status,
      date: b.date || "N/A",
      time: b.time || "N/A"
    }));

    res.json({
      success: true,
      results: {
        users,
        bookings: formattedBookings,
        totalResults: users.length + formattedBookings.length
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @desc    Get feedback/reviews
 * @route   GET /api/admin/feedback
 * @access  Private/Admin
 */
router.get("/feedback", authenticateAdmin, validate({ query: s.feedbackQuery }), async (req, res, next) => {
  try {
    const { limit = 10, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const feedbacks = await Booking.find({
      $or: [
        { rating: { $exists: true, $ne: null, $gt: 0 } },
        { 'rating.score': { $exists: true, $ne: null, $gt: 0 } }
      ]
    })
      .populate('customer', 'name email avatar')
      .populate('service', 'name category')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const formattedFeedbacks = feedbacks.map(f => {
      const userName = f.userName || f.customer?.name || "Guest User";
      const userEmail = f.userEmail || f.customer?.email || "";
      const userAvatar = f.customer?.avatar || "";
      const serviceName = f.service?.name || f.serviceName || "Service";
      const rating = f.rating?.score || f.rating || 0;
      const review = f.rating?.review || f.review || "";

      return {
        _id: f._id,
        userName,
        userEmail,
        userAvatar,
        serviceName,
        rating,
        review,
        date: new Date(f.createdAt).toLocaleDateString('en-IN'),
        createdAt: f.createdAt
      };
    });

    const totalFeedbacks = await Booking.countDocuments({
      $or: [
        { rating: { $exists: true, $ne: null, $gt: 0 } },
        { 'rating.score': { $exists: true, $ne: null, $gt: 0 } }
      ]
    });

    res.json({
      success: true,
      feedbacks: formattedFeedbacks,
      total: totalFeedbacks,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(totalFeedbacks / parseInt(limit)),
    });
  } catch (error) {
    next(error);
  }
});

// ======================================
// RECENT ACTIVITY ROUTE
// ======================================

/**
 * @desc    Get recent activities
 * @route   GET /api/admin/activities
 * @access  Private/Admin
 */
router.get("/activities", authenticateAdmin, validate({ query: s.activitiesQuery }), async (req, res, next) => {
  try {
    const { limit = 20 } = req.query;

    // Get recent bookings
    const recentBookings = await Booking.find()
      .populate('customer', 'name email')
      .populate('service', 'name')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('bookingId status userName serviceName createdAt')
      .lean();

    // Get recent users
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('name email role createdAt')
      .lean();

    // Format activities
    const activities = [
      ...recentBookings.map(booking => ({
        type: 'booking',
        id: booking._id,
        title: `New booking #${booking.bookingId}`,
        description: `${booking.userName || 'Customer'} booked ${booking.serviceName || 'service'}`,
        status: booking.status === 'in_progress' ? 'in progress' : booking.status,
        timestamp: booking.createdAt,
        user: booking.userName
      })),
      ...recentUsers.map(user => ({
        type: 'user',
        id: user._id,
        title: `New ${user.role} registered`,
        description: `${user.name} (${user.email}) joined`,
        status: 'active',
        timestamp: user.createdAt,
        user: user.name
      }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parseInt(limit));

    res.json({
      success: true,
      activities,
      total: activities.length
    });
  } catch (error) {
    next(error);
  }
});

// ======================================
// ANALYTICS ROUTE
// ======================================

/**
 * @desc    Get booking analytics
 * @route   GET /api/admin/analytics
 * @access  Private/Admin
 */
router.get("/analytics", authenticateAdmin, validate({ query: s.analyticsQuery }), async (req, res, next) => {
  try {
    const period = String(req.query.period || 'month').trim().toLowerCase();
    let startDate, endDate;

    const now = new Date();
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    switch (period) {
      case 'week':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        break;
      case 'quarter':
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        break;
      case 'year':
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    }

    // Get analytics data in parallel
    const [
      statusCounts,
      dailyBookings,
      categoryStats,
      topServices,
      totalRevenue
    ] = await Promise.all([
      // Status counts
      Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lt: endDate }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      // Daily bookings
      Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lt: endDate }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
            },
            count: { $sum: 1 },
            revenue: { $sum: '$price' }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      // Category stats
      Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lt: endDate }
          }
        },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            revenue: { $sum: '$price' }
          }
        },
        { $sort: { revenue: -1 } }
      ]),
      // Top services
      Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lt: endDate }
          }
        },
        {
          $group: {
            _id: '$serviceName',
            count: { $sum: 1 },
            revenue: { $sum: '$price' }
          }
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 }
      ]),
      // Total revenue
      Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lt: endDate },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$price' }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      analytics: {
        period,
        startDate,
        endDate,
        statusCounts,
        dailyBookings,
        categoryStats,
        topServices,
        totalRevenue: totalRevenue[0]?.total || 0
      }
    });
  } catch (error) {
    next(error);
  }
});


/**
 * @desc    Assign booking to employee
 * @route   POST /api/admin/bookings/:id/assign
 * @access  Private/Admin
 */
// ======================================
// ASSIGN BOOKING HANDLER (Step 3 & 4 Fixes)
// ======================================
// ======================================
// ASSIGN BOOKING HANDLER (Step 3 & 4 Fixes)
// ======================================
const assignBookingHandler = async (req, res, next) => {
  try {
    // Shape is checked by validate({ params, body }) on the route.
    const bookingId = String(req.params.bookingId).trim();
    const employeeId = String(req.body.employeeId).trim();

    // 1. Find Booking (Handle both ObjectId and String ID)
    const booking = mongoose.Types.ObjectId.isValid(bookingId)
      ? await Booking.findById(bookingId)
      : await Booking.findOne({ bookingId: bookingId });

    if (!booking) {
      throw ApiError.notFound("Booking not found");
    }

    // 2. Find Employee
    const employee = await Employee.findById(employeeId);

    if (!employee) {
      throw ApiError.notFound("Employee not found");
    }

    if (!(await canReceiveJobs(employee))) {
      return res.status(400).json({
        success: false,
        code: "SUBSCRIPTION_REQUIRED",
        error: SUBSCRIPTION_ASSIGN_ERROR,
        message: SUBSCRIPTION_ASSIGN_ERROR
      });
    }

    // Check if employee is active
    if (employee.status !== 'Active') {
      const message = "Cannot assign booking to inactive employee";
      return res.status(400).json({
        success: false,
        message,
        error: message,
        employeeStatus: employee.status
      });
    }

    // Respect the employee's own availability (switch + working days/hours).
    const unavailable = availabilityBlockReason(
      employee.availability,
      typeof booking.slotStartsAt === 'function' ? booking.slotStartsAt() : null
    );
    if (unavailable) {
      return res.status(400).json({ success: false, code: "EMPLOYEE_UNAVAILABLE", error: unavailable, message: unavailable });
    }

    // Taking the job away from an employee who already paid its fee refunds them.
    await refundOnReassign(booking._id, employee._id);

    // 3. Update Booking
    // Keep status as PENDING so employee can ACCEPT it. 
    // If status was something else, reset to PENDING for the flow.
    booking.status = 'PENDING';
    booking.assignedTo = employee._id;

    // Add to history
    if (!booking.statusHistory) booking.statusHistory = [];
    booking.statusHistory.push({
      status: 'PENDING',
      changedBy: mongoose.Types.ObjectId.isValid(req.admin?.id) ? req.admin.id : null, // Handle 'dev-admin' string
      role: 'admin',
      timestamp: new Date()
    });

    // Validation/cast failures surface as 400 via the global error handler.
    await booking.save();

    // 4. Create Service and Notification (safely)
    try {
      // Generate a unique numeric serviceId
      const lastService = await Service.findOne().sort({ serviceId: -1 });
      const newServiceId = lastService ? (lastService.serviceId + 1) : 1001;

      // Populate Area information before creating legacy Service
      const populatedBooking = await Booking.findById(booking._id)
          .populate('location.area')
          .lean();

      const areaDoc = populatedBooking?.location?.area;
      const customerAddress = populatedBooking?.location?.completeAddress || populatedBooking?.location?.address || '';

      // Determine customer name/details with fallbacks
      const customerName = booking.userName || booking.contactIdInfo?.fullName || booking.contactInfo?.fullName || (booking.customer ? "Customer" : "Guest");
      const customerPhone = booking.userPhone || booking.contactIdInfo?.phoneNumber || booking.contactInfo?.phoneNumber || "";
      const customerEmail = booking.userEmail || booking.contactIdInfo?.email || booking.contactInfo?.email || "";

      const customerLocation = {
          name: customerName,
          address: customerAddress,
          completeAddress: customerAddress,
          phone: customerPhone,
          email: customerEmail,

          // preserve structured location
          area: areaDoc?._id || null,
          areaName: areaDoc?.areaName || areaDoc?.name || '',
          city: areaDoc?.city || '',
          state: areaDoc?.state || '',
          country: areaDoc?.country || '',
          pincode: populatedBooking?.location?.pincode || areaDoc?.pincode || '',
          landmark: populatedBooking?.location?.landmark || '',
          coordinates: populatedBooking?.location?.coordinates || null
      };

      const newService = new Service({
        serviceId: newServiceId,
        empId: employee.empId || 0, // Fallback if empId missing
        title: booking.serviceName || booking.serviceDetails?.title || "Service Assignment",
        description: booking.specialInstructions || "No special instructions",
        serviceType: booking.category || booking.serviceDetails?.category || "General",
        status: 'scheduled',
        customer: customerLocation,
        scheduledDate: booking.schedule?.preferredDate || booking.date || new Date(),
        time: booking.schedule?.timeSlot || booking.time || "09:00 AM",
        estimatedEarnings: (booking.price || booking.payment?.amount || 0) * 0.8, // Assuming 80% split
        paymentStatus: booking.payment?.status || 'pending',
        notes: `Booking Ref: ${booking.bookingId}`
      });

      await newService.save();

      // 5. Create Notification
      await Notification.create({
        recipient: employee._id,
        title: "New Service Assignment",
        message: `You have been assigned a new service: ${newService.title} for ${customerName}`,
        type: "assignment",
        relatedId: newService._id,
        relatedModel: "Service"
      });

    } catch (innerError) {
      console.error("⚠️ Secondary error (Service/Notification):", innerError);
      // We warn but don't fail the request since booking is already assigned
    }

    res.json({
      success: true,
      message: "Booking assigned successfully",
      booking: booking
    });

  } catch (error) {
    next(error);
  }
};

const validateAssign = validate({ params: s.assignBookingParams, body: s.assignBookingBody });

router.post("/bookings/:bookingId/assign", authenticateAdmin, validateAssign, assignBookingHandler);
router.put("/bookings/:bookingId/assign", authenticateAdmin, validateAssign, assignBookingHandler);

export default router;
