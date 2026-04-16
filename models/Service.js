import mongoose from "mongoose";

const serviceSchema = new mongoose.Schema({
    serviceId: { type: Number, unique: true },
    empId: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    serviceType: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['assigned', 'scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled'],
        default: 'assigned'
    },
    customer: {
        name: String,
        address: String,
        landmark: String,
        pincode: String,
        phone: String,
        alternatePhone: String,
        email: String
    },
    category: String,
    scheduledDate: { type: Date, required: true },
    time: { type: String, required: true }, // "10:00 AM" format
    duration: { type: Number, default: 1 }, // hours
    completedDate: { type: Date },
    estimatedEarnings: { type: Number, default: 0 },
    actualEarnings: { type: Number },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'cancelled'],
        default: 'pending'
    },
    notes: String,
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'emergency'],
        default: 'medium'
    }
}, {
    timestamps: true
});

// Indexes for efficient queries
serviceSchema.index({ empId: 1, scheduledDate: 1 });
serviceSchema.index({ empId: 1, status: 1 });
serviceSchema.index({ scheduledDate: 1 });

export default mongoose.model("Service", serviceSchema);