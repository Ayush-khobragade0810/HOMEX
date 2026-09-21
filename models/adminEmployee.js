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
    // Areas are keyed by Mongo _id, not a numeric id — the Area model stores
    // location as strings (areaName/city/state/country) and has no numeric key.
    // Keep this a String so the _id returned by /api/areas can be stored here.
    areaId: { type: String, required: true },

    // Fields added to match the frontend component's needs
    earnings: { type: Number, default: 0, required: true },
    status: { type: String, default: 'Active', enum: ['Active', 'Inactive'] },

    // When this employee takes work. Set by the employee from their dashboard;
    // admins can't assign a booking that falls outside it (see utils/availability.js).
    availability: {
        available: { type: Boolean, default: true },
        // 0 = Sunday … 6 = Saturday
        workingDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
        startTime: { type: String, default: '09:00' }, // local business time, HH:MM
        endTime: { type: String, default: '18:00' },
        updatedAt: Date
    },

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
    walletBalance: { type: Number, default: 0 }, // Track withdrawable balance

    // Paid subscription gating job access. Rules live in utils/subscription.js.
    subscription: {
        // Grandfathered employees (existed before subscriptions): full access,
        // and no per-service fee since they never paid in a balance.
        exempt: { type: Boolean, default: false },
        // Prepaid credit in rupees. Top-ups add to it; each accepted service
        // deducts the service fee. Only ever changed through
        // services/serviceFeeService.js so it stays in step with the ledger.
        balance: { type: Number, default: 0 },
        // First approved payment. Having one grants dashboard access even when
        // the balance is too low to take new services.
        activatedAt: Date,
        expiresAt: Date, // legacy (30-day model); no longer read
        // Payment the employee reported, awaiting admin verification.
        pendingRequest: {
            transactionId: { type: String, trim: true },
            paymentMethod: { type: String, enum: ['upi', 'bank', 'cash', 'other'] },
            amount: Number,
            paidOn: Date,
            note: { type: String, trim: true },
            submittedAt: Date
        },
        lastRejection: {
            transactionId: String,
            reason: String,
            at: Date
        },
        history: [{
            action: { type: String, enum: ['submitted', 'approved', 'rejected'], required: true },
            transactionId: String,
            paymentMethod: String,
            amount: Number,
            periodStart: Date,
            periodEnd: Date,
            reason: String,
            by: { type: mongoose.Schema.Types.ObjectId },
            at: { type: Date, default: Date.now }
        }]
    }
});

employeeSchema.index({ 'subscription.pendingRequest.submittedAt': 1 });

// This plugin will automatically create and increment the empId
employeeSchema.plugin(AutoIncrementPlugin, { inc_field: 'empId', start_seq: 101 });

export default mongoose.models.Employee || mongoose.model("Employee", employeeSchema);