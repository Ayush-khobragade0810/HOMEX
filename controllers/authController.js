import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import logger from '../utils/logger.js';

// Constants
const DUMMY_HASH = '$2b$10$dummyhashdummyhashdummyhashdum'; // bcrypt hash for non-existent users
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

// Utility function
const normalizeIP = (ip) => {
  if (!ip) return '0.0.0.0';
  if (ip === '::1') return '127.0.0.1';
  if (ip.includes('::ffff:')) return ip.replace('::ffff:', '');
  return ip;
};

// Audit Log Helper
const auditLog = async (details) => {
  const { event, ...rest } = details;
  // Map to existing logger.audit signature: (action, user, resource, details)
  // We construct a dummy user object if userId is present, or pass generic info
  const userForLog = rest.userId ? { _id: rest.userId, role: rest.role || 'unknown', email: rest.email } : { _id: 'anonymous', role: 'guest', email: rest.email };
  logger.audit(event, userForLog, 'auth', rest);
};

// Rate limiter
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,


  handler: async (req, res) => {
    await auditLog({
      event: 'rate_limit_exceeded',
      endpoint: '/login',
      ip: normalizeIP(req.ip)
    });
    return res.status(429).json({
      message: 'Too many login attempts, please try again later'
    });
  }
});

// Generate tokens
const generateTokens = (user) => {
  const accessToken = jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '24h' }
  );

  const refreshToken = crypto.randomBytes(40).toString('hex');
  const refreshTokenExpires = new Date(
    Date.now() + (parseInt(process.env.JWT_REFRESH_EXPIRE_DAYS) || 7) * 24 * 60 * 60 * 1000
  );

  return { accessToken, refreshToken, refreshTokenExpires };
};

// Set cookie options
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
export const register = async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;

    // Check if user already exists
    const normalizedEmail = email.toLowerCase();
    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Check availability of phone only if provided
    if (phone) {
      const existingPhone = await User.findOne({ phone });
      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: 'User with this phone already exists'
        });
      }
    }

    // Create user
    const user = await User.create({
      name,
      email: normalizedEmail,
      phone,
      password,
      role: (role || 'user').toLowerCase(),
      metadata: {
        signupSource: req.body.source || 'web',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    // Generate tokens
    const { accessToken, refreshToken, refreshTokenExpires } = generateTokens(user);

    // Store refresh token
    await user.addRefreshToken(refreshToken, refreshTokenExpires, {
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip
    });

    // Set cookies
    res.cookie('accessToken', accessToken, cookieOptions);
    res.cookie('refreshToken', refreshToken, cookieOptions);

    logger.audit('user_registered', user, 'auth', {
      email,
      source: req.body.source || 'web'
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      tokens: {
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    console.error('🔥 SIGNUP CATCH BLOCK ERROR:', error);

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = {};
      Object.keys(error.errors).forEach(key => {
        errors[key] = error.errors[key].message;
      });
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors,
        errorType: 'ValidationError'
      });
    }

    // Handle duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`,
        field: field,
        errorType: 'DuplicateKey'
      });
    }

    logger.errorWithContext(
      { email: req.body.email },
      'User registration error',
      error
    );
    res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Signup alias
export const signup = register;

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res) => {
  console.log("LOGIN HIT", req.headers.authorization);
  const startTime = Date.now(); // For timing attack prevention
  const { email, password } = req.body;
  const ip = normalizeIP(req.ip);
  const userAgent = req.get('User-Agent');

  // Input validation
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    // 1. Find user (with password field explicitly selected)
    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+password +failedAttempts +lockedUntil +loginCount +refreshTokens');

    // 2. Check if user exists (with timing attack protection)
    const dummyCompare = bcrypt.compare(password, DUMMY_HASH);
    if (!user) {
      await Promise.all([
        dummyCompare,
        auditLog({
          event: 'login_failed',
          reason: 'user_not_found',
          email: email.toLowerCase().trim(),
          ip,
          userAgent
        })
      ]);

      // Consistent timing regardless of user existence
      const elapsed = Date.now() - startTime;
      const delay = Math.max(500 - elapsed, 0);
      await new Promise(resolve => setTimeout(resolve, delay));

      return res.status(401).json({
        message: 'Invalid credentials' // Generic message
      });
    }

    // 3. Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await auditLog({
        event: 'login_blocked',
        reason: 'account_locked',
        userId: user._id,
        ip,
        userAgent
      });

      const remainingTime = Math.ceil((user.lockedUntil - Date.now()) / 1000 / 60);
      return res.status(403).json({
        message: `Account is temporarily locked. Try again in ${remainingTime} minutes`
      });
    }

    // 4. Verify password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // Increment failed attempts atomically
      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id },
        {
          $inc: { failedAttempts: 1 },
          $set: {
            lockedUntil: {
              $cond: {
                if: { $gte: ['$failedAttempts', MAX_FAILED_ATTEMPTS - 1] },
                then: new Date(Date.now() + LOCKOUT_DURATION),
                else: null
              }
            }
          }
        },
        { new: true }
      );

      await auditLog({
        event: 'login_failed',
        reason: 'invalid_password',
        userId: user._id,
        failedAttempts: updatedUser ? updatedUser.failedAttempts : 0,
        ip,
        userAgent
      });

      // Consistent delay
      const elapsed = Date.now() - startTime;
      const delay = Math.max(500 - elapsed, 0);
      await new Promise(resolve => setTimeout(resolve, delay));

      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // 5. Successful login - atomic update
    await User.findOneAndUpdate(
      { _id: user._id },
      {
        $set: {
          lastLogin: new Date(),
          failedAttempts: 0,
          lockedUntil: null
        },
        $inc: { loginCount: 1 }
      }
    );

    // 6. Secure audit logging
    await auditLog({
      event: 'login_success',
      userId: user._id,
      role: user.role,
      ip,
      userAgent,
      loginCount: user.loginCount + 1
    });

    // 7. Generate JWT token (with short expiry) -- Using existing generateTokens helper if possible, 
    // but the snippet provided custom JWT generation. I will use the generateTokens helper I see in the file or adapt.
    // The snippet uses jwt.sign directly.
    // The existing code has `generateTokens` helper. I will use it to be consistent with register/refresh, OR follow snippet.
    // Snippet: 
    // const token = jwt.sign(..., { expiresIn: '24h' });
    // My generateTokens: { accessToken (15m), refreshToken (7d) }.
    // The snippet is for a simpler auth (single token?). But my system has refresh tokens.
    // I should MAINTAIN the refresh token architecture. The user "Enhanced User Schema" includes refresh tokens.
    // So I will use `generateTokens` helper.

    const { accessToken, refreshToken, refreshTokenExpires } = generateTokens(user);

    // Store refresh token
    await user.addRefreshToken(refreshToken, refreshTokenExpires, {
      userAgent: req.get('User-Agent'),
      ipAddress: normalizeIP(req.ip)
    });

    // 8. Set secure HTTP-only cookie (optional)
    res.cookie('accessToken', accessToken, cookieOptions);
    res.cookie('refreshToken', refreshToken, cookieOptions);

    // 9. Response (sanitized user data)
    res.status(200).json({
      success: true,
      token: accessToken, // Frontend might expect 'token' or 'accessToken'. Existing code returns 'tokens: { accessToken, ... }'.
      // Snippet returns { token, user }. Existing returns { success, message, user, tokens }.
      // I will return a superset to avoid breaking frontend?
      // Snippet: res.status(200).json({ token, user: { ... } });
      // I will return { success: true, token: accessToken, tokens: { ... }, user: ... }
      tokens: {
        accessToken,
        refreshToken
      },
      user: {
        _id: user._id,
        id: user._id, // Keep id for backward compatibility
        email: user.email,
        role: user.role,
        lastLogin: new Date(),
        name: user.name,
        phone: user.phone,
        avatar: user.avatar
      }
    });

  } catch (error) {
    console.error('Login error:', error);

    await auditLog({
      event: 'login_error',
      error: error.message,
      email: email?.toLowerCase()?.trim(),
      ip,
      userAgent,
      timestamp: new Date()
    });

    res.status(500).json({ message: 'Internal server error' });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -refreshTokens -__v');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    logger.errorWithContext(
      { userId: req.user._id },
      'Get current user error',
      error
    );
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Logout user
// @route   GET /api/auth/logout
// @access  Private
export const logout = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (refreshToken) {
      // Revoke refresh token
      await req.user.revokeRefreshToken(refreshToken);
    }

    // Clear cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    logger.audit('user_logged_out', req.user, 'auth');

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    logger.errorWithContext(
      { userId: req.user._id },
      'Logout error',
      error
    );
    res.status(500).json({
      success: false,
      message: 'Server error during logout'
    });
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh-token
// @access  Public (with refresh token)
export const refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Find user with this refresh token
    const user = await User.findOne({
      'refreshTokens.token': refreshToken,
      'refreshTokens.isRevoked': false,
      'refreshTokens.expiresAt': { $gt: new Date() }
    }).select('+refreshTokens');

    if (!user) {
      logger.warn('Refresh token attempt: Invalid or expired token');
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken, refreshTokenExpires } = generateTokens(user);

    // Revoke old refresh token
    await user.revokeRefreshToken(refreshToken);

    // Store new refresh token
    await user.addRefreshToken(newRefreshToken, refreshTokenExpires, {
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip
    });

    // Set cookies
    res.cookie('accessToken', accessToken, cookieOptions);
    res.cookie('refreshToken', newRefreshToken, cookieOptions);

    logger.audit('token_refreshed', user, 'auth');

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      tokens: {
        accessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    logger.error('Token refresh error', error);
    res.status(500).json({
      success: false,
      message: 'Server error during token refresh'
    });
  }
};

// @desc    Revoke all refresh tokens (for security)
// @route   POST /api/auth/revoke-all
// @access  Private
export const revokeAllTokens = async (req, res) => {
  try {
    await req.user.revokeAllRefreshTokens();

    // Clear cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    logger.audit('all_tokens_revoked', req.user, 'auth');

    res.status(200).json({
      success: true,
      message: 'All sessions have been revoked. Please login again.'
    });
  } catch (error) {
    logger.errorWithContext(
      { userId: req.user._id },
      'Revoke all tokens error',
      error
    );
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Employee Login (Simplified/Passwordless for employees if needed)
// @route   POST /api/auth/employee-login
// @access  Public
export const employeeLogin = async (req, res) => {
  const { email } = req.body;
  const ip = normalizeIP(req.ip);
  const userAgent = req.get('User-Agent');

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    // 1. Find user
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(401).json({ message: 'Employee not found' });
    }

    if (user.role !== 'employee' && user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized as employee' });
    }

    // 2. Auto-sync/create Employee record if missing
    try {
      const Employee = (await import('../models/adminEmployee.js')).default;
      let employeeRecord = await Employee.findOne({ email: user.email });

      if (!employeeRecord) {
        console.log(`📝 Auto-sync: Creating missing Employee record for ${user.email}`);
        employeeRecord = new Employee({
          empName: user.name || "Employee",
          email: user.email,
          phone: user.phone || "",
          role: "Service Technician",
          status: "Active",
          earnings: 0,
          rating: 5,
          completedJobs: 0
        });
        await employeeRecord.save();
      }
    } catch (importErr) {
      console.error("Failed to sync Employee record:", importErr);
    }

    // 3. Generate tokens
    const { accessToken, refreshToken, refreshTokenExpires } = generateTokens(user);

    await user.addRefreshToken(refreshToken, refreshTokenExpires, { userAgent, ipAddress: ip });

    // Set cookies
    res.cookie('accessToken', accessToken, cookieOptions);
    res.cookie('refreshToken', refreshToken, cookieOptions);

    res.status(200).json({
      success: true,
      accessToken, // Frontend expects this
      refreshToken,
      user: {
        _id: user._id,
        id: user._id,
        email: user.email,
        role: user.role,
        name: user.name
      }
    });

  } catch (error) {
    console.error('Employee login error:', error);
    res.status(500).json({ message: 'Server error during employee login' });
  }
};

// @desc    Get User Profile
// @route   GET /api/auth/profile
// @access  Private
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.json({ success: true, user });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// @desc    Update User Profile
// @route   PUT /api/auth/profile
// @access  Private
export const updateProfile = async (req, res) => {
  const { name, phone, address, avatar } = req.body;

  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (address) user.address = address;
    if (avatar) user.avatar = avatar;

    await user.save();

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        avatar: user.avatar
      }
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// @desc    Change Password
// @route   POST /api/auth/change-password
// @access  Private
export const changePassword = async (req, res) => {
  const userId = req.user.userId || req.user._id || req.user.id; // Prioritize userId (User ID) over id (Employee ID)
  console.log("🔐 CHANGE PASSWORD REQUEST:", { userId, userObj: req.user });

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const user = await User.findById(userId).select('+password');
    console.log("🔍 Database User Search Result:", user ? "Found" : "Not Found");

    if (!user) {
      return res.status(404).json({ message: 'User account not found', debugId: userId });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    // Update password (pre-save hook will hash it)
    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ message: 'Server error' });
  }
};
