import { Joi, objectId, numericId, pincode } from './common.js';

/**
 * Location masters (country / state / city / area).
 *
 * Country, state and city are keyed by numeric auto-increment ids
 * (countryId / stateId / cityId), which the admin screens send either as
 * numbers or as numeric strings from <select> values — Joi converts both.
 * Areas are keyed by Mongo _id and store their parents as plain strings.
 */

const placeName = (label) => Joi.string().trim().min(1).max(100).label(label);

/** `:id` for country / state / city routes (numeric auto-increment id). */
export const numericIdParams = Joi.object({
    id: numericId().required().label('ID')
        .messages({ 'number.base': 'Invalid ID format', 'number.integer': 'Invalid ID format', 'number.min': 'Invalid ID format' })
});

/** `:id` for area routes (Mongo ObjectId). */
export const areaIdParams = Joi.object({
    id: objectId().required().label('ID').messages({ 'string.pattern.base': 'Invalid ID format' })
});

export const country = Joi.object({
    name: placeName('Country name').required()
});

export const state = Joi.object({
    name: placeName('State name').required(),
    countryId: numericId().required().label('Country')
        .messages({ 'number.base': 'Please select a valid country' })
});

export const city = Joi.object({
    name: placeName('City name').required(),
    stateId: numericId().required().label('State')
        .messages({ 'number.base': 'Please select a valid state' }),
    // Sent by the UI but not stored on the city (it derives from the state).
    countryId: numericId().allow('', null).label('Country')
});

export const area = Joi.object({
    areaName: placeName('Area name').required(),
    city: placeName('City').required(),
    state: placeName('State').required(),
    country: placeName('Country').required(),
    pincode: pincode().allow('', null).label('PIN code')
        .messages({ 'string.pattern.base': 'PIN code must contain only digits (4-10 digits)' }),
    description: Joi.string().trim().max(500).allow('', null).label('Description')
});

/** Case-insensitive exact-match regex for a user-supplied name (special characters escaped). */
export const exactName = (value) =>
    new RegExp(`^${String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

export default { numericIdParams, areaIdParams, country, state, city, area, exactName };
