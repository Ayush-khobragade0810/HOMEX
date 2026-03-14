import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
        console.log("Connected.");

        const citiesColl = mongoose.connection.db.collection('cities');
        const areasColl = mongoose.connection.db.collection('areas');

        // Check for New York
        let newYork = await citiesColl.findOne({ cityName: 'New York' });

        if (!newYork) {
            console.log("New York not found. Creating...");
            // Find max ID
            const lastCity = await citiesColl.find().sort({ cityId: -1 }).limit(1).toArray();
            const newId = (lastCity[0]?.cityId || 0) + 1;

            // Need countryId and stateId.. assuming mappings or dummy
            // For now, let's find 'Los Angeles' and borrow country/state if possible, or create defaults.
            // Actually, allow invalid foreign keys for Country/State as simpler fix for City lookup

            // Better: Find "USA" country if exists
            const usCountry = await mongoose.connection.db.collection('countries').findOne({ countryName: 'USA' })
                || await mongoose.connection.db.collection('countries').findOne({ countryName: 'United States' });

            // Find a state like "New York"
            const nyState = await mongoose.connection.db.collection('states').findOne({ stateName: 'New York' });

            newYork = {
                cityId: newId,
                cityName: 'New York',
                stateId: nyState?.stateId || 999,
                countryId: usCountry?.countryId || 999
            };

            await citiesColl.insertOne(newYork);
            console.log(`Created 'New York' with ID: ${newId}`);
        } else {
            console.log(`Found 'New York' with ID: ${newYork.cityId}`);
        }

        // Link Manhattan
        const manhattan = await areasColl.findOne({ areaName: 'Manhattan' });
        if (manhattan) {
            if (manhattan.cityId !== newYork.cityId) {
                await areasColl.updateOne(
                    { areaName: 'Manhattan' },
                    { $set: { cityId: newYork.cityId } }
                );
                console.log(`Linked 'Manhattan' to 'New York' (ID: ${newYork.cityId})`);
            } else {
                console.log("'Manhattan' is already linked to 'New York'.");
            }
        } else {
            console.log("'Manhattan' area not found!");
        }

        // Link others if needed
        const nyAreas = ['Brooklyn', 'Queens'];
        await areasColl.updateMany(
            { areaName: { $in: nyAreas } },
            { $set: { cityId: newYork.cityId } }
        );


    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
};

run();
