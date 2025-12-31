require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const FormTemplate = require('../models/FormTemplate');
const FormInstance = require('../models/FormInstance');
const LeaveRequest = require('../models/LeaveRequest');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

const seedDatabase = async () => {
  try {
    // Clear existing data
    console.log('Clearing existing data...');
    await User.deleteMany({});
    await FormTemplate.deleteMany({});
    await FormInstance.deleteMany({});
    await LeaveRequest.deleteMany({});

    // Create Users
    console.log('Creating users...');

    const admin = await User.create({
      name: 'Admin User',
      email: 'admin@atsha.com',
      password: 'admin123',
      phone: '+1234567890',
      role: 'admin',
      department: 'management',
      languagePreference: 'ar',
      isActive: true,
      leaveBalance: 30
    });

    const supervisor = await User.create({
      name: 'Kitchen Supervisor',
      email: 'supervisor@atsha.com',
      password: 'super123',
      phone: '+1234567891',
      role: 'supervisor',
      department: 'kitchen',
      departments: ['kitchen', 'cleaning'],
      languagePreference: 'ar',
      isActive: true,
      leaveBalance: 25
    });

    const supervisor2 = await User.create({
      name: 'Counter Supervisor',
      email: 'supervisor2@atsha.com',
      password: 'super123',
      phone: '+1234567892',
      role: 'supervisor',
      department: 'counter',
      departments: ['counter', 'delivery'],
      languagePreference: 'ar',
      isActive: true,
      leaveBalance: 25
    });

    const employee1 = await User.create({
      name: 'Ahmed Ali',
      email: 'employee@atsha.com',
      password: 'emp123',
      phone: '+1234567893',
      role: 'employee',
      department: 'kitchen',
      languagePreference: 'ar',
      isActive: true,
      leaveBalance: 21
    });

    const employee2 = await User.create({
      name: 'Sara Mohammed',
      email: 'sara@atsha.com',
      password: 'emp123',
      phone: '+1234567894',
      role: 'employee',
      department: 'counter',
      languagePreference: 'ar',
      isActive: true,
      leaveBalance: 21
    });

    const employee3 = await User.create({
      name: 'John Smith',
      email: 'john@atsha.com',
      password: 'emp123',
      phone: '+1234567895',
      role: 'employee',
      department: 'cleaning',
      languagePreference: 'ar',
      isActive: true,
      leaveBalance: 21
    });

    const employee4 = await User.create({
      name: 'Fatima Hassan',
      email: 'fatima@atsha.com',
      password: 'emp123',
      phone: '+1234567896',
      role: 'employee',
      department: 'delivery',
      languagePreference: 'ar',
      isActive: true,
      leaveBalance: 21
    });

    const employee5 = await User.create({
      name: 'Omar Ibrahim',
      email: 'omar@atsha.com',
      password: 'emp123',
      phone: '+1234567897',
      role: 'employee',
      department: 'kitchen',
      languagePreference: 'ar',
      isActive: true,
      leaveBalance: 21
    });

    console.log('Users created successfully!');

    // Create Form Templates
    console.log('Creating form templates...');

    const dailyReportTemplate = await FormTemplate.create({
      title: {
        en: 'Daily Report',
        ar: 'التقرير اليومي'
      },
      description: {
        en: 'Daily operational report for restaurant',
        ar: 'تقرير العمليات اليومي للمطعم'
      },
      sections: [
        {
          id: 'general',
          label: {
            en: 'General Information',
            ar: 'المعلومات العامة'
          },
          fields: [
            {
              key: 'manager',
              label: { en: 'Manager on Duty', ar: 'المدير المناوب' },
              type: 'text',
              required: true
            },
            {
              key: 'shift',
              label: { en: 'Shift', ar: 'الوردية' },
              type: 'select',
              options: [
                { en: 'Morning', ar: 'صباحي' },
                { en: 'Evening', ar: 'مسائي' },
                { en: 'Night', ar: 'ليلي' }
              ],
              required: true
            },
            {
              key: 'weather',
              label: { en: 'Weather Condition', ar: 'حالة الطقس' },
              type: 'text',
              required: false
            }
          ]
        },
        {
          id: 'operations',
          label: {
            en: 'Operations',
            ar: 'العمليات'
          },
          fields: [
            {
              key: 'opening_time',
              label: { en: 'Opening Time', ar: 'وقت الافتتاح' },
              type: 'time',
              required: true
            },
            {
              key: 'closing_time',
              label: { en: 'Closing Time', ar: 'وقت الإغلاق' },
              type: 'time',
              required: true
            },
            {
              key: 'customer_count',
              label: { en: 'Approximate Customer Count', ar: 'عدد العملاء التقريبي' },
              type: 'number',
              required: true
            },
            {
              key: 'issues',
              label: { en: 'Issues or Incidents', ar: 'المشاكل أو الحوادث' },
              type: 'textarea',
              required: false
            }
          ]
        }
      ],
      visibleToRoles: ['admin', 'supervisor', 'employee'],
      editableByRoles: ['admin', 'supervisor'],
      departments: ['all'],
      requiresApproval: true,
      isActive: true,
      createdBy: admin._id
    });

    const inventoryTemplate = await FormTemplate.create({
      title: {
        en: 'Daily Inventory Check',
        ar: 'الجرد اليومي'
      },
      description: {
        en: 'Daily inventory and stock checking form',
        ar: 'نموذج فحص المخزون والجرد اليومي'
      },
      sections: [
        {
          id: 'kitchen_inventory',
          label: {
            en: 'Kitchen Inventory',
            ar: 'مخزون المطبخ'
          },
          fields: [
            {
              key: 'chicken_stock',
              label: { en: 'Chicken Stock (kg)', ar: 'مخزون الدجاج (كجم)' },
              type: 'number',
              required: true
            },
            {
              key: 'oil_stock',
              label: { en: 'Cooking Oil (liters)', ar: 'زيت الطهي (لتر)' },
              type: 'number',
              required: true
            },
            {
              key: 'spices_sufficient',
              label: { en: 'Spices Sufficient', ar: 'التوابل كافية' },
              type: 'boolean',
              required: true
            },
            {
              key: 'items_needed',
              label: { en: 'Items Needed', ar: 'المواد المطلوبة' },
              type: 'textarea',
              required: false
            }
          ]
        }
      ],
      visibleToRoles: ['admin', 'supervisor', 'employee'],
      editableByRoles: ['admin', 'supervisor'],
      departments: ['kitchen'],
      requiresApproval: true,
      isActive: true,
      createdBy: admin._id
    });

    const wastageTemplate = await FormTemplate.create({
      title: {
        en: 'Wastage Report',
        ar: 'تقرير الهالك'
      },
      description: {
        en: 'Daily wastage and spoilage report',
        ar: 'تقرير الهدر والتلف اليومي'
      },
      sections: [
        {
          id: 'wastage',
          label: {
            en: 'Wastage Details',
            ar: 'تفاصيل الهالك'
          },
          fields: [
            {
              key: 'item_name',
              label: { en: 'Item Name', ar: 'اسم الصنف' },
              type: 'text',
              required: true
            },
            {
              key: 'quantity',
              label: { en: 'Quantity', ar: 'الكمية' },
              type: 'number',
              required: true
            },
            {
              key: 'reason',
              label: { en: 'Reason for Wastage', ar: 'سبب الهدر' },
              type: 'select',
              options: [
                { en: 'Expired', ar: 'منتهي الصلاحية' },
                { en: 'Damaged', ar: 'تالف' },
                { en: 'Overcooked', ar: 'محروق' },
                { en: 'Customer Return', ar: 'إرجاع العميل' },
                { en: 'Other', ar: 'أخرى' }
              ],
              required: true
            },
            {
              key: 'notes',
              label: { en: 'Additional Notes', ar: 'ملاحظات إضافية' },
              type: 'textarea',
              required: false
            }
          ]
        }
      ],
      visibleToRoles: ['admin', 'supervisor', 'employee'],
      editableByRoles: ['admin', 'supervisor', 'employee'],
      departments: ['kitchen'],
      requiresApproval: true,
      isActive: true,
      createdBy: admin._id
    });

    console.log('Form templates created successfully!');

    // Create Sample Form Instances
    console.log('Creating sample form instances...');

    await FormInstance.create({
      templateId: dailyReportTemplate._id,
      filledBy: supervisor._id,
      department: 'kitchen',
      date: new Date(),
      shift: 'morning',
      values: {
        'general.manager': 'Kitchen Supervisor',
        'general.shift': 'Morning',
        'general.weather': 'Sunny',
        'operations.opening_time': '08:00',
        'operations.closing_time': '22:00',
        'operations.customer_count': 150,
        'operations.issues': 'No major issues'
      },
      status: 'submitted'
    });

    await FormInstance.create({
      templateId: inventoryTemplate._id,
      filledBy: employee1._id,
      department: 'kitchen',
      date: new Date(),
      shift: 'morning',
      values: {
        'kitchen_inventory.chicken_stock': 50,
        'kitchen_inventory.oil_stock': 25,
        'kitchen_inventory.spices_sufficient': true,
        'kitchen_inventory.items_needed': 'Need to order more chicken by tomorrow'
      },
      status: 'approved',
      approvedBy: supervisor._id,
      approvalDate: new Date()
    });

    console.log('Sample form instances created successfully!');

    // Create Sample Leave Requests
    console.log('Creating sample leave requests...');

    await LeaveRequest.create({
      userId: employee1._id,
      type: 'vacation',
      startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      reason: 'Family vacation',
      status: 'pending',
      days: 4
    });

    await LeaveRequest.create({
      userId: employee2._id,
      type: 'sick',
      startDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      reason: 'Flu and fever',
      status: 'approved',
      approvedBy: supervisor2._id,
      approvalDate: new Date(),
      days: 2
    });

    console.log('Sample leave requests created successfully!');

    console.log('\n✅ Database seeded successfully!');
    console.log('\n📝 Sample Login Credentials:');
    console.log('Admin: admin@atsha.com / admin123');
    console.log('Supervisor: supervisor@atsha.com / super123');
    console.log('Employee: employee@atsha.com / emp123');
    console.log('\nYou can now start using the application!\n');

  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

// Run the seed function
connectDB().then(() => {
  seedDatabase();
});

