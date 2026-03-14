
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

const dropIndex = async () => {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected.');

        const collection = mongoose.connection.collection('users');

        // List indexes
        const indexes = await collection.indexes();
        console.log('📋 Current Indexes:', indexes.map(i => i.name));

        // Drop phone index if exists
        if (indexes.find(i => i.name === 'phone_1')) {
            console.log('🗑️ Dropping phone_1 index...');
            await collection.dropIndex('phone_1');
            console.log('✅ Index dropped.');
        } else {
            console.log('ℹ️ phone_1 index not found.');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('👋 Disconnected.');
        process.exit(0);
    }
};

dropIndex();
