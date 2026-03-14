import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema({
    paymentId: { type: Number, unique: true },
    // Core ID used in main backend
    empId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
    // Optional ref for future migration
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },

    serviceId: { type: String, required: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },

    customer: {
        name: String,
        email: String,
        phone: String,
        address: String
    },
    serviceType: {
        type: String,
        required: true,
        enum: ['Plumbing', 'AC Repair', 'Appliance Repair', 'Drain Cleaning', 'Electrical', 'Emergency Plumbing', 'cleaning', 'repair', 'maintenance', 'consultation', 'installation', 'other']
    },

    // Financials
    amount: { type: Number, required: true }, // Used as 'totalEarnings' in some views
    baseRate: { type: Number, required: true },
    commission: { type: Number, required: true },
    commissionRate: { type: Number, default: 30 },
    bonus: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    tip: { type: Number, default: 0 },

    // Total Amount (amount + bonus + tax + tip?) - Keeping 'amount' as primary for now, but adding totalAmount for compatibility
    totalAmount: { type: Number },

    hours: { type: Number, required: true },
    hourlyRate: { type: Number },

    date: { type: Date, default: Date.now, index: true },
    scheduledDate: { type: Date },

    status: {
        type: String,
        enum: ['completed', 'pending', 'processing', 'cancelled', 'refunded', 'failed'],
        default: 'pending',
        index: true
    },

    paymentMethod: {
        type: String,
        required: true
    },
    paymentGateway: String,
    transactionId: String,

    notes: String,
    attachments: [{
        name: String,
        url: String,
        type: String
    }],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }

}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes
paymentSchema.index({ empId: 1, date: -1 });
paymentSchema.index({ empId: 1, status: 1 });

// Pre-save to ensure totalAmount is populated
paymentSchema.pre('save', function (next) {
    if (!this.totalAmount) {
        this.totalAmount = this.amount; // Default to amount if not specified
    }
    next();
});

export default mongoose.model("Payment", paymentSchema);