import Payment from '../models/Payment.js';
import UpcomingPayment from '../models/UpcomingPayment.js';
import Withdrawal from '../models/Withdrawal.js';
import Employee from '../models/adminEmployee.js'; // Ensure correct path to Employee model
import Booking from '../models/Booking.js';
import mongoose from 'mongoose';
import { startOfDay, endOfDay, subDays, subMonths, format } from 'date-fns';

class PaymentService {
    constructor() { }

    async getDashboardData(employeeId, filters = {}) {
        try {
            const { timeRange = 'all', status = 'all' } = filters;
            const empId = parseInt(employeeId);

            // Auto-heal: create Payment documents for completed bookings that
            // don't have one yet. Batched — one read for the existing payments,
            // one insertMany, one $inc — because this runs on every dashboard
            // load and the database is remote (~37ms per round trip).
            const assignedToEmployee = (emp) => ({
                $or: [
                    { 'assignedTo.technicianId': emp._id },
                    { assignedTo: emp._id }
                ],
                status: { $regex: /completed/i }
            });

            // `avatar` can hold a large inline image on older records; never needed here.
            const empDoc = await Employee.findOne({ empId }).select('-avatar').lean();

            if (empDoc) {
                const [completedBookings, existingPayments] = await Promise.all([
                    // Skip fields this never reads; assignedTo.avatar can hold a
                    // large inline image on older records.
                    Booking.find(assignedToEmployee(empDoc))
                        .select('-assignedTo.avatar -history -statusTimeline')
                        .lean(),
                    Payment.find({ empId }).select('serviceId').lean()
                ]);

                const alreadyPaid = new Set(existingPayments.map((p) => String(p.serviceId)));
                const missing = completedBookings.filter((b) => !alreadyPaid.has(String(b.bookingId)));

                if (missing.length) {
                    const lastPayment = await Payment.findOne().sort({ paymentId: -1 }).select('paymentId').lean();
                    let nextPaymentId = lastPayment ? lastPayment.paymentId + 1 : 1001;
                    let earnedTotal = 0;

                    const newPayments = missing.map((booking) => {
                        const collected = booking.payment?.amount || booking.billing?.grandTotal || booking.serviceDetails?.price || 0;
                        const commissionRate = 30;
                        const commission = Math.round(collected * (commissionRate / 100) * 100) / 100;
                        const baseRate = Math.round((collected - commission) * 100) / 100;
                        const durationHours = ((booking.serviceDetails?.duration || 60) / 60) || 1;
                        earnedTotal += baseRate;

                        return {
                            paymentId: nextPaymentId++,
                            empId: empDoc.empId,
                            employee: empDoc._id,
                            serviceId: booking.bookingId,
                            customer: {
                                name: booking.contactIdInfo?.fullName || booking.contactInfo?.fullName || booking.userId?.name || 'Customer',
                                email: booking.contactIdInfo?.email || booking.contactInfo?.email || booking.userId?.email || '',
                                phone: booking.contactIdInfo?.phoneNumber || booking.contactInfo?.phoneNumber || booking.userId?.phone || '',
                                address: booking.location?.completeAddress || booking.location?.address || ''
                            },
                            serviceType: booking.serviceDetails?.title || 'Service',
                            amount: collected,
                            commission,
                            commissionRate,
                            baseRate,
                            hours: durationHours,
                            date: booking.completedAt || booking.updatedAt || new Date(),
                            status: 'completed',
                            paymentMethod: booking.payment?.method || 'cash',
                            transactionId: booking.payment?.transactionId || `TXN-${Date.now()}-${nextPaymentId}`
                        };
                    });

                    await Payment.insertMany(newPayments, { ordered: false });
                    // $inc, not save(): saving the document would rewrite every
                    // field (including a large inline avatar) on each heal.
                    await Employee.updateOne(
                        { _id: empDoc._id },
                        { $inc: { walletBalance: earnedTotal, earnings: earnedTotal } }
                    );
                }
            }

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

            // Everything below is independent, so issue it in parallel: on a
            // remote database the round trips dominate the response time.
            const paymentsPromise = Payment.find(query)
                .sort({ date: -1 })
                .limit(100)
                .lean();

            const statsPromise = Payment.aggregate([
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

            const paymentMethodsPromise = Payment.aggregate([
                { $match: { empId: empId, status: 'completed' } },
                {
                    $group: {
                        _id: '$paymentMethod',
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount' },
                    },
                },
            ]);

            const upcomingBookingsPromise = empDoc
                ? Booking.find({
                    $or: [
                        { 'assignedTo.technicianId': empDoc._id },
                        { assignedTo: empDoc._id }
                    ],
                    status: { $in: ['ASSIGNED', 'assigned', 'ACCEPTED', 'CONFIRMED', 'IN_PROGRESS', 'NAVIGATING', 'STARTED', 'in_progress', 'scheduled', 'confirmed'] }
                })
                    .select('-assignedTo.avatar -history -statusTimeline')
                    .populate('userId', 'name email phone')
                    .sort({ 'schedule.preferredDate': 1 })
                    .limit(5)
                    .lean()
                : Promise.resolve([]);

            const dbUpcomingPromise = UpcomingPayment.find({
                empId: empId,
                status: { $ne: 'completed' },
            })
                .sort({ scheduledDate: 1 })
                .limit(5)
                .lean();

            const [
                payments,
                statsAggregation,
                lastWeekEarnings,
                thisWeekEarnings,
                paymentMethodsAgg,
                bookings,
                dbUpcoming,
                earningsTrend
            ] = await Promise.all([
                paymentsPromise,
                statsPromise,
                this.getPeriodEarnings(empId, subDays(now, 14), subDays(now, 7)),
                this.getPeriodEarnings(empId, subDays(now, 7), now),
                paymentMethodsPromise,
                upcomingBookingsPromise,
                dbUpcomingPromise,
                this.getEarningsTrend(empId, 7)
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
                thisWeekEarnings: thisWeekEarnings || 0,
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

            if (lastWeekEarnings > 0) {
                stats.weeklyGrowth = Math.round(((thisWeekEarnings - lastWeekEarnings) / lastWeekEarnings) * 100);
            }

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

            const mappedUpcoming = bookings.map(b => {
                    const durationHours = (b.serviceDetails?.duration || 60) / 60;
                    const estimatedAmount = b.billing?.grandTotal || b.serviceDetails?.price || 0;
                    return {
                        _id: b._id,
                        upcomingId: b.bookingId,
                        empId: empId,
                        serviceId: b.bookingId,
                        estimatedAmount: estimatedAmount,
                        scheduledDate: b.schedule?.preferredDate,
                        customer: {
                            name: b.contactIdInfo?.fullName || b.contactInfo?.fullName || b.userId?.name || 'Guest',
                            phone: b.contactIdInfo?.phoneNumber || b.userId?.phone || '',
                            email: b.contactIdInfo?.email || b.userId?.email || ''
                        },
                        serviceType: b.serviceDetails?.title || 'Service',
                        hours: durationHours,
                        hourlyRate: durationHours > 0 ? estimatedAmount / durationHours : estimatedAmount,
                    status: 'scheduled'
                };
            });

            const upcomingPayments = mappedUpcoming.length > 0 ? mappedUpcoming : dbUpcoming;

            // Wallet balance comes from the employee document already read above.
            const walletBalance = empDoc?.walletBalance || 0;

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
            const { startDate, endDate, status, timeRange } = filters;
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
            } else if (timeRange) {
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
