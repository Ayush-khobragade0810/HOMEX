import Joi from 'joi';

// Auth Schemas
export const authSchemas = {
    signup: Joi.object({
        name: Joi.string().min(2).max(50).required(),
        email: Joi.string().email().required(),
        password: Joi.string().min(6).required(),
        phone: Joi.string().pattern(/^[0-9]{10,15}$/).optional(),
        role: Joi.string().valid('user', 'admin', 'employee').required(),
        countryId: Joi.number().optional(),
        stateId: Joi.number().optional(),
        cityId: Joi.number().optional(),
        areaId: Joi.number().optional()
    }),
    login: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().required()
    }),
    changePassword: Joi.object({
        currentPassword: Joi.string().required(),
        newPassword: Joi.string().min(6).required(),
        confirmPassword: Joi.string().valid(Joi.ref('newPassword')).optional()
    })
};

// Booking Schemas live in validators/booking.js; re-exported here so existing
// imports of `bookingSchemas` from this file keep working.
export { bookingSchemas } from '../validators/booking.js';

// Extra Service Schemas (additional charges added during an appointment)
const extraServiceLine = {
    name: Joi.string().trim().min(1).max(120),
    quantity: Joi.number().integer().min(1),
    unitPrice: Joi.number().min(0),
    price: Joi.number().min(0), // accepted alias for unitPrice
    notes: Joi.string().allow('').max(500)
};

export const extraServiceSchemas = {
    // Charges must be >= 0 and a name is mandatory.
    // NOTE: the quantity default lives here (not on the shared line) so that an
    // empty update body stays empty and is correctly rejected by `.min(1)`.
    create: Joi.object({
        ...extraServiceLine,
        name: extraServiceLine.name.required(),
        quantity: extraServiceLine.quantity.default(1)
    }).or('unitPrice', 'price'),

    // Partial update — at least one field must be supplied.
    update: Joi.object({ ...extraServiceLine }).min(1)
};
