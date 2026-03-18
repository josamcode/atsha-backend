const normalizeEnvValue = (value) => {
  if (value == null) {
    return undefined;
  }

  const trimmedValue = String(value).trim();
  if (!trimmedValue) {
    return undefined;
  }

  const wrappedInDoubleQuotes = trimmedValue.startsWith('"') && trimmedValue.endsWith('"');
  const wrappedInSingleQuotes = trimmedValue.startsWith("'") && trimmedValue.endsWith("'");

  if (wrappedInDoubleQuotes || wrappedInSingleQuotes) {
    const unwrappedValue = trimmedValue.slice(1, -1).trim();
    return unwrappedValue || undefined;
  }

  return trimmedValue;
};

module.exports = {
  frontendUrl: normalizeEnvValue(process.env.FRONTEND_URL) || 'http://localhost:3000',
  myfatoorah: {
    token: normalizeEnvValue(process.env.MYFATOORAH_TOKEN),
    baseUrl: normalizeEnvValue(process.env.MYFATOORAH_BASE_URL) || 'https://api-sa.myfatoorah.com',
    callbackBaseUrl: normalizeEnvValue(process.env.MYFATOORAH_CALLBACK_BASE_URL),
    paymentMethodId: normalizeEnvValue(process.env.MYFATOORAH_PAYMENT_METHOD_ID)
  }
};
