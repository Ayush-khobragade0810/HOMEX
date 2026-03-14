import Payment from '../models/Payment.js';
import UpcomingPayment from '../models/UpcomingPayment.js';
import Withdrawal from '../models/Withdrawal.js';
import Employee from '../models/adminEmployee.js'; // Ensure correct path to Employee model
import { startOfDay, endOfDay, subDays, subMonths, format } from 'date-fns';

class PaymentService {
    constructor() { }

    async getDashboardData(employeeId, filters = {}) {
        try {
            const { timeRange = 'all', status = 'all' } = filters;
            const empId = parseInt(employeeId);

            // Build query
            let query = { empId: empId };

            // Apply time filter
            const now = new Date();
            switch (timeRange) {
                case 'today':
                    query.date = {
                        $gte: startOfDay(now),
                        $lte: endOfDay(now),
                    };
                    break;
                case 'week':
                    query.date = { $gte: subDays(now, 7) };
                    break;
                case 'month':
                    query.date = { $gte: subMonths(now, 1) };
                    break;
                case 'year':
                    query.date = { $gte: subMonths(now, 12) };
                    break;
            }

            // Apply status filter
            if (status !== 'all') {
                query.status = status;
            }

            // Get payments
            const payments = await Payment.find(query)
                .sort({ date: -1 })
                .limit(100)
                .lean();

            // Get stats using aggregation
            const statsAggregation = await Payment.aggregate([
                { $match: { empId: empId } },
                {
                    $facet: {
                        completed: [
                            { $match: { status: 'completed' } },
                            {
                                $group: {
                                    _id: null,
                                    totalEarnings: { $sum: '$amount' }, // Using 'amount' instead of 'totalAmount'
                                    totalCommission: { $sum: '$commission' },
                                    averageEarning: { $avg: '$amount' },
                                    count: { $sum: 1 },
                                    totalHours: { $sum: '$hours' },
                                },
                            },
                        ],
                        pending: [
                            { $match: { status: 'pending' } },
                            {
                                $group: {
                                    _id: null,
                                    totalAmount: { $sum: '$amount' },
                                    count: { $sum: 1 },
                                },
                            },
                        ],
                        processing: [
                            { $match: { status: 'processing' } },
                            {
                                $group: {
                                    _id: null,
                                    totalAmount: { $sum: '$amount' },
                                    count: { $sum: 1 },
                                },
                            },
                        ],
                    },
                },
            ]);

            const stats = {
                totalEarnings: 0,
                pendingAmount: 0,
                processingAmount: 0,
                totalCommission: 0,
                averageEarning: 0,
                completedCount: 0,
                pendingCount: 0,
                processingCount: 0,
                totalHours: 0,
                weeklyGrowth: 0,
                monthlyTarget: 5000,
            };

            if (statsAggregation[0].completed.length > 0) {
                const completed = statsAggregation[0].completed[0];
                stats.totalEarnings = completed.totalEarnings || 0;
                stats.totalCommission = completed.totalCommission || 0;
                stats.averageEarning = Math.round(completed.averageEarning || 0);
                stats.completedCount = completed.count || 0;
                stats.totalHours = completed.totalHours || 0;
            }

            if (statsAggregation[0].pending.length > 0) {
                const pending = statsAggregation[0].pending[0];
                stats.pendingAmount = pending.totalAmount || 0;
                stats.pendingCount = pending.count || 0;
            }

            // Calculate weekly growth (simplified)
            const lastWeekEarnings = await this.getPeriodEarnings(empId, subDays(now, 14), subDays(now, 7));
            const thisWeekEarnings = await this.getPeriodEarnings(empId, subDays(now, 7), now);

            if (lastWeekEarnings > 0) {
                stats.weeklyGrowth = Math.round(((thisWeekEarnings - lastWeekEarnings) / lastWeekEarnings) * 100);
            }

            // Get payment methods distribution
            const paymentMethodsAgg = await Payment.aggregate([
                { $match: { empId: empId, status: 'completed' } },
                {
                    $group: {
                        _id: '$paymentMethod',
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount' },
                    },
                },
            ]);

            const paymentMethods = {
                credit_card: 0,
                cash: 0,
                bank_transfer: 0,
                digital_wallet: 0,
            };

            paymentMethodsAgg.forEach(method => {
                const methodName = method._id;
                if (paymentMethods.hasOwnProperty(methodName)) {
                    paymentMethods[methodName] = method.count;
                }
            });

            // Get upcoming payments (from UpcomingPayment model to match system architecture)
            // Note: Merging logic to include both 'pending' Payments and 'UpcomingPayment' records could be better,
            // but for now, standard Homax flow uses UpcomingPayment for scheduled jobs.
            const upcomingPayments = await UpcomingPayment.find({
                empId: empId,
                status: { $ne: 'completed' }, // Fetch scheduled/pending
            })
                .sort({ scheduledDate: 1 })
                .limit(5)
                .lean();

            // Get earnings trend (last 7 days)
            const earningsTrend = await this.getEarningsTrend(empId, 7);

            // Fetch Employee for wallet balance
            const employee = await Employee.findOne({ empId });
            const walletBalance = employee?.walletBalance || 0;

            // Adjust stats to include wallet info
            stats.walletBalance = walletBalance;

            return {
                payments,
                upcomingPayments,
                stats,
                paymentMethods,
                earningsTrend,
                walletBalance // Explicitly return wallet balance
            };
        } catch (error) {
            console.error('Error in getDashboardData:', error);
            throw error;
        }
    }

    async getPeriodEarnings(employeeId, startDate, endDate) {
        const result = await Payment.aggregate([
            {
                $match: {
                    empId: employeeId,
                    status: 'completed',
                    date: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' },
                },
            },
        ]);

        return result.length > 0 ? result[0].total : 0;
    }

    async getEarningsTrend(employeeId, days = 7) {
        const endDate = new Date();
        const startDate = subDays(endDate, days - 1);

        const earnings = await Payment.aggregate([
            {
                $match: {
                    empId: employeeId,
                    status: 'completed',
                    date: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
                    dayOfWeek: { $first: { $dayOfWeek: '$date' } },
                    amount: { $sum: '$amount' },
                },
            },
            { $sort: { '_id': 1 } },
        ]);

        // Fill missing days with zero
        const result = [];
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        for (let i = 0; i < days; i++) {
            const date = subDays(endDate, days - 1 - i);
            const dateStr = format(date, 'yyyy-MM-dd');
            // Fix day of week index to match array
            const dayOfWeek = date.getDay();

            const earning = earnings.find(e => e._id === dateStr);
            result.push({
                day: dayNames[dayOfWeek],
                date: dateStr,
                amount: earning ? earning.amount : 0,
            });
        }

        return result;
    }

    async exportPayments(employeeId, format = 'csv', filters = {}) {
        try {
            const { startDate, endDate, status } = filters;
            const empId = parseInt(employeeId);

            let query = { empId: empId };

            if (status && status !== 'all') {
                query.status = status;
            }

            if (startDate && endDate) {
                query.date = {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate),
                };
            }

            const payments = await Payment.find(query)
                .sort({ date: -1 })
                .lean();

            return payments;
        } catch (error) {
            console.error('Error in exportPayments:', error);
            throw error;
        }
    }

    async getPaymentById(paymentId, employeeId) {
        return await Payment.findOne({
            _id: paymentId,
            empId: parseInt(employeeId),
        }).lean();
    }

    async requestWithdrawal(empId, amount, methodData) {
        try {
            const employee = await Employee.findOne({ empId: parseInt(empId) });
            if (!employee) throw new Error('Employee not found');

            if (employee.walletBalance < amount) {
                throw new Error('Insufficient wallet balance');
            }

            // Create withdrawal request
            const withdrawal = new Withdrawal({
                empId: parseInt(empId),
                amount,
                method: methodData.type,
                accountDetails: {
                    accountNumber: methodData.accountNumber,
                    ifsc: methodData.ifsc,
                    bankName: methodData.bankName,
                    upiId: methodData.upiId,
                    accountHolder: methodData.accountHolder
                },
                status: 'pending'
            });

            await withdrawal.save();

            // Deduct from wallet immediately
            employee.walletBalance -= amount;
            await employee.save();

            return withdrawal;
        } catch (error) {
            console.error('Error in requestWithdrawal:', error);
            throw error;
        }
    }

    async addPaymentMethod(empId, methodData) {
        try {
            const employee = await Employee.findOne({ empId: parseInt(empId) });
            if (!employee) throw new Error('Employee not found');

            employee.paymentMethods.push(methodData);
            await employee.save();

            return employee.paymentMethods;
        } catch (error) {
            console.error('Error in addPaymentMethod:', error);
            throw error;
        }
    }

    async getEmployeePaymentMethods(empId) {
        const employee = await Employee.findOne({ empId: parseInt(empId) });
        return employee?.paymentMethods || [];
    }
}

export default new PaymentService();
