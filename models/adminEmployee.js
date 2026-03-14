import mongoose from "mongoose";
import AutoIncrementFactory from "mongoose-sequence";

const AutoIncrementPlugin = AutoIncrementFactory(mongoose);

const employeeSchema = new mongoose.Schema({
    empId: { type: Number, unique: true },
    empName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, default: "" },
    role: { type: String, default: "Employee", required: true },

    // Fields for location, matching the frontend form
    countryId: { type: Number, required: true },
    stateId: { type: Number, required: true },
    cityId: { type: Number, required: true },
    areaId: { type: Number, required: true },

    // Fields added to match the frontend component's needs
    earnings: { type: Number, default: 0, required: true },
    status: { type: String, default: 'Active', enum: ['Active', 'Inactive'] },

    // Other profile fields from your original schema
    address: String,
    joinDate: { type: Date, default: Date.now },
    bio: String,
    avatar: { type: String, default: "DP" },
    specialties: [String],
    certifications: [String],
    rating: { type: Number, default: 0 },
    completedJobs: { type: Number, default: 0 },
    settings: {
        notifications: { type: Boolean, default: true },
        darkMode: { type: Boolean, default: false },
        emailAlerts: { type: Boolean, default: true },
        twoFactor: { type: Boolean, default: false },
        smsNotifications: { type: Boolean, default: true }
    },
    statistics: {
        totalEarnings: { type: Number, default: 0 },
        hoursWorked: { type: Number, default: 0 },
    },
    paymentMethods: [{
        type: { type: String, enum: ['bank', 'upi'], required: true },
        accountHolder: String,
        accountNumber: String, // or UPI ID
        ifsc: String,
        bankName: String,
        isDefault: { type: Boolean, default: false },
        addedAt: { type: Date, default: Date.now }
    }],
    walletBalance: { type: Number, default: 0 } // Track withdrawable balance
});

// This plugin will automatically create and increment the empId
employeeSchema.plugin(AutoIncrementPlugin, { inc_field: 'empId', start_seq: 101 });

export default mongoose.models.Employee || mongoose.model("Employee", employeeSchema);