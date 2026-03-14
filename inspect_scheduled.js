
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import Service from './models/Service.js';

dotenv.config();

const inspectScheduled = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        console.log('--- Inspecting Scheduled Services for Emp 114 ---');
        const services = await Service.find({
            empId: 114,
            status: { $regex: /scheduled|pending|assigned/i }
        });

        let output = '';
        output += `Found ${services.length} scheduled services.\n`;

        services.forEach(s => {
            output += '------------------------------------------------\n';
            output += `_id: ${s._id} (Type: ${typeof s._id})\n`;
            // Check constructor name for accurate type check
            output += `_id Constructor: ${s._id.constructor.name}\n`;
            output += `serviceId: ${s.serviceId} (Type: ${typeof s.serviceId})\n`;
            output += `status: ${s.status}\n`;
            output += `Full Doc: ${JSON.stringify(s, null, 2)}\n`;
        });

        fs.writeFileSync('inspect_log.txt', output);
        console.log('Written to inspect_log.txt');

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

inspectScheduled();
