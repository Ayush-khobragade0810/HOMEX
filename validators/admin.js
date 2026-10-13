import { Joi, objectId, anyId, email, phone, phoneLoose, personName, numericId, pagination } from './common.js';

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

export const USER_ROLES = ['user', 'technician', 'employee', 'admin'];
export const EMPLOYEE_STATUSES = ['Active', 'Inactive'];
export const ANALYTICS_PERIODS = ['week', 'month', 'quarter', 'year'];

/** Employee routes take either the Mongo _id or the numeric empId. */
export const employeeIdParam = Joi.object({
    id: Joi.alternatives()
        .try(objectId(), Joi.string().trim().pattern(/^\d{1,15}$/))
        .required()
        .label('Employee ID')
        .messages({
            'alternatives.match': 'Invalid employee ID format',
            'alternatives.any': 'Invalid employee ID format'
        })
});

/** Location master ids: numbers, sometimes sent as numeric strings. */
const locationId = () => numericId();

/** Areas are keyed by Mongo _id (legacy rows may carry a numeric id). */
const areaId = () => Joi.alternatives().try(numericId(), Joi.string().trim().min(1).max(64));

const stringList = () => Joi.array().items(Joi.string().trim().allow('').max(200)).max(50);

/* ------------------------------------------------------------------ */
/* Users (/api/admin/users)                                            */
/* ------------------------------------------------------------------ */

export const listUsersQuery = Joi.object({
    ...pagination,
    role: Joi.string().trim().max(30).allow(''),
    search: Joi.string().trim().max(100).allow('')
});

const userAddress = Joi.object({
    street: Joi.string().trim().allow('', null).max(200),
    city: Joi.string().trim().allow('', null).max(100),
    state: Joi.string().trim().allow('', null).max(100),
    pincode: Joi.string().trim().allow('', null).max(10),
    completeAddress: Joi.string().trim().allow('', null).max(500)
});

export const updateUser = Joi.object({
    name: personName(),
    email: email(),
    // The User model stores a 10-digit number (or nothing).
    phone: phone().allow('', null),
    address: userAddress.allow(null),
    role: Joi.string().trim().lowercase().valid(...USER_ROLES),
    isActive: Joi.boolean().strict(),
    avatar: Joi.string().trim().allow('', null)
});

export const updateUserStatus = Joi.object({
    isActive: Joi.boolean().strict().required().label('Active status')
});

/* ------------------------------------------------------------------ */
/* Search / feedback / activities / analytics                          */
/* ------------------------------------------------------------------ */

export const searchQuery = Joi.object({
    query: Joi.string().trim().max(100).allow('').label('Search query')
});

export const feedbackQuery = Joi.object({
    page: pagination.page,
    limit: Joi.number().integer().min(1).max(100)
});

export const activitiesQuery = Joi.object({
    limit: Joi.number().integer().min(1).max(100)
});

export const analyticsQuery = Joi.object({
    period: Joi.string().trim().lowercase().valid(...ANALYTICS_PERIODS)
});

/* ------------------------------------------------------------------ */
/* Assign booking (/api/admin/bookings/:bookingId/assign)              */
/* ------------------------------------------------------------------ */

// bookingId may be the Mongo _id or the human booking reference.
export const assignBookingParams = Joi.object({ bookingId: anyId().required() });

export const assignBookingBody = Joi.object({
    employeeId: objectId().required()
        .messages({ 'any.required': 'Employee ID is required', 'string.pattern.base': 'Invalid Employee ID format' })
});

/* ------------------------------------------------------------------ */
/* Employees (/api/employees)                                          */
/* ------------------------------------------------------------------ */

export const listEmployeesQuery = Joi.object({
    // The controller matches case-insensitively.
    status: Joi.string().trim().insensitive().valid(...EMPLOYEE_STATUSES).allow('')
        .messages({ 'any.only': 'Status must be Active or Inactive' })
});

const availability = Joi.object({
    available: Joi.boolean(),
    workingDays: Joi.array().items(Joi.number().integer().min(0).max(6)).max(7),
    startTime: Joi.string().trim().pattern(/^([01]?\d|2[0-3]):[0-5]\d$/)
        .messages({ 'string.pattern.base': 'Start time must be in HH:MM format' }),
    endTime: Joi.string().trim().pattern(/^([01]?\d|2[0-3]):[0-5]\d$/)
        .messages({ 'string.pattern.base': 'End time must be in HH:MM format' })
});

const settings = Joi.object({
    notifications: Joi.boolean(),
    darkMode: Joi.boolean(),
    emailAlerts: Joi.boolean(),
    twoFactor: Joi.boolean(),
    smsNotifications: Joi.boolean()
});

// Shared by create and update. Role is free text: existing records use values
// such as "Service Technician" besides the form's User/Employee/Admin.
const employeeFields = {
    email: email(),
    phone: phoneLoose().allow('', null),
    role: Joi.string().trim().min(2).max(50),
    earnings: Joi.number().min(0).max(100_000_000),
    status: Joi.string().trim().valid(...EMPLOYEE_STATUSES),
    countryId: locationId(),
    stateId: locationId(),
    cityId: locationId(),
    areaId: areaId(),
    address: Joi.string().trim().allow('', null).max(500),
    bio: Joi.string().trim().allow('', null).max(1000),
    specialties: stringList().allow(null),
    certifications: stringList().allow(null),
    availability,
    settings
};

export const createEmployee = Joi.object({
    name: personName().required().label('Employee name'),
    ...employeeFields,
    email: employeeFields.email.required(),
    role: employeeFields.role.required(),
    countryId: employeeFields.countryId.required().label('Country'),
    stateId: employeeFields.stateId.required().label('State'),
    cityId: employeeFields.cityId.required().label('City'),
    areaId: employeeFields.areaId.required().label('Area')
});

// The admin table and the employee's own profile page send the whole record
// back (including read-only fields), so everything here is optional and blank
// values are tolerated where the controller ignores them.
export const updateEmployee = Joi.object({
    name: personName().allow(''),
    empName: personName().allow(''),
    ...employeeFields,
    email: employeeFields.email.allow(''),
    role: employeeFields.role.allow(''),
    status: employeeFields.status.allow(''),
    countryId: Joi.alternatives().try(locationId(), Joi.valid('', null)),
    stateId: Joi.alternatives().try(locationId(), Joi.valid('', null)),
    cityId: Joi.alternatives().try(locationId(), Joi.valid('', null)),
    areaId: Joi.alternatives().try(areaId(), Joi.valid('', null)),
    avatar: Joi.string().allow('', null)
});
