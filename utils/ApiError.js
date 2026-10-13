/**
 * An error carrying the HTTP status (and optional machine-readable code and
 * per-field errors) the global error handler should respond with.
 *
 * Express 5 forwards errors thrown in async handlers to the error handler, so
 * a controller can simply `throw ApiError.notFound('Booking not found')`.
 */
export class ApiError extends Error {
    constructor(statusCode, message, { code, errors, details } = {}) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.isOperational = true;
        if (code) this.code = code;
        if (errors) this.errors = errors;
        if (details) this.details = details;
    }

    static badRequest(message = 'Bad request', opts) { return new ApiError(400, message, opts); }
    static validation(errors, message = 'Validation failed') {
        return new ApiError(400, message, { code: 'VALIDATION_ERROR', errors });
    }
    static unauthorized(message = 'Authentication required', opts) { return new ApiError(401, message, opts); }
    static paymentRequired(message = 'Payment required', opts) { return new ApiError(402, message, opts); }
    static forbidden(message = 'You do not have permission to perform this action', opts) { return new ApiError(403, message, opts); }
    static notFound(message = 'Resource not found', opts) { return new ApiError(404, message, opts); }
    static conflict(message = 'Resource already exists', opts) { return new ApiError(409, message, opts); }
    static unprocessable(message = 'Request could not be processed', opts) { return new ApiError(422, message, opts); }
    static tooMany(message = 'Too many requests, please try again later', opts) { return new ApiError(429, message, opts); }
    static internal(message = 'Something went wrong. Please try again later.', opts) { return new ApiError(500, message, opts); }
}

/**
 * Sends a JSON error in the project's standard shape. `error` mirrors `message`
 * because parts of the frontend read one and parts read the other.
 */
export const sendError = (res, statusCode, message, extra = {}) =>
    res.status(statusCode).json({ success: false, message, error: message, ...extra });

export default ApiError;
