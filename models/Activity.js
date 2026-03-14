import mongoose from "mongoose";
import AutoIncrementFactory from "mongoose-sequence";

const AutoIncrementPlugin = AutoIncrementFactory(mongoose);

const activitySchema = new mongoose.Schema({
    activityId: { type: Number, unique: true },
    empId: { type: mongoose.Schema.Types.Mixed, required: true }, // Allow Number or ObjectId
    type: {
        type: String,
        enum: ['service_completed', 'rating_received', 'service_scheduled', 'service_started', 'video_watched', 'quiz_completed', 'payment_received', 'profile_updated'],
        required: true
    },
    message: { type: String, required: true },
    serviceId: { type: mongoose.Schema.Types.Mixed }, // Allow Number or ObjectId
    metadata: { type: Object }
}, {
    timestamps: true
});

activitySchema.plugin(AutoIncrementPlugin, { inc_field: 'activityId' });
activitySchema.index({ empId: 1, createdAt: -1 });

export default mongoose.model("Activity", activitySchema);