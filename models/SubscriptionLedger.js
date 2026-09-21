import mongoose from 'mongoose';

/**
 * Every movement of an employee's subscription balance: top-ups approved by an
 * admin, the per-service fee taken when they accept a job, and refunds when a
 * job is cancelled through no fault of theirs.
 *
 * Append-only. `balanceAfter` is the balance right after this entry, so the
 * history can be read without re-summing.
 */
const subscriptionLedgerSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    empId: Number,
    type: { type: String, enum: ['credit', 'debit'], required: true },
    reason: {
        type: String,
        enum: ['subscription_payment', 'service_fee', 'service_fee_refund', 'opening_balance'],
        required: true
    },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true },

    // Service-fee entries point at the booking they were charged for.
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', index: true },
    bookingRef: String,
    serviceTitle: String,

    transactionId: String, // subscription payments
    note: String,
    by: { type: mongoose.Schema.Types.ObjectId }
}, { timestamps: { createdAt: true, updatedAt: false } });

subscriptionLedgerSchema.index({ employee: 1, createdAt: -1 });
subscriptionLedgerSchema.index({ reason: 1, createdAt: -1 });

export default mongoose.models.SubscriptionLedger || mongoose.model('SubscriptionLedger', subscriptionLedgerSchema);
