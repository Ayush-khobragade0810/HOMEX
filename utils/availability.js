/**
 * Employee availability: an on/off switch plus the days and hours they work.
 * Times are local business time (same convention as booking time slots).
 */

const DEFAULTS = {
    available: true,
    workingDays: [1, 2, 3, 4, 5, 6],
    startTime: '09:00',
    endTime: '18:00'
};

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (time) => {
    const m = TIME_PATTERN.exec(String(time || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export const describeAvailability = (availability) => {
    const a = availability || {};
    const workingDays = Array.isArray(a.workingDays) && a.workingDays.length ? a.workingDays : DEFAULTS.workingDays;
    return {
        available: a.available !== false,
        workingDays: [...new Set(workingDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
        startTime: TIME_PATTERN.test(a.startTime || '') ? a.startTime : DEFAULTS.startTime,
        endTime: TIME_PATTERN.test(a.endTime || '') ? a.endTime : DEFAULTS.endTime,
        updatedAt: a.updatedAt || null
    };
};

/** Validate an update from the employee. Returns { errors, value }. */
export const validateAvailability = (body = {}) => {
    const errors = {};
    const value = {};

    value.available = body.available !== false;

    const days = body.workingDays;
    if (days !== undefined) {
        if (!Array.isArray(days) || days.some((d) => !Number.isInteger(Number(d)) || Number(d) < 0 || Number(d) > 6)) {
            errors.workingDays = 'Working days must be numbers from 0 (Sunday) to 6 (Saturday)';
        } else {
            value.workingDays = [...new Set(days.map(Number))].sort();
            if (value.available && value.workingDays.length === 0) {
                errors.workingDays = 'Pick at least one working day, or turn availability off';
            }
        }
    }

    const start = body.startTime ?? DEFAULTS.startTime;
    const end = body.endTime ?? DEFAULTS.endTime;
    const startMin = toMinutes(start);
    const endMin = toMinutes(end);

    if (startMin === null) errors.startTime = 'Start time must look like 09:00';
    if (endMin === null) errors.endTime = 'End time must look like 18:00';
    if (startMin !== null && endMin !== null && endMin <= startMin) {
        errors.endTime = 'End time must be after the start time';
    }
    if (startMin !== null) value.startTime = start;
    if (endMin !== null) value.endTime = end;

    return { errors, value };
};

/**
 * Can this employee take a booking in `slot`?
 * `slot` is a Date for the booked start time; without one, only the on/off
 * switch is checked (nothing to compare the hours against).
 * Returns null when fine, or a human-readable reason.
 */
export const availabilityBlockReason = (availability, slot, { timeZoneOffsetMinutes = Number(process.env.BUSINESS_TZ_OFFSET_MINUTES ?? 330) } = {}) => {
    const a = describeAvailability(availability);
    if (!a.available) return 'This employee has marked themselves unavailable.';
    if (!slot) return null;

    const date = new Date(slot);
    if (Number.isNaN(date.getTime())) return null;

    // Shift into business-local time before reading the day and clock.
    const local = new Date(date.getTime() + timeZoneOffsetMinutes * 60 * 1000);
    const day = local.getUTCDay();
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();

    if (!a.workingDays.includes(day)) {
        const names = a.workingDays.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ');
        return `This employee doesn't work on ${DAY_NAMES[day]} (works ${names || 'no days'}).`;
    }

    const startMin = toMinutes(a.startTime);
    const endMin = toMinutes(a.endTime);
    if (startMin !== null && endMin !== null && (minutes < startMin || minutes >= endMin)) {
        return `That time is outside this employee's working hours (${a.startTime}–${a.endTime}).`;
    }

    return null;
};
