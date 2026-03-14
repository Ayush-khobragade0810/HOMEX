import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

        const cities = await mongoose.connection.db.collection('cities').find().toArray();
        const areas = await mongoose.connection.db.collection('areas').find().toArray();

        console.log("--- ALL CITIES ---");
        // Print nicely
        cities.forEach(c => {
            console.log(`[${c.cityId}] ${c.cityName} (IDType: ${typeof c.cityId})`);
        });

        console.log("\n--- ALL AREAS (failures only) ---");
        let failureCount = 0;
        areas.forEach(a => {
            const match = cities.find(c => c.cityId === a.cityId);
            if (!match) {
                failureCount++;
                console.log(`FAIL: [Area: ${a.areaName}] has cityId: ${a.cityId} (Type: ${typeof a.cityId}) -> No City Match`);
            }
        });

        if (failureCount === 0) {
            console.log("No failures found! All areas have valid cities.");
        } else {
            console.log(`\nFound ${failureCount} orphaned areas.`);
        }

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
};

run();
