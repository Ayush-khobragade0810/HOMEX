/**
 * Live updates for the admin panel over Socket.IO. Admin pages listen for these
 * and quietly reload, so new requests appear without a page refresh.
 *
 *   admin:booking:new           a customer created a booking (shown as a toast)
 *   admin:bookings:changed      any booking was created or updated
 *   admin:subscription:request  an employee submitted a payment (shown as a toast)
 *   admin:subscriptions:changed a payment was approved/rejected, or a balance moved
 *
 * Best-effort: a failed broadcast must never break the request that caused it.
 */
import logger from './logger.js';

export const ADMIN_EVENTS = {
    BOOKING_NEW: 'admin:booking:new',
    BOOKINGS_CHANGED: 'admin:bookings:changed',
    SUBSCRIPTION_REQUEST: 'admin:subscription:request',
    SUBSCRIPTIONS_CHANGED: 'admin:subscriptions:changed'
};

export const notifyAdmins = async (event, payload = {}) => {
    try {
        // Imported lazily: the Booking model calls this from its hooks, and the
        // socket service imports models itself.
        const { default: socketService } = await import('../socket/socketService.js');
        socketService.emitToAdmins(event, payload);
    } catch (err) {
        logger.warn({ err: err.message, event }, 'Admin live update failed');
    }
};
