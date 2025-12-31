require('dotenv').config();
const mongoose = require('mongoose');
const AttendanceToken = require('../models/AttendanceToken');

const cleanupInvalidTokens = async () => {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('🔄 Searching for invalid tokens...');
    
    // Find tokens without valid sequenceNumber
    const invalidTokens = await AttendanceToken.find({
      $or: [
        { sequenceNumber: { $exists: false } },
        { sequenceNumber: null },
        { sequenceNumber: { $type: 'string' } }
      ]
    });

    console.log(`📊 Found ${invalidTokens.length} invalid token(s)`);

    if (invalidTokens.length > 0) {
      // Delete invalid tokens
      const result = await AttendanceToken.deleteMany({
        $or: [
          { sequenceNumber: { $exists: false } },
          { sequenceNumber: null },
          { sequenceNumber: { $type: 'string' } }
        ]
      });

      console.log(`✅ Deleted ${result.deletedCount} invalid token(s)`);
    } else {
      console.log('✅ No invalid tokens found');
    }

    // Show current token count
    const totalTokens = await AttendanceToken.countDocuments();
    console.log(`📊 Total valid tokens remaining: ${totalTokens}`);

    console.log('✅ Cleanup completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
};

cleanupInvalidTokens();

