/**
 * Shared billing calculator — the single source of truth for invoice totals.
 *
 * Every consumer (extra-service endpoints, service completion, and the invoice
 * template) MUST use these helpers so the customer bill, the invoice PDF and the
 * payment summary can never drift apart.
 *
 * Pipeline:  base + extras = subtotal  ->  - discount  ->  + tax  =  grandTotal
 *
 * Tax is fully implemented but defaults to 0%, which keeps totals numerically
 * identical to the previous behaviour (the old invoice hard-coded "Tax (0%)").
 * Set INVOICE_TAX_RATE (percent, e.g. "18") to switch it on globally.
 */

/** Round to 2 decimal places, coercing junk to 0. */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Default tax rate (percent). 0 preserves existing invoice behaviour. */
export const DEFAULT_TAX_RATE = Math.max(0, Number(process.env.INVOICE_TAX_RATE) || 0);

/**
 * Normalise one extra-service line and compute its amount.
 * Quantity is floored to a minimum of 1; unit price is clamped to >= 0.
 */
export function normalizeExtraService(raw = {}) {
    const quantity = Math.max(1, Math.floor(Number(raw.quantity) || 1));
    const unitPrice = Math.max(0, Number(raw.unitPrice ?? raw.price) || 0);

    const line = {
        name: String(raw.name || '').trim(),
        quantity,
        unitPrice: round2(unitPrice),
        amount: round2(quantity * unitPrice)
    };

    const notes = raw.notes == null ? '' : String(raw.notes).trim();
    if (notes) line.notes = notes;

    return line;
}

/** Sum of every extra-service line amount. */
export function calculateExtrasTotal(extraServices = []) {
    const list = Array.isArray(extraServices) ? extraServices : [];

    return round2(
        list.reduce((sum, item) => {
            const qty = Math.max(1, Math.floor(Number(item?.quantity) || 1));
            const unit = Math.max(0, Number(item?.unitPrice) || 0);
            const rawAmount = Number(item?.amount);
            const amount = Number.isFinite(rawAmount) ? rawAmount : qty * unit;
            return sum + (Number(amount) || 0);
        }, 0)
    );
}

/**
 * Compute the full billing breakdown for a booking.
 * Accepts a Mongoose document or a plain object. `overrides` lets callers
 * preview totals (e.g. before persisting a new extra service).
 */
export function computeBilling(booking = {}, overrides = {}) {
    const baseAmount = round2(
        overrides.baseAmount ?? booking?.serviceDetails?.price ?? 0
    );

    const extrasTotal = calculateExtrasTotal(
        overrides.extraServices ?? booking?.extraServices
    );

    const subtotal = round2(baseAmount + extrasTotal);

    // Discount can never be negative nor exceed the subtotal.
    const rawDiscount = Number(overrides.discount ?? booking?.billing?.discount ?? 0) || 0;
    const discount = round2(Math.min(Math.max(0, rawDiscount), subtotal));

    const taxRate = Math.max(
        0,
        Number(overrides.taxRate ?? booking?.billing?.taxRate ?? DEFAULT_TAX_RATE) || 0
    );

    const taxableAmount = round2(subtotal - discount);
    const taxAmount = round2((taxableAmount * taxRate) / 100);
    const grandTotal = round2(taxableAmount + taxAmount);

    return { baseAmount, extrasTotal, subtotal, discount, taxRate, taxAmount, grandTotal };
}

/**
 * Recompute the breakdown and assign it onto a booking document.
 * Does NOT save — the caller decides when to persist.
 */
export function applyBilling(booking, overrides = {}) {
    const billing = computeBilling(booking, overrides);
    booking.billing = billing;
    return billing;
}

/**
 * Read-side total summary for list/detail endpoints.
 *
 * Deliberately RECOMPUTES rather than trusting the persisted `billing` block:
 * bookings created before this feature have no breakdown at all, and any writer
 * that updates a booking without going through applyBilling/computeBilling
 * leaves `billing.grandTotal` stale. Deriving from serviceDetails.price +
 * extraServices — the actual source of truth — is self-healing for both.
 *
 * Spread the result into a list-item payload so every surface (employee
 * dashboard, schedule, admin, invoice) reports the same number.
 */
export function bookingTotals(booking = {}) {
    const billing = computeBilling(booking);
    const extraServices = Array.isArray(booking?.extraServices) ? booking.extraServices : [];

    return {
        // Base service price, never mutated by extras.
        estimatedEarnings: billing.baseAmount,
        baseAmount: billing.baseAmount,
        extrasTotal: billing.extrasTotal,
        // The number every UI should show as "the booking total".
        totalPrice: billing.grandTotal,
        hasExtras: extraServices.length > 0,
        extraServices: extraServices.map((ex) => ({
            _id: ex._id,
            name: ex.name,
            quantity: ex.quantity,
            unitPrice: ex.unitPrice,
            amount: ex.amount,
            notes: ex.notes
        })),
        billing
    };
}
