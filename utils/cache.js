/**
 * Caching utility with Redis support and in-memory fallback
 * Automatically falls back to in-memory cache if Redis is unavailable
 */

let redisClient = null;
const memoryCache = new Map();
let redisErrorLogged = false; // Track if we've already logged the error
const CACHE_TTL = {
  SHORT: 60, // 1 minute
  MEDIUM: 300, // 5 minutes
  LONG: 1800, // 30 minutes
  VERY_LONG: 3600 // 1 hour
};

// Try to initialize Redis
try {
  const redis = require('redis');
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  redisClient = redis.createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 3) {
          if (!redisErrorLogged) {
            console.warn('Redis connection failed after 3 retries, using in-memory cache');
            redisErrorLogged = true;
          }
          return false; // Stop reconnecting, use memory cache
        }
        return Math.min(retries * 100, 3000);
      }
    }
  });

  redisClient.on('error', (err) => {
    // Only log meaningful errors and avoid duplicate messages
    // Connection refused is expected if Redis isn't running - we'll fall back gracefully
    if (!redisErrorLogged && err && (err.message || err.code || err.toString() !== 'Error')) {
      const errorCode = err.code || '';
      // For connection errors, show a friendly message about fallback
      if (errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND') {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('⚠️  Redis not available (connection refused), using in-memory cache');
        }
      } else {
        // For other errors, show the actual error
        const errorMsg = err.message || err.code || err.toString();
        console.warn(`Redis Client Error: ${errorMsg}, falling back to in-memory cache`);
      }
      redisErrorLogged = true;
    }
    redisClient = null; // Fallback to memory cache
  });

  redisClient.on('connect', () => {
    redisErrorLogged = false; // Reset on successful connection
    if (process.env.NODE_ENV !== 'production') {
      console.log('✅ Redis connected successfully');
    }
  });

  // Connect asynchronously (don't block server startup)
  redisClient.connect().catch((err) => {
    if (!redisErrorLogged) {
      const errorCode = err?.code || '';
      // For connection errors, show a friendly message about fallback
      if (errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND') {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('⚠️  Redis not available (connection refused), using in-memory cache');
        }
      } else {
        // For other errors, show the actual error
        const errorMsg = err?.message || err?.code || 'Connection failed';
        console.warn(`Redis connection failed: ${errorMsg}, using in-memory cache`);
      }
      redisErrorLogged = true;
    }
    redisClient = null;
  });
} catch (error) {
  // Redis not installed or not available
  redisClient = null;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('Redis not available, using in-memory cache');
  }
}

/**
 * Get value from cache
 */
async function get(key) {
  try {
    if (redisClient && redisClient.isReady) {
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : null;
    }
  } catch (error) {
    // Fallback to memory cache on Redis error
  }

  // Use memory cache
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Expired or not found
  if (cached) {
    memoryCache.delete(key);
  }
  return null;
}

/**
 * Set value in cache
 */
async function set(key, value, ttlSeconds = CACHE_TTL.MEDIUM) {
  try {
    if (redisClient && redisClient.isReady) {
      await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
      return;
    }
  } catch (error) {
    // Fallback to memory cache on Redis error
  }

  // Use memory cache
  const expiresAt = Date.now() + (ttlSeconds * 1000);
  memoryCache.set(key, { value, expiresAt });

  // Clean up expired entries periodically (prevent memory leak)
  if (memoryCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of memoryCache.entries()) {
      if (v.expiresAt <= now) {
        memoryCache.delete(k);
      }
    }
  }
}

/**
 * Delete value from cache
 */
async function del(key) {
  try {
    if (redisClient && redisClient.isReady) {
      await redisClient.del(key);
    }
  } catch (error) {
    // Ignore Redis errors
  }

  memoryCache.delete(key);
}

/**
 * Delete multiple keys matching a pattern
 */
async function delPattern(pattern) {
  try {
    if (redisClient && redisClient.isReady) {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    }
  } catch (error) {
    // Ignore Redis errors
  }

  // Delete from memory cache
  const regex = new RegExp(pattern.replace('*', '.*'));
  for (const key of memoryCache.keys()) {
    if (regex.test(key)) {
      memoryCache.delete(key);
    }
  }
}

/**
 * Clear all cache
 */
async function flush() {
  try {
    if (redisClient && redisClient.isReady) {
      await redisClient.flushDb();
    }
  } catch (error) {
    // Ignore Redis errors
  }

  memoryCache.clear();
}

/**
 * Generate cache key
 */
function key(...parts) {
  return parts.filter(Boolean).join(':');
}

module.exports = {
  get,
  set,
  del,
  delPattern,
  flush,
  key,
  CACHE_TTL
};

