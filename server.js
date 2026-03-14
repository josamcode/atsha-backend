const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

// Body parser with optimized limits (reduced from 10mb to 5mb for better performance)
// Large files should use multipart/form-data instead
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Serve static files from uploads directory with CORS headers
const path = require('path');
app.use('/uploads', (req, res, next) => {
  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    return res.status(200).end();
  }

  // Add CORS headers for image requests
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Enable CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://192.168.56.1:3000',
  "https://atsha-frontend.vercel.app",
  "https://atshaplus.com",
  "https://www.atshaplus.com"
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  exposedHeaders: ['Content-Disposition', 'Content-Type']
}));

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false
}));

// Rate limiting - Increased limits to prevent frequent rate limit errors
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // Increased to 2000 requests per 15 minutes (was 500)
  message: {
    error: 'Too many requests',
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
  handler: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
    res.status(429).json({
      success: false,
      error: 'Too many requests',
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: retryAfter > 0 ? retryAfter : 0
    });
  }
});
app.use('/api/', limiter);

// Auth rate limiting (stricter but still reasonable)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // Increased from 5 to 20 for better UX
  message: {
    error: 'Too many login attempts',
    message: 'Too many login attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
    res.status(429).json({
      success: false,
      error: 'Too many login attempts',
      message: 'Too many login attempts, please try again later.',
      retryAfter: retryAfter > 0 ? retryAfter : 0
    });
  }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/form-templates', require('./routes/formTemplates'));
app.use('/api/form-instances', require('./routes/formInstances'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/leaves', require('./routes/leaves'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/organizations', require('./routes/organizations'));
app.use('/api/invitations', require('./routes/invitations'));
app.use('/api/platform', require('./routes/platform'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'atsha Server is running',
    timestamp: new Date().toISOString()
  });
});

// Error handler (should be last)
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const logger = require('./utils/logger');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.log(`🚀 atsha Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  logger.log('💡 QR codes will be generated on-demand from the frontend');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error(`Error: ${err.message}`);
  server.close(() => process.exit(1));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    logger.log('Process terminated');
  });
});

module.exports = app;
