
import mongoose from 'mongoose';
const mongoURI = "mongodb+srv://Homex:Homex%40123@atlascluster.izog0qm.mongodb.net/employees";
const bookingSchema = new mongoose.Schema({ status: String, bookingId: String }, { strict: false });
const Booking = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);

async function check() {
    await mongoose.connect(mongoURI);
    const upper = await Booking.countDocuments({ status: 'COMPLETED' });
    const lower = await Booking.countDocuments({ status: 'completed' });
    const all = await Booking.find({}, 'status');

    console.log("UPPER_CASE_COUNT: " + upper);
    console.log("LOWER_CASE_COUNT: " + lower);
    console.log("ALL_STATUSES: " + JSON.stringify(all.map(b => b.status)));

    await mongoose.disconnect();
    process.exit();
}
check();
