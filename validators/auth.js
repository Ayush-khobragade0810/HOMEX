import { Joi, email, phone, password, personName } from './common.js';

/*
 * Request schemas for /api/auth. The validate middleware does not mutate the
 * request, so these only reject bad input; controllers still normalise values
 * (trim / lowercase) themselves.
 */

// Location master ids may arrive as numbers or numeric strings.
const locationId = () => Joi.alternatives().try(Joi.number().integer().min(0), Joi.string().trim().max(64).allow(''));

/** Signup form sends { name, email, phone, password, role }. */
export const signup = Joi.object({
    name: personName().required().label('Name')
        .messages({ 'string.min': 'Please enter your name (at least 2 characters)' }),
    email: email().required().label('Email')
        .messages({ 'string.email': 'Please enter a valid email address' }),
    phone: phone().required().label('Mobile number')
        .messages({ 'string.pattern.base': 'Please enter a valid 10-digit mobile number' }),
    password: password().required().label('Password'),
    confirmPassword: Joi.any().valid(Joi.ref('password')).messages({ 'any.only': 'Passwords do not match' }),
    // Self-signup may only create customer or employee accounts.
    role: Joi.string().trim().lowercase().valid('user', 'employee').insensitive().label('Role')
        .messages({ 'any.only': 'Role must be either user or employee' }),
    source: Joi.string().trim().max(50),
    countryId: locationId(),
    stateId: locationId(),
    cityId: locationId(),
    areaId: locationId()
});

export const register = signup;

const loginId = () => Joi.alternatives().try(Joi.string().trim().min(1).max(254), Joi.number());

/** Login accepts an email or 10-digit mobile number as `identifier`, `email` or `phone`. */
export const login = Joi.object({
    identifier: loginId(),
    email: loginId(),
    phone: loginId(),
    password: Joi.string().required().label('Password')
        .messages({ 'string.empty': 'Password is required' })
})
    .or('identifier', 'email', 'phone')
    .messages({ 'object.missing': 'Email or mobile number is required' });

/** Passwordless employee login: { email }. */
export const employeeLogin = Joi.object({
    email: email().required().label('Email')
        .messages({ 'string.email': 'Please enter a valid email address' })
});

/** PUT /api/auth/profile */
export const updateProfile = Joi.object({
    name: personName().allow('').label('Name'),
    phone: phone().allow('', null).label('Mobile number')
        .messages({ 'string.pattern.base': 'Please enter a valid 10-digit mobile number' }),
    address: Joi.alternatives().try(Joi.string().max(500).allow(''), Joi.object()).label('Address'),
    avatar: Joi.string().max(2048).allow('').label('Avatar')
});

export const changePassword = Joi.object({
    currentPassword: Joi.string().required().label('Current password'),
    newPassword: password().required().label('New password')
        .invalid(Joi.ref('currentPassword'))
        .messages({ 'any.invalid': 'New password must be different from your current password' }),
    confirmPassword: Joi.any().valid(Joi.ref('newPassword')).messages({ 'any.only': 'Passwords do not match' })
});

/** The refresh token may come from the cookie instead, so it is optional here. */
export const refreshToken = Joi.object({
    refreshToken: Joi.string().trim().max(512).label('Refresh token')
});

export default { signup, register, login, employeeLogin, updateProfile, changePassword, refreshToken };
