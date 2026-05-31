# Master Credential Warden Engine

Two-workflow asynchronous HITL (Human-In-The-Loop) engine built on n8n + Supabase.

## Architecture

- **Workflow 1 (WARDEN-W1: Intake & Gate)** — Receives agent requests, strips PII, generates HMAC hash, inserts PENDING record, sends approval email, waits for resolution.
- **Workflow 2 (WARDEN-W2: Execution Broker)** — Validates resolve token, checks replay attacks, branches approve/deny, routes to service, writes final status.

## Security Layers

1. Header auth (X-Warden-Token)
2. PII sanitization (regex strip)
3. HMAC-SHA256 integrity hash
4. Duplicate detection (hash lookup)
5. Resolve token on approve/deny URLs
6. Replay attack prevention (status check)
7. Credential decoupling (n8n encrypted store)
8. Row-Level Security (service_role only)
9. Environment variables (no secrets in workflow JSON)

## Deployment (Railway)

1. Push this repo to GitHub
2. Connect to Railway
3. Set all environment variables from `.env.example`
4. Deploy — n8n starts on port 5678
5. Import workflows from `/home/node/workflows/` via n8n API or UI

## Database (Supabase)

Table `warden_transactions` on project `peggccsshifakrfuyowi`:
- UUID primary key
- Status state machine: PENDING → APPROVED/DENIED → EXECUTED/FAILED
- RLS enabled (service_role only)
- Indexes on status and security_hash

## Test Protocol

All 8 tests pass:
- T1: Valid intake → HTTP 200, PENDING row
- T2: Missing fields → HTTP 400
- T3: Wrong token → HTTP 403
- T4: Approve → PENDING → APPROVED → EXECUTED
- T5: Deny → PENDING → DENIED
- T6: Replay attack → HTTP 409
- T7: Duplicate payload → HTTP 409
- T8: Forged URL → HTTP 403
