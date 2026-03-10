## Enterprise Organization Management Phase

Phase 3 adds the administration backend required to operate multiple organizations inside one deployment.

### Implemented APIs

- `GET /api/organizations/current`
- `GET /api/organizations/current/settings`
- `PUT /api/organizations/current/settings`
- `GET /api/organizations`
- `POST /api/organizations`
- `GET /api/organizations/:id`
- `PUT /api/organizations/:id`
- `PATCH /api/organizations/:id/status`
- `GET /api/invitations`
- `POST /api/invitations`
- `PUT /api/invitations/:id/cancel`
- `GET /api/invitations/public/:token`
- `POST /api/invitations/accept`

### Access model

- `platform_admin`
  - can create, list, update, and suspend organizations
  - can create and manage invitations for any organization by passing `organizationId`
- `organization_admin`
  - can read and update settings only for the active organization
  - can create, list, and cancel invitations only for the active organization

### Invitation contract

- Create invitation
  - request body supports `email`, `role`, `department`, `departments`, `languagePreference`, `expiresInDays`, and optional `organizationId` for platform admins
- Preview invitation
  - call `GET /api/invitations/public/:token`
- Accept invitation
  - call `POST /api/invitations/accept` with `token`, `name`, `password`, and optional `phone`, `languagePreference`
  - response returns authenticated session payload: `user`, `organization`, `accessToken`, `refreshToken`

### Audit coverage added in this phase

- organization creation
- organization update
- organization status change
- organization settings update
- invitation creation
- invitation cancellation
- invitation acceptance

### Deferred to the next phase

- invitation resend flow
- organization member management UI
- existing user controller audit hooks
- cross-module tenant scoping for business controllers
