import moment from 'moment';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import { cache } from '../utils/helpers.js';


/**
 * =============================
 * DASHBOARD STATS
 * =============================
 */
export const getDashboardStats = async (req, res) => {
  try {
    const cacheKey = 'admin_dashboard_stats';
    const cachedStats = cache.get(cacheKey);

    if (cachedStats) {
      console.log('🚀 Serving dashboard stats from cache');
      return res.json({ success: true, ...cachedStats });
    }

    console.log('📊 Fetching fresh dashboard stats...');

    const startOfDay = moment().startOf('day').toDate();
    const endOfDay = moment().endOf('day').toDate();

    // Run basic counts in parallel
    const [
      totalUsers,
      totalBookings,
      pendingBookings,
      completedBookings,
      inProgressBookings,
      todaysBookings
    ] = await Promise.all([
      User.countDocuments({ role: 'user', isDeleted: { $ne: true } }),
      Booking.countDocuments(),
      Booking.countDocuments({
        status: { $in: ['PENDING', 'pending', 'Pending'] }
      }),
      Booking.countDocuments({
        status: { $in: ['COMPLETED', 'completed', 'Completed', 'DONE', 'done', 'FINISHED', 'finished'] }
      }),
      Booking.countDocuments({
        status: {
          $in: [
            'IN_PROGRESS', 'in_progress', 'In Progress',
            'STARTED', 'started',
            'NAVIGATING', 'navigating',
            'ACCEPTED', 'accepted', 'CONFIRMED', 'confirmed',
            'ASSIGNED', 'assigned'
          ]
        }
      }),
      Booking.countDocuments({
        'schedule.preferredDate': { $gte: startOfDay, $lte: endOfDay }
      })
    ]);

    console.log('✅ Basic counts completed');

    // Run aggregations individually with error handling for each to pinpoint failure
    let totalEarnings = 0;
    try {
      const totalEarningsResult = await Booking.aggregate([
        { $match: { 'payment.status': 'paid' } },
        { $group: { _id: null, total: { $sum: '$payment.amount' } } }
      ]);
      totalEarnings = totalEarningsResult[0]?.total || 0;
    } catch (aggErr) {
      console.error('❌ Total Earnings Aggregation failed:', aggErr.message);
    }

    let todaysEarnings = 0;
    try {
      const todaysEarningsResult = await Booking.aggregate([
        {
          $match: {
            'payment.status': 'paid',
            'schedule.preferredDate': { $gte: startOfDay, $lte: endOfDay }
          }
        },
        { $group: { _id: null, total: { $sum: '$payment.amount' } } }
      ]);
      todaysEarnings = todaysEarningsResult[0]?.total || 0;
    } catch (aggErr) {
      console.error('❌ Today\'s Earnings Aggregation failed:', aggErr.message);
    }

    let avgRating = "5.0";
    try {
      const avgRatingAgg = await Booking.aggregate([
        { $match: { 'rating.stars': { $exists: true, $ne: null } } },
        { $group: { _id: null, avg: { $avg: '$rating.stars' } } }
      ]);
      if (avgRatingAgg && avgRatingAgg.length > 0) {
        avgRating = Number(avgRatingAgg[0].avg).toFixed(1);
      }
    } catch (aggErr) {
      console.error('❌ Avg Rating Aggregation failed:', aggErr.message);
    }

    const stats = {
      totalUsers,
      totalBookings,
      totalEarnings,
      todaysEarnings,
      avgRating,
      pendingBookings,
      completedBookings,
      inProgressBookings,
      todaysBookings
    };

    // Cache results for 5 minutes
    cache.set(cacheKey, stats, 5 * 60 * 1000);

    console.log('✅ Dashboard stats compiled successfully');

    res.json({
      success: true,
      ...stats
    });
  } catch (err) {
    console.error('❌ ADMIN STATS ERROR (getDashboardStats):', {
      message: err.message,
      stack: err.stack
    });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch dashboard statistics',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * =============================
 * RECENT BOOKINGS (ADMIN)
 * =============================
 */
export const getRecentBookings = async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    const skip = (page - 1) * limit;

    const query = {};

    if (req.query.status) {
      query.status = req.query.status;
    }

    const bookings = await Booking.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customer', 'name email phone')
      .populate('assignedTo', 'name email phone')
      .lean();

    const formatted = bookings.map(b => ({
      _id: b._id,
      bookingId: b.bookingId,

      // SERVICE DETAILS
      serviceName: b.serviceName || b.serviceDetails?.title,
      category: b.category || b.serviceDetails?.category,
      price: b.price || b.serviceDetails?.price,
      duration: b.duration || b.serviceDetails?.duration,

      // CUSTOMER DETAILS
      userName: b.userName || b.customer?.name || b.contactIdInfo?.fullName || b.contactInfo?.fullName,
      userEmail: b.userEmail || b.customer?.email || b.contactIdInfo?.email || b.contactInfo?.email,
      userPhone: b.userPhone || b.customer?.phone || b.contactInfo?.phoneNumber || b.contactIdInfo?.phoneNumber,

      // DATE & TIME
      date: b.date || b.schedule?.preferredDate,
      time: b.time,
      timeSlot: b.timeSlot || b.schedule?.timeSlot,

      // STATUS
      status: b.status,
      paymentStatus: b.payment?.status || 'pending',

      // PAYMENT
      totalAmount: b.totalAmount || b.payment?.amount || b.price || b.serviceDetails?.price,
      paymentMethod: b.payment?.method,

      // ADDRESS
      address: b.address || b.location?.completeAddress,

      // SPECIAL INSTRUCTIONS
      specialInstructions: b.specialInstructions,

      // ASSIGNED EMPLOYEE
      assignedTo: b.assignedTo
        ? {
            name: b.assignedTo.name,
            email: b.assignedTo.email,
            phone: b.assignedTo.phone
          }
        : null,
      createdAt: b.createdAt
    }));

    const total = await Booking.countDocuments(query);

    res.json({
      success: true,
      bookings: formatted,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('🔴 Booking Fetch Error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch bookings',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * =============================
 * USER MANAGEMENT (ADMIN)
 * =============================
 */

/**
 * @desc    Get all users (with filters)
 * @route   GET /api/admin/users
 * @access  Private/Admin
 */
export const getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { role, search } = req.query;

    const query = { isDeleted: { $ne: true } };

    // Robust Role Filter (Case-insensitive & Sanitized)
    if (role && role !== 'all') {
      const sanitizedRole = String(role).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.role = { $regex: new RegExp(`^${sanitizedRole}$`, 'i') };
    }

    // Search filter (name or email) (Sanitized)
    if (search) {
      const sanitizedSearch = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: sanitizedSearch, $options: 'i' } },
        { email: { $regex: sanitizedSearch, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password -refreshTokens')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await User.countDocuments(query);

    // Get specific counts for UI stats/badges
    const [userCount, adminCount] = await Promise.all([
      User.countDocuments({ role: /^user$/i, isDeleted: { $ne: true } }),
      User.countDocuments({ role: /^admin$/i, isDeleted: { $ne: true } })
    ]);

    res.json({
      success: true,
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      stats: {
        total,
        users: userCount,
        admins: adminCount
      }
    });
  } catch (error) {
    console.error('❌ GET USERS ERROR (getAllUsers):', {
      message: error.message,
      stack: error.stack,
      query: req.query
    });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get user statistics
 * @route   GET /api/admin/user-stats
 * @access  Private/Admin
 */
export const getUserStats = async (req, res) => {
  try {
    const cacheKey = 'admin_user_stats';
    const cachedStats = cache.get(cacheKey);

    if (cachedStats) {
      return res.json({ success: true, stats: cachedStats });
    }

    const totalFilter = { isDeleted: { $ne: true } };

    // Parallelize counts for performance
    const [totalUsers, totalEmployees, startOfMonthCounts, activeUsers, totalBookings] = await Promise.all([
      User.countDocuments({ ...totalFilter, role: /^user$/i }),
      User.countDocuments({ ...totalFilter, role: /^employee$/i }),
      User.countDocuments({
        ...totalFilter,
        createdAt: { $gte: moment().startOf('month').toDate() },
        role: /^user$/i
      }),
      User.countDocuments({
        ...totalFilter,
        role: /^user$/i,
        $or: [
          { isActive: true },
          { isActive: { $exists: false } }
        ]
      }),
      Booking.countDocuments(totalFilter)
    ]);

    const stats = {
      totalUsers,
      totalEmployees,
      newUsers: startOfMonthCounts,
      activeUsers,
      avgBookings: totalUsers > 0 ? (totalBookings / totalUsers) : 0
    };

    cache.set(cacheKey, stats, 120000); // Cache for 2 mins

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('❌ USER STATS ERROR (getUserStats):', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch user stats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Debug user data
 * @route   GET /api/admin/debug-users
 * @access  Private/Admin
 */
export const debugUsers = async (req, res) => {
  try {
    const allUsers = await User.find({}).limit(100).lean();
    
    res.json({
      success: true,
      stats: {
        total: allUsers.length,
        rawUsers: allUsers.map(u => ({
          id: u._id,
          email: u.email,
          role: u.role,
          isActive: u.isActive
        }))
      }
    });

  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
