const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({ name: String });
const User = mongoose.model('User', UserSchema);

const BookingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
});
const Booking = mongoose.model('Booking', BookingSchema);

try {
  const b = new Booking({ userId: "undefined" });
  b.validateSync();
} catch (e) {
  console.log("TEST_UNDEFINED_STRING:", e.message);
}

try {
  const b2 = new Booking({ userId: undefined });
  b2.validateSync();
} catch (e) {
  console.log("TEST_UNDEFINED_VALUE:", e.message);
}
