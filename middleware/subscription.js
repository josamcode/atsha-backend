const {
  assertFeatureEnabled
} = require('../utils/subscription');

const requireSubscriptionFeature = (featureKey) => {
  return async (req, res, next) => {
    try {
      if (!req.organization) {
        return res.status(400).json({
          success: false,
          message: 'Organization context is required'
        });
      }

      const subscription = await assertFeatureEnabled(req.organization, featureKey);
      req.subscription = subscription;
      next();
    } catch (error) {
      return res.status(error.statusCode || 403).json({
        success: false,
        code: error.code || 'subscription_feature_disabled',
        message: error.message,
        details: error.details || {
          featureKey
        }
      });
    }
  };
};

module.exports = {
  requireSubscriptionFeature
};
