const Organization = require('../models/Organization');
const BillingPayment = require('../models/BillingPayment');
const { createAuditLog } = require('../utils/auditLogger');
const logger = require('../utils/logger');
const paymentConfig = require('../utils/paymentConfig');
const myfatoorahService = require('../services/myfatoorahService');
const {
  getSubscriptionPlans,
  normalizePlanCode,
  resolveOrganizationSubscription
} = require('../utils/subscription');

const SUPPORTED_BILLING_CYCLES = ['monthly', 'annual'];

const normalizeBaseUrl = (value) => {
  if (!value) {
    return null;
  }

  return String(value).replace(/\/+$/, '');
};

const normalizeBillingCycle = (value) => {
  const normalizedValue = String(value || 'monthly').trim().toLowerCase();
  if (['annual', 'yearly', 'year'].includes(normalizedValue)) {
    return 'annual';
  }

  return 'monthly';
};

const resolveRequestedPlanCode = (value) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return null;
  }

  return normalizePlanCode(rawValue);
};

const getPlanPricing = (plan, billingCycle = 'monthly') => {
  const pricingSource = billingCycle === 'annual'
    ? plan?.pricing?.yearly
    : plan?.pricing?.monthly;

  return {
    amount: Number(pricingSource?.amount) || 0,
    currency: String(
      pricingSource?.currency
      || plan?.market?.currency
      || 'SAR'
    ).trim().toUpperCase() || 'SAR'
  };
};

const addBillingCycle = (date, billingCycle) => {
  const nextDate = new Date(date);
  if (billingCycle === 'annual') {
    nextDate.setFullYear(nextDate.getFullYear() + 1);
    return nextDate;
  }

  nextDate.setMonth(nextDate.getMonth() + 1);
  return nextDate;
};

const parseProviderAmount = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const normalizedValue = value.replace(/,/g, '');
    const matchedValue = normalizedValue.match(/-?\d+(\.\d+)?/);
    if (!matchedValue) {
      return null;
    }

    const parsedValue = Number(matchedValue[0]);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  return null;
};

const normalizePhone = (phone) => {
  if (!phone) {
    return null;
  }

  const digits = String(phone).replace(/[^\d]/g, '');
  if (!digits) {
    return null;
  }

  if (digits.startsWith('966')) {
    return {
      countryCode: '+966',
      number: digits.slice(3)
    };
  }

  if (digits.startsWith('0')) {
    return {
      countryCode: '+966',
      number: digits.slice(1)
    };
  }

  return {
    countryCode: '+966',
    number: digits
  };
};

const mapInvoiceStatus = (invoiceStatus) => {
  const normalizedStatus = String(invoiceStatus || '').trim().toLowerCase();

  if (normalizedStatus === 'paid') {
    return 'paid';
  }

  if (normalizedStatus.includes('cancel')) {
    return 'cancelled';
  }

  if (
    normalizedStatus.includes('expire')
    || normalizedStatus.includes('fail')
    || normalizedStatus.includes('declin')
  ) {
    return 'failed';
  }

  return 'failed';
};

const buildRedirectUrl = (status, { invoiceId = null, organizationSlug = null } = {}) => {
  const frontendBaseUrl = normalizeBaseUrl(paymentConfig.frontendUrl) || 'http://localhost:3000';
  const redirectUrl = new URL('/organization/payment-result', frontendBaseUrl);

  redirectUrl.searchParams.set('status', status);
  if (invoiceId) {
    redirectUrl.searchParams.set('invoiceId', invoiceId);
  }
  if (organizationSlug) {
    redirectUrl.searchParams.set('organization', organizationSlug);
  }

  return redirectUrl.toString();
};

const getCallbackUrls = (organizationSlug = null) => {
  const callbackBaseUrl = normalizeBaseUrl(paymentConfig.myfatoorah?.callbackBaseUrl);
  if (!callbackBaseUrl) {
    throw new Error('MYFATOORAH_CALLBACK_BASE_URL is not configured');
  }

  const callbackUrl = new URL('/api/billing/callback', callbackBaseUrl);
  const errorUrl = new URL('/api/billing/error', callbackBaseUrl);

  if (organizationSlug) {
    callbackUrl.searchParams.set('organization', organizationSlug);
    errorUrl.searchParams.set('organization', organizationSlug);
  }

  return {
    callBackUrl: callbackUrl.toString(),
    errorUrl: errorUrl.toString()
  };
};

const findCheckoutPlan = async (planCode) => {
  const normalizedCode = resolveRequestedPlanCode(planCode);
  if (!normalizedCode) {
    return null;
  }

  const plans = await getSubscriptionPlans({ includeInactive: true });
  return plans.find((plan) => plan.code === normalizedCode) || null;
};

const serializePayment = (paymentRecord) => ({
  id: paymentRecord._id,
  organization: paymentRecord.organization,
  initiatedBy: paymentRecord.initiatedBy,
  provider: paymentRecord.provider,
  planCode: paymentRecord.planCode,
  planSnapshot: paymentRecord.planSnapshot,
  billingCycle: paymentRecord.billingCycle,
  invoiceId: paymentRecord.invoiceId,
  paymentId: paymentRecord.paymentId,
  status: paymentRecord.status,
  amount: paymentRecord.amount,
  currency: paymentRecord.currency,
  paymentUrl: paymentRecord.paymentUrl,
  paidAt: paymentRecord.paidAt,
  appliedAt: paymentRecord.appliedAt,
  createdAt: paymentRecord.createdAt,
  updatedAt: paymentRecord.updatedAt
});

const resolveNextSubscriptionWindow = ({
  organization,
  planCode,
  billingCycle,
  now = new Date()
}) => {
  const currentSubscription = organization?.subscription || {};
  const currentPlanCode = normalizePlanCode(
    currentSubscription.planCode || organization?.plan || 'free'
  );
  const currentStatus = String(currentSubscription.status || '').trim().toLowerCase();
  const currentEndsAt = currentSubscription.endsAt
    ? new Date(currentSubscription.endsAt)
    : null;

  const shouldExtendExistingWindow = (
    currentPlanCode === normalizePlanCode(planCode)
    && ['active', 'trialing', 'past_due'].includes(currentStatus)
    && currentEndsAt
    && currentEndsAt > now
  );

  const startsAt = shouldExtendExistingWindow ? currentEndsAt : now;
  const endsAt = addBillingCycle(startsAt, billingCycle);

  return {
    startsAt,
    endsAt
  };
};

exports.listCheckoutPlans = async (req, res, next) => {
  try {
    const plans = await getSubscriptionPlans();

    res.json({
      success: true,
      data: {
        plans: plans.map((plan) => ({
          ...plan,
          checkout: {
            monthly: (Number(plan?.pricing?.monthly?.amount) || 0) > 0,
            annual: (Number(plan?.pricing?.yearly?.amount) || 0) > 0
          }
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.checkout = async (req, res, next) => {
  try {
    if (!req.organization) {
      return res.status(400).json({
        success: false,
        message: 'Organization context is required'
      });
    }

    const planCode = resolveRequestedPlanCode(req.body?.planCode);
    const billingCycle = normalizeBillingCycle(req.body?.billingCycle);

    if (!planCode) {
      return res.status(400).json({
        success: false,
        message: 'planCode is required'
      });
    }

    if (!SUPPORTED_BILLING_CYCLES.includes(billingCycle)) {
      return res.status(400).json({
        success: false,
        message: 'billingCycle must be one of monthly or annual'
      });
    }

    const plan = await findCheckoutPlan(planCode);
    if (!plan || plan.isActive === false) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found'
      });
    }

    const pricing = getPlanPricing(plan, billingCycle);
    if (pricing.amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Selected plan does not require payment'
      });
    }

    const { callBackUrl, errorUrl } = getCallbackUrls(req.organization.slug);
    const paymentMethodId = await myfatoorahService.resolvePaymentMethodId({
      amount: pricing.amount,
      currency: pricing.currency
    });

    const customerPhone = normalizePhone(req.user?.phone);
    const executePayload = {
      PaymentMethodId: paymentMethodId,
      CustomerName: req.user?.name || req.organization?.name || 'Organization Admin',
      DisplayCurrencyIso: pricing.currency,
      CustomerEmail: req.user?.email,
      InvoiceValue: pricing.amount,
      CallBackUrl: callBackUrl,
      ErrorUrl: errorUrl,
      Language: req.user?.languagePreference === 'en' ? 'en' : 'ar',
      CustomerReference: String(req.organization._id),
      UserDefinedField: `${plan.code}:${billingCycle}`,
      InvoiceItems: [
        {
          ItemName: plan?.name?.en || plan.code,
          Quantity: 1,
          UnitPrice: pricing.amount
        }
      ]
    };

    if (customerPhone?.number) {
      executePayload.MobileCountryCode = customerPhone.countryCode;
      executePayload.CustomerMobile = customerPhone.number;
    }

    const executeResponse = await myfatoorahService.executePayment(executePayload);
    const executeData = executeResponse?.Data || {};
    const paymentUrl = executeData.PaymentURL || executeData.PaymentUrl;
    const invoiceId = executeData.InvoiceId ? String(executeData.InvoiceId) : null;

    if (!paymentUrl || !invoiceId) {
      logger.error('MyFatoorah executePayment response missing fields', executeResponse);
      return res.status(502).json({
        success: false,
        message: 'Failed to create payment session'
      });
    }

    await BillingPayment.findOneAndUpdate(
      { invoiceId },
      {
        organization: req.organization._id,
        initiatedBy: req.user._id,
        provider: 'myfatoorah',
        planCode: plan.code,
        planSnapshot: {
          code: plan.code,
          name: plan.name,
          billingCycle,
          market: {
            primaryRegion: plan?.market?.primaryRegion || 'MENA',
            primaryCountry: plan?.market?.primaryCountry || 'SA',
            currency: pricing.currency
          },
          pricing: {
            amount: pricing.amount,
            currency: pricing.currency
          }
        },
        billingCycle,
        status: 'pending',
        amount: pricing.amount,
        currency: pricing.currency,
        paymentUrl,
        organizationSlug: req.organization.slug,
        providerResponse: {
          executePayment: executeResponse
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    await createAuditLog({
      req,
      organizationId: req.organization._id,
      actorUserId: req.user._id,
      action: 'organization.subscription_checkout_started',
      entityType: 'Organization',
      entityId: req.organization._id,
      metadata: {
        planCode: plan.code,
        billingCycle,
        invoiceId,
        amount: pricing.amount,
        currency: pricing.currency
      }
    });

    res.json({
      success: true,
      data: {
        paymentUrl,
        invoiceId
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.paymentCallback = async (req, res) => {
  const requestedOrganizationSlug = String(req.query.organization || '').trim().toLowerCase() || null;
  const paymentId = req.query.paymentId || req.query.PaymentId;

  if (!paymentId) {
    return res.redirect(buildRedirectUrl('failed', {
      organizationSlug: requestedOrganizationSlug
    }));
  }

  try {
    const statusResponse = await myfatoorahService.getPaymentStatus({
      key: paymentId,
      keyType: 'PaymentId'
    });
    const statusData = statusResponse?.Data || {};
    const invoiceId = statusData.InvoiceId ? String(statusData.InvoiceId) : null;
    const mappedStatus = mapInvoiceStatus(statusData.InvoiceStatus || '');

    const paymentRecord = (
      invoiceId ? await BillingPayment.findOne({ invoiceId }) : null
    ) || await BillingPayment.findOne({ paymentId });
    const organizationSlug = paymentRecord?.organizationSlug || requestedOrganizationSlug;

    if (!paymentRecord) {
      logger.error('Billing payment record not found for callback', { invoiceId, paymentId });
      return res.redirect(buildRedirectUrl('failed', {
        invoiceId,
        organizationSlug
      }));
    }

    if (paymentRecord.status === 'paid' && paymentRecord.appliedAt) {
      return res.redirect(buildRedirectUrl('success', {
        invoiceId,
        organizationSlug
      }));
    }

    const providerAmount = parseProviderAmount(statusData.InvoiceValue);
    if (
      mappedStatus === 'paid'
      && providerAmount != null
      && Math.abs(providerAmount - Number(paymentRecord.amount || 0)) > 0.01
    ) {
      await BillingPayment.updateOne(
        { _id: paymentRecord._id },
        {
          status: 'failed',
          paymentId,
          providerResponse: statusResponse
        }
      );

      return res.redirect(buildRedirectUrl('failed', {
        invoiceId,
        organizationSlug
      }));
    }

    const providerCustomerReference = statusData?.CustomerReference != null
      ? String(statusData.CustomerReference).trim()
      : null;
    if (
      mappedStatus === 'paid'
      && providerCustomerReference
      && providerCustomerReference !== String(paymentRecord.organization)
    ) {
      await BillingPayment.updateOne(
        { _id: paymentRecord._id },
        {
          status: 'failed',
          paymentId,
          providerResponse: statusResponse
        }
      );

      return res.redirect(buildRedirectUrl('failed', {
        invoiceId,
        organizationSlug
      }));
    }

    if (mappedStatus !== 'paid') {
      await BillingPayment.updateOne(
        { _id: paymentRecord._id },
        {
          status: mappedStatus,
          paymentId,
          providerResponse: statusResponse
        }
      );

      return res.redirect(buildRedirectUrl(mappedStatus, {
        invoiceId,
        organizationSlug
      }));
    }

    const lockedPayment = await BillingPayment.findOneAndUpdate(
      {
        _id: paymentRecord._id,
        status: 'pending'
      },
      {
        status: 'processing',
        paymentId,
        providerResponse: statusResponse
      },
      {
        new: true
      }
    );

    const paymentToProcess = lockedPayment || paymentRecord;
    if (!lockedPayment && paymentToProcess.status === 'processing') {
      return res.redirect(buildRedirectUrl('processing', {
        invoiceId,
        organizationSlug
      }));
    }

    if (paymentToProcess.status === 'paid' && paymentToProcess.appliedAt) {
      return res.redirect(buildRedirectUrl('success', {
        invoiceId,
        organizationSlug
      }));
    }

    const organization = await Organization.findById(paymentToProcess.organization);
    if (!organization) {
      await BillingPayment.updateOne(
        { _id: paymentToProcess._id },
        {
          status: 'failed',
          paymentId,
          providerResponse: statusResponse
        }
      );

      return res.redirect(buildRedirectUrl('failed', {
        invoiceId,
        organizationSlug
      }));
    }

    const now = new Date();
    const nextSubscriptionWindow = resolveNextSubscriptionWindow({
      organization,
      planCode: paymentToProcess.planCode,
      billingCycle: paymentToProcess.billingCycle,
      now
    });

    organization.plan = paymentToProcess.planCode;
    organization.subscription = {
      ...(organization.subscription || {}),
      planCode: paymentToProcess.planCode,
      status: 'active',
      billingCycle: paymentToProcess.billingCycle,
      startsAt: nextSubscriptionWindow.startsAt,
      endsAt: nextSubscriptionWindow.endsAt,
      graceEndsAt: null,
      downgradePlanCode: normalizePlanCode(
        organization.subscription?.downgradePlanCode || 'free'
      ),
      market: {
        primaryRegion: paymentToProcess.planSnapshot?.market?.primaryRegion || 'MENA',
        primaryCountry: paymentToProcess.planSnapshot?.market?.primaryCountry || 'SA',
        currency: paymentToProcess.currency || 'SAR'
      }
    };
    await organization.save();

    await BillingPayment.updateOne(
      { _id: paymentToProcess._id },
      {
        status: 'paid',
        paymentId,
        paidAt: now,
        appliedAt: now,
        providerResponse: statusResponse
      }
    );

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: paymentToProcess.initiatedBy,
      action: 'organization.subscription_payment_completed',
      entityType: 'Organization',
      entityId: organization._id,
      metadata: {
        planCode: paymentToProcess.planCode,
        billingCycle: paymentToProcess.billingCycle,
        invoiceId,
        paymentId,
        amount: paymentToProcess.amount,
        currency: paymentToProcess.currency,
        startsAt: nextSubscriptionWindow.startsAt,
        endsAt: nextSubscriptionWindow.endsAt
      }
    });

    return res.redirect(buildRedirectUrl('success', {
      invoiceId,
      organizationSlug
    }));
  } catch (error) {
    logger.error('MyFatoorah payment callback failed:', error.message);
    return res.redirect(buildRedirectUrl('failed', {
      organizationSlug: requestedOrganizationSlug
    }));
  }
};

exports.paymentError = async (req, res) => {
  const requestedOrganizationSlug = String(req.query.organization || '').trim().toLowerCase() || null;
  const paymentId = req.query.paymentId || req.query.PaymentId;

  if (!paymentId) {
    return res.redirect(buildRedirectUrl('failed', {
      organizationSlug: requestedOrganizationSlug
    }));
  }

  try {
    const statusResponse = await myfatoorahService.getPaymentStatus({
      key: paymentId,
      keyType: 'PaymentId'
    });
    const statusData = statusResponse?.Data || {};
    const invoiceId = statusData.InvoiceId ? String(statusData.InvoiceId) : null;
    const mappedStatus = mapInvoiceStatus(statusData.InvoiceStatus || 'failed');
    const filter = invoiceId ? { invoiceId } : { paymentId };
    const paymentRecord = await BillingPayment.findOne(filter).select('organizationSlug');

    await BillingPayment.updateOne(filter, {
      status: mappedStatus,
      paymentId,
      providerResponse: statusResponse
    });

    return res.redirect(buildRedirectUrl(mappedStatus, {
      invoiceId,
      organizationSlug: paymentRecord?.organizationSlug || requestedOrganizationSlug
    }));
  } catch (error) {
    logger.error('MyFatoorah payment error callback failed:', error.message);
    return res.redirect(buildRedirectUrl('failed', {
      organizationSlug: requestedOrganizationSlug
    }));
  }
};

exports.getBillingStatus = async (req, res, next) => {
  try {
    if (!req.organization) {
      return res.status(400).json({
        success: false,
        message: 'Organization context is required'
      });
    }

    const [subscription, latestPayment] = await Promise.all([
      resolveOrganizationSubscription(req.organization, {
        includeUsage: true
      }),
      BillingPayment.findOne({ organization: req.organization._id })
        .sort({ createdAt: -1 })
        .lean()
    ]);

    res.json({
      success: true,
      data: {
        subscription,
        latestPayment: latestPayment ? serializePayment(latestPayment) : null
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getBillingHistory = async (req, res, next) => {
  try {
    if (!req.organization) {
      return res.status(400).json({
        success: false,
        message: 'Organization context is required'
      });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      BillingPayment.find({ organization: req.organization._id })
        .populate('initiatedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BillingPayment.countDocuments({ organization: req.organization._id })
    ]);

    res.json({
      success: true,
      count: payments.length,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      data: payments.map((payment) => ({
        ...serializePayment(payment),
        initiatedBy: payment.initiatedBy
      }))
    });
  } catch (error) {
    next(error);
  }
};
