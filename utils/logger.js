import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create log directory if it doesn't exist
const logDir = path.join(__dirname, '../logs');

if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Development logger (pretty print)
const devLogger = pino({
    level: process.env.LOG_LEVEL || 'debug',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'SYS:standard',
            levelFirst: true
        }
    }
});

// Production logger (JSON format, file rotation)
const prodLogger = pino({
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
        level: (label) => ({ level: label.toUpperCase() })
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    base: {
        pid: process.pid,
        hostname: 'homax-server'
    }
}, pino.destination({
    dest: path.join(logDir, 'app.log'),
    sync: false,
    mkdir: true
}));

// Error file logger
const errorLogger = pino(pino.destination({
    dest: path.join(logDir, 'error.log'),
    sync: false,
    mkdir: true
}));

// Audit logger
const auditLogger = pino(pino.destination({
    dest: path.join(logDir, 'audit.log'),
    sync: false,
    mkdir: true
}));

// Socket logger
const socketLogger = pino(pino.destination({
    dest: path.join(logDir, 'socket.log'),
    sync: false,
    mkdir: true
}));

// Create main logger instance
const logger = process.env.NODE_ENV === 'production' ? prodLogger : devLogger;

// Helper methods for different log types
logger.errorWithContext = (context, message, error = null) => {
    const logData = {
        ...context,
        message,
        error: error ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: error.code
        } : null
    };

    logger.error(logData);
    errorLogger.error(logData);
};

logger.audit = (action, user, resource, details = {}) => {
    const auditData = {
        action,
        user: {
            id: user._id || user.id,
            role: user.role,
            email: user.email
        },
        resource,
        ...details,
        ip: details.ip || 'unknown',
        userAgent: details.userAgent || 'unknown',
        timestamp: new Date().toISOString()
    };

    auditLogger.info(auditData);
    logger.info(auditData, `Audit: ${action}`);
};

logger.socket = (event, socketData, additionalData = {}) => {
    const socketLog = {
        event,
        socketId: socketData.socketId,
        userId: socketData.userId,
        ...additionalData,
        timestamp: new Date().toISOString()
    };

    socketLogger.info(socketLog);
    logger.debug(socketLog, `Socket: ${event}`);
};

// Request logging middleware
logger.requestLogger = (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;

        const logData = {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            userId: req.user?._id || 'anonymous'
        };

        if (res.statusCode >= 400) {
            logger.warn(logData, 'Request completed with error');
        } else {
            logger.info(logData, 'Request completed');
        }
    });

    next();
};

export default logger;
