import mongoose from "mongoose";

const countrySchema = new mongoose.Schema({
    countryId: { type: Number, unique: true },
    countryName: { type: String, required: true, unique: true }
});

// Auto-increment countryId
countrySchema.pre('save', async function(next) {
    if (this.isNew) {
        const lastCountry = await this.constructor.findOne().sort({ countryId: -1 });
        this.countryId = lastCountry ? lastCountry.countryId + 1 : 1;
    }
    next();
});

export default mongoose.model("Country", countrySchema);