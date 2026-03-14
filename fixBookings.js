// Script to scan and fix missing duration and phone fields in bookings
// Usage: node fixBookings.js

import mongoose from 'mongoose';

const MONGO_URI = 'mongodb://localhost:27017/YOUR_DB_NAME'; // <-- Change to your DB name

const bookingSchema = new mongoose.Schema({}, { strict: false });
const Booking = mongoose.model('Booking', bookingSchema, 'bookings');

async function main() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const bookings = await Booking.find({});
  let updated = 0;

  for (const booking of bookings) {
    let needsUpdate = false;

    // Fix duration
    let duration = booking.duration || booking.serviceDetails?.duration;
    if (!duration) {
      // Try to infer from serviceDetails or set a default (e.g., 60 min)
      if (booking.serviceDetails && booking.serviceDetails.price) {
        duration = 60; // Default for known service
      } else {
        duration = 45; // Fallback default
      }
      if (booking.serviceDetails) {
        booking.serviceDetails.duration = duration;
      } else {
        booking.duration = duration;
      }
      needsUpdate = true;
    }

    // Fix phone
    let phone = booking.userPhone || booking.customer?.phone || booking.contactInfo?.phoneNumber || booking.contactIdInfo?.phoneNumber;
    if (!phone) {
      // Set a placeholder or default
      booking.userPhone = '0000000000';
      needsUpdate = true;
    }

    if (needsUpdate) {
      await booking.save();
      updated++;
    }
  }

  console.log(`Updated ${updated} bookings with missing duration or phone.`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
