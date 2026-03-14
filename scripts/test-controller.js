import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { assignBooking } from '../controllers/adminBooking.controller.js';
import User from '../models/User.js';
import Booking from '../models/Booking.js';

// Load env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/homax';

// Mock Response Object
const mockRes = () => {
    const res = {};
    res.status = (code) => {
        console.log(`[MOCK RES] Status: ${code}`);
        return res;
    };
    res.json = (data) => {
        console.log(`[MOCK RES] JSON:`, JSON.stringify(data, null, 2));
        return res;
    };
    return res;
};

const runTest = async () => {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);

        // 1. Setup Data
        // Find admin
        const admin = await User.findOne({ role: 'admin' });
        // Find employee
        const employee = await User.findOne({ role: 'employee' });
        // Find booking
        let booking = await Booking.findOne({ status: 'pending' });

        if (!admin || !employee) {
            console.error('❌ Missing Admin or Employee for test.');
            process.exit(1);
        }

        if (!booking) {
            console.log('⚠️ Creating dummy booking...');
            const dummyServiceId = new mongoose.Types.ObjectId();
            booking = await Booking.create({
                userId: admin._id,
                serviceId: dummyServiceId,
                serviceDetails: { title: 'Direct Test', category: 'Test', price: 50, duration: 30 },
                schedule: { preferredDate: new Date(), timeSlot: '09:00 AM - 11:00 AM' },
                location: { address: 'Test', city: 'Test' },
                contactIdInfo: { fullName: 'Tester', phoneNumber: '0000000000' },
                payment: { amount: 50 },
                status: 'pending'
            });
        }

        console.log(`🧪 Testing assignment for Booking: ${booking.bookingId} to Emp: ${employee.name}`);

        // 2. Mock Request
        const req = {
            params: { id: booking._id.toString() }, // Ensure string
            body: { employeeId: employee._id.toString() },
            user: admin
        };

        // 3. Run Controller
        await assignBooking(req, mockRes());

        console.log('✅ Controller Execution Finished without Crash');

    } catch (e) {
        console.error('💥 Controller Crash:', e);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
};

runTest();
