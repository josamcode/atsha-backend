## Enterprise Auth Phase

Phase 2 makes authentication and protected requests organization-aware while keeping a compatibility path for the current single-org frontend.

### Implemented behavior

- Public auth routes resolve organization context before login-style flows.
- Protected routes validate the JWT against the active organization.
- JWT payload now includes:
  - `id`
  - `organizationId`
  - `role`
  - `sessionVersion`
- `authorize(...)` normalizes legacy and canonical role names:
  - `admin` -> `organization_admin`
  - `qr-manager` -> `qr_manager`
- Auth responses expose both:
  - legacy-compatible `user.role`
  - canonical `user.organizationRole`

### Resolution order in code

1. `Organization.allowedDomains` matched from request origin/referer/host
2. explicit slug from `X-Organization-Slug`, query, params, or body
3. `DEFAULT_ORGANIZATION_SLUG` environment fallback
4. single active organization fallback

### Compatibility notes

- Login and refresh still work for a single active organization even before the frontend sends organization slug.
- Login auto-attaches legacy users without `organizationId` to the resolved organization as a transition aid.
- Existing tokens issued before this phase should be treated as expired and replaced by a new login.

### Next backend phase

- Add organization CRUD and settings endpoints
- Add invitation onboarding
- Add audit hooks on sensitive admin actions
