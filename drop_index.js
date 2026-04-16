import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(async () => {
    console.log('MongoDB Connected');
    try {
        const result = await mongoose.connection.collection('areas').dropIndex('areaName_1_city_1_state_1_country_1');
        console.log('Index dropped successfully:', result);
    } catch (error) {
        if (error.codeName === 'IndexNotFound') {
            console.log('Index not found, probably already dropped or never existed.');
        } else {
            console.error('Error dropping index:', error);
        }
    }
    process.exit(0);
}).catch(err => {
    console.error('Connection error:', err);
    process.exit(1);
});
