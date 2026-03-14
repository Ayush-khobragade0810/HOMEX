import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import path from 'path';
import User from '../models/User.js';
import Booking from '../models/Booking.js';

// Load env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/homax';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const PORT = process.env.PORT || 5000;

const runTest = async () => {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected.');

        // 1. Get Admin Token
        const admin = await User.findOne({ role: 'admin' });
        if (!admin) throw new Error('No admin user found!');

        const token = jwt.sign({ id: admin._id, role: admin.role }, JWT_SECRET, { expiresIn: '1h' });
        console.log(`🔑 Generated token for Admin: ${admin.email}`);

        // 2. Find a Pending Booking
        let booking = await Booking.findOne({ status: 'pending' });

        if (!booking) {
            console.log('⚠️ No pending booking found. Creating one for test...');
            const customer = await User.findOne({ role: 'user' }) || admin;
            const dummyServiceId = new mongoose.Types.ObjectId();

            booking = await Booking.create({
                userId: customer._id,
                serviceId: dummyServiceId,
                serviceDetails: {
                    title: 'Test Service',
                    category: 'Plumbing',
                    price: 100,
                    duration: 60
                },
                schedule: {
                    preferredDate: new Date(Date.now() + 86400000),
                    timeSlot: '09:00 AM - 11:00 AM'
                },
                location: { address: '123 Test St', city: 'Test City' },
                contactIdInfo: { fullName: 'Test User', phoneNumber: '1234567890' },
                payment: { amount: 100 },
                status: 'pending'
            });
            console.log(`✅ Created Test Booking: ${booking.bookingId}`);
        } else {
            console.log(`📅 Found Pending Booking: ${booking.bookingId} (${booking._id})`);
        }

        // 3. Find an Employee
        const employee = await User.findOne({ role: 'employee' });
        if (!employee) throw new Error('No employee User found!');
        console.log(`👷 Found Employee: ${employee.name} (${employee._id})`);

        // 4. PREPARE + CALL API (Needs CSRF)
        const baseUrl = `http://localhost:${PORT}`;

        // A. Get CSRF Token and Cookie
        console.log('🛡️ Fetching CSRF Token...');
        const csrfResponse = await fetch(`${baseUrl}/api/csrf-token`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const csrfData = await csrfResponse.json();
        const csrfCookie = csrfResponse.headers.get('set-cookie');
        const csrfToken = csrfData.csrfToken;

        if (!csrfToken) {
            console.log('⚠️ Failed to get CSRF data. Raw response:', csrfData);
        } else {
            console.log('✅ Got CSRF Token');
        }

        const assignUrl = `${baseUrl}/api/admin/bookings/${booking._id}/assign`;
        console.log(`🚀 Sending PUT request to: ${assignUrl}`);

        const response = await fetch(assignUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
                'Cookie': csrfCookie
            },
            body: JSON.stringify({
                employeeId: employee._id.toString()
            })
        });

        const data = await response.json();

        console.log(`\n📥 Response Status: ${response.status}`);
        console.log(`📥 Response Body:`, JSON.stringify(data, null, 2));

        if (response.ok) {
            console.log('\n✅ TEST PASSED: Assignment Successful!');
        } else {
            console.error('\n❌ TEST FAILED');
        }

    } catch (error) {
        console.error('\n💥 TEST ERROR:', error.message);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected.');
        process.exit();
    }
};

runTest();
