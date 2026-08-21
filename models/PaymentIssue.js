import mongoose from "mongoose";

const paymentIssueSchema = new mongoose.Schema({
    // Numeric payment id (matches Payment.paymentId) when available
    paymentId: { type: Number, index: true },
    // Mongo ref to the payment the issue is about
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', index: true },

    // Reporter
    empId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
    reportedByName: String,
    reportedByEmail: String,

    category: {
        type: String,
        enum: ['amount_incorrect', 'payment_not_received', 'commission_dispute', 'duplicate_payment', 'wrong_details', 'other'],
        default: 'other'
    },
    description: { type: String, required: true, trim: true, maxlength: 2000 },

    // Snapshot so the issue stays readable even if the payment changes later
    paymentSnapshot: {
        amount: Number,
        commission: Number,
        status: String,
        date: Date,
        transactionId: String
    },

    status: {
        type: String,
        enum: ['open', 'in_review', 'resolved', 'rejected'],
        default: 'open',
        index: true
    },
    adminNotes: String,
    resolvedAt: Date
}, { timestamps: true });

paymentIssueSchema.index({ empId: 1, createdAt: -1 });

export default mongoose.model("PaymentIssue", paymentIssueSchema);
