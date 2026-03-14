import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('MONGO_URI not found in .env');
    process.exit(1);
}

async function checkCounts() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        const bookingCount = await mongoose.connection.db.collection('bookings').countDocuments();
        const userCount = await mongoose.connection.db.collection('users').countDocuments();
        const employeeCount = await mongoose.connection.db.collection('adminemployees').countDocuments();

        console.log(`Bookings: ${bookingCount}`);
        console.log(`Users: ${userCount}`);
        console.log(`Employees: ${employeeCount}`);

        // Check for any indexes in bookings
        const bookingIndexes = await mongoose.connection.db.collection('bookings').indexes();
        console.log('\nBooking Indexes:', JSON.stringify(bookingIndexes, null, 2));

        await mongoose.disconnect();
    } catch (err) {
        console.error('Error:', err);
    }
}

checkCounts();
