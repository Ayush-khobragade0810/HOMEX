import mongoose from "mongoose";

const citySchema = new mongoose.Schema({
    cityId: { type: Number, unique: true },
    cityName: { type: String, required: true },
    stateId: { type: Number, required: true }
});

// Auto-increment cityId
citySchema.pre('save', async function(next) {
    if (this.isNew) {
        const lastCity = await this.constructor.findOne().sort({ cityId: -1 });
        this.cityId = lastCity ? lastCity.cityId + 1 : 1;
    }
    next();
});

export default mongoose.model("City", citySchema);