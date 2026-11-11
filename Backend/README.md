# FileGuard authentication API

The API stores users and file metadata in MongoDB, hashes passwords with
bcrypt, and uses short-lived JWT bearer tokens. Files may be uploaded to a
private local storage directory and are fingerprinted by the server.
Public registration always creates a `user`; only a signed-in `superadmin` can
create an `admin` or assign the admin role.

## Setup

1. Install Node.js and start a MongoDB instance.
2. From this directory, create a local `.env` file with the following
   variables. Keep real credentials out of source control.
   `MONGODB_URI`, `JWT_SECRET` (at least 32 characters), `SUPER_ADMIN_NAME`,
   `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (at least 8 characters, a
   letter, and a number), `FRONTEND_ORIGIN`, and `PORT`.
3. Run `npm install`, then `npm run dev` for development or `npm start`.
4. Configure the frontend `VITE_API_URL` if the API is not available through
   the Vite `/api` proxy. The development proxy targets `http://localhost:5000`.
5. To enable account recovery and email security notifications, configure all
   of `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`.
   Recovery links are random, single-use, hashed in the database, and expire
   after 30 minutes. Without SMTP, password recovery returns a clear
   configuration error.
6. Uploaded files are stored outside public assets in `Backend/storage` by
   default. Set `FILE_STORAGE_DIR` to an absolute path on a private, persistent
   volume when deploying. Restrict access to that directory at the operating
   system level and include it in backups as appropriate.
7. Install ClamAV on the API host and keep its virus definitions current.
   FileGuard runs `clamscan` locally for every uploaded file. Set
   `CLAMSCAN_PATH` to the executable path if it is not on `PATH`. If ClamAV
   cannot run, the upload is retained and its malware result is reported as
   unavailable; the overall security status is inconclusive, never clean.

Example local development values (replace the JWT secret and account details):

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/fileguard
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters-long
FRONTEND_ORIGIN=http://localhost:5173
SUPER_ADMIN_NAME=FileGuard Super Admin
SUPER_ADMIN_EMAIL=superadmin@example.com
SUPER_ADMIN_PASSWORD=replace-with-a-strong-password
# Optional, but required for password recovery and email security notifications
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
# Optional if clamscan is not on PATH; use the local ClamAV executable path
CLAMSCAN_PATH=clamscan
```

The super-admin is created on first startup when its configured email is not
already present. The configured credentials do not overwrite an existing
super-admin account. The same email cannot be used to silently elevate an
ordinary account.

## Authentication routes

All routes are prefixed with `/api/auth`.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/register` | Public | Create a user account and sign in |
| `POST` | `/login` | Public | Sign in and receive a bearer token |
| `GET` | `/me` | Authenticated | Validate the token and return the current user |
| `PATCH` | `/me` | Authenticated | Update the current user's name and email |
| `PATCH` | `/me/password` | Authenticated | Change the current password and revoke older sessions |
| `POST` | `/logout` | Authenticated | Invalidate all tokens for the current account |
| `POST` | `/admins` | Super admin | Create an administrator account |
| `POST` | `/forgot-password` | Public | Email a one-time recovery link |
| `POST` | `/reset-password` | Public | Reset a password using its recovery link |
| `POST` | `/mfa/verify` | Challenge token | Complete super-admin authenticator sign-in |

Registration and login return `{ "user": { "id", "name", "email", "role", "created" }, "token": "..." }`.
Send the token as `Authorization: Bearer <token>` to protected routes. The
password is never returned by the API.

## Management API

All management routes use `/api/admin` and require `admin` or `superadmin`
unless noted. Admins can view standard users, file metadata, activity,
verification history, alerts, and reports; they can suspend or reactivate
standard users and investigate or escalate alerts. Admins cannot create or
manage administrator accounts, change system settings, or create or update
incidents. Those privileged changes are restricted to the super admin.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/overview` | System totals and recent activity |
| `GET` | `/users`, `/users/:id` | Search/list accounts and inspect account details |
| `PATCH` | `/users/:id/status` | Activate, deactivate, or suspend an eligible account (admin or super admin; reason required) |
| `PATCH` | `/users/:id/role` | Promote to admin or revoke admin role (super admin) |
| `POST` | `/users/:id/reset-access` | Email recovery link to an administrator (super admin) |
| `DELETE` | `/users/:id` | Delete a non-super-admin and associated file metadata |
| `GET` | `/files`, `/activity`, `/incidents`, `/settings` | Read system-wide data |
| `GET` | `/scan-history` | Review file security scan results |
| `POST` | `/activity/archive` | Archive logs older than a supplied ISO cutoff date (admin or super admin; records remain retrievable) |
| `GET` | `/activity?archived=true` | Retrieve archived activity |
| `POST` | `/activity/:id/restore` | Restore an archived activity record |
| `GET` | `/verification-history`, `/alerts` | Review verification records and security alerts |
| `PATCH` | `/alerts/:id` | Add an investigation note, update alert status, or escalate (admin or super admin) |
| `POST` / `PATCH` | `/incidents` and `/incidents/:id` | Record and investigate incidents (super admin) |
| `PUT` | `/settings` | Update validated policies (super admin) |
| `GET` | `/reports.csv?from=YYYY-MM-DD&to=YYYY-MM-DD` | Export a period report (admin or super admin) |
| `GET` / `POST` | `/mfa`, `/mfa/setup`, `/mfa/enable` | Configure super-admin MFA |

Security-sensitive account and policy changes are written to the activity log.
File modifications, flagged scan results, and failed login/MFA events generate security alerts.
When SMTP is configured and security notifications are enabled, active admins
and super admins also receive email notifications. Alerts preserve the source
activity record while their investigation notes and status are managed
separately.
Super-admin MFA uses an authenticator app; the secret is encrypted at rest with
a key derived from `JWT_SECRET`. Ten one-time recovery codes are shown once
during setup. Store them securely. Rotating `JWT_SECRET` requires setting up
MFA again.

Authenticated file routes use `/api/files`: `GET /` lists the current user's
files, `GET /:id/download` downloads the user's stored copy, and `GET /policy`
returns the active file policy. The frontend registers
a baseline through `POST /upload`, which accepts one multipart file in the
`file` field, validates its extension and size, and checks PDF, DOCX, XLSX,
TXT, JPG/JPEG, PNG, and ZIP structures. Other permitted extensions are marked
as structurally unsupported, not as structurally validated. The API scans each
upload with local ClamAV before calculating its server-side SHA-256. Structural
validation is capped at 100 MB per file and ZIP expansion at 100 MB. Files that
exceed those safety limits are retained but their structural result is
inconclusive. The oldest file with the same owner and name remains the original
SHA-256 baseline; later uploads are compared with it and never replace it.
Every scan is retained in scan history.

Uploads that are malformed, differ from an existing same-name baseline, are
flagged by ClamAV, or cannot be scanned are retained and their results are
shown to the owner and administrators. FileGuard does not block downloads
based on these findings. A ClamAV-unavailable scan or a scan that
exceeds ClamAV's configured limits is never reported as clean. ClamAV checks
for known malware signatures; it does not execute files
in a behavioral sandbox and cannot reliably determine whether an arbitrary file
will steal personal data, modify or encrypt files, install software, contact a
malicious server, or exploit a vulnerability. A clean signature scan is not
proof that a file is safe. Configure ClamAV and keep its definitions current in
production; investigate flagged or inconclusive results before opening files.

`POST /:id/verify` accepts the current copy as multipart data, scans it before
comparison, compares its fingerprint with the original baseline, and—when text
content is available—returns changed lines with original/current line numbers.
Malware-positive, structurally invalid, and unscannable comparison uploads are
retained and reported instead of rejected. Modified copies are retained
privately and can be retrieved by their owner through
`GET /history/:id/changed-copy`; `GET /history/:id/diff` retrieves the diff
again later. Changed copies are automatically deleted after 30 days; the
verification history remains. Binary or over-2-MB files are identified as
changed but do not receive line-by-line comparisons; their changed copies
remain downloadable until expiry.
`DELETE /:id` removes the owner's file record and original stored content,
while personal verification history remains. Hash-only registrations from
older versions must be removed and re-registered with the original file to
enable content comparisons. `POST /` and `/import` remain available for
metadata-only legacy records. Admins and super admins can also use
`POST /:id/admin-verify` to upload and compare an authorized local copy with a
required reason. As with user verification, the original is never replaced;
the owner can view any text diff and download the changed copy.

## Frontend behavior

The super-admin is redirected to `/superadmin` after sign-in. Legacy
browser-only file lists and verification history are not automatically
imported, because they are not tied to an authenticated owner and do not
include original file contents. Re-register files to save a private baseline.
New file uploads, registrations, verifications, authentication events, alerts,
and administrative actions are recorded centrally. Admins are redirected to
`/admin`, which provides
user-management, file monitoring, authorized verification, alert
investigation, activity, report, notification, and profile sections.
