
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const check = async () => {
    try {
        if (!process.env.MONGO_URI) { console.error('No MONGO_URI'); process.exit(1); }
        await mongoose.connect(process.env.MONGO_URI);

        // Define minimal schema matching the collection
        const bookingSchema = new mongoose.Schema({ status: String }, { strict: false });
        const Booking = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);

        const statuses = await Booking.distinct('status');
        console.log('DISTINCT_STATUSES:', JSON.stringify(statuses));

        const counts = await Booking.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
        console.log('COUNTS:', JSON.stringify(counts, null, 2));

    } catch (e) {
        console.error('ERROR:', e);
    } finally {
        await mongoose.disconnect();
    }
};

check();
