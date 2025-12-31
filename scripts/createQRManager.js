require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const createQRManager = async () => {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check if QR Manager already exists
    const existingQRManager = await User.findOne({ role: 'qr-manager' });
    if (existingQRManager) {
      console.log('⚠️  QR Manager user already exists:');
      console.log(`   Email: ${existingQRManager.email}`);
      console.log(`   Name: ${existingQRManager.name}`);
      console.log('   To create a new one, delete the existing user first.');
      process.exit(0);
    }

    // Default QR Manager credentials
    const defaultEmail = process.env.QR_MANAGER_EMAIL || 'qrmanager@atsha.com';
    const defaultPassword = process.env.QR_MANAGER_PASSWORD || 'QRManager123!';
    const defaultName = process.env.QR_MANAGER_NAME || 'QR Manager';

    // Check if email already exists
    const existingUser = await User.findOne({ email: defaultEmail });
    if (existingUser) {
      console.log(`❌ User with email ${defaultEmail} already exists.`);
      console.log('   Please use a different email or delete the existing user.');
      process.exit(1);
    }

    // Create QR Manager user
    const qrManager = await User.create({
      name: defaultName,
      email: defaultEmail,
      password: defaultPassword,
      role: 'qr-manager',
      department: 'management',
      isActive: true,
      languagePreference: 'en'
    });

    console.log('✅ QR Manager user created successfully!');
    console.log('📋 User Details:');
    console.log(`   Name: ${qrManager.name}`);
    console.log(`   Email: ${qrManager.email}`);
    console.log(`   Role: ${qrManager.role}`);
    console.log(`   Password: ${defaultPassword}`);
    console.log('\n⚠️  IMPORTANT: Please change the default password after first login!');
    console.log('\n💡 You can customize the credentials by setting environment variables:');
    console.log('   QR_MANAGER_EMAIL=your-email@example.com');
    console.log('   QR_MANAGER_PASSWORD=YourSecurePassword');
    console.log('   QR_MANAGER_NAME=Your Name');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating QR Manager:', error);
    process.exit(1);
  }
};

// Run the script
createQRManager();

