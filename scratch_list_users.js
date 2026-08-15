import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/homex';

async function run() {
    try {
        await mongoose.connect(mongoURI);
        console.log('Connected to DB');
        const db = mongoose.connection.db;

        const users = await db.collection('users').find({}).toArray();
        console.log(`Found ${users.length} users:`);
        users.forEach(u => {
            console.log(` - Email: ${u.email}, Role: ${u.role}, Name: ${u.name}`);
        });

        await mongoose.disconnect();
    } catch (e) {
        console.error('Error:', e);
    }
}

run();
