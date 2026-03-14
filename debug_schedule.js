
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Service from './models/Service.js';

dotenv.config();

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected');

        console.log('--- Checking ALL Services ---');
        const services = await Service.find({});
        console.log(`Found ${services.length} services.`);

        services.forEach(s => {
            console.log(`ID: ${s.serviceId} | Emp: ${s.empId} | Status: "${s.status}" | Date: ${s.scheduledDate}`);
        });

        console.log('--- End of Report ---');
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

connectDB();
