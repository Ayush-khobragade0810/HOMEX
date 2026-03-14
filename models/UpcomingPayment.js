import mongoose from "mongoose";

const upcomingPaymentSchema = new mongoose.Schema({
    upcomingId: { type: Number, unique: true },
    empId: { type: mongoose.Schema.Types.Mixed, required: true }, // Allow Number or ObjectId
    serviceId: { type: String, required: true },
    customer: {
        name: String,
        email: String,
        phone: String
    },
    serviceType: {
        type: String,
        required: true
    },
    estimatedAmount: { type: Number, required: true },
    scheduledDate: { type: Date, required: true },
    status: {
        type: String,
        enum: ['scheduled', 'confirmed', 'in-progress'],
        default: 'scheduled'
    },
    hours: { type: Number, required: true },
    address: String,
    notes: String
}, {
    timestamps: true
});

upcomingPaymentSchema.index({ empId: 1, scheduledDate: 1 });

export default mongoose.model("UpcomingPayment", upcomingPaymentSchema);