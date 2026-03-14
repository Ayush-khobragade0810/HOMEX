import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: function (v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Please enter a valid email address'
    }
  },
  phone: {
    type: String,
    required: false,
    default: '',
    trim: true,
    validate: {
      validator: function (v) {
        if (!v) return true; // Allow empty string or null
        return /^[0-9]{10}$/.test(v);
      },
      message: 'Please enter a valid 10-digit phone number'
    }
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    select: false
  },
  avatar: {
    type: String,
    default: 'https://ui-avatars.com/api/?name=User&background=0d9488&color=fff'
  },
  address: {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    completeAddress: { type: String, trim: true }
  },
  role: {
    type: String,
    enum: ['user', 'technician', 'employee', 'admin'],
    default: 'user'
  },
  lastLogin: Date,
  loginCount: {
    type: Number,
    default: 0
  },
  failedAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  lockedUntil: {
    type: Date,
    default: null,
    select: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  socketId: String,
  lastActive: {
    type: Date,
    default: Date.now
  },
  // Refresh tokens for JWT rotation
  refreshTokens: [{
    token: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    deviceInfo: {
      userAgent: String,
      ipAddress: String
    },
    isRevoked: { type: Boolean, default: false }
  }],
  preferences: {
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: false }
    },
    language: {
      type: String,
      default: 'en',
      enum: ['en', 'hi', 'ta', 'te', 'ml']
    }
  },
  stats: {
    totalBookings: { type: Number, default: 0 },
    completedBookings: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    rating: { type: Number, default: 5.0, min: 0, max: 5 }
  },
  metadata: {
    signupSource: { type: String, default: 'web' },
    lastLogin: Date,
    loginCount: { type: Number, default: 0 }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
// userSchema.index({ phone: 1 }); // Removed to prevent unique/index issues
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ 'metadata.lastLogin': -1 });
userSchema.index({ lockedUntil: 1 });

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Update lastLogin on findOneAndUpdate (for login)
userSchema.pre('findOneAndUpdate', function (next) {
  if (this._update.$set && this._update.$set['metadata.lastLogin']) {
    this._update.$inc = this._update.$inc || {};
    this._update.$inc['metadata.loginCount'] = 1;
  }
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Add refresh token
userSchema.methods.addRefreshToken = function (token, expiresAt, deviceInfo = {}) {
  const refreshToken = {
    token,
    expiresAt,
    deviceInfo
  };

  // Keep only last 5 refresh tokens
  this.refreshTokens.push(refreshToken);
  if (this.refreshTokens.length > 5) {
    this.refreshTokens = this.refreshTokens.slice(-5);
  }

  return this.save();
};

// Revoke refresh token
userSchema.methods.revokeRefreshToken = function (token) {
  const tokenIndex = this.refreshTokens.findIndex(rt => rt.token === token);
  if (tokenIndex !== -1) {
    this.refreshTokens[tokenIndex].isRevoked = true;
    return this.save();
  }
  return Promise.resolve(this);
};

// Revoke all refresh tokens
userSchema.methods.revokeAllRefreshTokens = function () {
  this.refreshTokens.forEach(rt => rt.isRevoked = true);
  return this.save();
};

// Check if refresh token is valid
userSchema.methods.isRefreshTokenValid = function (token) {
  const refreshToken = this.refreshTokens.find(rt => rt.token === token);

  if (!refreshToken) return false;
  if (refreshToken.isRevoked) return false;
  if (new Date() > refreshToken.expiresAt) return false;

  return true;
};

// Remove sensitive data from JSON output
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  delete user.refreshTokens;
  delete user.__v;
  return user;
};

// Static method to find by email
userSchema.statics.findByEmail = function (email) {
  return this.findOne({ email: email.toLowerCase() });
};

// Static method to find by phone
userSchema.statics.findByPhone = function (phone) {
  return this.findOne({ phone });
};

// Virtual for full name
userSchema.virtual('fullName').get(function () {
  return this.name;
});

export default mongoose.model('User', userSchema);
