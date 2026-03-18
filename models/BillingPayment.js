const mongoose = require('mongoose');

const billingPaymentSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    provider: {
      type: String,
      enum: ['myfatoorah'],
      required: true,
      index: true
    },
    planCode: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    planSnapshot: {
      code: {
        type: String,
        trim: true,
        lowercase: true
      },
      name: {
        en: String,
        ar: String
      },
      billingCycle: {
        type: String,
        enum: ['monthly', 'annual'],
        default: 'monthly'
      },
      market: {
        primaryRegion: String,
        primaryCountry: String,
        currency: String
      },
      pricing: {
        amount: Number,
        currency: String
      }
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'annual'],
      default: 'monthly'
    },
    invoiceId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    paymentId: {
      type: String,
      index: true,
      sparse: true
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'paid', 'failed', 'cancelled'],
      default: 'pending',
      index: true
    },
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: 'SAR'
    },
    paymentUrl: String,
    organizationSlug: {
      type: String,
      trim: true,
      lowercase: true
    },
    providerResponse: mongoose.Schema.Types.Mixed,
    paidAt: Date,
    appliedAt: Date
  },
  {
    timestamps: true
  }
);

billingPaymentSchema.index({ provider: 1, invoiceId: 1 }, { unique: true });

module.exports = mongoose.model('BillingPayment', billingPaymentSchema);
