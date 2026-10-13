import logger from '../utils/logger.js';

const isProduction = process.env.NODE_ENV === 'production';

const humanize = (field = '') =>
    String(field)
        .split('.').pop()
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/^\w/, c => c.toUpperCase());

/**
 * Maps any error to `{ status, body }` in the standard response shape:
 * { success: false, message, error, code?, errors?: [{ field, message }] }
 */
const normalize = (err) => {
    // Our own errors already carry status, code and field errors.
    if (err.isOperational || err.name === 'ApiError') {
        return {
            status: err.statusCode,
            message: err.message,
            code: err.code,
            errors: err.errors,
            details: err.details
        };
    }

    // Joi validation error thrown directly (e.g. schema.validateAsync).
    if (err.isJoi) {
        return {
            status: 400,
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            errors: err.details.map(d => ({ field: d.path.join('.'), message: d.message.replace(/["]/g, '') }))
        };
    }

    // Mongoose: a value could not be cast, e.g. a malformed ObjectId.
    if (err.name === 'CastError') {
        return {
            status: 400,
            message: err.kind === 'ObjectId'
                ? `Invalid ${humanize(err.path)} format`
                : `Invalid value for ${humanize(err.path)}`,
            code: 'INVALID_ID'
        };
    }

    // Mongoose schema validation.
    if (err.name === 'ValidationError' && err.errors) {
        const errors = Object.values(err.errors).map(e => ({
            field: e.path,
            message: e.kind === 'required'
                ? `${humanize(e.path)} is required`
                : e.name === 'CastError'
                    ? `${humanize(e.path)} has an invalid value`
                    : e.message
        }));
        return { status: 400, message: errors[0]?.message || 'Validation failed', code: 'VALIDATION_ERROR', errors };
    }

    // Mongo duplicate key.
    if (err.code === 11000 || err.code === 11001) {
        const field = Object.keys(err.keyValue || err.keyPattern || {})[0];
        const message = field
            ? `${humanize(field)} already exists`
            : 'A record with these details already exists';
        return { status: 409, message, code: 'DUPLICATE', errors: field ? [{ field, message }] : undefined };
    }

    // JWT errors (when a token is verified outside the auth middleware).
    if (err.name === 'TokenExpiredError') return { status: 401, message: 'Your session has expired. Please log in again.', code: 'TOKEN_EXPIRED' };
    if (err.name === 'JsonWebTokenError' || err.name === 'UnauthorizedError') return { status: 401, message: 'Invalid authentication token', code: 'INVALID_TOKEN' };

    // CSRF — the frontend retries with a fresh token on this exact code.
    if (err.code === 'EBADCSRFTOKEN') return { status: 403, message: 'Invalid CSRF token', code: 'CSRF_ERROR' };

    // body-parser
    if (err.type === 'entity.parse.failed') return { status: 400, message: 'Malformed JSON in request body', code: 'INVALID_JSON' };
    if (err.type === 'entity.too.large') return { status: 413, message: 'Request body is too large', code: 'PAYLOAD_TOO_LARGE' };

    // Multer uploads
    if (err.name === 'MulterError') {
        if (err.code === 'LIMIT_FILE_SIZE') return { status: 413, message: 'File is too large. Maximum size is 5MB.', code: 'FILE_TOO_LARGE' };
        if (err.code === 'LIMIT_UNEXPECTED_FILE') return { status: 400, message: `Unexpected file field "${err.field}"`, code: 'UPLOAD_ERROR' };
        return { status: 400, message: err.message, code: 'UPLOAD_ERROR' };
    }

    // Plain errors that were given a client status by the code that threw them.
    const status = Number(err.statusCode || err.status);
    if (status >= 400 && status < 500) return { status, message: err.message, code: err.code };

    return {
        status: status >= 500 && status < 600 ? status : 500,
        message: isProduction ? 'Something went wrong. Please try again later.' : (err.message || 'Internal server error'),
        code: 'INTERNAL_ERROR'
    };
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
    if (res.headersSent) return next(err);

    const { status, message, code, errors, details } = normalize(err);

    // 4xx responses are already logged by the request logger.
    if (status >= 500) {
        logger.error({ message: err.message, stack: err.stack, path: req.originalUrl, method: req.method }, 'Unhandled Server Error');
    }

    const body = { success: false, message, error: message };
    if (code) body.code = code;
    if (errors?.length) body.errors = errors;
    if (details) body.details = details;
    if (!isProduction && status >= 500) body.stack = err.stack;

    res.status(status).json(body);
};

/** 404 for unknown API routes. */
export const notFoundHandler = (req, res) => {
    const message = `Route not found: ${req.method} ${req.originalUrl}`;
    res.status(404).json({ success: false, message, error: message, code: 'ROUTE_NOT_FOUND' });
};

export default errorHandler;
