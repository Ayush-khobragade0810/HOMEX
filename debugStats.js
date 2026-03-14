import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.join(__dirname, '.env') });

const BookingSchema = new mongoose.Schema({}, { strict: false });
const Booking = mongoose.model('Booking', BookingSchema);

const debug = async () => {
    try {
        const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
        if (!mongoURI) {
            console.error('MONGO_URI not found in env');
            process.exit(1);
        }

        console.log('Connecting to DB...');
        await mongoose.connect(mongoURI);
        console.log('Connected.');

        const fs = await import('fs');
        let output = '';

        console.log('\n--- Status Distribution ---');
        const distribution = await Booking.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);
        output += JSON.stringify(distribution, null, 2) + '\n';

        console.log('\n--- Sample Bookings (Status & ID) ---');
        const samples = await Booking.find({}, { status: 1, _id: 1 }).limit(10);
        output += JSON.stringify(samples, null, 2);

        fs.writeFileSync('db_inspection.txt', output);
        console.log('Output written to db_inspection.txt');

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.connection.close();
        process.exit();
    }
};

debug();
