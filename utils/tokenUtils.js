const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const CryptoJS = require('crypto-js');

// Generate JWT access token
exports.generateAccessToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '24h'
  });
};

// Generate JWT refresh token
exports.generateRefreshToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d'
  });
};

// Verify refresh token
exports.verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch (error) {
    return null;
  }
};

// Generate QR attendance token
exports.generateQRToken = () => {
  const now = new Date();
  const validitySeconds = parseInt(process.env.QR_TOKEN_VALIDITY_SECONDS) || 30;

  const payload = {
    timestamp: now.getTime(),
    random: crypto.randomBytes(16).toString('hex')
  };

  const token = CryptoJS.AES.encrypt(
    JSON.stringify(payload),
    process.env.QR_TOKEN_SECRET
  ).toString();

  return {
    token,
    validFrom: now,
    validTo: new Date(now.getTime() + validitySeconds * 1000)
  };
};

// Verify QR attendance token
exports.verifyQRToken = (token) => {
  try {
    const bytes = CryptoJS.AES.decrypt(token, process.env.QR_TOKEN_SECRET);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    const payload = JSON.parse(decrypted);

    const now = Date.now();
    const validitySeconds = parseInt(process.env.QR_TOKEN_VALIDITY_SECONDS) || 30;
    const tokenAge = now - payload.timestamp;

    // Token is valid if it's less than validity seconds old
    return tokenAge <= (validitySeconds * 1000);
  } catch (error) {
    return false;
  }
};

// Generate password reset token
exports.generateResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

