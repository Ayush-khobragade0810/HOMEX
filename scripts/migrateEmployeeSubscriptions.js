/**
 * One-time setup for employee subscriptions. Safe to re-run; each step only
 * touches employees it hasn't handled yet.
 *
 *  1. Grandfather: employees with no subscription activity at all (they existed
 *     before subscriptions) are marked exempt, so nobody already working gets
 *     locked out.
 *  2. Opening balance: employees whose payment was approved under the earlier
 *     30-day model get that money as balance (no service fees were taken then),
 *     recorded in the ledger as an opening balance.
 *
 *   node scripts/migrateEmployeeSubscriptions.js           # dry run
 *   node scripts/migrateEmployeeSubscriptions.js --apply   # write
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import Employee from '../models/adminEmployee.js';
import SubscriptionLedger from '../models/SubscriptionLedger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/homax';
const APPLY = process.argv.includes('--apply');

const untouched = {
    'subscription.exempt': { $ne: true },
    'subscription.activatedAt': { $exists: false },
    'subscription.expiresAt': { $exists: false },
    'subscription.pendingRequest.submittedAt': { $exists: false },
    'subscription.history.0': { $exists: false }
};

const run = async () => {
    try {
        await mongoose.connect(MONGO_URI);

        // ---- 1. Grandfather ----
        const toExempt = await Employee.find(untouched).select('empId empName email').lean();
        console.log(`1) ${toExempt.length} existing employee(s) to keep active (exempt, no service fee):`);
        toExempt.forEach((e) => console.log(`     #${e.empId}  ${e.empName}  <${e.email}>`));

        // ---- 2. Opening balances ----
        const legacy = await Employee.find({
            'subscription.history': { $elemMatch: { action: 'approved' } },
            'subscription.exempt': { $ne: true }
        }).select('empId empName subscription').lean();

        // What each employee paid in approved top-ups vs what the ledger already
        // credited them. The gap is money approved under the old model and never
        // turned into balance — correct whether or not new top-ups were approved
        // before this script ran, and zero on a re-run.
        const credited = await SubscriptionLedger.aggregate([
            {
                $match: {
                    employee: { $in: legacy.map((e) => e._id) },
                    reason: { $in: ['subscription_payment', 'opening_balance'] }
                }
            },
            { $group: { _id: '$employee', total: { $sum: '$amount' } } }
        ]);
        const creditedBy = new Map(credited.map((c) => [String(c._id), c.total]));

        const toBackfill = legacy
            .map((e) => {
                const approved = e.subscription.history.filter((h) => h.action === 'approved');
                const approvedTotal = approved.reduce((sum, h) => sum + (Number(h.amount) || 0), 0);
                return {
                    employee: e,
                    amount: approvedTotal - (creditedBy.get(String(e._id)) || 0),
                    firstApproved: approved.map((h) => h.at).filter(Boolean).sort((a, b) => a - b)[0]
                };
            })
            .filter((x) => x.amount > 0);

        console.log(`\n2) ${toBackfill.length} employee(s) approved under the 30-day model to convert to balance:`);
        toBackfill.forEach(({ employee, amount }) =>
            console.log(`     #${employee.empId}  ${employee.empName}  →  balance ₹${amount}`));

        if (!APPLY) {
            console.log('\nDry run — nothing written. Re-run with --apply to make these changes.');
            return;
        }

        const exempted = await Employee.updateMany(untouched, { $set: { 'subscription.exempt': true } });
        console.log(`\nMarked ${exempted.modifiedCount} employee(s) exempt.`);

        for (const { employee, amount, firstApproved } of toBackfill) {
            // $inc, not $set: the employee may already have balance from a newer top-up.
            const updated = await Employee.findByIdAndUpdate(
                employee._id,
                {
                    $inc: { 'subscription.balance': amount },
                    $min: { 'subscription.activatedAt': firstApproved || new Date() }
                },
                { new: true }
            ).select('subscription.balance');

            await SubscriptionLedger.create({
                employee: employee._id,
                empId: employee.empId,
                type: 'credit',
                reason: 'opening_balance',
                amount,
                balanceAfter: updated.subscription.balance,
                note: 'Converted from 30-day subscription'
            });
        }
        console.log(`Set opening balance for ${toBackfill.length} employee(s).`);
    } catch (error) {
        console.error('Migration failed:', error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
};

run();
