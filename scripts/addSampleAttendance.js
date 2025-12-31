require('dotenv').config();
const mongoose = require('mongoose');
const AttendanceLog = require('../models/AttendanceLog');
const AttendanceToken = require('../models/AttendanceToken');
const User = require('../models/User');

const addSampleAttendance = async () => {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find a user (prefer employee role, or use any user)
    const user = await User.findOne({ role: 'employee' }) || await User.findOne();
    
    if (!user) {
      console.log('❌ No users found in database. Please create a user first.');
      process.exit(1);
    }

    console.log(`📊 Creating sample attendance for: ${user.name} (${user.email})`);

    // Create a sample QR token for reference
    const token = AttendanceToken.generateToken();
    const qrToken = await AttendanceToken.create({
      token,
      validFrom: new Date(),
      validTo: new Date(Date.now() + 60000),
      status: 'expired', // Mark as expired since it's just for reference
      sequenceNumber: 999
    });

    console.log('✅ Created reference QR token');

    // Create attendance logs for the last 7 days
    const logs = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      // Set check-in time (e.g., 9:00 AM + random minutes)
      const checkinTime = new Date(date);
      checkinTime.setHours(9, Math.floor(Math.random() * 30), 0, 0);
      
      // Set check-out time (e.g., 5:00 PM + random minutes)
      const checkoutTime = new Date(date);
      checkoutTime.setHours(17, Math.floor(Math.random() * 30), 0, 0);
      
      // Create check-in log
      logs.push({
        userId: user._id,
        type: 'checkin',
        timestamp: checkinTime,
        method: 'qr',
        tokenId: qrToken._id,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'Sample Data Generator',
          qrSequence: 999
        }
      });
      
      // Create check-out log (skip for today to show partial attendance)
      if (i > 0) {
        logs.push({
          userId: user._id,
          type: 'checkout',
          timestamp: checkoutTime,
          method: 'qr',
          tokenId: qrToken._id,
          metadata: {
            ip: '127.0.0.1',
            userAgent: 'Sample Data Generator',
            qrSequence: 999
          }
        });
      }
    }

    // Insert all logs
    await AttendanceLog.insertMany(logs);
    console.log(`✅ Created ${logs.length} sample attendance logs`);

    const totalLogs = await AttendanceLog.countDocuments({ userId: user._id });
    console.log(`📊 Total attendance logs for ${user.name}: ${totalLogs}`);

    console.log('✅ Sample attendance data created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating sample attendance:', error);
    process.exit(1);
  }
};

addSampleAttendance();

