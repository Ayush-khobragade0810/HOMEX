import mongoose from "mongoose";

const areaSchema = new mongoose.Schema({
    areaId: { type: Number, unique: true },
    areaName: { type: String, required: true },
    cityId: { type: Number, required: true },
    pincode: String,
    description: String
});

// Auto-increment areaId
areaSchema.pre('save', async function(next) {
    if (this.isNew) {
        const lastArea = await this.constructor.findOne().sort({ areaId: -1 });
        this.areaId = lastArea ? lastArea.areaId + 1 : 1;
    }
    next();
});

export default mongoose.model("Area", areaSchema);