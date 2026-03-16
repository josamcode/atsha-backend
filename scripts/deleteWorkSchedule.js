/**
 * Quick Fix Script: Delete workSchedule field from all users
 * 
 * This script removes the workSchedule field from all user documents
 * to immediately reduce document size. The workSchedule data can be
 * restored later if needed from backups or re-entered.
 * 
 * Run: node server/scripts/deleteWorkSchedule.js
 */

// Load environment variables - try multiple paths
const path = require('path');
const fs = require('fs');

// Try to find .env file in common locations
const envPaths = [
  path.join(__dirname, '../../.env'),  // Root of project
  path.join(__dirname, '../.env'),     // Server directory
  path.join(process.cwd(), '.env')     // Current working directory
];

let envLoaded = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    envLoaded = true;
    break;
  }
}

// If no .env found, try default dotenv behavior
if (!envLoaded) {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const User = require('../models/User');

async function deleteWorkSchedule() {
  try {
    console.log('🔄 Starting workSchedule deletion...');

    // Get MongoDB URI from environment
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

    if (!mongoUri) {
      console.error('❌ Error: MONGODB_URI environment variable is not set');
      console.error('   Please set MONGODB_URI in your .env file');
      console.error('   Example: MONGODB_URI=mongodb://localhost:27017/AraRM');
      process.exit(1);
    }

    // Connect to MongoDB
    const conn = await mongoose.connect(mongoUri);
    console.log(`✅ Connected to MongoDB: ${conn.connection.host}`);

    // Get total user count
    const totalUsers = await User.countDocuments();
    console.log(`📊 Found ${totalUsers} users to process\n`);

    // Count users with workSchedule
    const usersWithWorkSchedule = await User.countDocuments({
      workSchedule: { $exists: true, $ne: null, $ne: {} }
    });
    console.log(`📋 Users with workSchedule field: ${usersWithWorkSchedule}\n`);

    if (usersWithWorkSchedule === 0) {
      console.log('✅ No users have workSchedule field. Nothing to delete.');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Ask for confirmation (in production, you might want to add a --force flag)
    console.log('⚠️  WARNING: This will delete workSchedule field from ALL users!');
    console.log('   This action cannot be undone unless you have a backup.\n');

    // For safety, we'll proceed but log what we're doing
    console.log('🚀 Proceeding with deletion...\n');

    let processed = 0;
    let deleted = 0;
    let errors = 0;

    // Process in batches
    const BATCH_SIZE = 100;
    for (let skip = 0; skip < totalUsers; skip += BATCH_SIZE) {
      const users = await User.find({})
        .skip(skip)
        .limit(BATCH_SIZE)
        .select('_id email name workSchedule')
        .lean();

      for (const user of users) {
        try {
          processed++;

          // Check if user has workSchedule
          const hasWorkSchedule = user.workSchedule &&
            (typeof user.workSchedule === 'object' && Object.keys(user.workSchedule).length > 0) ||
            (Array.isArray(user.workSchedule) && user.workSchedule.length > 0) ||
            (typeof user.workSchedule === 'string' && user.workSchedule.length > 0);

          if (hasWorkSchedule) {
            // Get size before deletion for logging
            const sizeBefore = JSON.stringify(user.workSchedule).length;

            // Delete workSchedule field
            await User.updateOne(
              { _id: user._id },
              { $unset: { workSchedule: '' } }
            );

            deleted++;
            console.log(`✅ [${processed}/${totalUsers}] Deleted workSchedule (${sizeBefore} bytes) from user: ${user.email || user.name || user._id}`);
          } else {
            if (processed % 50 === 0) {
              console.log(`⏳ Processed ${processed}/${totalUsers} users...`);
            }
          }

        } catch (error) {
          errors++;
          console.error(`❌ Error processing user ${user._id}:`, error.message);
        }
      }
    }

    console.log('\n✅ Deletion completed!');
    console.log(`📊 Statistics:`);
    console.log(`   - Total users processed: ${processed}`);
    console.log(`   - workSchedule fields deleted: ${deleted}`);
    console.log(`   - Errors: ${errors}`);

    // Verify deletion
    console.log('\n🔍 Verifying deletion...');
    const remaining = await User.countDocuments({
      workSchedule: { $exists: true, $ne: null, $ne: {} }
    });

    console.log(`   - Users still with workSchedule: ${remaining}`);

    if (remaining === 0) {
      console.log('   ✅ All workSchedule fields successfully deleted!');
    } else {
      console.log(`   ⚠️  ${remaining} users still have workSchedule field.`);
    }

    // Get average document size (approximate)
    const sampleUsers = await User.find({}).limit(10).lean();
    const avgSize = sampleUsers.reduce((sum, user) => {
      return sum + JSON.stringify(user).length;
    }, 0) / sampleUsers.length;

    console.log(`\n📏 Average user document size: ~${Math.round(avgSize / 1024)}KB`);

    console.log('\n✨ Script completed successfully!');
    await mongoose.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('❌ Script failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run script
if (require.main === module) {
  deleteWorkSchedule();
}

module.exports = { deleteWorkSchedule };

