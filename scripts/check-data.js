import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import Booking from '../models/Booking.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/homax';

const run = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected.');

        const allBookings = await Booking.find({}, 'bookingId status assignedTo');
        console.log('📋 All Bookings:');
        allBookings.forEach(b => {
            console.log(`- ID: ${b.bookingId}, Status: ${b.status}, Assigned: ${!!b.assignedTo}`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
};
run();
