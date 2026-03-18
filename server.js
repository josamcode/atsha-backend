const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

// Body parser
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Allowed origins
const allowedOrigins =
  process.env.NODE_ENV === 'production'
    ? ['https://ararm.vercel.app']
    : [
      'http://localhost:3000',
      'http://192.168.56.1:3000',
      'https://atsha-frontend.vercel.app',
      'https://atshaplus.com',
      'https://www.atshaplus.com',
      'https://atsha.vercel.app'
    ];

// Serve static files from uploads directory with CORS headers
app.use(
  '/uploads',
  (req, res, next) => {
    const origin = req.headers.origin;

    if (req.method === 'OPTIONS') {
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      }
      return res.status(200).end();
    }

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    next();
  },
  express.static(path.join(__dirname, 'uploads'))
);

// Enable CORS
app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin like Postman/curl/mobile apps
      if (!origin) return callback(null, true);

      if (!allowedOrigins.includes(origin)) {
        return callback(
          new Error(
            'The CORS policy for this site does not allow access from the specified Origin.'
          ),
          false
        );
      }

      return callback(null, true);
    },
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'Content-Type']
  })
);

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: {
    error: 'Too many requests',
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
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

// Auth rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
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
app.use('/api/billing', require('./routes/billing'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'atsha Server is running',
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use(errorHandler);

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const logger = require('./utils/logger');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.log(
    `🚀 atsha Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`
  );
  logger.log('💡 QR codes will be generated on-demand from the frontend');
});

process.on('unhandledRejection', (err) => {
  logger.error(`Error: ${err.message}`);
  server.close(() => process.exit(1));
});

process.on('SIGTERM', () => {
  logger.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    logger.log('Process terminated');
  });
});

module.exports = app;
