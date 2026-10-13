import { Joi, objectId } from './common.js';

/**
 * Employee subscriptions (/api/subscription).
 *
 * The employee's payment report (POST /me/request) is validated by
 * validatePaymentRequest in utils/subscription.js, because the subscription
 * page expects its `errors` as an object keyed by field name.
 */

export const SUBSCRIPTION_STATES = ['all', 'pending', 'active', 'low_balance', 'none', 'rejected'];

export const employeeIdParams = Joi.object({
    employeeId: objectId().required().label('Employee ID')
        .messages({ 'string.pattern.base': 'Invalid employee ID' })
});

/** GET /admin/requests */
export const listQuery = Joi.object({
    state: Joi.string().trim().lowercase().valid(...SUBSCRIPTION_STATES).allow('').label('State')
});

/** GET /me/ledger and /admin/:employeeId/ledger */
export const ledgerQuery = Joi.object({
    page: Joi.number().integer().min(1).label('Page'),
    limit: Joi.number().integer().min(1).max(100).label('Limit')
});

/** PUT /admin/:employeeId/reject */
export const rejectBody = Joi.object({
    reason: Joi.string().trim().min(3).max(300).required().label('Reason')
        .messages({
            'any.required': 'Give the employee a reason so they can fix it',
            'string.empty': 'Give the employee a reason so they can fix it',
            'string.min': 'Give the employee a reason so they know what to fix'
        })
});

export default { employeeIdParams, listQuery, ledgerQuery, rejectBody };
