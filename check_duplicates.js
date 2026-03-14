
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Service from './models/Service.js';

dotenv.config();

const checkDuplicates = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        console.log('--- Checking for Duplicate Service IDs (Emp 114) ---');
        const services = await Service.find({ empId: 114 });

        const idCounts = {};
        services.forEach(s => {
            idCounts[s.serviceId] = (idCounts[s.serviceId] || 0) + 1;
        });

        const duplicates = Object.entries(idCounts).filter(([id, count]) => count > 1);

        if (duplicates.length > 0) {
            console.log('❌ Duplicates Found:', duplicates);
            // List details of duplicates
            for (const [id, count] of duplicates) {
                const dups = services.filter(s => s.serviceId == id);
                console.log(`-- ID ${id} (${count} copies) --`);
                dups.forEach(d => console.log(`   _id: ${d._id} | Status: ${d.status}`));
            }
        } else {
            console.log('✅ No duplicates found.');
        }

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

checkDuplicates();
