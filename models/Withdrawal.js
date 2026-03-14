import mongoose from 'mongoose';
import AutoIncrementFactory from 'mongoose-sequence';

const AutoIncrement = AutoIncrementFactory(mongoose);

const withdrawalSchema = new mongoose.Schema({
    withdrawalId: {
        type: Number,
        unique: true
    },
    empId: {
        type: Number,
        required: true,
        index: true
    },
    amount: {
        type: Number,
        required: true,
        min: 1
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'processed'],
        default: 'pending'
    },
    method: {
        type: String,
        enum: ['bank_transfer', 'upi'],
        required: true
    },
    accountDetails: {
        accountNumber: String,
        ifsc: String,
        bankName: String,
        upiId: String,
        accountHolder: String
    },
    requestedAt: {
        type: Date,
        default: Date.now
    },
    processedAt: Date,
    transactionReference: String,
    remarks: String
}, {
    timestamps: true
});

withdrawalSchema.plugin(AutoIncrement, { inc_field: 'withdrawalId', start_seq: 10001 });

export default mongoose.model('Withdrawal', withdrawalSchema);
