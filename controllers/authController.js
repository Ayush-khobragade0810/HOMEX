import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import logger from '../utils/logger.js';
import { ApiError, sendError } from '../utils/ApiError.js';

// Constants
const DUMMY_HASH = '$2b$10$dummyhashdummyhashdummyhashdum'; // bcrypt hash for non-existent users
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const INVALID_CREDENTIALS = 'Invalid email or password';
const ACCOUNT_DEACTIVATED = 'Your account has been deactivated. Please contact support.';
const SIGNUP_ROLES = ['user', 'employee'];

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

// Unexpected failures are logged with context; the global handler formats the response.
const fail = (next, error, context, label) => {
  if (!error.isOperational) logger.errorWithContext(context, label, error);
  return next(error);
};

// The signed-in account's User id (employees carry it as `userId`, see authMiddleware).
const ownUserId = (req) => req.user?.userId || req.user?._id || req.user?.id;

// req.user is a User document for customers/admins but a plain object for
// employees, so load the User when the document methods are not available.
const loadUserDoc = async (req) => {
  if (typeof req.user?.revokeRefreshToken === 'function') return req.user;
  const id = ownUserId(req);
  return id ? User.findById(id).select('+refreshTokens') : null;
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
    return sendError(res, 429, 'Too many login attempts, please try again later', { code: 'RATE_LIMITED' });
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

// 400 for one invalid field, in the standard shape plus the legacy `field` key.
const fieldError = (res, field, message) =>
  sendError(res, 400, message, { code: 'VALIDATION_ERROR', field, errors: [{ field, message }] });

const conflictError = (res, field, message) =>
  sendError(res, 409, message, { code: 'DUPLICATE', field, errors: [{ field, message }] });

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
export const register = async (req, res, next) => {
  try {
    const { name, email, phone, password, role } = req.body || {};

    // The route validator already enforces these; kept so the controller is
    // safe on its own and never reaches email.toLowerCase() with bad input.
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (trimmedName.length < 2) {
      return fieldError(res, 'name', 'Please enter your name (at least 2 characters)');
    }

    const normalizedEmailInput = typeof email === 'string' ? email.trim() : '';
    if (!normalizedEmailInput) {
      return fieldError(res, 'email', 'Email is required');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmailInput)) {
      return fieldError(res, 'email', 'Please enter a valid email address');
    }

    if (typeof password !== 'string' || password.length < 6) {
      return fieldError(res, 'password', 'Password must be at least 6 characters long');
    }

    // Mobile number is mandatory at signup
    const normalizedPhone = (phone || '').toString().trim();
    if (!normalizedPhone) {
      return fieldError(res, 'phone', 'Mobile number is required');
    }
    if (!/^[0-9]{10}$/.test(normalizedPhone)) {
      return fieldError(res, 'phone', 'Please enter a valid 10-digit mobile number');
    }

    // Self-signup can only create customer or employee accounts.
    const normalizedRole = (role || 'user').toString().trim().toLowerCase();
    if (!SIGNUP_ROLES.includes(normalizedRole)) {
      return fieldError(res, 'role', 'Role must be either user or employee');
    }

    // Check if user already exists
    const normalizedEmail = normalizedEmailInput.toLowerCase();
    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) {
      return conflictError(res, 'email', 'Email is already registered');
    }

    // Mobile number must be unique
    const existingPhone = await User.findOne({ phone: normalizedPhone });
    if (existingPhone) {
      return conflictError(res, 'phone', 'Mobile number is already registered');
    }

    // Create user
    const user = await User.create({
      name: trimmedName,
      email: normalizedEmail,
      phone: normalizedPhone,
      password,
      role: normalizedRole,
      metadata: {
        signupSource: req.body.source || 'web',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    // If role is employee, auto-create the corresponding Employee profile
    if (user.role === 'employee') {
      try {
        const Employee = (await import('../models/adminEmployee.js')).default;
        const employeeRecord = new Employee({
          empName: user.name || "Employee",
          email: user.email,
          phone: user.phone || "",
          role: "Service Technician",
          status: "Active",
          countryId: 1,
          stateId: 1,
          cityId: 1,
          areaId: "1",
          earnings: 0,
          rating: 5,
          completedJobs: 0,
          avatar: user.name ? user.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'EMP'
        });
        await employeeRecord.save();
      } catch (err) {
        console.error("❌ Failed to auto-create employee during signup:", err.message);
      }
    }

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
    // Two signups racing past the existence checks hit the unique index.
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || 'email';
      return conflictError(res, field, field === 'phone'
        ? 'Mobile number is already registered'
        : 'Email is already registered');
    }

    // Mongoose ValidationError / anything else: the global handler maps it
    // (400 with field errors, or a generic 500).
    return fail(next, error, { email: req.body?.email }, 'User registration error');
  }
};

// Signup alias
export const signup = register;

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res, next) => {
  const startTime = Date.now(); // For timing attack prevention
  const { email, phone, identifier, password } = req.body || {};
  const ip = normalizeIP(req.ip);
  const userAgent = req.get('User-Agent');

  // Users may sign in with either their email address or their mobile number
  const loginId = (identifier || email || phone || '').toString().trim();
  const isPhoneLogin = /^[0-9]{10}$/.test(loginId);
  const loginMethod = isPhoneLogin ? 'phone' : 'email';

  // Input validation
  if (!loginId) {
    return fieldError(res, 'identifier', 'Email or mobile number is required');
  }
  if (typeof password !== 'string' || !password) {
    return fieldError(res, 'password', 'Password is required');
  }

  // Same response time whether or not the account exists.
  const delayFailure = async () => {
    const elapsed = Date.now() - startTime;
    await new Promise(resolve => setTimeout(resolve, Math.max(500 - elapsed, 0)));
  };

  try {
    // 1. Find user by mobile number or email (with password field explicitly selected)
    const query = isPhoneLogin
      ? { phone: loginId }
      : { email: loginId.toLowerCase() };

    const user = await User.findOne(query)
      .select('+password +failedAttempts +lockedUntil +loginCount +refreshTokens');

    // 2. Check if user exists (with timing attack protection). Soft-deleted
    // accounts are treated as non-existent.
    if (!user || user.isDeleted === true) {
      await Promise.all([
        bcrypt.compare(password, DUMMY_HASH).catch(() => false),
        auditLog({
          event: 'login_failed',
          reason: user ? 'account_deleted' : 'user_not_found',
          email: isPhoneLogin ? undefined : loginId.toLowerCase(),
          identifier: loginId,
          loginMethod,
          ip,
          userAgent
        })
      ]);

      await delayFailure();
      return sendError(res, 401, INVALID_CREDENTIALS, { code: 'INVALID_CREDENTIALS' }); // Generic message
    }

    // 3. Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await auditLog({
        event: 'login_blocked',
        reason: 'account_locked',
        userId: user._id,
        loginMethod,
        ip,
        userAgent
      });

      const remainingTime = Math.ceil((user.lockedUntil - Date.now()) / 1000 / 60);
      return sendError(res, 403,
        `Account is temporarily locked due to too many failed attempts. Try again in ${remainingTime} minute${remainingTime === 1 ? '' : 's'}.`,
        { code: 'ACCOUNT_LOCKED' });
    }

    // 4. Verify password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // Count the failure and lock the account once the limit is reached.
      // ($cond is an aggregation operator: inside a plain $set MongoDB rejects
      // the whole update, which turned every wrong password into a 500 and
      // meant the lockout never actually happened.)
      const failedAttempts = (user.failedAttempts || 0) + 1;
      const lockedUntil = failedAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_DURATION)
        : null;

      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id },
        { $set: { failedAttempts, lockedUntil } },
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

      await delayFailure();
      return sendError(res, 401, INVALID_CREDENTIALS, { code: 'INVALID_CREDENTIALS' });
    }

    // Correct password, but an admin has deactivated the account.
    if (user.isActive === false) {
      await auditLog({ event: 'login_blocked', reason: 'account_deactivated', userId: user._id, loginMethod, ip, userAgent });
      return sendError(res, 403, ACCOUNT_DEACTIVATED, { code: 'ACCOUNT_DEACTIVATED' });
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
      loginMethod,
      ip,
      userAgent,
      loginCount: user.loginCount + 1
    });

    // 7. Access token + rotating refresh token (same helper as register/refresh).
    const { accessToken, refreshToken, refreshTokenExpires } = generateTokens(user);

    // Store refresh token
    await user.addRefreshToken(refreshToken, refreshTokenExpires, {
      userAgent: req.get('User-Agent'),
      ipAddress: normalizeIP(req.ip)
    });

    // 8. Set secure HTTP-only cookie (optional)
    res.cookie('accessToken', accessToken, cookieOptions);
    res.cookie('refreshToken', refreshToken, cookieOptions);

    // 9. Response (sanitized user data). Both `token` and `tokens` are read by the frontend.
    res.status(200).json({
      success: true,
      token: accessToken,
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
    await auditLog({
      event: 'login_error',
      error: error.message,
      identifier: loginId,
      loginMethod,
      ip,
      userAgent,
      timestamp: new Date()
    });

    return fail(next, error, { identifier: loginId }, 'Login error');
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(ownUserId(req))
      .select('-password -refreshTokens -__v');

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    return fail(next, error, { userId: ownUserId(req) }, 'Get current user error');
  }
};

// @desc    Logout user
// @route   GET /api/auth/logout
// @access  Private
export const logout = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (refreshToken) {
      // Revoke refresh token
      const user = await loadUserDoc(req);
      if (user) await user.revokeRefreshToken(refreshToken);
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
    return fail(next, error, { userId: ownUserId(req) }, 'Logout error');
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh-token
// @access  Public (with refresh token)
export const refreshToken = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken || typeof refreshToken !== 'string') {
      return fieldError(res, 'refreshToken', 'Refresh token is required');
    }

    // Find user with this refresh token
    const user = await User.findOne({
      refreshTokens: {
        $elemMatch: {
          token: refreshToken,
          isRevoked: false,
          expiresAt: { $gt: new Date() }
        }
      }
    }).select('+refreshTokens');

    if (!user) {
      logger.warn('Refresh token attempt: Invalid or expired token');
      return sendError(res, 401, 'Your session has expired. Please log in again.', { code: 'INVALID_REFRESH_TOKEN' });
    }

    if (user.isActive === false || user.isDeleted === true) {
      return sendError(res, 403, ACCOUNT_DEACTIVATED, { code: 'ACCOUNT_DEACTIVATED' });
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
    return fail(next, error, {}, 'Token refresh error');
  }
};

// @desc    Revoke all refresh tokens (for security)
// @route   POST /api/auth/revoke-all
// @access  Private
export const revokeAllTokens = async (req, res, next) => {
  try {
    const user = await loadUserDoc(req);
    if (!user) {
      throw ApiError.notFound('User account not found');
    }
    await user.revokeAllRefreshTokens();

    // Clear cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    logger.audit('all_tokens_revoked', req.user, 'auth');

    res.status(200).json({
      success: true,
      message: 'All sessions have been revoked. Please login again.'
    });
  } catch (error) {
    return fail(next, error, { userId: ownUserId(req) }, 'Revoke all tokens error');
  }
};

// @desc    Employee Login (Simplified/Passwordless for employees if needed)
// @route   POST /api/auth/employee-login
// @access  Public
export const employeeLogin = async (req, res, next) => {
  const { email } = req.body || {};
  const ip = normalizeIP(req.ip);
  const userAgent = req.get('User-Agent');

  if (!email || typeof email !== 'string' || !email.trim()) {
    return fieldError(res, 'email', 'Email is required');
  }

  try {
    // 1. Find user
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user || user.isDeleted === true) {
      return sendError(res, 401, 'No employee account found for this email', { code: 'INVALID_CREDENTIALS' });
    }

    if (user.role !== 'employee' && user.role !== 'admin') {
      return sendError(res, 403, 'This account is not registered as an employee', { code: 'NOT_EMPLOYEE' });
    }

    if (user.isActive === false) {
      return sendError(res, 403, ACCOUNT_DEACTIVATED, { code: 'ACCOUNT_DEACTIVATED' });
    }

    // 2. Auto-sync/create Employee record if missing
    try {
      const Employee = (await import('../models/adminEmployee.js')).default;
      let employeeRecord = await Employee.findOne({ email: user.email });

      if (!employeeRecord) {
        employeeRecord = new Employee({
          empName: user.name || "Employee",
          email: user.email,
          phone: user.phone || "",
          role: "Service Technician",
          status: "Active",
          countryId: 1,
          stateId: 1,
          cityId: 1,
          areaId: "1",
          earnings: 0,
          rating: 5,
          completedJobs: 0,
          avatar: user.name ? user.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'EMP'
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
        phone: user.phone,
        role: user.role,
        name: user.name
      }
    });

  } catch (error) {
    return fail(next, error, { email }, 'Employee login error');
  }
};

// @desc    Get User Profile
// @route   GET /api/auth/profile
// @access  Private
export const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(ownUserId(req)).select("-password");
    if (!user) throw ApiError.notFound('User not found');

    res.json({ success: true, user });
  } catch (error) {
    return fail(next, error, { userId: ownUserId(req) }, 'Get profile error');
  }
};

// @desc    Update User Profile
// @route   PUT /api/auth/profile
// @access  Private
export const updateProfile = async (req, res, next) => {
  const { name, phone, address, avatar } = req.body || {};

  try {
    const user = await User.findById(ownUserId(req));
    if (!user) throw ApiError.notFound('User not found');

    if (typeof name === 'string' && name.trim()) user.name = name.trim();
    if (typeof phone === 'string' && phone.trim() && phone.trim() !== user.phone) {
      const normalizedPhone = phone.trim();
      // Mobile number identifies an account (see register), so keep it unique.
      const taken = await User.exists({ phone: normalizedPhone, _id: { $ne: user._id } });
      if (taken) return conflictError(res, 'phone', 'Mobile number is already registered');
      user.phone = normalizedPhone;
    }
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
  } catch (error) {
    return fail(next, error, { userId: ownUserId(req) }, 'Update profile error');
  }
};

// @desc    Change Password
// @route   POST /api/auth/change-password
// @access  Private
export const changePassword = async (req, res, next) => {
  const userId = ownUserId(req); // Prioritize userId (User ID) over id (Employee ID)

  const { currentPassword, newPassword } = req.body || {};

  // 400, never 401: a 401 would make the frontend log the user out.
  if (!currentPassword) {
    return fieldError(res, 'currentPassword', 'Current password is required');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return fieldError(res, 'newPassword', newPassword ? 'New password must be at least 6 characters long' : 'New password is required');
  }
  if (newPassword === currentPassword) {
    return fieldError(res, 'newPassword', 'New password must be different from your current password');
  }

  try {
    const user = await User.findById(userId).select('+password');

    if (!user) {
      throw ApiError.notFound('User account not found');
    }

    const isMatch = await user.comparePassword(String(currentPassword));
    if (!isMatch) {
      return sendError(res, 400, 'Current password is incorrect', {
        code: 'INVALID_CURRENT_PASSWORD',
        errors: [{ field: 'currentPassword', message: 'Current password is incorrect' }]
      });
    }

    // Update password (pre-save hook will hash it)
    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    return fail(next, error, { userId }, 'Change password error');
  }
};
