const DEFAULT_PLATFORM_PROFILE = Object.freeze({
  platformName: 'AraRM',
  supportEmail: '',
  websiteUrl: '',
  locale: 'en',
  timezone: 'Africa/Cairo',
  defaultOrganizationPlan: 'free',
  allowOrganizationRegistration: true
});

const DEFAULT_SUBSCRIPTION_PLANS = Object.freeze({
  free: {
    code: 'free',
    name: {
      en: 'Free',
      ar: 'مجاني'
    },
    description: {
      en: 'Entry plan for pilots and very small teams.',
      ar: 'خطة أولية للتجربة والفرق الصغيرة جدا.'
    },
    market: {
      primaryRegion: 'MENA',
      primaryCountry: 'SA',
      currency: 'SAR'
    },
    pricing: {
      monthly: {
        amount: 0,
        currency: 'SAR'
      },
      yearly: {
        amount: 0,
        currency: 'SAR'
      }
    },
    features: {
      qrCode: false,
      attendanceManagement: false,
      leaveManagement: false,
      messaging: false
    },
    limits: {
      formsPerMonth: 100,
      templatesTotal: 3,
      usersTotal: 5,
      messagesPerMonth: 0
    },
    isActive: true,
    sortOrder: 0
  },
  plus: {
    code: 'plus',
    name: {
      en: 'Plus',
      ar: 'بلس'
    },
    description: {
      en: 'For growing teams that need operational workflows and messaging.',
      ar: 'للفرق المتنامية التي تحتاج إلى سير عمل تشغيلي ونظام مراسلة.'
    },
    market: {
      primaryRegion: 'MENA',
      primaryCountry: 'SA',
      currency: 'SAR'
    },
    pricing: {
      monthly: {
        amount: 149,
        currency: 'SAR'
      },
      yearly: {
        amount: 1490,
        currency: 'SAR'
      }
    },
    features: {
      qrCode: true,
      attendanceManagement: true,
      leaveManagement: false,
      messaging: true
    },
    limits: {
      formsPerMonth: 1000,
      templatesTotal: 15,
      usersTotal: 25,
      messagesPerMonth: 1000
    },
    isActive: true,
    sortOrder: 1
  },
  pro: {
    code: 'pro',
    name: {
      en: 'Pro',
      ar: 'برو'
    },
    description: {
      en: 'Full operating suite for larger organizations and regional rollout.',
      ar: 'باقة تشغيل متكاملة للمنظمات الأكبر وللتوسع الإقليمي.'
    },
    market: {
      primaryRegion: 'MENA',
      primaryCountry: 'SA',
      currency: 'SAR'
    },
    pricing: {
      monthly: {
        amount: 349,
        currency: 'SAR'
      },
      yearly: {
        amount: 3490,
        currency: 'SAR'
      }
    },
    features: {
      qrCode: true,
      attendanceManagement: true,
      leaveManagement: true,
      messaging: true
    },
    limits: {
      formsPerMonth: 10000,
      templatesTotal: 150,
      usersTotal: 200,
      messagesPerMonth: 20000
    },
    isActive: true,
    sortOrder: 2
  }
});

const cloneDefaultPlatformProfile = () => ({
  ...DEFAULT_PLATFORM_PROFILE
});

const cloneDefaultSubscriptionPlans = () => Object.values(DEFAULT_SUBSCRIPTION_PLANS)
  .map((plan) => JSON.parse(JSON.stringify(plan)));

module.exports = {
  DEFAULT_PLATFORM_PROFILE,
  DEFAULT_SUBSCRIPTION_PLANS,
  cloneDefaultPlatformProfile,
  cloneDefaultSubscriptionPlans
};
