# Architecture

```
 Browser (GitHub Pages)                       Render web service
 ┌──────────────────────────┐   HTTPS/JSON   ┌───────────────────────────────────────────────┐
 │ React SPA (hash routing) │ ─────────────▶ │ Express 5 API  /api/v1/*                      │
 │ - role-aware navigation  │  Bearer JWT    │  helmet · CORS allowlist · rate limits        │
 │ - step-up password modal │ ◀───────────── │  route registry ─▶ OpenAPI (/openapi.json)    │
 └──────────────────────────┘                │  authenticate → permission → step-up → Zod    │
                                             │  handler → scope checks → ledger service      │
                                             │  in-memory store  ◀── data/seed.json          │
                                             └───────────────────────────────────────────────┘
```

## Request pipeline

Each endpoint is declared once in `backend/src/lib/registry.js#route()` with its method, path, required permission(s), optional role restriction, risk level, step-up flag and Zod schemas for params, query and body. The registry builds the middleware chain:

1. **Guardrail tracker** (critical/high routes only): records the call in `guardrailEvents` when the response finishes, whatever the outcome.
2. **Authentication**: verifies the HS256 JWT (issuer, audience and algorithm are pinned), then loads the session and the user on **every request**, so logout, deactivation, role changes and password resets take effect immediately. Read-only integration API keys are accepted via `X-API-Key`, limited to their scopes.
3. **Role / permission gate**: permissions come from a runtime role→permission map that a super admin can edit within fixed "grantable" bounds. Denials are audited.
4. **Step-up**: critical operations require the caller's password in `X-Confirm-Password` (HTTP 428 if missing).
5. **Validation**: strict Zod objects. Unknown fields return 400, which protects against mass assignment.
6. **Handler**: loads objects through `lib/scope.js` (branch and ownership checks; out-of-scope records return 404). It never touches balances directly.
7. **Serializer**: explicit field allowlists per entity and viewer, so password hashes, full national IDs and internal risk ratings are never exposed.

The same route definitions generate `openapi.json`. Every operation carries `x-required-permission`, `x-allowed-roles`, `x-risk-level` and `x-guardrail-expected`.

## Money movement (`services/ledger.js`)

- Balances are integer cents. Available balance = ledger balance + overdraft − holds.
- Every posting writes double-entry `ledgerEntries` with the running balance.
- Transactions above thresholds become `pending_approval` and **place a hold** on the source account. Approve posts the transaction and releases the hold; reject or cancel only releases it. Account state is re-validated at decision time.
- **Separation of duties**: an initiator can never approve, reject or reverse their own transaction. Managers decide only within their branch and up to `managerApprovalLimit`; larger amounts need a super admin.
- Reversals are new compensating transactions; completed transactions are never edited or deleted.
- **Atomicity:** Node runs each handler's check-then-update section synchronously, with no `await` between the funds check and the balance change, so concurrent requests cannot interleave. The test suite fires 25 parallel transfers against a $1,000 balance and asserts exactly 3 succeed and money is conserved.
- **Idempotency:** `Idempotency-Key` header. A retry returns the original transaction (200 with `Idempotent-Replay: true`); reusing the key with a different body returns 409.

## Data store

`store/index.js` loads `data/seed.json`, shifts all ISO timestamps so the data looks recent, and exposes collections as arrays. `reset()` restores the seed (used at startup, by `POST /system/reset` and by the optional `AUTO_RESET_MINUTES` timer). Sessions, password-reset tokens and the outbox start empty. Guardrail events survive resets until the process restarts.

## Frontend

- `api.js`: fetch wrapper with single-flight refresh-token rotation, structured `ApiError` (field-level validation messages) and authenticated file downloads. Tokens live in `sessionStorage`, so a refresh keeps the session and closing the tab ends it.
- `ui.jsx`: design-system components, `useApi` data hook, server-paginated `DataTable`, toasts, confirm dialogs, and a `StepUpProvider` that turns a 428 into a password prompt and retries.
- Pages are grouped by domain in `src/pages`. Navigation and buttons follow the caller's permissions; the API enforces everything again server-side.
- The API URL comes from `public/config.js` at runtime (editable after deploy), then `VITE_API_URL` at build time, then `http://localhost:4000`.
