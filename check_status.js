
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import Service from './models/Service.js';

dotenv.config();

const checkStatuses = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        console.log('--- Checking Service Statuses for Emp 114 ---');
        const services = await Service.find({ empId: 114 });

        const statuses = {};
        services.forEach(s => {
            statuses[s.status] = (statuses[s.status] || 0) + 1;
        });

        console.log('Unique Statuses Found:', statuses);
        fs.writeFileSync('status_log.txt', JSON.stringify(statuses, null, 2));
        console.log('Written to status_log.txt');

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

checkStatuses();
