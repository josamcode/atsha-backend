const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT token
exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Not authorized to access this route' 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    if (!req.user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'User account is deactivated' 
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({ 
      success: false, 
      message: 'Token is not valid' 
    });
  }
};

// Role-based authorization
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route`
      });
    }
    next();
  };
};

// Check if user has access to specific department
exports.checkDepartmentAccess = (req, res, next) => {
  const { department } = req.params;
  
  // Admin has access to all departments
  if (req.user.role === 'admin') {
    return next();
  }
  
  // Supervisor can only access their departments
  if (req.user.role === 'supervisor') {
    if (!req.user.departments || !req.user.departments.includes(department)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this department'
      });
    }
  }
  
  // Employee can only access their own department
  if (req.user.role === 'employee') {
    if (req.user.department !== department) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this department'
      });
    }
  }
  
  next();
};

