import { Joi, objectId, anyId, isoDate, timeSlot, money } from './common.js';

/**
 * Employee schedule (/api/schedule).
 *
 * Action routes take either a booking's Mongo _id, its human bookingId
 * ("BK-…") or a legacy Service's numeric serviceId, so `:id` is not
 * restricted to ObjectIds.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every status the booking/service flows use (any case). */
export const SCHEDULE_STATUSES = [
    'pending', 'confirmed', 'assigned', 'scheduled', 'accepted', 'navigating', 'en_route',
    'started', 'in_progress', 'in progress', 'current', 'completed', 'cancelled', 'canceled',
    'rejected', 'rescheduled'
];

/** `:id` on action routes. */
export const actionParams = Joi.object({
    id: anyId().required().label('Service ID')
});

/** Legacy `/employee/:empId…` routes: numeric empId or Employee ObjectId. */
export const empIdParams = Joi.object({
    empId: Joi.alternatives()
        .try(Joi.string().trim().pattern(/^\d{1,12}$/), objectId())
        .required()
        .label('Employee ID')
        .messages({ 'alternatives.match': 'Invalid employee ID format' })
});

const optionalBool = Joi.boolean().allow('', null);

/** GET /api/schedule (and /day, /week, /month, …) */
export const listQuery = Joi.object({
    view: Joi.string().trim().lowercase().valid('agenda', 'day', 'week', 'month', 'list', 'all').allow('', null).label('View'),
    date: isoDate().allow('', null).label('Date'),
    dateFilter: Joi.string().trim().lowercase().valid('all', 'today', 'week', 'month').allow('', null).label('Date filter'),
    includeCompleted: optionalBool.label('Include completed')
});

/** PATCH /:id/status */
export const statusBody = Joi.object({
    status: Joi.string().trim().valid(...SCHEDULE_STATUSES).insensitive().required()
        .messages({ 'any.only': 'Status must be a valid service status' }),
    notes: Joi.string().max(2000).allow('', null),
    actualEarnings: money().allow('', null)
        .messages({ 'number.min': 'Actual earnings cannot be negative' })
});

/** PATCH /:id/start — the dashboard sends the client's start time. */
export const startBody = Joi.object({
    startTime: isoDate().allow('', null).label('Start time')
});

/** PATCH /:id/complete */
export const completeBody = Joi.object({
    notes: Joi.string().max(2000).allow('', null),
    actualEarnings: money().allow('', null)
        .messages({ 'number.min': 'Actual earnings cannot be negative' })
});

/** PATCH /:id/reschedule — the new date may not be in the past (one day of timezone slack). */
export const rescheduleBody = Joi.object({
    scheduledDate: isoDate().required().label('New date')
        .custom((value, helpers) => {
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            if (value.getTime() < today.getTime() - DAY_MS) return helpers.error('date.past');
            return value;
        })
        .messages({ 'date.past': 'New date cannot be in the past' }),
    time: timeSlot().allow('', null).label('Time slot')
});

export default { actionParams, empIdParams, listQuery, statusBody, startBody, completeBody, rescheduleBody };
