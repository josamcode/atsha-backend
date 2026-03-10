require('dotenv').config();
const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const User = require('../models/User');
const FormTemplate = require('../models/FormTemplate');
const FormInstance = require('../models/FormInstance');
const LeaveRequest = require('../models/LeaveRequest');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected');
  } catch (error) {
    console.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }
};

const createOrganization = async (payload) => {
  return Organization.create({
    status: 'active',
    plan: 'enterprise',
    locale: 'en',
    timezone: 'Africa/Cairo',
    securitySettings: {
      sessionVersion: 1,
      requireDomainMatch: false,
      passwordResetEnabled: true
    },
    attendanceSettings: {
      qrTokenValiditySeconds: 30,
      allowPublicAttendance: true
    },
    leaveSettings: {
      approvalRequired: true,
      defaultAnnualBalance: 21
    },
    featureFlags: {
      multiOrganization: true,
      invitations: true,
      customBranding: true
    },
    ...payload
  });
};

const createUser = async (organizationId, payload) => {
  return User.create({
    organizationId,
    languagePreference: 'en',
    isActive: true,
    leaveBalance: 21,
    workDays: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'],
    ...payload
  });
};

const seedDatabase = async () => {
  try {
    console.log('Clearing existing tenant test data...');
    await FormInstance.deleteMany({});
    await FormTemplate.deleteMany({});
    await LeaveRequest.deleteMany({});
    await User.deleteMany({});
    await Organization.deleteMany({});

    console.log('Creating organizations...');
    const nileFoods = await createOrganization({
      name: 'Nile Foods',
      slug: 'nile-foods',
      allowedDomains: ['nile.local'],
      branding: {
        displayName: 'Nile Foods',
        shortName: 'Nile',
        legalName: 'Nile Foods LLC',
        supportEmail: 'support@nilefoods.com',
        emailFromName: 'Nile Foods',
        primaryColor: '#0f766e',
        secondaryColor: '#0f172a'
      }
    });

    const desertMeals = await createOrganization({
      name: 'Desert Meals',
      slug: 'desert-meals',
      allowedDomains: ['desert.local'],
      branding: {
        displayName: 'Desert Meals',
        shortName: 'Desert',
        legalName: 'Desert Meals Inc',
        supportEmail: 'support@desertmeals.com',
        emailFromName: 'Desert Meals',
        primaryColor: '#b45309',
        secondaryColor: '#7c2d12'
      }
    });

    console.log('Creating users...');
    const nileAdmin = await createUser(nileFoods._id, {
      name: 'Nile Admin',
      email: 'admin@nilefoods.com',
      password: 'TestPass123',
      phone: '+201000000001',
      role: 'organization_admin',
      department: 'management',
      leaveBalance: 30
    });

    const nileSupervisor = await createUser(nileFoods._id, {
      name: 'Nile Kitchen Supervisor',
      email: 'supervisor@nilefoods.com',
      password: 'TestPass123',
      phone: '+201000000002',
      role: 'supervisor',
      department: 'kitchen',
      departments: ['kitchen', 'cleaning'],
      leaveBalance: 25
    });

    const nileEmployee = await createUser(nileFoods._id, {
      name: 'Nile Employee',
      email: 'employee@nilefoods.com',
      password: 'TestPass123',
      phone: '+201000000003',
      role: 'employee',
      department: 'kitchen'
    });

    const nileQrManager = await createUser(nileFoods._id, {
      name: 'Nile QR Manager',
      email: 'qr@nilefoods.com',
      password: 'TestPass123',
      phone: '+201000000004',
      role: 'qr_manager',
      department: 'management'
    });

    const desertAdmin = await createUser(desertMeals._id, {
      name: 'Desert Admin',
      email: 'admin@desertmeals.com',
      password: 'TestPass123',
      phone: '+201000000101',
      role: 'organization_admin',
      department: 'management',
      leaveBalance: 30
    });

    const desertSupervisor = await createUser(desertMeals._id, {
      name: 'Desert Counter Supervisor',
      email: 'supervisor@desertmeals.com',
      password: 'TestPass123',
      phone: '+201000000102',
      role: 'supervisor',
      department: 'counter',
      departments: ['counter', 'delivery'],
      leaveBalance: 25
    });

    const desertEmployee = await createUser(desertMeals._id, {
      name: 'Desert Employee',
      email: 'employee@desertmeals.com',
      password: 'TestPass123',
      phone: '+201000000103',
      role: 'employee',
      department: 'delivery'
    });

    await Organization.updateOne({ _id: nileFoods._id }, { $set: { createdBy: nileAdmin._id } });
    await Organization.updateOne({ _id: desertMeals._id }, { $set: { createdBy: desertAdmin._id } });

    console.log('Creating templates...');
    const nileDailyTemplate = await FormTemplate.create({
      organizationId: nileFoods._id,
      title: {
        en: 'Nile Daily Operations',
        ar: 'Nile Daily Operations'
      },
      description: {
        en: 'Daily operations checklist for Nile Foods',
        ar: 'Daily operations checklist for Nile Foods'
      },
      sections: [
        {
          id: 'summary',
          label: {
            en: 'Summary',
            ar: 'Summary'
          },
          fields: [
            {
              key: 'manager',
              label: { en: 'Manager on Duty', ar: 'Manager on Duty' },
              type: 'text',
              required: true
            },
            {
              key: 'notes',
              label: { en: 'Notes', ar: 'Notes' },
              type: 'textarea',
              required: false
            }
          ]
        }
      ],
      visibleToRoles: ['organization_admin', 'supervisor', 'employee'],
      editableByRoles: ['organization_admin', 'supervisor'],
      departments: ['all'],
      requiresApproval: true,
      isActive: true,
      createdBy: nileAdmin._id
    });

    const desertSafetyTemplate = await FormTemplate.create({
      organizationId: desertMeals._id,
      title: {
        en: 'Desert Delivery Safety',
        ar: 'Desert Delivery Safety'
      },
      description: {
        en: 'Delivery safety checklist',
        ar: 'Delivery safety checklist'
      },
      sections: [
        {
          id: 'delivery',
          label: {
            en: 'Delivery Review',
            ar: 'Delivery Review'
          },
          fields: [
            {
              key: 'vehicleCheck',
              label: { en: 'Vehicle checked', ar: 'Vehicle checked' },
              type: 'boolean',
              required: true
            },
            {
              key: 'routeNotes',
              label: { en: 'Route Notes', ar: 'Route Notes' },
              type: 'textarea',
              required: false
            }
          ]
        }
      ],
      visibleToRoles: ['organization_admin', 'supervisor', 'employee'],
      editableByRoles: ['organization_admin', 'supervisor'],
      departments: ['delivery', 'counter'],
      requiresApproval: true,
      isActive: true,
      createdBy: desertAdmin._id
    });

    console.log('Creating form instances...');
    await FormInstance.create({
      organizationId: nileFoods._id,
      templateId: nileDailyTemplate._id,
      filledBy: nileSupervisor._id,
      department: 'kitchen',
      date: new Date(),
      shift: 'morning',
      values: {
        manager: 'Nile Kitchen Supervisor',
        notes: 'Morning shift started normally.'
      },
      status: 'submitted'
    });

    await FormInstance.create({
      organizationId: desertMeals._id,
      templateId: desertSafetyTemplate._id,
      filledBy: desertEmployee._id,
      department: 'delivery',
      date: new Date(),
      shift: 'evening',
      values: {
        vehicleCheck: true,
        routeNotes: 'All routes clear for tonight.'
      },
      status: 'approved',
      approvedBy: desertSupervisor._id,
      approvalDate: new Date()
    });

    console.log('Creating leave requests...');
    await LeaveRequest.create({
      organizationId: nileFoods._id,
      userId: nileEmployee._id,
      type: 'vacation',
      startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
      reason: 'Family trip',
      status: 'pending',
      days: 3
    });

    await LeaveRequest.create({
      organizationId: desertMeals._id,
      userId: desertEmployee._id,
      type: 'sick',
      startDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      reason: 'Seasonal flu',
      status: 'approved',
      approvedBy: desertAdmin._id,
      approvalDate: new Date(),
      days: 2
    });

    console.log('\nDatabase seeded successfully.');
    console.log('\nTest login accounts (email + password):');
    console.log('Nile Admin: admin@nilefoods.com / TestPass123');
    console.log('Nile Supervisor: supervisor@nilefoods.com / TestPass123');
    console.log('Nile Employee: employee@nilefoods.com / TestPass123');
    console.log('Nile QR Manager: qr@nilefoods.com / TestPass123');
    console.log('Desert Admin: admin@desertmeals.com / TestPass123');
    console.log('Desert Supervisor: supervisor@desertmeals.com / TestPass123');
    console.log('Desert Employee: employee@desertmeals.com / TestPass123');
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

connectDB().then(seedDatabase);
