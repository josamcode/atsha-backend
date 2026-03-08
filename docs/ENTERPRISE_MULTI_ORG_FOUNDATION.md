## Enterprise Conversion Foundation

This repository is being converted from a single-tenant deployment to a shared multi-organization platform. The first implementation phase is intentionally limited to schema and migration foundations so later auth and controller refactors can build on stable tenant primitives.

### Canonical Decisions

- Tenant key on business data: `organizationId`
- Tenant entity: `Organization`
- Global admin role: `platform_admin`
- Organization admin role: `organization_admin`
- Legacy role aliases still accepted during transition: `admin`, `qr-manager`
- Department storage: string codes on records, organization-owned department definitions on `Organization.departments`

### Request Resolution Order

Later auth work should resolve organization context in this order:

1. Custom domain against `Organization.allowedDomains`
2. Organization slug during login/bootstrap
3. Development fallback header such as `X-Organization-Slug`

### Phase Order For This Repo

1. Foundation
   Add `Organization`, `AuditLog`, `organizationId` fields, tenant indexes, and a default-organization backfill script.
2. Auth and middleware
   Introduce organization resolution, JWT organization scope, and active-organization checks.
3. Organization management
   Add organization CRUD, settings, invitations, and audit hooks.
4. Module refactors
   Scope users, forms, attendance, leaves, messages, notifications, and dashboards.
5. Frontend session and routing
   Add organization bootstrap, organization context, route separation, and organization admin screens.
6. Branding and delivery
   Make email, PDF, uploads, and CORS organization-aware.
7. Migration and verification
   Run backfill, enforce required fields and compound uniqueness, then add tenant isolation tests.

### Current Phase 1 Scope

- New models: `Organization`, `AuditLog`
- New utilities: `utils/tenantConstants.js`, `utils/tenantScope.js`
- Tenant field added to all tenant-owned collections
- Compound tenant indexes added where they will be needed after backfill
- Migration scaffold added: `scripts/backfillDefaultOrganization.js`

### Deferred To The Next Phase

- `resolveOrganization` and `requireOrganization` middleware
- JWT payload updates to include `organizationId`
- Controller-level tenant scoping
- Frontend organization bootstrap and routing
- White-label branding and public-domain resolution
