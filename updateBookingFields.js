// Script to update a booking with missing phone and duration
// Usage: node updateBookingFields.js <email or bookingId> <phone> <duration>

import mongoose from 'mongoose';

const MONGO_URI = 'mongodb://localhost:27017/YOUR_DB_NAME'; // <-- Change to your DB name

const bookingSchema = new mongoose.Schema({}, { strict: false });
const Booking = mongoose.model('Booking', bookingSchema, 'bookings');

const [arg, phone, duration] = process.argv.slice(2);
if (!arg || !phone || !duration) {
  console.error('Usage: node updateBookingFields.js <email or bookingId> <phone> <duration>');
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
    // Set phone in all possible locations
    booking.userPhone = phone;
    if (booking.customer) booking.customer.phone = phone;
    if (booking.contactInfo) booking.contactInfo.phoneNumber = phone;
    if (booking.contactIdInfo) booking.contactIdInfo.phoneNumber = phone;
    // Set duration in all possible locations
    booking.duration = Number(duration);
    if (booking.serviceDetails) booking.serviceDetails.duration = Number(duration);
    await booking.save();
    console.log('Booking updated.');
  }
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
