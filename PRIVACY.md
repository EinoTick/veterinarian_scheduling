# Privacy & data retention

This document describes how VetClinic Scheduler handles personal data for clinic
clients/patients and staff accounts. It is an operational guide for deployers —
not legal advice. Adapt retention periods to your jurisdiction and DPA.

## Data categories

| Category | Examples | Stored in |
|----------|----------|-----------|
| Client / owner PII | name, email, phone, notes | `clients` |
| Patient / animal | name, species, breed, notes | `patients` |
| Appointment snapshots | `client_name`, `patient_name`, times, status | `appointments` |
| Staff accounts | name, email, role | `users` |
| Session tech data | refresh token hash, user-agent | `refresh_tokens` |
| Override audit | who authorized a soft-stop / double-book | `override_logs` |

API timestamps are UTC. Clinic timezone is used for display only.

## Rights support (API)

Clinic administrators (and system administrators) can:

- **Export** — `GET /api/clients/{id}/export`  
  Returns client, patients, related appointments (newest first, capped; see
  `appointments_truncated` when more exist), and override logs for those
  appointments as JSON.
- **Erase** — `POST /api/clients/{id}/erase`  
  Anonymizes client/patient PII (placeholder names, cleared contact fields),
  deactivates records, redacts appointment name snapshots to `REDACTED`, and
  replaces override-log notes with `[redacted]`. Appointment/allocation rows
  and stable numeric IDs remain for scheduling integrity and clinical audit
  (residual identifiers are not deleted).

Staff account deletion is not a self-serve GDPR erase path: deactivate the user
(`PATCH /api/users/{id}` with `is_active: false`), which also invalidates sessions.

## Retention defaults

| Data | Default practice |
|------|------------------|
| Active client/patient records | Until clinic erases or deactivates |
| Soft-deactivated clients/patients | Keep until erase or policy purge |
| Appointments (incl. cancelled) | Retain for clinic operations; erase redacts names |
| Override logs | Retain with appointments; review periodically |
| Refresh tokens | Revoked/expired rows purged ~30 days after stale (opportunistic on login) |
| Application logs | Operator-controlled; avoid logging raw PII |

Recommended: daily encrypted DB backups kept **≥ 7 days**, and a **quarterly restore drill** (see `DEPLOY.md` and `deploy/scripts/`).

## Lawful basis / DPA notes

Deployers should document their lawful basis (e.g. contract / legitimate interest
for clinic operations) and processor agreements with hosting providers. Limit
staff access via system roles (`USER` / `CLINIC_ADMIN` / `SYSTEM_ADMIN`).
