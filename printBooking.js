// Script to print a booking by customer email or bookingId
// Usage: node printBooking.js <email or bookingId>

import mongoose from 'mongoose';

const MONGO_URI = 'mongodb://localhost:27017/YOUR_DB_NAME'; // <-- Change to your DB name

const bookingSchema = new mongoose.Schema({}, { strict: false });
const Booking = mongoose.model('Booking', bookingSchema, 'bookings');

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node printBooking.js <email or bookingId>');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  let booking;
  if (arg.includes('@')) {
    booking = await Booking.findOne({ $or: [
      { userEmail: arg },
      { 'customer.email': arg },
      { 'contactInfo.email': arg },
      { 'contactIdInfo.email': arg }
    ] });
  } else {
    booking = await Booking.findOne({ $or: [
      { bookingId: arg },
      { _id: arg }
    ] });
  }
  if (!booking) {
    console.log('Booking not found.');
  } else {
    console.log(JSON.stringify(booking, null, 2));
  }
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
