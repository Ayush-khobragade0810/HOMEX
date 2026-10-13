import { Joi, objectId, email, phone, personName, pagination } from './common.js';

/* Request schemas for /api/user (also mounted at /api/my-bookings). */

/** A user id, or the alias "me" for the signed-in user. */
const userIdOrMe = () =>
    Joi.alternatives().try(objectId().messages({ 'string.pattern.base': 'Invalid user ID format' }), Joi.string().valid('me'))
        .label('User ID') // explicit label so the message is used verbatim
        .messages({ 'alternatives.match': 'Invalid user ID format' });

export const userIdParams = Joi.object({ id: userIdOrMe().required() });

export const notificationParams = Joi.object({
    userId: userIdOrMe().required(),
    notificationId: objectId().required().label('Notification ID')
        .messages({ 'string.pattern.base': 'Invalid notification ID format' })
});

/**
 * Profile update. Sent as multipart/form-data by the dashboard (avatar upload),
 * so every field arrives as a string and blank fields arrive as ''.
 */
export const updateProfile = Joi.object({
    name: personName().allow('').label('Name'),
    email: email().allow('').label('Email')
        .messages({ 'string.email': 'Please enter a valid email address' }),
    phone: phone().allow('', null).label('Mobile number')
        .messages({ 'string.pattern.base': 'Please enter a valid 10-digit mobile number' }),
    address: Joi.alternatives().try(Joi.string().max(500).allow(''), Joi.object()).label('Address'),
    // JSON body sends an object; multipart sends a JSON string.
    preferences: Joi.alternatives().try(Joi.object(), Joi.string().max(2000)).label('Preferences')
});

export const bookingsQuery = Joi.object({
    ...pagination,
    status: Joi.string().trim().max(30).allow(''),
    search: Joi.string().trim().max(100).allow('')
});

export const notificationsQuery = Joi.object({
    ...pagination,
    unreadOnly: Joi.boolean().truthy('true').falsy('false').label('Unread only')
});

export default { userIdParams, notificationParams, updateProfile, bookingsQuery, notificationsQuery };
