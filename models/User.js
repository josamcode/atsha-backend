const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  phone: {
    type: String,
    trim: true
  },
  nationality: {
    type: String,
    trim: true,
    default: 'Egyptian'
  },
  idNumber: {
    type: String,
    trim: true
  },
  jobTitle: {
    type: String,
    trim: true
  },
  image: {
    type: String,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: ['admin', 'supervisor', 'employee', 'qr-manager'],
    default: 'employee'
  },
  department: {
    type: String,
    enum: ['kitchen', 'counter', 'cleaning', 'management', 'delivery', 'other'],
    default: 'other'
  },
  departments: [{
    type: String,
    enum: ['kitchen', 'counter', 'cleaning', 'management', 'delivery', 'other']
  }],
  languagePreference: {
    type: String,
    enum: ['ar', 'en'],
    default: 'en'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  leaveBalance: {
    type: Number,
    default: 0
  },
  workDays: [{
    type: String,
    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  }],
  workSchedule: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    // Custom setter to ensure workSchedule is always an object
    set: function (value) {
      // If value is undefined, null, or empty, return empty object
      if (!value || value === null) {
        return {};
      }

      // If it's already an object and not an array, return as is
      if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Map)) {
        // Validate size - prevent storing huge objects
        const size = JSON.stringify(value).length;
        if (size > 10000) { // 10KB limit
          console.warn(`⚠️  workSchedule too large (${size} bytes), truncating to empty object`);
          return {};
        }
        return value;
      }

      // If it's a string, try to parse it
      if (typeof value === 'string' && value.trim()) {
        try {
          const parsed = JSON.parse(value);
          if (typeof parsed === 'object' && !Array.isArray(parsed)) {
            const size = JSON.stringify(parsed).length;
            if (size > 10000) {
              console.warn(`⚠️  Parsed workSchedule too large (${size} bytes), truncating`);
              return {};
            }
            return parsed;
          }
        } catch (e) {
          console.warn(`⚠️  Failed to parse workSchedule string: ${e.message}`);
        }
      }

      // If it's an array or other invalid type, return empty object
      if (Array.isArray(value)) {
        console.warn(`⚠️  workSchedule cannot be an array, using empty object`);
      }

      return {};
    }
  },
  refreshToken: {
    type: String,
    select: false
  },
  resetPasswordToken: {
    type: String,
    select: false
  },
  resetPasswordExpire: {
    type: Date,
    select: false
  },
  passwordResetRequested: {
    type: Boolean,
    default: false
  },
  passwordResetRequestDate: {
    type: Date
  }
  // metadata field removed - moved to UserMetadata collection
  // Large metadata should be stored in UserMetadata collection
}, {
  timestamps: true
});

// Indexes for frequently queried fields
// Note: email already has unique: true which creates an index, so we don't duplicate it
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ department: 1, isActive: 1 });
userSchema.index({ departments: 1, isActive: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ name: 1 }); // For search queries
userSchema.index({ createdAt: -1 }); // For sorting by creation date

// Compound indexes for common query patterns
userSchema.index({ role: 1, department: 1, isActive: 1 });
userSchema.index({ email: 1, isActive: 1 });

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Ensure supervisor has departments array
userSchema.pre('save', function (next) {
  if (this.role === 'supervisor' && (!this.departments || this.departments.length === 0)) {
    if (this.department && this.department !== 'other') {
      this.departments = [this.department];
    }
  }
  next();
});

module.exports = mongoose.model('User', userSchema);