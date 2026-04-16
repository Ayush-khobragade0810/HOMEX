import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Area from './models/Area.js';
import Country from './models/Country.js';
import State from './models/State.js';
import City from './models/City.js';

dotenv.config();

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(async () => {
    console.log('MongoDB Connected for Cleanup');
    try {
        // Clear old fragmented data
        const areaResult = await Area.deleteMany({});
        console.log(`Deleted ${areaResult.deletedCount} legacy areas`);

        const cityResult = await City.deleteMany({});
        console.log(`Deleted ${cityResult.deletedCount} legacy cities`);
        
        const stateResult = await State.deleteMany({});
        console.log(`Deleted ${stateResult.deletedCount} legacy states`);
        
        const countryResult = await Country.deleteMany({});
        console.log(`Deleted ${countryResult.deletedCount} legacy countries`);

        // Seed fresh master entities
        await Area.create([
            { areaName: 'Downtown', city: 'New York', state: 'NY', country: 'USA' },
            { areaName: 'Beltarodi', city: 'Nagpur', state: 'Maharashtra', country: 'India' },
            { areaName: 'Manish Nagar', city: 'Nagpur', state: 'Maharashtra', country: 'India' },
            { areaName: 'Koramangala', city: 'Bangalore', state: 'Karnataka', country: 'India' }
        ]);
        console.log('✅ Successfully seeded clean master Area locations.');
        
    } catch (error) {
        console.error('❌ Error dropping old items:', error);
    }
    process.exit(0);
}).catch(err => {
    console.error('Connection error:', err);
    process.exit(1);
});
