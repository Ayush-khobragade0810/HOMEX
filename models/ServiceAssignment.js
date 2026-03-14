// models/ServiceAssignment.js
import mongoose from 'mongoose';

const serviceAssignmentSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  customer: String,
  customerPhone: String,
  serviceType: String,
  address: String,
  status: {
    type: String,
    enum: ['pending', 'scheduled', 'confirmed', 'in_progress', 'en_route', 'completed'],
    default: 'pending'
  },
  scheduledDate: Date,
  completedDate: Date,
  duration: Number,
  estimatedEarnings: Number,
  payment: Number,
  priority: { type: String, default: 'medium' }
}, { timestamps: true });

export default mongoose.model('ServiceAssignment', serviceAssignmentSchema);
