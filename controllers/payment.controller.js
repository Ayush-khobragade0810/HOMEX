import Payment from "../models/Payment.js";
import UpcomingPayment from "../models/UpcomingPayment.js";

// Get dashboard payment data for an employee
export const getEmployeePayments = async (req, res) => {
    try {
        const { employeeId } = req.params;

        // Parse employeeId as number since it's stored as Number in models
        const empId = parseInt(employeeId);

        if (isNaN(empId)) {
            return res.status(400).json({ message: "Invalid employee ID format" });
        }

        // Fetch payments and upcoming payments in parallel
        const [payments, upcomingPayments] = await Promise.all([
            Payment.find({ empId }).sort({ date: -1 }),
            UpcomingPayment.find({ empId }).sort({ scheduledDate: 1 })
        ]);

        // Calculate statistics
        const stats = {
            totalEarnings: 0,
            pendingAmount: 0,
            totalCommission: 0,
            averageEarning: 0,
            completedCount: 0,
            pendingCount: 0,
            weeklyGrowth: 0, // Placeholder logic
            monthlyTarget: 5000 // Placeholder or could be fetched from employee settings
        };

        const paymentMethods = {
            credit_card: 0,
            cash: 0,
            bank_transfer: 0,
            digital_wallet: 0
        };

        // Process payments for stats
        payments.forEach(payment => {
            if (payment.status === 'completed') {
                stats.totalEarnings += payment.amount;
                stats.totalCommission += payment.commission || 0;
                stats.completedCount++;
            } else if (payment.status === 'pending' || payment.status === 'processing') {
                stats.pendingAmount += payment.amount;
                stats.pendingCount++;
            }

            if (payment.paymentMethod && paymentMethods[payment.paymentMethod] !== undefined) {
                paymentMethods[payment.paymentMethod]++;
            } else if (payment.paymentMethod) {
                // specific handling if other methods appear, or just ignore
            }
        });

        if (stats.completedCount > 0) {
            stats.averageEarning = stats.totalEarnings / stats.completedCount;
        }

        // Calculate Weekly Growth (Simple comparison of this week vs last week earnings)
        const now = new Date();
        const startOfThisWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        const startOfLastWeek = new Date(now.setDate(now.getDate() - 7));

        let thisWeekEarnings = 0;
        let lastWeekEarnings = 0;

        payments.forEach(payment => {
            const paymentDate = new Date(payment.date);
            if (payment.status === 'completed') {
                if (paymentDate >= startOfThisWeek) {
                    thisWeekEarnings += payment.amount;
                } else if (paymentDate >= startOfLastWeek && paymentDate < startOfThisWeek) {
                    lastWeekEarnings += payment.amount;
                }
            }
        });

        if (lastWeekEarnings > 0) {
            stats.weeklyGrowth = Math.round(((thisWeekEarnings - lastWeekEarnings) / lastWeekEarnings) * 100);
        } else if (thisWeekEarnings > 0) {
            stats.weeklyGrowth = 100; // 100% growth if started from 0
        }

        // Prepare Earnings Trend (Last 7 days)
        const earningsTrend = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toLocaleDateString('en-US', { weekday: 'short' });

            // Find payments for this day
            const dailyTotal = payments
                .filter(p => {
                    const pDate = new Date(p.date);
                    return pDate.getDate() === d.getDate() &&
                        pDate.getMonth() === d.getMonth() &&
                        pDate.getFullYear() === d.getFullYear() &&
                        p.status === 'completed';
                })
                .reduce((sum, p) => sum + p.amount, 0);

            earningsTrend.push({
                day: dateStr,
                amount: dailyTotal
            });
        }

        res.status(200).json({
            payments,
            upcomingPayments,
            stats,
            paymentMethods,
            earningsTrend
        });

    } catch (error) {
        console.error("Error fetching employee payments:", error);
        res.status(500).json({ message: "Server error fetching payments" });
    }
};

// Export payments (CSV)
export const exportPayments = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const empId = parseInt(employeeId);

        if (isNaN(empId)) {
            return res.status(400).json({ message: "Invalid employee ID format" });
        }

        const payments = await Payment.find({ empId }).sort({ date: -1 });

        // Simple CSV generation
        const fields = ['paymentId', 'serviceType', 'amount', 'commission', 'status', 'date', 'paymentMethod'];
        const csv = [
            fields.join(','),
            ...payments.map(p => fields.map(field => {
                let val = p[field];
                if (field === 'date') val = new Date(val).toLocaleDateString();
                return JSON.stringify(val);
            }).join(','))
        ].join('\n');

        res.header('Content-Type', 'text/csv');
        res.attachment(`payments-${employeeId}.csv`);
        res.send(csv);

    } catch (error) {
        console.error("Error exporting payments:", error);
        res.status(500).json({ message: "Server error exporting payments" });
    }
};
