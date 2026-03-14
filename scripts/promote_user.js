import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import User from '../models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const promoteUser = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        // Find the user seen in logs (assuming it's the main one)
        const user = await User.findOne({ email: /gmail\.com$/ });

        if (user) {
            user.role = 'admin';
            await user.save();
            console.log(`✅ SUCCESS: Promoted user ${user.email} to 'admin'.`);
            console.log(`PLEASE LOGOUT AND LOGIN AGAIN.`);
        } else {
            console.log('❌ No user found with gmail.com');
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

promoteUser();
