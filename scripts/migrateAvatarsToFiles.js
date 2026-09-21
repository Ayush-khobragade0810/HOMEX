/**
 * One-time: move base64 avatars out of MongoDB into /uploads/avatars and store
 * only the URL. An inline avatar is sent back on every read of that record —
 * one 465KB avatar made /api/employees/profile a 476KB, ~2s response, and the
 * auth middleware loaded it on every request.
 *
 * Safe to re-run: only documents whose avatar still starts with "data:" are touched.
 *
 *   node scripts/migrateAvatarsToFiles.js           # dry run
 *   node scripts/migrateAvatarsToFiles.js --apply   # write
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Employee from '../models/adminEmployee.js';
import User from '../models/User.js';
import { persistAvatar } from '../utils/avatarStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/homax';
const APPLY = process.argv.includes('--apply');
const kb = (s) => Math.round(String(s).length / 1024);

const run = async () => {
    try {
        await mongoose.connect(MONGO_URI);

        const targets = [
            { model: Employee, label: 'employee', nameField: 'empName', idField: 'empId' },
            { model: User, label: 'user', nameField: 'name', idField: '_id' }
        ];

        for (const { model, label, nameField, idField } of targets) {
            const docs = await model.find({ avatar: /^data:/ }).select(`avatar ${nameField} ${idField}`).lean();
            console.log(`\n${docs.length} ${label}(s) with an inline avatar:`);

            for (const doc of docs) {
                const who = `${doc[nameField] || label} (${doc[idField]})`;
                if (!APPLY) {
                    console.log(`   ${who}: ${kb(doc.avatar)}KB would move to a file`);
                    continue;
                }
                const url = await persistAvatar(doc.avatar, `${label}-${doc[idField]}`);
                if (url === doc.avatar) {
                    console.log(`   ${who}: could not convert, left as is`);
                    continue;
                }
                await model.updateOne({ _id: doc._id }, { $set: { avatar: url } });
                console.log(`   ${who}: ${kb(doc.avatar)}KB -> ${url}`);
            }
        }

        // Bookings keep a copy of the technician's avatar. An inline copy makes
        // every booking ~465KB, which is what made the schedule and booking
        // lists slow. Point them at the employee's file instead.
        const { default: Booking } = await import('../models/Booking.js');
        const bookingsWithInline = await Booking.find({ 'assignedTo.avatar': /^data:/ })
            .select('bookingId assignedTo.technicianId')
            .lean();

        console.log(`\n${bookingsWithInline.length} booking(s) carrying an inline avatar copy:`);
        if (!APPLY) {
            bookingsWithInline.forEach((b) =>
                console.log(`   ${b.bookingId}: would use the employee's avatar URL instead`));
        } else {
            for (const booking of bookingsWithInline) {
                const emp = await Employee.findById(booking.assignedTo?.technicianId).select('avatar').lean();
                const replacement = emp?.avatar && !String(emp.avatar).startsWith('data:') ? emp.avatar : '';
                await Booking.updateOne(
                    { _id: booking._id },
                    replacement
                        ? { $set: { 'assignedTo.avatar': replacement } }
                        : { $unset: { 'assignedTo.avatar': '' } }
                );
                console.log(`   ${booking.bookingId}: ${replacement || 'removed (employee has no file avatar)'}`);
            }
        }

        if (!APPLY) console.log('\nDry run — nothing written. Re-run with --apply to convert them.');
    } catch (error) {
        console.error('Avatar migration failed:', error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
};

run();
