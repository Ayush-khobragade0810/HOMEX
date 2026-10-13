import mongoose from "mongoose";

const stateSchema = new mongoose.Schema({
    stateId: { type: Number, unique: true },
    stateName: { type: String, required: [true, "State name is required"] },
    countryId: { type: Number, required: [true, "Country is required"] }
});

// Auto-increment stateId
stateSchema.pre('save', async function(next) {
    if (this.isNew) {
        const lastState = await this.constructor.findOne().sort({ stateId: -1 });
        this.stateId = lastState ? lastState.stateId + 1 : 1;
    }
    next();
});

export default mongoose.model("State", stateSchema);