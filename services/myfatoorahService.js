const http = require('http');
const https = require('https');
const { URL } = require('url');
const paymentConfig = require('../utils/paymentConfig');
const logger = require('../utils/logger');

const getAuthHeader = () => {
  const token = paymentConfig.myfatoorah?.token;
  if (!token) {
    throw new Error('MYFATOORAH_TOKEN is not configured');
  }

  if (token.toLowerCase().startsWith('bearer ')) {
    return token;
  }

  return `Bearer ${token}`;
};

const request = (path, payload = {}) => {
  return new Promise((resolve, reject) => {
    const baseUrl = paymentConfig.myfatoorah?.baseUrl;
    if (!baseUrl) {
      reject(new Error('MYFATOORAH_BASE_URL is not configured'));
      return;
    }

    const url = new URL(path, baseUrl);
    const requestBody = JSON.stringify(payload);
    const transport = url.protocol === 'http:' ? http : https;

    const req = transport.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        headers: {
          Authorization: getAuthHeader(),
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
        },
        timeout: 30000
      },
      (res) => {
        let responseBody = '';

        res.on('data', (chunk) => {
          responseBody += chunk;
        });

        res.on('end', () => {
          let parsedResponse = null;

          try {
            parsedResponse = responseBody ? JSON.parse(responseBody) : null;
          } catch (error) {
            logger.error('MyFatoorah response parse error:', error);
          }

          if (res.statusCode >= 400) {
            reject(new Error(
              parsedResponse?.Message
              || parsedResponse?.message
              || `MyFatoorah HTTP ${res.statusCode}`
            ));
            return;
          }

          if (!parsedResponse) {
            reject(new Error('MyFatoorah returned an empty response'));
            return;
          }

          if (parsedResponse.IsSuccess === false) {
            reject(new Error(
              parsedResponse.Message
              || parsedResponse?.Data?.ErrorMessage
              || 'MyFatoorah request failed'
            ));
            return;
          }

          resolve(parsedResponse);
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('MyFatoorah request timed out'));
    });

    req.write(requestBody);
    req.end();
  });
};

const initiatePayment = ({ amount, currency }) => request('/v2/InitiatePayment', {
  InvoiceAmount: amount,
  CurrencyIso: currency
});

const executePayment = (payload) => request('/v2/ExecutePayment', payload);

const getPaymentStatus = ({ key, keyType }) => request('/v2/getPaymentStatus', {
  Key: key,
  KeyType: keyType
});

const pickPaymentMethod = (methods = []) => {
  if (!Array.isArray(methods) || methods.length === 0) {
    return null;
  }

  const preferredKeywords = ['visa', 'master', 'credit', 'mada', 'apple', 'stc'];
  const keywordMatch = methods.find((method) => {
    const label = `${method.PaymentMethodEn || ''} ${method.PaymentMethodAr || ''}`.toLowerCase();
    return preferredKeywords.some((keyword) => label.includes(keyword));
  });

  if (keywordMatch && keywordMatch.IsDirectPayment === false) {
    return keywordMatch;
  }

  const nonDirectMatch = methods.find((method) => method.IsDirectPayment === false);
  if (nonDirectMatch) {
    return nonDirectMatch;
  }

  return keywordMatch || methods[0];
};

const resolvePaymentMethodId = async ({ amount, currency }) => {
  const override = paymentConfig.myfatoorah?.paymentMethodId;
  if (override) {
    return Number(override);
  }

  const response = await initiatePayment({ amount, currency });
  const methods = response?.Data?.PaymentMethods || [];
  const selectedMethod = pickPaymentMethod(methods);

  if (!selectedMethod?.PaymentMethodId) {
    throw new Error('No available payment methods from MyFatoorah');
  }

  return selectedMethod.PaymentMethodId;
};

module.exports = {
  executePayment,
  getPaymentStatus,
  initiatePayment,
  resolvePaymentMethodId
};
