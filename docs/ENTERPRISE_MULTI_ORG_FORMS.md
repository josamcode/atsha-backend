## Enterprise Forms Phase

Phase 6 makes the forms backend organization-safe.

### Updated APIs

- `GET /api/form-templates`
- `GET /api/form-templates/:id`
- `POST /api/form-templates`
- `PUT /api/form-templates/:id`
- `DELETE /api/form-templates/:id`
- `POST /api/form-templates/:id/duplicate`
- `GET /api/form-instances`
- `GET /api/form-instances/:id`
- `POST /api/form-instances`
- `PUT /api/form-instances/:id`
- `DELETE /api/form-instances/:id`
- `PUT /api/form-instances/:id/approve`
- `GET /api/form-instances/:id/export`
- `GET /api/form-instances/stats/summary`
- `POST /api/form-instances/:id/images`
- `DELETE /api/form-instances/:id/images/:imageId`

### Access model

- `platform_admin`
  can manage templates and form instances for any organization by passing `organizationId`
- `organization_admin`
  can manage templates and all form instances inside the active organization
- `supervisor`
  can list, read, update, approve, and manage images only for forms in their allowed departments
- `employee`
  can list, read, create, and export their own forms, and can update or delete only their own draft forms, subject to template permissions

### Tenant behavior

- Template listing and reads are scoped by `organizationId`, role visibility, and department access
- Template create, update, duplicate, and delete validate department assignments against `Organization.departments`
- The legacy `admin + management department` shortcut was removed; organization admins now own template management
- Form instance list, read, create, update, delete, approve, export, and stats are scoped by `organizationId`
- Submitted-form notifications and admin emails are restricted to the same organization
- Form image uploads now use organization-aware Cloudinary folders under `organizations/<organizationId>/form-instances/<formInstanceId>`
- PDF export now receives organization context for tenant-scoped branding fallbacks

### Audit coverage added in this phase

- form template creation
- form template update
- form template deletion
- form template duplication
- form instance creation
- form instance update
- form instance submission
- form instance deletion
- form instance approval
- form instance rejection

### Compatibility notes

- Template role arrays still store legacy `admin` values for current client compatibility, while backend permission checks normalize them to organization-aware roles
- Frontend form pages still contain hardcoded department and management-admin assumptions and need their own refactor phase

### Deferred to the next phases

- attendance controller tenant refactor
- leave controller tenant refactor
- message controller tenant refactor
- notification controller tenant refactor
- dashboard tenant refactor
- frontend organization-aware forms UI
