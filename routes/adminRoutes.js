import express from 'express';
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Service from '../models/Service.js';
import Notification from '../models/Notification.js';
import Employee from '../models/adminEmployee.js';
import { adminAuth as authenticateAdmin } from '../middleware/authMiddleware.js';
import { getDashboardStats, getUserStats, getAllUsers } from '../controllers/adminController.js';

const router = express.Router();

const validateObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const sanitizeInput = (input) => {
  if (typeof input === 'string') return input.trim();
  return input;
};

const validateEmail = (email) => {
  return String(email)
    .toLowerCase()
    .match(
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    );
};

const validatePhone = (phone) => {
  // Accepts 10-digit numbers, with optional country code (+91)
  return /^(\+91[\-\s]?)?[0]?(91)?[6789]\d{9}$/.test(phone) || /^\d{10}$/.test(phone);
};


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
router.get("/users", authenticateAdmin, getAllUsers);

/**
 * @desc    Get user by ID with details
 * @route   GET /api/admin/users/:id
 * @access  Private/Admin
 */
router.get("/users/:id", authenticateAdmin, async (req, res) => {
  try {
    const userId = sanitizeInput(req.params.id);

    if (!validateObjectId(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID format'
      });
    }

    const user = await User.findById(userId)
      .select("-password")
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
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
    console.error("User Fetch Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load user"
    });
  }
});

/**
 * @desc    Update user (Admin only)
 * @route   PUT /api/admin/users/:id
 * @access  Private/Admin
 */
router.put("/users/:id", authenticateAdmin, async (req, res) => {
  try {
    const userId = sanitizeInput(req.params.id);

    if (!validateObjectId(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID format'
      });
    }

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

    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        // Validate email and phone if provided
        if (key === 'email' && req.body.email && !validateEmail(req.body.email)) {
          throw new Error('Invalid email format');
        }
        if (key === 'phone' && req.body.phone && !validatePhone(req.body.phone)) {
          throw new Error('Invalid phone number format');
        }
        updateData[key] = sanitizeInput(req.body[key]);
      }
    });

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    res.json({
      success: true,
      message: "User updated successfully",
      user: updatedUser
    });

  } catch (error) {
    console.error("Update User Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update user"
    });
  }
});

/**
 * @desc    Update user status
 * @route   PUT /api/admin/users/:id/status
 * @access  Private/Admin
 */
router.put("/users/:id/status", authenticateAdmin, async (req, res) => {
  try {
    const userId = sanitizeInput(req.params.id);
    const { isActive } = req.body;

    if (!validateObjectId(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID format'
      });
    }

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: "isActive must be a boolean"
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { isActive },
      { new: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      user: updatedUser
    });
  } catch (error) {
    console.error("Update User Status Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update user status"
    });
  }
});

/**
 * @desc    Delete user (Admin only)
 * @route   DELETE /api/admin/users/:id
 * @access  Private/Admin
 */
router.delete("/users/:id", authenticateAdmin, async (req, res) => {
  try {
    const userId = sanitizeInput(req.params.id);

    if (!validateObjectId(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID format'
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    // Check if user has bookings
    const userBookings = await Booking.countDocuments({
      customer: user._id
    });

    if (userBookings > 0) {
      return res.status(400).json({
        success: false,
        error: "Cannot delete user with existing bookings",
        bookingCount: userBookings
      });
    }

    await User.findByIdAndDelete(userId);

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Delete User Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete user"
    });
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
router.get("/search", authenticateAdmin, async (req, res) => {
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

    const searchRegex = { $regex: sanitizedQuery, $options: 'i' };

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
    console.error("Search Error:", error);
    res.status(500).json({
      success: false,
      error: "Search failed"
    });
  }
});

/**
 * @desc    Get feedback/reviews
 * @route   GET /api/admin/feedback
 * @access  Private/Admin
 */
router.get("/feedback", authenticateAdmin, async (req, res) => {
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
    console.error("Feedback Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load feedback"
    });
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
router.get("/activities", authenticateAdmin, async (req, res) => {
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
    console.error("Activities Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load activities"
    });
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
router.get("/analytics", authenticateAdmin, async (req, res) => {
  try {
    const { period = 'month' } = req.query;
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
    console.error('Error fetching booking analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch booking analytics'
    });
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
const assignBookingHandler = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { employeeId } = req.body;

    console.log("🔥 Assign booking controller HIT");
    console.log("METHOD:", req.method);
    console.log("PARAMS:", req.params);
    console.log("BODY:", req.body);

    if (!bookingId || !employeeId) {
      console.error("❌ Missing required fields:", { bookingId, employeeId });
      return res.status(400).json({
        success: false,
        error: "Booking ID or Employee ID missing"
      });
    }

    // 1. Find Booking (Handle both ObjectId and String ID)
    let booking;
    try {
      if (mongoose.Types.ObjectId.isValid(bookingId)) {
        booking = await Booking.findById(bookingId);
      } else {
        booking = await Booking.findOne({ bookingId: bookingId });
      }
    } catch (err) {
      console.error("❌ Error finding booking:", err);
      return res.status(500).json({ success: false, error: "Database error finding booking" });
    }

    if (!booking) {
      console.error("❌ Booking not found:", bookingId);
      return res.status(404).json({ success: false, error: "Booking not found" });
    }

    // 2. Find Employee
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      console.error("❌ Invalid Employee ID format:", employeeId);
      return res.status(400).json({ success: false, error: "Invalid Employee ID format" });
    }

    let employee;
    try {
      employee = await Employee.findById(employeeId);
    } catch (err) {
      console.error("❌ Error finding employee:", err);
      return res.status(500).json({ success: false, error: "Database error finding employee" });
    }

    if (!employee) {
      console.error("❌ Employee not found:", employeeId);
      return res.status(404).json({ success: false, error: "Employee not found" });
    }

    // Check if employee is active
    if (employee.status !== 'Active') {
      console.warn(`⚠️ Attempted assignment to inactive employee: ${employee.empName} (${employee.status})`);
      return res.status(400).json({
        success: false,
        error: "Cannot assign booking to inactive employee",
        employeeStatus: employee.status
      });
    }

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

    try {
      await booking.save();
      console.log("✅ Booking assigned to employee (Status: PENDING)");
    } catch (saveError) {
      console.error("❌ Error saving booking:", saveError);
      return res.status(500).json({ success: false, error: "Failed to save booking assignment", details: saveError.message });
    }

    // 4. Create Service and Notification (safely)
    try {
      // Generate a unique numeric serviceId
      const lastService = await Service.findOne().sort({ serviceId: -1 });
      const newServiceId = lastService ? (lastService.serviceId + 1) : 1001;

      // Determine customer name/details with fallbacks
      const customerName = booking.userName || booking.contactIdInfo?.fullName || booking.contactInfo?.fullName || (booking.customer ? "Customer" : "Guest");
      const customerPhone = booking.userPhone || booking.contactIdInfo?.phoneNumber || booking.contactInfo?.phoneNumber || "";

      let customerAddress = "";
      if (booking.location) {
        customerAddress = booking.location.completeAddress ||
          `${booking.location.area || ''}, ${booking.location.city || ''}` || "";
      }

      const customerEmail = booking.userEmail || booking.contactIdInfo?.email || booking.contactInfo?.email || "";

      const newService = new Service({
        serviceId: newServiceId,
        empId: employee.empId || 0, // Fallback if empId missing
        title: booking.serviceName || booking.serviceDetails?.title || "Service Assignment",
        description: booking.specialInstructions || "No special instructions",
        serviceType: booking.category || booking.serviceDetails?.category || "General",
        status: 'scheduled',
        customer: {
          name: customerName,
          address: customerAddress,
          phone: customerPhone,
          email: customerEmail
        },
        scheduledDate: booking.schedule?.preferredDate || booking.date || new Date(),
        time: booking.schedule?.timeSlot || booking.time || "09:00 AM",
        estimatedEarnings: (booking.price || booking.payment?.amount || 0) * 0.8, // Assuming 80% split
        paymentStatus: booking.payment?.status || 'pending',
        notes: `Booking Ref: ${booking.bookingId}`
      });

      await newService.save();
      console.log("✅ Service record created:", newServiceId);

      // 5. Create Notification
      await Notification.create({
        recipient: employee._id,
        title: "New Service Assignment",
        message: `You have been assigned a new service: ${newService.title} for ${customerName}`,
        type: "assignment",
        relatedId: newService._id,
        relatedModel: "Service"
      });
      console.log("✅ Notification created");

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
    console.error("❌ Assign Booking Unhandled Error:", error);
    res.status(500).json({ success: false, error: error.message, stack: error.stack });
  }
};

router.post("/bookings/:bookingId/assign", authenticateAdmin, assignBookingHandler);
router.put("/bookings/:bookingId/assign", authenticateAdmin, assignBookingHandler);

export default router;
