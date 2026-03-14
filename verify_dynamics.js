import mongoose from 'mongoose';
import Employee from './models/adminEmployee.js';
import Booking from './models/Booking.js';
import dotenv from 'dotenv';

dotenv.config();

const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/homax";

async function verify() {
    try {
        await mongoose.connect(mongoUri);
        console.log("Connected to MongoDB");

        const employees = await Employee.find({});
        console.log(`Found ${employees.length} employees.`);

        const employeeIds = employees.map(e => e._id);
        const allRelevantBookings = await Booking.find({
            "assignedTo.technicianId": { $in: employeeIds }
        });

        console.log(`Found ${allRelevantBookings.length} relevant bookings.`);

        const statsMap = {};
        allRelevantBookings.forEach(booking => {
            const techId = booking.assignedTo?.technicianId?.toString();
            if (!techId) return;

            if (!statsMap[techId]) {
                statsMap[techId] = {
                    totalEarnings: 0,
                    currentTask: null
                };
            }

            if (['completed', 'COMPLETED'].includes(booking.status)) {
                statsMap[techId].totalEarnings += (booking.payment?.amount || booking.serviceDetails?.price || 0);
            }

            const activeStatuses = ['assigned', 'ASSIGNED', 'in_progress', 'IN_PROGRESS', 'navigating', 'NAVIGATING', 'started', 'STARTED', 'ACCEPTED'];
            if (!statsMap[techId].currentTask && activeStatuses.includes(booking.status)) {
                statsMap[techId].currentTask = booking;
            }
        });

        employees.forEach(emp => {
            const stats = statsMap[emp._id.toString()] || { totalEarnings: 0, currentTask: null };
            console.log(`--- Employee: ${emp.empName} ---`);
            console.log(`DB Earnings: ${emp.earnings}`);
            console.log(`Dynamic Earnings: ${stats.totalEarnings}`);
            console.log(`Current Task: ${stats.currentTask ? stats.currentTask.bookingId + " (" + stats.currentTask.status + ")" : "None"}`);
            if (stats.currentTask) {
                console.log(`Backend Task Object Location:`, stats.currentTask.location);
                const loc = stats.currentTask.location?.completeAddress || stats.currentTask.location?.address || "N/A";
                console.log(`Calculated Location String for Frontend: ${loc}`);
            }
        });

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

verify();
