import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Employee from '../models/adminEmployee.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ MongoDB Connected');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
};

// Sync existing employee users to Employee collection
const syncEmployees = async () => {
    try {
        console.log('\n🔄 Starting employee sync...\n');

        // Find all users with role="employee"
        const employeeUsers = await User.find({ role: 'employee' });
        console.log(`Found ${employeeUsers.length} employee users in User collection`);

        let created = 0;
        let skipped = 0;

        for (const user of employeeUsers) {
            // Check if Employee record already exists
            const existingEmployee = await Employee.findOne({ email: user.email });

            if (existingEmployee) {
                console.log(`⏭️  Skipped: ${user.email} (already exists)`);
                skipped++;
                continue;
            }

            // Create new Employee record
            const employee = new Employee({
                empName: user.name,
                email: user.email,
                phone: user.phone || '',
                role: 'Service Technician',
                countryId: 1,
                stateId: 1,
                cityId: 1,
                areaId: 1,
                earnings: 0,
                status: 'Active',
                bio: '',
                specialties: [],
                certifications: [],
                rating: 0,
                completedJobs: 0
            });

            await employee.save();
            console.log(`✅ Created: ${user.email} (empId: ${employee.empId})`);
            created++;
        }

        console.log(`\n📊 Summary:`);
        console.log(`   Total employee users: ${employeeUsers.length}`);
        console.log(`   Created: ${created}`);
        console.log(`   Skipped: ${skipped}`);
        console.log('\n✨ Employee sync completed!\n');

    } catch (error) {
        console.error('❌ Error syncing employees:', error);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Database connection closed');
    }
};

// Run the script
(async () => {
    await connectDB();
    await syncEmployees();
})();
