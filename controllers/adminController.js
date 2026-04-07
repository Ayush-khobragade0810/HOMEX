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

    const startOfDay = moment().startOf('day').toDate();
    const endOfDay = moment().endOf('day').toDate();

    const [
      totalUsers,
      totalBookings,
      pendingBookings,
      completedBookings,
      inProgressBookings,
      todaysBookings,
      totalEarningsResult,
      todaysEarningsResult
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
      }),
      Booking.aggregate([
        { $match: { 'payment.status': 'paid' } },
        { $group: { _id: null, total: { $sum: '$payment.amount' } } }
      ]).allowDiskUse(true),
      Booking.aggregate([
        {
          $match: {
            'payment.status': 'paid',
            'schedule.preferredDate': { $gte: startOfDay, $lte: endOfDay }
          }
        },
        { $group: { _id: null, total: { $sum: '$payment.amount' } } }
      ]).allowDiskUse(true)
    ]);

    const avgRatingAgg = await Booking.aggregate([
      { $match: { 'rating.stars': { $exists: true } } },
      { $group: { _id: null, avg: { $avg: '$rating.stars' } } }
    ]).allowDiskUse(true);

    const stats = {
      totalUsers,
      totalBookings,
      totalEarnings: totalEarningsResult[0]?.total || 0,
      todaysEarnings: todaysEarningsResult[0]?.total || 0,
      avgRating: Number(avgRatingAgg[0]?.avg || 5).toFixed(1),
      pendingBookings,
      completedBookings,
      inProgressBookings,
      todaysBookings
    };

    // Cache results for 5 minutes
    cache.set(cacheKey, stats, 5 * 60 * 1000);

    res.json({
      success: true,
      ...stats
    });
  } catch (err) {
    console.error('Stats fetch error:', err);
    res.status(500).json({ success: false, error: 'Stats fetch failed' });
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
    console.error(err);
    res.status(500).json({ success: false, error: 'Booking fetch failed' });
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

    const query = {};

    // Robust Role Filter (Case-insensitive)
    if (role && role !== 'all') {
      query.role = { $regex: new RegExp(`^${role}$`, 'i') };
    }

    // Search filter (name or email)
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Exclude soft-deleted users
    query.isDeleted = { $ne: true };

    const users = await User.find(query)
      .select('-password -refreshTokens')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await User.countDocuments(query);

    // Get specific counts for UI stats/badges
    const userCount = await User.countDocuments({ role: /^user$/i, isDeleted: { $ne: true } });
    const adminCount = await User.countDocuments({ role: /^admin$/i, isDeleted: { $ne: true } });

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
    console.error('Get Users Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
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

    // Robust case-insensitive counts
    const totalUsers = await User.countDocuments({ ...totalFilter, role: /^user$/i });
    const totalEmployees = await User.countDocuments({ ...totalFilter, role: /^employee$/i });

    // New users this month
    const startOfMonth = moment().startOf('month').toDate();
    const newUsers = await User.countDocuments({
      ...totalFilter,
      createdAt: { $gte: startOfMonth },
      role: /^user$/i
    });

    // Active users
    const activeUsers = await User.countDocuments({
      ...totalFilter,
      role: /^user$/i,
      $or: [
        { isActive: true },
        { isActive: { $exists: false } }
      ]
    });

    // Calculate Avg Bookings
    const totalBookings = await Booking.countDocuments(totalFilter);
    const avgBookings = totalUsers > 0 ? (totalBookings / totalUsers) : 0;

    const stats = {
      totalUsers,
      totalEmployees,
      newUsers,
      activeUsers,
      avgBookings
    };

    cache.set(cacheKey, stats, 5 * 60 * 1000);

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('User Stats Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user stats' });
  }
};

/**
 * @desc    Debug user data
 * @route   GET /api/admin/debug-users
 * @access  Private/Admin
 */
export const debugUsers = async (req, res) => {
  try {
    console.log('=== DEBUG MODE: USER DATA ANALYSIS ===');

    const allUsers = await User.find({});
    console.log(`📊 Total users in DB: ${allUsers.length}`);

    if (allUsers.length > 0) {
      console.log(`👤 User SAMPLE (First 3):`, allUsers.slice(0, 3).map(u => ({
        _id: u._id,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        isDeleted: u.isDeleted
      })));
    }

    const totalCount = await User.countDocuments();
    const activeCount = await User.countDocuments({ isActive: true });
    const adminCount = await User.countDocuments({ role: /^admin$/i });
    const userCount = await User.countDocuments({ role: /^user$/i });

    res.json({
      success: true,
      stats: {
        total: totalCount,
        active: activeCount,
        admin: adminCount,
        users: userCount,
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
    res.status(500).json({ error: error.message });
  }
};
