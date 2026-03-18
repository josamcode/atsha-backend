# AraRM Backend Server

Node.js + Express backend for the AraRM Restaurant Management System.

## Features

- RESTful API with Express.js
- MongoDB database with Mongoose ODM
- JWT authentication with refresh tokens
- Role-based access control (Admin, Supervisor, Employee)
- Dynamic form system
- QR-based attendance tracking
- Leave management
- PDF generation with Arabic support
- Security features (Helmet, CORS, Rate Limiting)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file based on `.env.example`:

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/AraRM
JWT_SECRET=your_super_secret_jwt_key_here
JWT_REFRESH_SECRET=your_super_secret_refresh_key_here
JWT_EXPIRE=24h
JWT_REFRESH_EXPIRE=7d
QR_TOKEN_SECRET=your_qr_token_secret_here
QR_TOKEN_VALIDITY_MINUTES=1
MAX_FILE_SIZE=5242880
UPLOAD_DIR=./uploads
CLIENT_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
MYFATOORAH_TOKEN=your-myfatoorah-token
MYFATOORAH_BASE_URL=https://api-sa.myfatoorah.com
MYFATOORAH_CALLBACK_BASE_URL=http://localhost:5000
MYFATOORAH_PAYMENT_METHOD_ID=
```

### 3. Start MongoDB

Ensure MongoDB is running locally or provide a remote connection string.

```bash
# For local MongoDB
mongod
```

### 4. Seed the Database (Optional)

```bash
node scripts/seed.js
```

This creates sample users, form templates, and data.

### 5. Start the Server

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

Server will run on `http://localhost:5000`

## API Documentation

### Authentication Endpoints

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile
- `PUT /api/auth/change-password` - Change password

### Users Endpoints (Admin/Supervisor)

- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create user (Admin only)
- `PUT /api/users/:id` - Update user (Admin only)
- `DELETE /api/users/:id` - Delete user (Admin only)
- `PUT /api/users/:id/reset-password` - Reset password (Admin only)

### Form Templates Endpoints (Admin)

- `GET /api/form-templates` - Get all templates
- `GET /api/form-templates/:id` - Get template by ID
- `POST /api/form-templates` - Create template
- `PUT /api/form-templates/:id` - Update template
- `DELETE /api/form-templates/:id` - Delete template
- `POST /api/form-templates/:id/duplicate` - Duplicate template

### Form Instances Endpoints

- `GET /api/form-instances` - Get all instances (with filters)
- `GET /api/form-instances/:id` - Get instance by ID
- `POST /api/form-instances` - Create instance
- `PUT /api/form-instances/:id` - Update instance
- `DELETE /api/form-instances/:id` - Delete instance
- `PUT /api/form-instances/:id/approve` - Approve/Reject (Admin/Supervisor)
- `GET /api/form-instances/:id/export` - Export as PDF
- `GET /api/form-instances/stats/summary` - Get statistics

### Attendance Endpoints

- `GET /api/attendance/qr-code` - Generate QR code (Admin/Supervisor)
- `POST /api/attendance/check-in` - Check in
- `POST /api/attendance/check-out` - Check out
- `GET /api/attendance/logs` - Get attendance logs
- `GET /api/attendance/my-attendance` - Get my attendance
- `GET /api/attendance/stats` - Get statistics (Admin/Supervisor)
- `POST /api/attendance/manual` - Manual entry (Admin/Supervisor)

### Leaves Endpoints

- `GET /api/leaves` - Get all leave requests
- `GET /api/leaves/:id` - Get leave request by ID
- `POST /api/leaves` - Create leave request
- `PUT /api/leaves/:id` - Update leave request
- `DELETE /api/leaves/:id` - Delete leave request
- `PUT /api/leaves/:id/approve` - Approve/Reject (Admin/Supervisor)
- `PUT /api/leaves/:id/cancel` - Cancel leave
- `GET /api/leaves/stats/summary` - Get statistics
- `GET /api/leaves/my-balance` - Get my leave balance

### Dashboard Endpoint

- `GET /api/dashboard/summary` - Get dashboard summary

### Billing Endpoints

- `GET /api/billing/plans` - List checkout-ready subscription plans
- `POST /api/billing/checkout` - Create a MyFatoorah checkout session for the active organization
- `GET /api/billing/status` - Get the organization subscription state and latest payment
- `GET /api/billing/history` - Get organization payment history
- `GET /api/billing/callback` - MyFatoorah success callback
- `GET /api/billing/error` - MyFatoorah failure callback

## Project Structure

```
server/
├── config/
│   └── db.js              # Database connection
├── controllers/
│   ├── authController.js
│   ├── userController.js
│   ├── formTemplateController.js
│   ├── formInstanceController.js
│   ├── attendanceController.js
│   └── leaveController.js
├── middleware/
│   ├── auth.js            # Authentication & authorization
│   ├── errorHandler.js    # Global error handler
│   └── upload.js          # File upload configuration
├── models/
│   ├── User.js
│   ├── FormTemplate.js
│   ├── FormInstance.js
│   ├── AttendanceToken.js
│   ├── AttendanceLog.js
│   └── LeaveRequest.js
├── routes/
│   ├── auth.js
│   ├── users.js
│   ├── formTemplates.js
│   ├── formInstances.js
│   ├── attendance.js
│   ├── leaves.js
│   └── dashboard.js
├── scripts/
│   └── seed.js            # Database seeding script
├── utils/
│   ├── tokenUtils.js      # JWT & QR token utilities
│   └── pdfGenerator.js    # PDF generation utility
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── server.js              # Main entry point
```

## Security Considerations

- Use strong secrets for JWT tokens in production
- Configure CORS to only allow your frontend domain
- Use HTTPS in production
- Keep dependencies updated
- Enable MongoDB authentication
- Use environment-specific configurations
- Implement proper logging and monitoring

## Production Deployment

1. Set `NODE_ENV=production` in environment variables
2. Use a production MongoDB instance (MongoDB Atlas recommended)
3. Set strong, unique secrets for all tokens
4. Configure proper CORS settings
5. Use a process manager like PM2
6. Set up proper logging
7. Enable HTTPS
8. Consider using a reverse proxy (nginx)

## Common Commands

```bash
# Install dependencies
npm install

# Start in development mode
npm run dev

# Start in production mode
npm start

# Seed database
node scripts/seed.js

# Run tests (when implemented)
npm test
```

## Troubleshooting

### Cannot connect to MongoDB

- Ensure MongoDB is running
- Check your MONGODB_URI in .env
- Verify network connectivity

### JWT errors

- Check JWT_SECRET and JWT_REFRESH_SECRET are set
- Verify token expiration settings

### QR code issues

- Ensure QR_TOKEN_SECRET is set
- Check QR_TOKEN_VALIDITY_MINUTES setting

## License

ISC
