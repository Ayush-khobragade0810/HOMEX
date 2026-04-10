import express from 'express';
import dns from 'dns';
import dotenv from 'dotenv';
// Load environment variables immediately
dotenv.config();

// CRITICAL: Force use of Google DNS to bypass local SRV resolution failures
dns.setServers(['8.8.8.8', '8.8.4.4']);

import cors from 'cors';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss-clean';
import hpp from 'hpp';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import path from 'path';
import { fileURLToPath } from 'url';

// Import configs and utils
import logger from './utils/logger.js';
import socketService from './socket/socketService.js';

// Import routes
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import bookingRoutes from './routes/booking.js';
import adminBookingRoutes from './routes/admin/bookings.js';
import adminRoutes from './routes/adminRoutes.js';
import adminEmployeeRoutes from './routes/adminEmployeeRoutes.js';
import serviceRoutes from './routes/serviceRoutes.js';
import serviceActionRoutes from './routes/serviceActionRoutes.js';
import countryRoutes from './routes/countryRoutes.js';
import stateRoutes from './routes/stateRoutes.js';
import cityRoutes from './routes/cityRoute.js';
import areaRoutes from './routes/areaRoute.js';
import debugRoutes from './routes/debug.js';
import testRoutes from './routes/test.js';
import notificationRoutes from './routes/notificationRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';

// Constants and App Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 5000;

const app = express();
const httpServer = createServer(app);

// CORS Configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(base => base.replace(/^["']|["']$/g, '').trim())
  : ["http://localhost:5173", "http://localhost:3000", "https://homex.net.in"];

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
    allowedHeaders: ["Authorization"]
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  family: 4
})
  .then(() => logger.info('MongoDB Connected'))
  .catch((err) => {
    logger.error('MongoDB connection failed', err);
    process.exit(1);
  });

// Setup Socket Service
socketService.init(io);

// 1. GLOBAL MIDDLEWARE
app.set('trust proxy', 1);
app.use(compression());

// Handle CORS
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const isRenderDomain = origin.endsWith('.onrender.com');
    const isWhitelisted = allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*');

    if (isWhitelisted || isRenderDomain) {
      callback(null, true);
    } else {
      console.warn(`🚦 [CORS REJECTED]: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Security Headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://ui-avatars.com"],
      imgSrc: ["'self'", "data:", "https:", "https://res.cloudinary.com", "https://ui-avatars.com"],
      connectSrc: ["'self'", "https://homex-1.onrender.com", "http://localhost:5000", "http://localhost:5173", "wss://homex-1.onrender.com"]
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xContentTypeOptions: true,
  xFrameOptions: { action: 'deny' },
  dnsPrefetchControl: { allow: false }
}));

// HSTS headers
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// app.use(xss());
// app.use(hpp()); // <-- Disabled as requested to prevent query parameter conflicts

// Cookie and Body Parsing
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Custom MongoDB Sanitizer (Body and Params only)
// app.use((req, res, next) => {
//   if (req.body) mongoSanitize.sanitize(req.body);
//   if (req.params) mongoSanitize.sanitize(req.params);
//   // DO NOT touch req.query
//   next();
// });

// app.use(mongoSanitize());

// app.use(mongoSanitize({
//   allowDots: true,
//   replaceWith: '_',
// }));

// CSRF Utility Setup
const csrfProtection = csrf({ cookie: true });

// Static Files & Logging
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(logger.requestLogger);

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// 2. DEBUG MIDDLEWARE
app.use((req, res, next) => {
  console.log(`📨 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  console.log('   Headers:', req.headers['authorization'] ? 'Has Auth' : 'No Auth');
  next();
});

// 3. ROUTES
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  try {
    const token = req.csrfToken();
    res.json({ csrfToken: token });
  } catch (err) {
    logger.error('CSRF Token generation failed:', err);
    res.status(500).json({ success: false, message: 'Failed to generate CSRF token' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);
app.use('/api/test', testRoutes);
app.use('/api/user', userRoutes);
app.use('/api/my-bookings', userRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminBookingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/employees', adminEmployeeRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/service-actions', serviceActionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/countries', countryRoutes);
app.use('/api/states', stateRoutes);
app.use('/api/cities', cityRoutes);
app.use('/api/areas', areaRoutes);
app.use('/api/debug', debugRoutes);

// Health Checks
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date()
  });
});

app.get('/api/ws-health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    connections: socketService.getConnectionCount()
  });
});

// 4. ERROR HANDLING
app.use('/api', (req, res) => {
  console.warn(`⚠️  [404 NOT FOUND] ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: `API Route not found: ${req.originalUrl}`,
    hint: 'Check if the prefix /api is being correctly handled by your proxy.'
  });
});

app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  const statusCode = err.statusCode || 500;
  const isDev = process.env.NODE_ENV === 'development';
  const response = {
    success: false,
    message: err.message || 'Internal Server Error'
  };
  if (isDev) {
    response.stack = err.stack;
    logger.error(err);
  } else {
    logger.error({
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method
    }, 'Unhandled Server Error');
  }
  res.status(statusCode).json(response);
});

// 5. START SERVER
const serverListener = httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`Backend ready on port ${PORT}`);

  const printRoutes = () => {
    try {
      if (!app._router || !app._router.stack) return;
      console.log('\n📋 REGISTERED ROUTES:');
      console.log('====================');
      app._router.stack.forEach((middleware) => {
        if (middleware.route) {
          const methods = Object.keys(middleware.route.methods).join(', ').toUpperCase();
          console.log(`${methods.padEnd(7)} ${middleware.route.path}`);
        } else if (middleware.name === 'router' && middleware.handle && middleware.handle.stack) {
          const prefix = middleware.regexp.toString()
            .replace('/^\\', '')
            .replace('\\/?(?=\\/|$)/i', '')
            .replace('\\/', '/');

          middleware.handle.stack.forEach((handler) => {
            if (handler.route) {
              const route = handler.route;
              const methods = Object.keys(route.methods).join(', ').toUpperCase();
              console.log(`${methods.padEnd(7)} ${prefix}${route.path}`);
            }
          });
        }
      });
      console.log('====================\n');
    } catch (err) {
      console.warn('⚠️ Could not print registered routes:', err.message);
    }
  };
  printRoutes();
});

// Server Timeouts
serverListener.timeout = 120000;
serverListener.keepAliveTimeout = 65000;
serverListener.headersTimeout = 61000;

// Process Error Handlers
process.on('unhandledRejection', (err) => {
  logger.error({ err: err.message, stack: err.stack }, '🔴 Unhandled Rejection! Shutting down gracefully...');
  if (process.env.NODE_ENV === 'production') {
    setTimeout(() => process.exit(1), 1000);
  }
});

process.on('uncaughtException', (err) => {
  logger.error({ err: err.message, stack: err.stack }, '🔴 Uncaught Exception! Shutting down gracefully...');
  setTimeout(() => process.exit(1), 1000);
});
