import mongoose from "mongoose";

const areaSchema = new mongoose.Schema({
    areaName: { type: String, required: true, trim: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true },
    pincode: String,
    description: String
}, { timestamps: true });

// Strong uniqueness (correct design)
areaSchema.index(
    { areaName: 1, city: 1, state: 1, country: 1 },
    { unique: true }
);

const AreaModel = mongoose.model("Area", areaSchema);

export default AreaModel;