import BaseJoi from 'joi';

/**
 * Human-readable default messages for every schema built from this Joi
 * instance. `{{#label}}` is the field name; the validate middleware turns an
 * un-labelled key such as `contactInfo.phoneNumber` into "Phone number".
 */
const messages = {
    'any.required': '{{#label}} is required',
    'any.only': '{{#label}} must be one of: {{#valids}}',
    'any.invalid': '{{#label}} has an invalid value',
    'any.unknown': '{{#label}} is not allowed',
    'string.base': '{{#label}} must be text',
    'string.empty': '{{#label}} cannot be empty',
    'string.min': '{{#label}} must be at least {{#limit}} characters long',
    'string.max': '{{#label}} must be at most {{#limit}} characters long',
    'string.length': '{{#label}} must be exactly {{#limit}} characters long',
    'string.email': '{{#label}} must be a valid email address',
    'string.pattern.base': '{{#label}} is in an invalid format',
    'string.hex': '{{#label}} must be a valid ID',
    'string.uri': '{{#label}} must be a valid URL',
    'string.isoDate': '{{#label}} must be a valid date (YYYY-MM-DD)',
    'number.base': '{{#label}} must be a number',
    'number.integer': '{{#label}} must be a whole number',
    'number.min': '{{#label}} must be at least {{#limit}}',
    'number.max': '{{#label}} must be at most {{#limit}}',
    'number.positive': '{{#label}} must be greater than 0',
    'number.unsafe': '{{#label}} is too large',
    'boolean.base': '{{#label}} must be true or false',
    'date.base': '{{#label}} must be a valid date',
    'date.format': '{{#label}} must be a valid date (YYYY-MM-DD)',
    'date.min': '{{#label}} cannot be earlier than {{#limit}}',
    'date.max': '{{#label}} cannot be later than {{#limit}}',
    'array.base': '{{#label}} must be a list',
    'array.min': '{{#label}} must contain at least {{#limit}} item(s)',
    'array.max': '{{#label}} must contain at most {{#limit}} item(s)',
    'array.includesRequiredUnknowns': '{{#label}} is missing required items',
    'object.base': '{{#label}} must be an object',
    'object.min': 'Provide at least one field to update',
    'object.missing': 'At least one of {{#peers}} is required',
    'object.and': '{{#presentWithLabels}} must be provided together with {{#missingWithLabels}}',
    'object.xor': 'Provide only one of {{#peers}}',
    'alternatives.match': '{{#label}} has an invalid value',
    'alternatives.types': '{{#label}} has an invalid value'
};

export const Joi = BaseJoi.defaults(schema => schema.prefs({ messages }));

/* ------------------------------------------------------------------ */
/* Reusable field rules                                                */
/* ------------------------------------------------------------------ */

const OBJECT_ID = /^[a-f\d]{24}$/i;

/** A MongoDB ObjectId string. */
export const objectId = () =>
    Joi.string().trim().pattern(OBJECT_ID).messages({ 'string.pattern.base': '{{#label}} must be a valid ID' });

/** An id that may be either an ObjectId or a human booking/service reference like "BK-1234". */
export const anyId = () => Joi.string().trim().min(1).max(64);

export const email = () => Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254);

/** 10-digit mobile number — the format the User model stores. */
export const phone = () =>
    Joi.string().trim().pattern(/^[0-9]{10}$/)
        .messages({ 'string.pattern.base': '{{#label}} must be a valid 10-digit phone number' });

/** Phone number that may include a country code, spaces or dashes. */
export const phoneLoose = () =>
    Joi.string().trim().pattern(/^\+?[0-9][0-9\s-]{8,16}[0-9]$/)
        .messages({ 'string.pattern.base': '{{#label}} must be a valid phone number' });

export const password = () =>
    Joi.string().min(6).max(128).messages({ 'string.min': '{{#label}} must be at least 6 characters long' });

export const personName = () => Joi.string().trim().min(2).max(50);

export const pincode = () =>
    Joi.string().trim().pattern(/^[0-9]{4,10}$/).messages({ 'string.pattern.base': '{{#label}} must be a valid PIN code' });

/** A calendar date, as an ISO string (YYYY-MM-DD or full ISO timestamp). */
export const isoDate = () => Joi.date().iso();

/** "09:00 AM", "9:00 am", "14:30", or a range like "09:00 AM - 10:00 AM". */
export const timeSlot = () => Joi.string().trim().min(3).max(40);

export const money = () => Joi.number().min(0).max(10_000_000);

/** Numeric (auto-increment) ids used by the location masters and empId. */
export const numericId = () => Joi.number().integer().min(0);

export const pagination = {
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(1000)
};

/** `{ id }` params schema. */
export const idParam = (name = 'id') => Joi.object({ [name]: objectId().required() });

export default Joi;
