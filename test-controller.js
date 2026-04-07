import mongoose from 'mongoose';
import { createBooking } from './controllers/bookingController.js';

const mockReq = {
  body: {
    serviceDetails: { title: 'Demo', category: 'Test', price: 10, duration: 60 },
    schedule: { preferredDate: '2027-10-10', timeSlot: '10:00 AM' },
    location: { country: 'A', state: 'B', city: 'C', area: 'D', address: 'E' },
    payment: { amount: 10, method: 'cash' },
    contactInfo: { fullName: 'Test Name', phoneNumber: '1234567890' }
  },
  user: {
    role: 'user',
    id: '65f1a2b3c4d5e6f7a8b9c0d1' // standard token lacks _id and userId
  },
  get: () => 'TestAgent',
  ip: '127.0.0.1'
};

const mockRes = {
  status: (code) => {
    console.log(`STATUS CALLED: ${code}`);
    return mockRes;
  },
  json: (data) => {
    console.log(`JSON CALLED: ${JSON.stringify(data, null, 2)}`);
  }
};

async function test() {
  try {
    await mongoose.connect('mongodb+srv://Homex:Homex@atlascluster.izog0qm.mongodb.net/employees');
  } catch (e) {
    console.log("DB Connection failed:", e.message);
  }
  
  try {
    await createBooking(mockReq, mockRes);
  } catch(e) {
    console.log("Unhandled Exception:", e.message);
  }
  
  process.exit(0);
}

test();
