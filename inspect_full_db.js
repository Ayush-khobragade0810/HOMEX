import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

        const cities = await mongoose.connection.db.collection('cities').find().toArray();
        const areas = await mongoose.connection.db.collection('areas').find().toArray();

        console.log("\n--- CITIES ---");
        cities.forEach(c => console.log(`'${c.cityName}' (ID: ${c.cityId})`));

        console.log("\n--- AREAS ---");
        areas.forEach(a => {
            const match = cities.find(c => c.cityId === a.cityId);
            const status = match ? `LINKED to '${match.cityName}'` : `ORPHAN (CityID: ${a.cityId})`;
            console.log(`'${a.areaName}' -> ${status}`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
};

run();
