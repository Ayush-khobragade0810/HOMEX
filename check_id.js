
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
import Employee from './models/adminEmployee.js';
import Service from './models/Service.js';
import Booking from './models/Booking.js';

dotenv.config();

const checkId = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const idToCheck = '6970d0185bc675f04e08899a'; // ID from user logs

        console.log(`Checking ID: ${idToCheck}`);

        // Check if ID is User
        const user = await User.findById(idToCheck);
        if (user) console.log('✅ Found USER:', user.name, user.email);
        else console.log('❌ Not a USER');

        // Check if ID is Employee
        const emp = await Employee.findById(idToCheck);
        if (emp) {
            console.log('✅ Found EMPLOYEE by _id:', emp.empName, emp.empId);

            // Check Services for THIS Employee (114)
            const services114 = await Service.find({ empId: emp.empId });
            console.log(`👉 Services for empId ${emp.empId}: ${services114.length}`);

            // Check Services for OTHER Employee (112)
            const services112 = await Service.find({ empId: 112 });
            console.log(`👉 Services for empId 112: ${services112.length}`);

        } else {
            console.log('❌ Not an EMPLOYEE by _id');
        }

        console.log('--- Done ---');
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

checkId();
