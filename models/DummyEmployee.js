// models/Employee.js
import mongoose from 'mongoose';

const employeeSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  role: { type: String, default: 'employee' },
  rating: { type: Number, default: 4.5 },
  jobsCompleted: { type: Number, default: 0 },
  earnings: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.models.Employee || mongoose.model('Employee', employeeSchema);
