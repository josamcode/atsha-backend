const User = require('../models/User');
const UserMetadata = require('../models/UserMetadata');
const { createNotification } = require('../utils/notifications');
const { sendEmailToUser, getEmployeeReportEmail } = require('../utils/emailService');
const { getUsers, getUserById, getUserCount, searchUsers, PROJECTIONS } = require('../utils/userQueries');
const logger = require('../utils/logger');

// @desc    Get all users
// @route   GET /api/users
// @access  Private (Admin, Supervisor)
exports.getUsers = async (req, res) => {
  try {
    const { role, department, isActive, search, page = 1, limit = 50, sort = 'name' } = req.query;

    let query = {};

    // Apply filters
    if (role) query.role = role;
    if (department) query.department = department;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    // Supervisors can only see users in their departments
    if (req.user.role === 'supervisor') {
      query.department = { $in: req.user.departments };
    }

    // Handle search
    if (search) {
      const searchResults = await searchUsers(search, query, 'LIST', parseInt(limit));
      const total = await getUserCount({
        ...query,
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ]
      });

      return res.json({
        success: true,
        count: searchResults.length,
        total,
        data: searchResults,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    }

    // Parse sort parameter
    const sortObj = {};
    if (sort.startsWith('-')) {
      sortObj[sort.substring(1)] = -1;
    } else {
      sortObj[sort] = 1;
    }

    // Use optimized query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const users = await getUsers(query, 'LIST', {
      sort: sortObj,
      limit: parseInt(limit),
      skip
    });

    const total = await getUserCount(query);

    res.json({
      success: true,
      count: users.length,
      total,
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private (All authenticated users - employees can only access their own data)
exports.getUser = async (req, res) => {
  try {
    // Use optimized query - get only necessary fields
    const user = await getUserById(req.params.id, 'FULL');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Employees can only access their own data
    if (req.user.role === 'employee') {
      if (req.user._id.toString() !== req.params.id && req.user.id !== req.params.id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this user'
        });
      }
    }

    // Supervisors can only see users in their departments
    if (req.user.role === 'supervisor') {
      if (!req.user.departments.includes(user.department)) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this user'
        });
      }
    }

    // Optionally include metadata if requested
    const includeMetadata = req.query.includeMetadata === 'true';
    let responseData = { user: user.toObject() };

    if (includeMetadata) {
      const metadata = await UserMetadata.findOne({ userId: user._id }).lean();
      responseData.metadata = metadata || null;
    }

    res.json({
      success: true,
      data: responseData.user,
      ...(includeMetadata && { metadata: responseData.metadata })
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create user
// @route   POST /api/users
// @access  Private (Admin only)
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, phone, role, department, departments, languagePreference, leaveBalance, workDays, workSchedule, nationality, idNumber, jobTitle } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Handle image upload
    const imagePath = req.file ? `/uploads/${req.file.filename}` : undefined;

    // Normalize workSchedule to ensure it's always a proper object
    // Prevent storing as array, string, or other invalid types
    let parsedWorkSchedule = {};
    if (workSchedule !== undefined && workSchedule !== null) {
      try {
        if (typeof workSchedule === 'string' && workSchedule.trim()) {
          // If it's a JSON string, parse it
          parsedWorkSchedule = JSON.parse(workSchedule);
        } else if (Array.isArray(workSchedule)) {
          // If it's an array (corrupted data), ignore it and use empty object
          logger.warn(`⚠️  Invalid workSchedule format (array) when creating user, using empty object`);
          parsedWorkSchedule = {};
        } else if (typeof workSchedule === 'object') {
          // Valid object - use as is
          parsedWorkSchedule = workSchedule;
        }

        // Ensure it's a plain object (not Map, etc.)
        if (parsedWorkSchedule instanceof Map) {
          parsedWorkSchedule = Object.fromEntries(parsedWorkSchedule);
        }

        // Validate size - if too large, warn and truncate
        const scheduleSize = JSON.stringify(parsedWorkSchedule).length;
        if (scheduleSize > 10000) { // 10KB limit
          logger.warn(`⚠️  workSchedule too large (${scheduleSize} bytes) when creating user, truncating`);
          parsedWorkSchedule = {};
        }
      } catch (e) {
        // If parsing fails, use empty object
        logger.warn(`⚠️  Error parsing workSchedule when creating user: ${e.message}, using empty object`);
        parsedWorkSchedule = {};
      }
    }

    const user = await User.create({
      name,
      email,
      password,
      phone,
      role: role || 'employee',
      department: department || 'other',
      departments: departments || [],
      languagePreference: languagePreference || 'en',
      leaveBalance: leaveBalance || 0,
      workDays: workDays || [],
      workSchedule: parsedWorkSchedule,
      nationality: nationality || undefined,
      idNumber: idNumber || undefined,
      jobTitle: jobTitle || undefined,
      image: imagePath
    });

    // Create notification for admins when new user is created
    const roleMap = {
      admin: { en: 'Admin', ar: 'مدير' },
      supervisor: { en: 'Supervisor', ar: 'مشرف' },
      employee: { en: 'Employee', ar: 'موظف' }
    };
    const roleEn = roleMap[role]?.en || role;
    const roleAr = roleMap[role]?.ar || role;

    await createNotification({
      type: 'user_created',
      title: {
        en: 'New User Created',
        ar: 'تم إنشاء مستخدم جديد'
      },
      message: {
        en: `New user "${name}" has been created with role: ${roleEn}`,
        ar: `تم إنشاء مستخدم جديد "${name}" بدور: ${roleAr}`
      },
      data: {
        userId: user._id,
        name: name,
        email: email,
        role: role,
        department: department
      }
    });

    res.status(201).json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private (Admin only)
exports.updateUser = async (req, res) => {
  try {
    const { name, email, phone, role, department, departments, languagePreference, isActive, leaveBalance, workDays, workSchedule, nationality, idNumber, jobTitle } = req.body;

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prepare update object
    const updateFields = {};
    if (name) updateFields.name = name;
    if (email) updateFields.email = email;
    if (phone) updateFields.phone = phone;
    if (role) updateFields.role = role;
    if (department) updateFields.department = department;
    if (departments) updateFields.departments = departments;
    if (languagePreference) updateFields.languagePreference = languagePreference;
    if (isActive !== undefined) updateFields.isActive = isActive;
    if (leaveBalance !== undefined) updateFields.leaveBalance = leaveBalance;
    if (workDays !== undefined) updateFields.workDays = workDays;
    if (workSchedule !== undefined) {
      // Normalize workSchedule to ensure it's always a proper object
      // Prevent storing as array, string, or other invalid types
      try {
        let normalizedSchedule = {};

        if (typeof workSchedule === 'string' && workSchedule.trim()) {
          // If it's a JSON string, parse it
          normalizedSchedule = JSON.parse(workSchedule);
        } else if (Array.isArray(workSchedule)) {
          // If it's an array (corrupted data), ignore it and use empty object
          logger.warn(`⚠️  Invalid workSchedule format (array) for user ${req.params.id}, using empty object`);
          normalizedSchedule = {};
        } else if (typeof workSchedule === 'object' && workSchedule !== null) {
          // Valid object - use as is
          normalizedSchedule = workSchedule;
        } else {
          // Invalid type - use empty object
          normalizedSchedule = {};
        }

        // Ensure it's a plain object (not Map, etc.)
        if (normalizedSchedule instanceof Map) {
          normalizedSchedule = Object.fromEntries(normalizedSchedule);
        }

        // Validate size - if too large, warn and truncate
        const scheduleSize = JSON.stringify(normalizedSchedule).length;
        if (scheduleSize > 10000) { // 10KB limit
          logger.warn(`⚠️  workSchedule too large (${scheduleSize} bytes) for user ${req.params.id}, truncating`);
          normalizedSchedule = {};
        }

        updateFields.workSchedule = normalizedSchedule;
      } catch (e) {
        // If parsing fails, use empty object
        logger.warn(`⚠️  Error parsing workSchedule for user ${req.params.id}: ${e.message}, using empty object`);
        updateFields.workSchedule = {};
      }
    }
    if (nationality !== undefined) updateFields.nationality = nationality;
    if (idNumber !== undefined) updateFields.idNumber = idNumber;
    if (jobTitle !== undefined) updateFields.jobTitle = jobTitle;

    // Handle image upload
    if (req.file) {
      // Store old image path for deletion (async, non-blocking)
      const oldImagePath = user.image;
      updateFields.image = `/uploads/${req.file.filename}`;

      // Delete old image asynchronously (non-blocking)
      if (oldImagePath) {
        const fs = require('fs');
        const path = require('path');
        const fullOldImagePath = path.join(process.env.UPLOAD_DIR || './uploads', path.basename(oldImagePath));
        // Delete in background, don't wait for it
        fs.unlink(fullOldImagePath, (err) => {
          if (err && err.code !== 'ENOENT') {
            console.error('Error deleting old user image:', err);
          }
        });
      }
    }

    // Use findByIdAndUpdate for better performance
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select('-password -refreshToken');

    res.json({
      success: true,
      data: updatedUser
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private (Admin only)
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent deleting yourself
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    await user.deleteOne();

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Reset user password
// @route   PUT /api/users/:id/reset-password
// @access  Private (Admin only)
exports.resetPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide new password'
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.password = newPassword;
    // Clear reset request flags
    user.passwordResetRequested = false;
    user.passwordResetRequestDate = undefined;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    // Send email to user
    const { getPasswordResetByAdminEmail, sendEmailToUser } = require('../utils/emailService');
    const userLanguage = user.languagePreference || 'ar';
    await sendEmailToUser(user.email, (language) => getPasswordResetByAdminEmail({
      userName: user.name,
      newPassword: newPassword,
      resetBy: req.user.name
    }, language), userLanguage);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get password reset requests
// @route   GET /api/users/password-reset-requests
// @access  Private (Admin only)
exports.getPasswordResetRequests = async (req, res) => {
  try {
    // Optimized query - only select necessary fields
    const users = await User.find({
      passwordResetRequested: true
    })
      .select('name email department passwordResetRequestDate _id')
      .sort('-passwordResetRequestDate')
      .lean(); // Use lean() for read-only queries

    res.json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get admin user (for employees to send messages)
// @route   GET /api/users/admin
// @access  Private (All authenticated users)
exports.getAdminUser = async (req, res) => {
  try {
    // Optimized query - only select necessary fields
    const admin = await User.findOne({ role: 'admin', isActive: true })
      .select('_id name email department role')
      .lean(); // Use lean() for read-only queries

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin user not found'
      });
    }

    res.json({
      success: true,
      data: admin
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Send employee report via email
// @route   POST /api/users/:id/send-report
// @access  Private (Admin only)
exports.sendEmployeeReport = async (req, res) => {
  try {
    const { month, year } = req.body;
    const employee = await User.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    if (!employee.email) {
      return res.status(400).json({
        success: false,
        message: 'Employee email not found'
      });
    }

    // Get month name
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthNamesAr = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ];

    const selectedMonth = month !== undefined ? parseInt(month) : new Date().getMonth();
    const selectedYear = year || new Date().getFullYear();
    const monthName = monthNames[selectedMonth];
    const monthNameAr = monthNamesAr[selectedMonth];

    // Get frontend URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const reportUrl = `${frontendUrl}/users/${employee._id}/report?month=${selectedMonth}&year=${selectedYear}`;

    // Get department name
    const departmentNames = {
      kitchen: { en: 'Kitchen', ar: 'المطبخ' },
      counter: { en: 'Counter', ar: 'الكاونتر' },
      cleaning: { en: 'Cleaning', ar: 'النظافة' },
      management: { en: 'Management', ar: 'الإدارة' },
      delivery: { en: 'Delivery', ar: 'التوصيل' },
      other: { en: 'Other', ar: 'أخرى' }
    };

    const department = departmentNames[employee.department] || { en: employee.department, ar: employee.department };

    // Send email
    const language = employee.languagePreference || 'ar';
    const emailData = getEmployeeReportEmail({
      employeeName: employee.name,
      month: language === 'ar' ? monthNameAr : monthName,
      year: selectedYear,
      department: language === 'ar' ? department.ar : department.en,
      reportUrl: reportUrl
    }, language);

    // Update email content to include report link button before the last paragraph
    const emailContent = emailData.html.replace(
      /<p style="text-align: [^"]+; font-size: 12px; color: #6b7280;">[^<]+<\/p>/,
      `<div style="text-align: center; margin: 30px 0;">
        <a href="${reportUrl}" style="display: inline-block; padding: 12px 25px; background-color: #d4b900; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold;">${language === 'ar' ? 'عرض التقرير' : 'View Report'}</a>
      </div>
      <p style="text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 12px; color: #6b7280;">${language === 'ar' ? 'فريق إدارة atsha' : 'atsha Management Team'}</p>`
    );

    const result = await sendEmailToUser(
      employee.email,
      () => ({
        subject: emailData.subject,
        html: emailContent
      }),
      language
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Report sent successfully',
        data: {
          email: employee.email,
          messageId: result.messageId
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.error || 'Failed to send report email'
      });
    }
  } catch (error) {
    console.error('Error sending employee report:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

