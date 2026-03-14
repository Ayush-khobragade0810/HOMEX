import dotenv from 'dotenv';
import mongoose from 'mongoose';
import paymentService from '../services/paymentService.js';
import analyticsService from '../services/analyticsService.js';
import exportService from '../services/exportService.js';
import Payment from '../models/Payment.js';

dotenv.config();

console.log('✅ Dependencies imported successfully.');

const verifyServices = async () => {
    try {
        console.log('🔍 Verifying Service Objects...');
        if (!paymentService.getDashboardData) throw new Error('paymentService.getDashboardData missing');
        if (!analyticsService.getMonthlyAnalytics) throw new Error('analyticsService.getMonthlyAnalytics missing');
        if (!exportService.generateCSV) throw new Error('exportService.generateCSV missing');

        console.log('✅ Service methods verified.');

        console.log('🔍 Verifying Payment Model...');
        if (!Payment.schema.paths.totalAmount) throw new Error('Payment model missing totalAmount');
        if (!Payment.schema.paths.empId) throw new Error('Payment model missing empId');

        console.log('✅ Payment model verified.');

        console.log('🎉 Merge verification successful! All modules load correctly.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Verification failed:', error);
        process.exit(1);
    }
};

verifyServices();
