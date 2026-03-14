// Middleware for Joi validation
export const validateRequest = (schema) => (req, res, next) => {
    if (!schema) return next();

    const { error } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });

    if (error) {
        const errors = error.details.map((detail) => ({
            field: detail.path.join('.'),
            message: detail.message.replace(/['"]/g, '')
        }));

        return res.status(400).json({
            success: false,
            message: 'Validation Error',
            errors
        });
    }

    next();
};

export const validateQuery = (schema) => (req, res, next) => {
    if (!schema) return next();

    const { error } = schema.validate(req.query, { abortEarly: false, stripUnknown: true });

    if (error) {
        const errors = error.details.map((detail) => ({
            field: detail.path.join('.'),
            message: detail.message.replace(/['"]/g, '')
        }));
        return res.status(400).json({
            success: false,
            message: 'Invalid Query Parameters',
            errors
        });
    }
    next();
}
