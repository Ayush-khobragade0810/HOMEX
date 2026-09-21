/**
 * Employee subscription rules — the single source of truth for whether an
 * employee may use the dashboard and take new services.
 *
 * Prepaid balance model: the employee pays a top-up outside the app (UPI/bank/
 * cash), submits the reference, and an admin approves it, which adds the top-up
 * to their balance. Every service they accept deducts SERVICE_FEE. There is no
 * expiry; the balance lasts until it's spent.
 */

export const SUBSCRIPTION_AMOUNT = Math.max(0, Number(process.env.SUBSCRIPTION_AMOUNT) || 3500);
export const SERVICE_FEE = Math.max(0, Number(process.env.SERVICE_FEE) || 120);
export const PAYMENT_METHODS = ['upi', 'bank', 'cash', 'other'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** A payment older than this can't be for the current renewal. */
export const MAX_PAYMENT_AGE_DAYS = 30;
export const NOTE_MAX_LENGTH = 500;

/**
 * Reference formats per payment method. Mirrored in
 * Frontend/pages/EmployeeSubscription.jsx — keep the two in sync.
 */
export const REFERENCE_RULES = {
    upi: {
        required: true,
        pattern: /^\d{12}$/,
        emptyMessage: 'Enter the 12-digit UPI reference (UTR) from your payment',
        message: 'UPI reference (UTR) is the 12-digit number shown in your UPI app'
    },
    bank: {
        required: true,
        pattern: /^[A-Z0-9]{12,22}$/,
        emptyMessage: 'Enter the bank reference (UTR / RRN) from your payment',
        message: 'Bank reference must be 12–22 letters or digits (IMPS: 12-digit RRN, NEFT: UTR)'
    },
    // Cash has no transaction reference; a receipt number is optional.
    cash: {
        required: false,
        pattern: /^[A-Z0-9/-]{4,30}$/,
        message: 'Receipt number must be 4–30 letters, digits, - or /'
    },
    other: {
        required: true,
        pattern: /^[A-Z0-9/_.-]{4,64}$/,
        emptyMessage: 'Enter a reference that identifies your payment',
        message: 'Reference must be 4–64 letters, digits, or - / _ .'
    }
};

/** Pasted references often carry spaces or lowercase; store one canonical form. */
export const normalizeReference = (raw) => String(raw ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * Validate an employee's payment report.
 * Returns { errors, value } — `errors` is keyed by field, empty when valid.
 */
export const validatePaymentRequest = (body = {}, now = new Date()) => {
    const errors = {};

    const paymentMethod = String(body.paymentMethod ?? '').trim().toLowerCase();
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
        errors.paymentMethod = 'Select how you paid';
    }

    const transactionId = normalizeReference(body.transactionId);
    const rule = REFERENCE_RULES[paymentMethod];
    if (!transactionId) {
        if (rule?.required) errors.transactionId = rule.emptyMessage;
    } else if (rule && !rule.pattern.test(transactionId)) {
        errors.transactionId = rule.message;
    } else if (/^(.)\1+$/.test(transactionId)) {
        errors.transactionId = "That doesn't look like a real reference number";
    }

    // Date-only "YYYY-MM-DD". Compared as calendar days in UTC with one day of
    // slack, so an employee ahead of UTC (e.g. IST just after midnight) can
    // still enter today's date.
    let paidOn = null;
    const rawDate = String(body.paidOn ?? '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate);
    if (!match) {
        errors.paidOn = 'Enter the date you paid';
    } else {
        const [, y, m, d] = match.map(Number);
        const ts = Date.UTC(y, m - 1, d);
        const parsed = new Date(ts);
        const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

        if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
            errors.paidOn = 'Enter a valid date';
        } else if (ts > todayUTC + DAY_MS) {
            errors.paidOn = "Payment date can't be in the future";
        } else if (ts < todayUTC - MAX_PAYMENT_AGE_DAYS * DAY_MS) {
            errors.paidOn = `Payment must be from the last ${MAX_PAYMENT_AGE_DAYS} days`;
        } else {
            paidOn = parsed;
        }
    }

    const note = String(body.note ?? '').trim();
    if (note.length > NOTE_MAX_LENGTH) {
        errors.note = `Keep the note under ${NOTE_MAX_LENGTH} characters`;
    } else if (paymentMethod === 'cash' && note.length < 3) {
        errors.note = 'Say who you handed the cash to';
    } else if (paymentMethod === 'other' && note.length < 5) {
        errors.note = 'Describe how you paid so the admin can verify it';
    }

    return { errors, value: { paymentMethod, transactionId, paidOn, note } };
};

/** Where employees should send the fee. Unset values are omitted, never invented. */
export const payeeDetails = () => {
    const details = {
        upiId: process.env.SUBSCRIPTION_UPI_ID || '',
        payeeName: process.env.SUBSCRIPTION_PAYEE_NAME || '',
        bankDetails: process.env.SUBSCRIPTION_BANK_DETAILS || '',
        contact: process.env.SUBSCRIPTION_CONTACT || ''
    };
    return Object.fromEntries(Object.entries(details).filter(([, v]) => v));
};

const balanceOf = (subscription) => Math.max(0, Number(subscription?.balance) || 0);

/**
 * Has ever subscribed: grandfathered, or at least one payment approved. With a
 * balance below the service fee this no longer opens the dashboard, but it
 * still lets them finish jobs they already paid for (see
 * requireSubscriptionOrPaidJob).
 */
export const hasSubscriptionAccess = (subscription) =>
    Boolean(subscription?.exempt || subscription?.activatedAt);

/** May accept (and be assigned) a new service right now. */
export const canTakeServices = (subscription) => {
    if (!subscription) return false;
    if (subscription.exempt) return true;
    return hasSubscriptionAccess(subscription) && balanceOf(subscription) >= SERVICE_FEE;
};

/**
 * One state for the UI to switch on:
 *   active      — can take services
 *   low_balance — has access, but the balance can't cover one more service fee
 *   pending     — never activated; first payment is awaiting approval
 *   rejected    — never activated; last submission was rejected
 *   none        — never paid
 * A top-up can be pending in any state; `pendingRequest` carries it.
 */
export const subscriptionState = (subscription) => {
    const sub = subscription || {};
    if (canTakeServices(sub)) return 'active';
    if (hasSubscriptionAccess(sub)) return 'low_balance';
    if (sub.pendingRequest?.submittedAt) return 'pending';
    if (sub.lastRejection?.at) return 'rejected';
    return 'none';
};

/** Public view of an employee's subscription, safe to send to that employee. */
export const describeSubscription = (subscription) => {
    const sub = subscription || {};
    const balance = balanceOf(sub);
    const access = hasSubscriptionAccess(sub);

    return {
        state: subscriptionState(sub),
        // May use the dashboard: exempt, or balance covers one more service fee.
        active: canTakeServices(sub),
        canTakeServices: canTakeServices(sub),
        // Has ever had a payment approved (low-balance employees are activated
        // but not active).
        activated: access,
        exempt: Boolean(sub.exempt),
        balance,
        serviceFee: SERVICE_FEE,
        servicesLeft: sub.exempt ? null : (SERVICE_FEE > 0 ? Math.floor(balance / SERVICE_FEE) : null),
        amount: SUBSCRIPTION_AMOUNT,
        activatedAt: sub.activatedAt || null,
        pendingRequest: sub.pendingRequest?.submittedAt ? sub.pendingRequest : null,
        lastRejection: sub.lastRejection?.at ? sub.lastRejection : null,
        payTo: payeeDetails()
    };
};
