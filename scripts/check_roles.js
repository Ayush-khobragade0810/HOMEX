import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env vars
dotenv.config({ path: join(__dirname, '../.env') });

// Import User model (adjust path as needed)
import User from '../models/User.js';

const checkRoles = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to DB');

        const users = await User.find({}, 'name email role');
        console.log('\n=== USER ROLES ===');
        console.table(users.map(u => ({
            id: u._id.toString(),
            name: u.name,
            email: u.email,
            role: u.role
        })));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

checkRoles();
