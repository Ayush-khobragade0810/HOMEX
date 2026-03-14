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

// Booking Schemas
export const bookingSchemas = {
    createBooking: Joi.object({
        serviceId: Joi.string().hex().length(24).optional(), // ObjectId
        serviceDetails: Joi.object({
            title: Joi.string().required(),
            price: Joi.number().min(0).required(),
            category: Joi.string().required(),
            duration: Joi.number().optional()
        }).required(),
        schedule: Joi.object({
            preferredDate: Joi.date().iso().required(), // Modified to allow today
            timeSlot: Joi.string().required()
        }).required(),
        location: Joi.object({
            country: Joi.string().optional(),
            state: Joi.string().optional(),
            city: Joi.string().optional(),
            area: Joi.string().optional(),
            completeAddress: Joi.string().required()
        }).required(),
        contactInfo: Joi.object({
            fullName: Joi.string().required(),
            phoneNumber: Joi.string().min(10).required(), // Relaxed validation
            email: Joi.string().email().required()
        }).required(),
        payment: Joi.object({
            method: Joi.string().valid('online', 'cash').required(),
            amount: Joi.number().required()
        }).required(),
        notes: Joi.string().max(500).optional()
    }),
    updateStatus: Joi.object({
        status: Joi.string().valid('PENDING', 'ACCEPTED', 'NAVIGATING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'pending', 'accepted', 'navigating', 'in_progress', 'completed', 'cancelled').required(),
        notes: Joi.string().optional(),
        cancellationReason: Joi.string().when('status', {
            is: Joi.string().valid('CANCELLED', 'cancelled'),
            then: Joi.required(),
            otherwise: Joi.optional()
        })
    })
};
