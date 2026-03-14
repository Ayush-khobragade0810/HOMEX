import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const mapping = {
    'Mumbai': ['Andheri', 'Bandra', 'Borivali'],
    'Pune': ['Hinjewadi', 'Kothrud', 'Viman Nagar'],
    'Delhi': ['Connaught Place', 'Dwarka', 'Saket'],
    'New Delhi': ['Connaught Place', 'Dwarka', 'Saket'], // variation
    'Bangalore': ['Whitefield', 'Indiranagar', 'Koramangala'],
    'Bengaluru': ['Whitefield', 'Indiranagar', 'Koramangala'], // variation
    'Los Angeles': ['Hollywood', 'Downtown', 'Beverly Hills'],
    'New York': ['Manhattan', 'Brooklyn', 'Queens']
};

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        console.log("Connected.");

        const citiesColl = mongoose.connection.db.collection('cities');
        const areasColl = mongoose.connection.db.collection('areas');

        const cities = await citiesColl.find().toArray();
        console.log(`Loaded ${cities.length} cities.`);

        for (const cityName in mapping) {
            // Find city (case-insensitive)
            const city = cities.find(c => c.cityName.toLowerCase() === cityName.toLowerCase());

            if (city) {
                console.log(`Found City '${city.cityName}' with ID: ${city.cityId}`);

                const areaNames = mapping[cityName];
                const result = await areasColl.updateMany(
                    { areaName: { $in: areaNames } },
                    { $set: { cityId: city.cityId } }
                );

                if (result.modifiedCount > 0) {
                    console.log(`  ✅ Updated ${result.modifiedCount} areas to CityID ${city.cityId}`);
                }
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
};

run();
