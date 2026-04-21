import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from Backend root
dotenv.config({ path: path.join(__dirname, '../.env') });

async function dropGhostIndex() {
    const mongoUri = process.env.MONGO_URI;
    
    if (!mongoUri) {
        console.error('❌ Error: MONGO_URI not found in .env file');
        process.exit(1);
    }

    console.log('🔗 Connecting to MongoDB...');
    
    try {
        await mongoose.connect(mongoUri);
        console.log('✅ Connected successfully.');

        const dbName = mongoose.connection.name;
        console.log(`📂 Database: ${dbName}`);

        const areasCollection = mongoose.connection.collection('areas');
        
        // 1. List all indexes first
        console.log('🔍 Fetching current indexes for "areas" collection...');
        const indexes = await areasCollection.indexes();
        
        console.log('📌 Found indexes:');
        indexes.forEach(idx => console.log(`   - ${idx.name} (${JSON.stringify(idx.key)})`));

        // 2. Check for areaId_1
        const hasAreaIdIndex = indexes.some(idx => idx.name === 'areaId_1');

        if (hasAreaIdIndex) {
            console.log('⚠️  Ghost index "areaId_1" detected.');
            console.log('🧹 Dropping index "areaId_1"...');
            
            await areasCollection.dropIndex('areaId_1');
            
            console.log('✨ SUCCESS: Index "areaId_1" has been dropped.');
        } else {
            console.log('ℹ️  Index "areaId_1" was not found. It might have been dropped already.');
        }

        // 3. Optional: Check for duplicate nulls that might block future unique indexes
        const nullCount = await areasCollection.countDocuments({ areaId: { $exists: false } });
        console.log(`📝 Note: There are ${nullCount} documents without an "areaId" field.`);

    } catch (error) {
        console.error('❌ FATAL ERROR:');
        console.error(error.message);
        
        if (error.message.includes('ECONNREFUSED') || error.message.includes('querySrv')) {
            console.log('\n💡 TROUBLESHOOTING TIP:');
            console.log('This looks like a network or whitelist issue.');
            console.log('Please ensure your IP is whitelisted in MongoDB Atlas or check your internet connection.');
        }
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB.');
        process.exit(0);
    }
}

dropGhostIndex();
