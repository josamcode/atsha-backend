## SaaS Subscription Architecture

This repository now has a subscription enforcement foundation designed for multi-organization SaaS usage.

### Core design

- Subscription scope: organization level
- Entitlement source: resolved organization subscription
- Enforcement location: backend-first, with frontend route guards as a secondary UX layer
- Effective plan behavior: if a paid subscription is expired, cancelled, suspended, or past due outside grace, the organization is automatically enforced on its downgrade plan, which defaults to `free`

### Entitlement model

The effective subscription is composed from:

1. `Organization.subscription`
2. Legacy `Organization.plan` compatibility mapping
3. Default plan catalog in `backend/utils/subscription.js`
4. Optional organization-specific overrides:
   - `subscription.customLimits`
   - `subscription.customFeatures`
5. Existing organization feature flags, which can still disable modules even if the plan allows them

### Supported feature gates

- `qrCode`
- `attendanceManagement`
- `leaveManagement`
- `messaging`

### Supported usage limits

- `formsPerMonth`
- `templatesTotal`
- `usersTotal`
- `messagesPerMonth`

### Locking behavior

When an organization drops below its previous entitlement level:

- Existing data is not deleted
- Extra templates beyond the active plan limit are marked as locked
- Locked templates remain visible for administration and upgrade recovery
- Locked templates cannot be used to create new form instances
- Locked templates cannot be edited until the organization is back within limit or upgrades again

This keeps downgrade behavior reversible and safe.

### Usage accounting

Monthly quotas are tracked in `SubscriptionUsage`.

- Metrics are partitioned by organization, metric key, and month
- The counter layer falls back to live MongoDB counts if no usage document exists yet
- On the first write for a given month, the counter initializes itself from real data instead of starting from zero

### Saudi / MENA considerations

The default plan catalog is biased toward regional rollout:

- Primary country: `SA`
- Default currency: `SAR`
- Region marker: `MENA`
- Localized plan names and descriptions are available in English and Arabic

Recommended next steps for market readiness:

1. Add billing provider integration that supports Saudi invoicing and VAT handling
2. Add public pricing and platform-admin plan management UI
3. Introduce invoice, payment, renewal, and dunning records separate from organization settings
4. Add audit logs for subscription lifecycle changes
5. Add notifications for approaching quota thresholds and expiry dates
6. Add country-specific defaults for timezone, locale, tax settings, and legal documents

### Current implementation boundaries

Implemented now:

- Resolved subscription payload returned with organization/auth responses
- Feature enforcement on attendance, QR, leaves, and messages
- Seat, template, forms-per-month, and messages-per-month enforcement
- Automatic effective-plan downgrade logic
- Template locking on downgrade
- Frontend route guards for disabled subscription features
- Organization settings visibility for current plan and usage

Deferred for the next phase:

- Billing provider integration
- Payment collection and invoice lifecycle
- Self-service checkout and renewal flows
- Platform-admin CRUD APIs for reusable plan definitions
- Tenant-specific notification thresholds
- Hard lock strategies for users or other resources beyond templates
