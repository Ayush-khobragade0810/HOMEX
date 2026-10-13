import { Joi, objectId } from './common.js';

/** Notifications (/api/notifications). */

export const notificationIdParams = Joi.object({
    id: objectId().required().label('Notification ID')
        .messages({ 'string.pattern.base': 'Invalid notification ID' })
});

export default { notificationIdParams };
