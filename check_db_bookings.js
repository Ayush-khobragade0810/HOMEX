
import mongoose from 'mongoose';

const mongoURI = "mongodb+srv://Homex:Homex%40123@atlascluster.izog0qm.mongodb.net/employees";

// Define a simple Booking schema
const bookingSchema = new mongoose.Schema({
    status: String,
    bookingId: String
}, { strict: false });

// Only try to register if not already registered (though in a standalone script this is fresh)
const Booking = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);

async function checkBookings() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(mongoURI);
        console.log('✅ Connected!');

        console.log('🔍 Checking Booking Statuses...');

        const distinctStatuses = await Booking.distinct('status');
        console.log('📋 Distinct Statuses found in DB:', distinctStatuses);

        const statusCounts = await Booking.aggregate([
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);
        console.log('📊 Count by Status:', statusCounts);

        const completedUpper = await Booking.countDocuments({ status: 'COMPLETED' });
        const completedLower = await Booking.countDocuments({ status: 'completed' });

        console.log(`✅ COMPLETED (Upper): ${completedUpper}`);
        console.log(`⚠️ completed (Lower): ${completedLower}`);

        if (completedUpper > 0 && completedLower === 0) {
            console.log("➡️ Conclusion: DB uses Uppercase 'COMPLETED'. Queries MUST match case.");
        } else if (completedLower > 0) {
            console.log("➡️ Conclusion: DB contains Lowercase 'completed'. Data might be inconsistent.");
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('👋 Disconnected');
        process.exit();
    }
}

checkBookings();
