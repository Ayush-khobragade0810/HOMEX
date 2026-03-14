
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Service from './models/Service.js';

dotenv.config();

const migrateData = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        const oldId = 112;
        const newId = 114;

        console.log(`Migrating Services from Emp ${oldId} to Emp ${newId}...`);

        const result = await Service.updateMany(
            { empId: oldId },
            { $set: { empId: newId } }
        );

        console.log(`✅ Migrated ${result.modifiedCount} services.`);

        // Also check if there are Bookings for the old user?
        // Skipped for now, focusing on Service legacy data as that's what was missing (27 records).

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

migrateData();
