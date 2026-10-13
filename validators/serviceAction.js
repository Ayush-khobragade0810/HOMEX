import { Joi, objectId, anyId, money, numericId, timeSlot, pagination } from './common.js';

/**
 * Schemas for the employee job flow:
 *   /api/service-actions  (accept / confirm / start / complete / status / extras)
 *   /api/service-details  (details, notes, requirements)
 *   /api/services         (legacy numeric Service records)
 *
 * Job ids may be a booking ObjectId, a human bookingId ("BK-…") or a legacy
 * numeric Service id, so `:id` is only checked loosely (anyId).
 */

const optionalText = (max = 2000) => Joi.string().trim().allow('', null).max(max);
const optionalDate = () => Joi.date().allow('', null);

/* ------------------------------------------------------------------ */
/* Params                                                              */
/* ------------------------------------------------------------------ */

export const jobIdParams = Joi.object({ id: anyId().required().label('Service ID') });

/** Legacy Service records are addressed by their numeric serviceId. */
export const legacyServiceParams = Joi.object({
    id: numericId().required().label('Service ID')
});

export const extraServiceParams = Joi.object({
    id: anyId().required().label('Service ID'),
    extraId: objectId().required().label('Extra service ID')
});

export const serviceDetailParams = Joi.object({ serviceId: anyId().required().label('Service ID') });

export const noteIdParams = Joi.object({ noteId: numericId().required().label('Note ID') });

export const employeeParams = Joi.object({ empId: numericId().required().label('Employee ID') });

/* ------------------------------------------------------------------ */
/* Job status statuses                                                 */
/* ------------------------------------------------------------------ */

/** Statuses the generic status endpoint understands (any case). */
export const JOB_STATUSES = [
    'pending', 'scheduled', 'confirmed', 'assigned', 'accepted',
    'en_route', 'navigating', 'started', 'in_progress', 'current',
    'completed', 'cancelled', 'canceled', 'rejected', 'rescheduled'
];

/** Status values stored on legacy Service documents. */
export const SERVICE_STATUSES = ['assigned', 'scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled'];

/* ------------------------------------------------------------------ */
/* Extra services                                                      */
/* ------------------------------------------------------------------ */

const extraServiceLine = {
    name: Joi.string().trim().min(1).max(120).label('Service name'),
    quantity: Joi.number().integer().min(1),
    unitPrice: Joi.number().min(0).max(10_000_000).label('Charge'),
    price: Joi.number().min(0).max(10_000_000).label('Charge'), // accepted alias for unitPrice
    notes: Joi.string().allow('', null).max(500)
};

export const extraServiceSchemas = {
    create: Joi.object({
        ...extraServiceLine,
        name: extraServiceLine.name.required()
    }).or('unitPrice', 'price').messages({ 'object.missing': 'Charge is required' }),

    // Partial update — at least one field must be supplied.
    update: Joi.object({ ...extraServiceLine }).min(1)
};

/* ------------------------------------------------------------------ */
/* /api/service-actions                                                */
/* ------------------------------------------------------------------ */

export const serviceActionSchemas = {
    // accept / confirm — the dashboard sends {} or { notes }
    accept: Joi.object({ notes: optionalText() }),

    start: Joi.object({
        startTime: optionalDate().label('Start time'),
        notes: optionalText()
    }),

    // Sent by CompleteServiceModal: { actualEarnings, paymentMethod, notes,
    // extraServices: [{ name, quantity, unitPrice, notes }], completionTime }
    complete: Joi.object({
        actualEarnings: money().allow('', null).label('Amount collected'),
        paymentMethod: Joi.string().trim().allow('', null).max(40),
        notes: optionalText(),
        completionTime: optionalDate().label('Completion time'),
        extraServices: Joi.array().max(50).items(Joi.object({
            // Lines without a name are skipped by the controller.
            name: Joi.string().trim().allow('', null).max(120).label('Extra service name'),
            quantity: Joi.number().integer().min(1).allow('', null).label('Extra service quantity'),
            unitPrice: Joi.number().min(0).max(10_000_000).allow('', null).label('Extra service charge'),
            price: Joi.number().min(0).max(10_000_000).allow('', null).label('Extra service charge'),
            notes: Joi.string().allow('', null).max(500)
        })).label('Extra services')
    }),

    status: Joi.object({
        status: Joi.string().trim().insensitive().valid(...JOB_STATUSES).required()
            .messages({ 'any.only': 'Status must be one of: ' + JOB_STATUSES.join(', ') }),
        notes: optionalText()
    }),

    reschedule: Joi.object({
        scheduledDate: Joi.date().required().label('Date'),
        time: timeSlot().required().label('Time'),
        notes: optionalText()
    })
};

/* ------------------------------------------------------------------ */
/* /api/service-details                                                */
/* ------------------------------------------------------------------ */

export const serviceDetailSchemas = {
    addNote: Joi.object({
        note: Joi.string().trim().min(1).max(2000).required().label('Note')
            .messages({ 'string.empty': 'Note content is required', 'any.required': 'Note content is required' }),
        type: Joi.string().valid('general', 'customer_communication', 'technical', 'follow_up'),
        priority: Joi.string().valid('low', 'medium', 'high')
    }),

    requirements: Joi.object({
        requirements: Joi.array().items(Joi.string().trim().max(500)).max(50).required()
            .messages({ 'array.base': 'Requirements must be a list', 'any.required': 'Requirements are required' })
    }),

    // Only these fields are applied by the controller; at least one is needed.
    updateInfo: Joi.object({
        status: Joi.string().trim().insensitive().valid(...JOB_STATUSES)
            .messages({ 'any.only': 'Status must be one of: ' + JOB_STATUSES.join(', ') }),
        notes: optionalText(),
        priority: Joi.string().valid('low', 'medium', 'high', 'emergency'),
        duration: Joi.number().positive().max(1000).label('Duration'),
        estimatedEarnings: money().allow('', null).label('Service price'),
        actualEarnings: money().allow('', null).label('Amount collected')
    }).or('status', 'notes', 'priority', 'duration', 'estimatedEarnings', 'actualEarnings')
        .messages({ 'object.missing': 'Provide at least one field to update' })
};

/* ------------------------------------------------------------------ */
/* /api/services (legacy Service records)                              */
/* ------------------------------------------------------------------ */

export const legacyServiceSchemas = {
    listQuery: Joi.object({
        status: Joi.string().valid(...SERVICE_STATUSES),
        limit: pagination.limit
    }),

    updateStatus: Joi.object({
        status: Joi.string().valid(...SERVICE_STATUSES).required(),
        actualHours: Joi.number().min(0).max(1000),
        rating: Joi.number().min(1).max(5),
        feedback: optionalText()
    }),

    rating: Joi.object({
        rating: Joi.number().min(1).max(5).required(),
        feedback: optionalText()
    })
};

export default serviceActionSchemas;
