import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const MONGO_URI = 'mongodb+srv://Homex:Homex@atlascluster.izog0qm.mongodb.net/employees';
const JWT_SECRET = 'your_super_secret_key';

async function test() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const user = await db.collection('users').findOne({});
  
  if (!user) {
    console.log("No users found in database");
    process.exit(1);
  }
  
  const token = jwt.sign({ id: user._id.toString(), role: user.role || 'user' }, JWT_SECRET, { expiresIn: '1h' });
  console.log("Found user, sending request with token:", token);

  const payload = {
    serviceDetails: { title: 'Demo', category: 'Test', price: 10, duration: 60 },
    schedule: { preferredDate: '2027-10-10', timeSlot: '10:00 AM' },
    location: { country: 'A', state: 'B', city: 'C', area: 'D', address: 'E' },
    payment: { amount: 10, method: 'cash' },
    contactInfo: { fullName: 'Test Name', phoneNumber: '1234567890' }
  };

  const r = await fetch('http://localhost:5000/api/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  
  const data = await r.json();
  console.log(JSON.stringify({ status: r.status, data }, null, 2));
  process.exit(0);
}

test().catch(console.error);
