import jwt from 'jsonwebtoken';
import Employee from '../models/adminEmployee.js';

// 401 means "log in again" to the frontend (it clears the session), so it is
// only used when the caller's credentials are missing or invalid.
const unauthorized = (res, message, code) =>
  res.status(401).json({ success: false, message, error: message, ...(code && { code }) });

export const protect = async (req, res, next) => {
  try {
    let token;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return unauthorized(res, 'Not authorized, no token provided', 'NO_TOKEN');
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');

    // Strategy 1: Try to find Employee directly (for employee login)
    // Only the fields this middleware and req.user need. Without a projection
    // every authenticated request drags the whole record over the wire,
    // including an inline avatar image on older records.
    const EMPLOYEE_FIELDS = 'empId empName name email role status';
    let employee = await Employee.findById(decoded.id).select(EMPLOYEE_FIELDS);
    let user = null;

    // Strategy 2: If not found, check if it's a User who is an employee
    if (!employee) {
      const { default: User } = await import('../models/User.js'); // Dynamic import to avoid circular dependency
      // refreshTokens is needed by logout (req.user.revokeRefreshToken()).
      user = await User.findById(decoded.id).select('name email phone role avatar isActive refreshTokens');

      if (user) {
      } else {
      }

      if (user) {
        // SELF-HEALING: Fix null role if token has valid role
        if ((!user.role || user.role === 'null') && decoded.role) {
          user.role = decoded.role;
          try {
            await user.save();
          } catch (optErr) {
            console.error('Failed to save fixed role:', optErr.message);
          }
        }

        if (user.role === 'employee' || user.role === 'admin' || user.role === 'user') {
          // Find the linked employee record by email only if they ARE an employee
          if (user.role === 'employee') {
            employee = await Employee.findOne({ email: user.email }).select(EMPLOYEE_FIELDS);

            if (!employee) {

              // EMERGENCY FALLBACK: Try to find by Name
              const potentialMatch = await Employee.findOne({ empName: user.name }).select(EMPLOYEE_FIELDS);

              if (potentialMatch) {
                user.email = potentialMatch.email;
                await user.save();
                employee = potentialMatch;
              } else {
                // FIX: Auto-create Employee Record if missing (Fixes broken link issue)
                try {
                  employee = await Employee.create({
                    empName: user.name || "Employee",
                    email: user.email,
                    phone: user.phone || "",
                    role: "Service Technician",
                    status: "Active",
                    // Required location fields (using defaults)
                    countryId: 1,
                    stateId: 1,
                    cityId: 1,
                    areaId: 1,
                    earnings: 0,
                    rating: 5,
                    completedJobs: 0,
                    avatar: user.name ? user.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'EMP'
                  });
                } catch (err) {
                  console.error("❌ Failed to auto-create employee in middleware:", err.message);
                  // We let it fall through; final check will handle the 401 if creation failed
                }
              }
            }
          } else {
            // If role is 'user' or 'admin', we don't need an employee profile
            req.user = user;
            return next();
          }
        }
      }
    }

    if (!employee) {
      return unauthorized(res, 'Your account could not be found. Please log in again.', 'ACCOUNT_NOT_FOUND');
    }

    // Attach employee to request
    req.user = {
      id: employee._id,
      userId: user ? user._id : decoded.id, // Pass underlying User ID for auth operations
      email: employee.email,
      empId: employee.empId,
      name: employee.empName || employee.name, // Handle difference in field names
      role: employee.role
    };

    next();
  } catch (error) {
    console.error('Auth error:', error.message);

    if (error.name === 'TokenExpiredError') {
      return unauthorized(res, 'Your session has expired. Please log in again.', 'TOKEN_EXPIRED');
    }

    // A malformed token, or one whose id is not a valid ObjectId.
    if (error.name === 'JsonWebTokenError' || error.name === 'NotBeforeError' || error.name === 'CastError') {
      return unauthorized(res, 'Invalid authentication token', 'INVALID_TOKEN');
    }

    // Anything else (e.g. the database being unreachable) is a server fault,
    // not a reason to log the user out.
    return res.status(500).json({
      success: false,
      message: 'Could not verify your session. Please try again.',
      error: 'Could not verify your session. Please try again.'
    });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return unauthorized(res, 'Not authorized, please log in');
    }
    if (!roles.includes(req.user.role)) {
      const message = `Access denied: this action requires ${roles.join(' or ')} role`;
      return res.status(403).json({ success: false, message, error: message, code: 'FORBIDDEN' });
    }
    next();
  };
};

/* ============================
   ADMIN AUTH
============================ */
export const adminAuth = async (req, res, next) => {
  const token =
    req.header('admin-token') ||
    (req.header('authorization')?.startsWith('Bearer ')
      ? req.header('authorization').replace('Bearer ', '')
      : null);

  if (!token) {
    return unauthorized(res, 'No admin token, authorization denied', 'NO_TOKEN');
  }

  // 1. Static token validation (Legacy/Internal)
  if (token === process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN) {
    req.user = {
      role: 'admin',
      permissions: ['read', 'write', 'delete']
    };
    req.admin = req.user;
    return next();
  }

  // 2. JWT Validation
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    const userRole = decoded.user?.role || decoded.role;

    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Admin role required',
        error: 'Access denied: Admin role required',
        code: 'FORBIDDEN'
      });
    }

    req.user = decoded.user || decoded;
    req.admin = { ...req.user, permissions: ['read', 'write', 'delete'] };
    next();
  } catch (err) {
    console.error("Admin Auth Error:", err.message);
    return err.name === 'TokenExpiredError'
      ? unauthorized(res, 'Your session has expired. Please log in again.', 'TOKEN_EXPIRED')
      : unauthorized(res, 'Invalid authentication token', 'INVALID_TOKEN');
  }
};

/* ============================
   USER AUTH (Legacy Alias)
============================ */
export const userAuth = protect;

export default { protect, authorize, adminAuth, userAuth };