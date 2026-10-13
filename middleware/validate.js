import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';

const JOI_OPTIONS = {
    abortEarly: false,     // report every invalid field, not just the first
    allowUnknown: true,    // clients may send extra fields; controllers pick what they use
    errors: { wrap: { label: false } }
};

// "contactInfo.phoneNumber" -> "Phone number"
const humanize = (key) =>
    String(key)
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .toLowerCase()
        .replace(/^\w/, c => c.toUpperCase());

const messageFor = (d) => {
    const path = d.path.join('.');
    const label = d.context?.label;
    // No explicit .label(): Joi used the raw path, so swap in a readable name.
    // Only the leading label is replaced, so a custom message that merely
    // contains the key ("Invalid payment ID" for key `id`) is left intact.
    if (label && label === path && d.message.startsWith(label)) {
        const last = [...d.path].reverse().find(p => typeof p === 'string') || path;
        return humanize(last) + d.message.slice(label.length);
    }
    return d.message;
};

const toFieldErrors = (error) => {
    const seen = new Set();
    return error.details
        .map(d => ({ field: d.path.join('.') || d.context?.key || 'value', message: messageFor(d) }))
        // Alternatives can report the same field more than once.
        .filter(e => (seen.has(e.field) ? false : seen.add(e.field)));
};

const run = (schema, data) => {
    const { error } = schema.validate(data ?? {}, JOI_OPTIONS);
    return error ? toFieldErrors(error) : null;
};

/**
 * Validates any of req.body / req.query / req.params against Joi schemas and
 * responds 400 with `errors: [{ field, message }]` listing every problem.
 *
 * The request is not modified: controllers keep receiving exactly what the
 * client sent, so adding validation never changes their behaviour for valid
 * input.
 *
 *   router.post('/', validate({ body: schemas.create }), handler)
 */
export const validate = ({ body, query, params } = {}) => (req, res, next) => {
    const errors = [
        ...(params ? run(params, req.params) || [] : []),
        ...(query ? run(query, req.query) || [] : []),
        ...(body ? run(body, req.body) || [] : [])
    ];

    if (errors.length) {
        // Lead with the first problem so a single toast is still useful.
        return next(ApiError.validation(errors, errors[0].message));
    }
    next();
};

/** Backwards-compatible helpers. */
export const validateRequest = (schema) => (schema ? validate({ body: schema }) : (req, res, next) => next());
export const validateQuery = (schema) => (schema ? validate({ query: schema }) : (req, res, next) => next());
export const validateParams = (schema) => (schema ? validate({ params: schema }) : (req, res, next) => next());

/**
 * Rejects route params that are not valid Mongo ObjectIds with a 400, before
 * the controller turns them into a CastError or a misleading 404.
 *
 *   router.get('/:id', validateObjectId('id'), handler)
 */
export const validateObjectId = (...names) => (req, res, next) => {
    const params = names.length ? names : ['id'];
    const errors = params
        .filter(name => req.params[name] !== undefined && !mongoose.Types.ObjectId.isValid(req.params[name]))
        .map(name => ({ field: name, message: `Invalid ${name === 'id' ? 'ID' : name} format` }));

    if (errors.length) return next(ApiError.validation(errors, errors[0].message));
    next();
};

export default validate;
