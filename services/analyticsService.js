import Payment from '../models/Payment.js';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';

class AnalyticsService {
    async getMonthlyAnalytics(employeeId, months = 6) {
        const now = new Date();
        const analytics = [];

        for (let i = 0; i < months; i++) {
            const monthStart = startOfMonth(subMonths(now, i));
            const monthEnd = endOfMonth(subMonths(now, i));

            // Note: Ensuring employeeId is correct type (Number or ObjectId) matches schema

            const monthData = await Payment.aggregate([
                {
                    $match: {
                        empId: parseInt(employeeId), // Adapted field name from 'employee' to 'empId' if needed, checking schema next
                        date: { $gte: monthStart, $lte: monthEnd },
                    },
                },
                {
                    $facet: {
                        total: [
                            {
                                $group: {
                                    _id: null,
                                    earnings: { $sum: '$amount' }, // Adapted 'totalAmount' to 'amount'
                                    commission: { $sum: '$commission' },
                                    count: { $sum: 1 },
                                    hours: { $sum: '$hours' },
                                },
                            },
                        ],
                        byStatus: [
                            {
                                $group: {
                                    _id: '$status',
                                    count: { $sum: 1 },
                                    amount: { $sum: '$amount' },
                                },
                            },
                        ],
                        byMethod: [
                            { $match: { status: 'completed' } },
                            {
                                $group: {
                                    _id: '$paymentMethod',
                                    count: { $sum: 1 },
                                    amount: { $sum: '$amount' },
                                },
                            },
                        ],
                        topServices: [
                            { $match: { status: 'completed' } },
                            {
                                $group: {
                                    _id: '$serviceType',
                                    count: { $sum: 1 },
                                    amount: { $sum: '$amount' },
                                    avgAmount: { $avg: '$amount' },
                                },
                            },
                            { $sort: { amount: -1 } },
                            { $limit: 5 },
                        ],
                    },
                },
            ]);

            analytics.push({
                month: format(monthStart, 'MMM yyyy'),
                startDate: monthStart,
                total: monthData[0]?.total[0] || {
                    earnings: 0,
                    commission: 0,
                    count: 0,
                    hours: 0,
                },
                byStatus: monthData[0]?.byStatus || [],
                byMethod: monthData[0]?.byMethod || [],
                topServices: monthData[0]?.topServices || [],
            });
        }

        return analytics;
    }

    async getYearlySummary(employeeId, year) {
        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year, 11, 31, 23, 59, 59);

        const summary = await Payment.aggregate([
            {
                $match: {
                    empId: parseInt(employeeId),
                    date: { $gte: yearStart, $lte: yearEnd },
                },
            },
            {
                $facet: {
                    monthly: [
                        {
                            $group: {
                                _id: { $month: '$date' },
                                earnings: { $sum: '$amount' },
                                commission: { $sum: '$commission' },
                                count: { $sum: 1 },
                            },
                        },
                        { $sort: { _id: 1 } },
                    ],
                    summary: [
                        {
                            $group: {
                                _id: null,
                                totalEarnings: { $sum: '$amount' },
                                totalCommission: { $sum: '$commission' },
                                totalCount: { $sum: 1 },
                                avgEarning: { $avg: '$amount' },
                                maxEarning: { $max: '$amount' },
                                minEarning: { $min: '$amount' },
                                totalHours: { $sum: '$hours' },
                            },
                        },
                    ],
                },
            },
        ]);

        return {
            monthly: summary[0]?.monthly || [],
            summary: summary[0]?.summary[0] || {},
        };
    }
}

export default new AnalyticsService();
