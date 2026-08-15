import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/homex';

async function run() {
    try {
        await mongoose.connect(mongoURI);
        console.log('Connected to DB');
        const db = mongoose.connection.db;

        const bookingId = '6a805050ecea69ab5fa689a4';
        
        // Query by ObjectId
        const booking = await db.collection('bookings').findOne({ _id: new mongoose.Types.ObjectId(bookingId) });
        console.log('--- BOOKING SEARCH BY OBJECTID ---');
        console.log(JSON.stringify(booking, null, 2));

        // Query by string bookingId just in case
        if (!booking) {
            const bookingByStr = await db.collection('bookings').findOne({ bookingId: bookingId });
            console.log('--- BOOKING SEARCH BY STRING ID ---');
            console.log(JSON.stringify(bookingByStr, null, 2));
        }

        await mongoose.disconnect();
    } catch (e) {
        console.error('Error:', e);
    }
}

run();
