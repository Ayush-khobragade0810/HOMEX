import jwt from 'jsonwebtoken';
import Employee from '../models/adminEmployee.js';

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
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');

    // Strategy 1: Try to find Employee directly (for employee login)
    let employee = await Employee.findById(decoded.id);
    let user = null;

    // Strategy 2: If not found, check if it's a User who is an employee
    if (!employee) {
      const { default: User } = await import('../models/User.js'); // Dynamic import to avoid circular dependency
      user = await User.findById(decoded.id);

      if (user) {
        console.log(`🔐 Auth Middleware: Found User ${user._id} (${user.email}), linking to Employee...`);
      } else {
        console.log(`🔐 Auth Middleware: User ${decoded.id} not found.`);
      }

      if (user) {
        // SELF-HEALING: Fix null role if token has valid role
        if ((!user.role || user.role === 'null') && decoded.role) {
          console.log(`🔧 Auth Middleware: Auto-fixing null role for user ${user._id} to ${decoded.role} (Source: Token)`);
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
            employee = await Employee.findOne({ email: user.email });

            if (!employee) {
              console.warn(`⚠️ Auth Middleware: Link broken! User ${user.email} has no Employee match.`);

              // EMERGENCY FALLBACK: Try to find by Name
              const potentialMatch = await Employee.findOne({ empName: user.name });

              if (potentialMatch) {
                console.log(`🔧 Auto-Link: Found Employee ${potentialMatch.empId} by name "${user.name}". Syncing emails...`);
                user.email = potentialMatch.email;
                await user.save();
                employee = potentialMatch;
              } else {
                // FIX: Auto-create Employee Record if missing (Fixes broken link issue)
                console.log(`📝 Auth Middleware: Creating missing Employee record for ${user.email}`);
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
                  console.log(`✅ Auto-created Employee record: ${employee.empId}`);
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
      console.log('⛔ Auth Middleware: Final check failed - Profile not found');
      return res.status(401).json({ message: 'User or Employee profile not found' });
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

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }

    return res.status(401).json({ message: 'Not authorized' });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authorized" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: `User role ${req.user.role} is not authorized` });
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
    return res.status(401).json({
      success: false,
      message: 'No admin token, authorization denied'
    });
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
        message: 'Access denied: Admin role required'
      });
    }

    req.user = decoded.user || decoded;
    req.admin = { ...req.user, permissions: ['read', 'write', 'delete'] };
    next();
  } catch (err) {
    console.error("Admin Auth Error:", err.message);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

/* ============================
   USER AUTH (Legacy Alias)
============================ */
export const userAuth = protect;

export default { protect, authorize, adminAuth, userAuth };