import { Joi, objectId, isoDate } from './common.js';

/**
 * Employee payments (/api/payments).
 *
 * `:empId` is the numeric empId or the Employee ObjectId; `:id` is a payment's
 * numeric paymentId or its Mongo _id (the receipt / issue buttons send _id).
 */

export const PAYMENT_STATUSES = ['completed', 'pending', 'processing', 'cancelled', 'refunded', 'failed'];
export const ISSUE_CATEGORIES = ['amount_incorrect', 'payment_not_received', 'commission_dispute', 'duplicate_payment', 'wrong_details', 'other'];
export const TIME_FILTERS = ['all', 'today', 'week', 'month', 'quarter', 'year'];

/** Largest single withdrawal / payment we accept (₹10 lakh). */
export const MAX_AMOUNT = 1_000_000;

const numericString = Joi.string().trim().pattern(/^\d{1,12}$/);

export const empIdParams = Joi.object({
    empId: Joi.alternatives().try(numericString, objectId()).required().label('Employee ID')
        .messages({ 'alternatives.match': 'Invalid employee ID format' })
});

export const paymentIdParams = Joi.object({
    id: Joi.alternatives().try(numericString, objectId()).required().label('Payment ID')
        .messages({ 'alternatives.match': 'Invalid payment ID format' })
});

/** A positive rupee amount with at most 2 decimals. */
const amount = (label) => Joi.number().positive().max(MAX_AMOUNT).label(label)
    .custom((value, helpers) =>
        Math.abs(value * 100 - Math.round(value * 100)) > 1e-6 ? helpers.error('number.paise') : value)
    .messages({ 'number.paise': '{{#label}} can have at most 2 decimal places' });
const nonNegative = (label) => Joi.number().min(0).max(MAX_AMOUNT).label(label)
    .messages({ 'number.min': '{{#label}} cannot be negative' });

const statusFilter = Joi.string().trim().lowercase().valid('all', ...PAYMENT_STATUSES).allow('', null).label('Status filter');
const timeFilter = Joi.string().trim().lowercase().valid(...TIME_FILTERS).allow('', null).label('Time filter');

/** GET /employee/:empId/dashboard */
export const dashboardQuery = Joi.object({
    timeRange: timeFilter.label('Time range'),
    status: statusFilter.label('Status')
});

/** GET /employee/:empId/filter */
export const filterQuery = Joi.object({ timeFilter, statusFilter });

/** GET /employee/:empId/statistics */
export const statisticsQuery = Joi.object({
    period: Joi.string().trim().lowercase().valid('week', 'month', 'quarter', 'year').label('Period')
});

/** GET /employee/:empId/export — an explicit range must run forwards. */
export const exportQuery = Joi.object({
    format: Joi.string().trim().lowercase().valid('json', 'csv', 'pdf').label('Format'),
    startDate: isoDate().allow('', null).label('Start date'),
    endDate: isoDate().allow('', null).label('End date')
        .when('startDate', {
            is: isoDate().required(),
            then: Joi.date().min(Joi.ref('startDate'))
                .messages({ 'date.min': 'End date cannot be before the start date' })
        }),
    timeFilter,
    statusFilter
});

/**
 * Saved payout method. Bank accounts need an account number and IFSC; for UPI
 * the frontend sends the UPI ID in `accountNumber` (and copies it to `upiId`).
 */
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
const UPI_ID = /^[\w.-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
const BANK_ACCOUNT = /^\d{9,18}$/;

export const paymentMethodBody = Joi.object({
    type: Joi.string().trim().lowercase().valid('bank', 'upi').required().label('Method type')
        .messages({ 'any.only': 'Method type must be bank or upi' }),
    accountHolder: Joi.string().trim().min(2).max(100).required().label('Account holder name'),
    accountNumber: Joi.when('type', {
        is: 'upi',
        then: Joi.string().trim().pattern(UPI_ID).required().label('UPI ID')
            .messages({ 'string.pattern.base': 'Enter a valid UPI ID (e.g. name@bank)' }),
        otherwise: Joi.string().trim().pattern(BANK_ACCOUNT).required().label('Account number')
            .messages({ 'string.pattern.base': 'Account number must be 9 to 18 digits' })
    }),
    ifsc: Joi.when('type', {
        is: 'bank',
        then: Joi.string().trim().pattern(IFSC).required().label('IFSC code')
            .messages({ 'string.pattern.base': 'Enter a valid 11-character IFSC code (e.g. HDFC0001234)' }),
        otherwise: Joi.string().trim().allow('', null)
    }),
    bankName: Joi.string().trim().max(100).allow('', null),
    upiId: Joi.string().trim().max(320).allow('', null)
});

/**
 * POST /employee/:empId/withdraw. `methodData` is the saved method the employee
 * picked (or the UI's { type: 'bank_transfer', accountHolder } fallback), so
 * only its type is enforced here.
 */
export const withdrawalBody = Joi.object({
    amount: amount('Amount').required(),
    methodData: Joi.object({
        type: Joi.string().trim().lowercase().valid('bank', 'bank_transfer', 'upi').required().label('Payment method type')
            .messages({ 'any.only': 'Select a bank account or UPI ID to withdraw to' })
    }).required().unknown(true).label('Payment method')
        .messages({ 'any.required': 'Select a bank account or UPI ID to withdraw to' })
});

/** POST /:id/report-issue */
export const reportIssueBody = Joi.object({
    category: Joi.string().trim().valid(...ISSUE_CATEGORIES).allow('', null).label('Issue type'),
    description: Joi.string().trim().min(1).max(2000).required()
        .messages({ 'any.required': 'Please describe the issue.', 'string.empty': 'Please describe the issue.' })
});

/** POST / — record a payment for a completed service (admin). */
export const createPaymentBody = Joi.object({
    empId: Joi.alternatives().try(Joi.number().integer().min(1), numericString).required().label('Employee ID')
        .messages({ 'alternatives.match': 'Employee ID must be a number' }),
    serviceId: Joi.alternatives().try(Joi.number().integer().min(0), Joi.string().trim().min(1).max(64)).required().label('Service ID'),
    amount: amount('Amount').required(),
    commission: nonNegative('Commission').required(),
    baseRate: nonNegative('Base rate').required(),
    bonus: nonNegative('Bonus').allow('', null),
    hours: Joi.number().min(0).max(24 * 31).required().label('Hours'),
    paymentMethod: Joi.string().trim().min(2).max(50).required().label('Payment method'),
    serviceType: Joi.string().trim().min(1).max(100).required().label('Service type'),
    customer: Joi.object({
        name: Joi.string().trim().max(100).allow('', null),
        email: Joi.string().trim().max(254).allow('', null),
        phone: Joi.string().trim().max(20).allow('', null),
        address: Joi.string().trim().max(500).allow('', null)
    }).unknown(true).allow(null)
});

/** PATCH /:id/status (admin) */
export const updateStatusBody = Joi.object({
    status: Joi.string().trim().lowercase().valid(...PAYMENT_STATUSES).required().label('Status')
});

export default {
    empIdParams, paymentIdParams, dashboardQuery, filterQuery, statisticsQuery, exportQuery,
    paymentMethodBody, withdrawalBody, reportIssueBody, createPaymentBody, updateStatusBody
};
