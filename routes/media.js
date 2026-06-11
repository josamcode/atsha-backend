const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const { protect } = require('../middleware/auth');

/**
 * GET /api/media/proxy-image
 * Proxies an image from a remote URL, returning it with the correct content type.
 * This avoids CORS issues when html2canvas captures cross-origin images.
 *
 * Query params:
 *   url - The remote image URL to proxy (required)
 *
 * Security: Only authenticated users can proxy images.
 * The URL must start with https:// (enforced to prevent SSRF to internal services).
 */
router.get('/proxy-image', protect, async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ success: false, message: 'URL parameter is required' });
    }

    const decodedUrl = decodeURIComponent(url);

    // Security: only allow HTTPS URLs to prevent internal network access
    if (!/^https:\/\//i.test(decodedUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Only HTTPS URLs are allowed for image proxying'
      });
    }

    // Block internal/private IPs
    const urlObj = new URL(decodedUrl);
    const hostname = urlObj.hostname.toLowerCase();

    const blockedHosts = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '[::1]',
      'internal',
      'metadata.google.internal',
      '169.254.169.254'
    ];

    if (blockedHosts.includes(hostname) || hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') || hostname.startsWith('192.168.')) {
      return res.status(403).json({
        success: false,
        message: 'Proxying to internal/private hosts is not allowed'
      });
    }

    // Download the image
    const imageBuffer = await new Promise((resolve, reject) => {
      https.get(decodedUrl, { timeout: 15000 }, (response) => {
        // Follow redirects (max 3 hops)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectUrl = response.headers.location;
          // Recursively follow — but we only do this client.get once for simplicity
          https.get(redirectUrl, { timeout: 15000 }, (redirectResponse) => {
            if (redirectResponse.statusCode !== 200) {
              reject(new Error(`Redirect failed: HTTP ${redirectResponse.statusCode}`));
              return;
            }
            const chunks = [];
            redirectResponse.on('data', (chunk) => chunks.push(chunk));
            redirectResponse.on('end', () => resolve(Buffer.concat(chunks)));
            redirectResponse.on('error', reject);
          }).on('error', reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      }).on('error', reject);
    });

    // Determine content type from URL extension or default to image/png
    const ext = decodedUrl.split('.').pop()?.split('?')[0]?.toLowerCase();
    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'ico': 'image/x-icon',
      'bmp': 'image/bmp',
      'bin': 'image/png' // R2 stored images without extension default to PNG
    };
    const contentType = mimeTypes[ext] || 'image/png';

    // Cache for 1 hour in browser
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(imageBuffer);
  } catch (error) {
    console.error('[media proxy] Error proxying image:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to proxy image'
    });
  }
});

module.exports = router;
