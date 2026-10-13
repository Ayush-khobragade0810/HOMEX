import Employee from '../models/adminEmployee.js';
import { hasSubscriptionAccess, canTakeServices, SERVICE_FEE } from '../utils/subscription.js';
import { findBookingForId } from '../services/serviceFeeService.js';

/**
 * Whether a job may be assigned to this employee: their balance must cover the
 * service fee they'll pay on accepting it. Accepts an Employee document
 * or a User document with role 'employee' (linked to its Employee by email), since
 * the assign endpoints receive either.
 */
export const canReceiveJobs = async (employeeOrUser) => {
    if (!employeeOrUser) return false;
    const employee = employeeOrUser.empId !== undefined
        ? employeeOrUser
        : await Employee.findOne({ email: employeeOrUser.email }).select('subscription').lean();
    return canTakeServices(employee?.subscription);
};

export const SUBSCRIPTION_ASSIGN_ERROR =
    `This employee can't take new services: they have no subscription, or their balance is below the ₹${SERVICE_FEE} service fee.`;

const isEmployeeRequest = (req) => req.user?.empId !== undefined && req.user?.empId !== null;

/** The 402 the frontend API client turns into a redirect to the subscription page. */
const subscriptionRequired = (res, subscription) => {
    const lowBalance = hasSubscriptionAccess(subscription);
    const balance = Number(subscription?.balance) || 0;
    const message = lowBalance
        ? `Your subscription balance is ₹${balance}, below the ₹${SERVICE_FEE} service fee. Top up to use your dashboard.`
        : 'An active subscription is required to receive and work on service requests.';
    return res.status(402).json({
        success: false,
        code: 'SUBSCRIPTION_REQUIRED',
        reason: lowBalance ? 'LOW_BALANCE' : 'NOT_SUBSCRIBED',
        message,
        error: message
    });
};

/**
 * Dashboard gate: the employee must be able to take a new service — exempt, or
 * a balance that covers at least one more service fee. Must run after `protect`.
 *
 * `protect` only sets `req.user.empId` when the caller resolved to an Employee
 * record, so admins and customers pass straight through — their own checks
 * still apply downstream.
 */
export const requireActiveSubscription = async (req, res, next) => {
    if (!isEmployeeRequest(req)) return next();

    try {
        const employee = await Employee.findById(req.user.id).select('subscription').lean();
        if (canTakeServices(employee?.subscription)) return next();
        return subscriptionRequired(res, employee?.subscription);
    } catch (error) {
        console.error('Subscription check error:', error.message);
        return res.status(500).json({ success: false, message: 'Could not verify subscription', error: 'Could not verify subscription' });
    }
};

/**
 * Gate for actions on ONE job (start / complete / status / notes …). Same as
 * requireActiveSubscription, except an employee whose balance has run out may
 * still act on a job they already paid the service fee for — so a locked
 * dashboard never strands work in progress.
 *
 * The job id is read from req.params.id or req.params.serviceId, and may be a
 * booking id or a legacy Service id (resolved to its booking).
 */
export const requireSubscriptionOrPaidJob = async (req, res, next) => {
    if (!isEmployeeRequest(req)) return next();

    try {
        const employee = await Employee.findById(req.user.id).select('subscription').lean();
        const sub = employee?.subscription;
        if (canTakeServices(sub)) return next();

        const jobId = req.params.id || req.params.serviceId;
        if (hasSubscriptionAccess(sub) && jobId) {
            const booking = await findBookingForId(jobId);
            const fee = booking?.serviceFee;
            if (fee?.status === 'charged' && String(fee.employee) === String(req.user.id)) return next();
        }

        return subscriptionRequired(res, sub);
    } catch (error) {
        console.error('Subscription check error:', error.message);
        return res.status(500).json({ success: false, message: 'Could not verify subscription', error: 'Could not verify subscription' });
    }
};
