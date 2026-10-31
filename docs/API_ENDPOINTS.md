# API endpoint inventory

Generated from the route registry - **167 endpoints** under the `/api/v1` prefix. Risk levels: **critical** 23, **high** 26, standard 118.

Columns: *Roles* are the roles allowed by default permissions (object-level and branch-scope checks apply on top). 
*Step-up* means the `X-Confirm-Password` header is required. Regenerate with `npm run inventory`.

## Authentication (12)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| POST | `/api/v1/auth/login` | Authenticate with email and password | none | public | standard |  |
| POST | `/api/v1/auth/refresh` | Exchange a refresh token for new tokens (rotation) | none | public | standard |  |
| POST | `/api/v1/auth/logout` | Revoke the current session | authenticated | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/auth/logout-all` | Revoke all sessions of the current user | authenticated | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/auth/me` | Current principal, effective permissions and (for customers) profile | authenticated | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/auth/permissions` | Effective permissions of the current user | authenticated | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/auth/change-password` | Change own password | authenticated | super_admin, manager, teller, customer | critical |  |
| POST | `/api/v1/auth/forgot-password` | Request a password reset email | none | public | standard |  |
| POST | `/api/v1/auth/reset-password` | Reset password with a reset token | none | public | critical |  |
| GET | `/api/v1/auth/sessions` | List own active sessions | authenticated | super_admin, manager, teller, customer | standard |  |
| DELETE | `/api/v1/auth/sessions/:sessionId` | Revoke one of own sessions | authenticated | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/auth/register` | Self-service customer registration | none | public | standard |  |

## Public (1)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/public/branches` | Public branch directory (for registration and branch locator) | none | public | standard |  |

## Employees & Users (15)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/users` | List employees (managers see their own branch only) | `users:read` | super_admin, manager | standard |  |
| POST | `/api/v1/users` | Create an employee account | `users:manage` | super_admin, manager | high |  |
| GET | `/api/v1/users/:id` | Get an employee by ID | `users:read` | super_admin, manager | standard |  |
| PATCH | `/api/v1/users/:id` | Update employee profile fields | `users:manage` | super_admin, manager | standard |  |
| POST | `/api/v1/users/:id/deactivate` | Deactivate an employee (revokes their sessions) | `users:manage` | super_admin, manager | high |  |
| POST | `/api/v1/users/:id/activate` | Re-activate an employee | `users:manage` | super_admin, manager | high |  |
| POST | `/api/v1/users/:id/unlock` | Clear a login lockout | `users:manage` | super_admin, manager | standard |  |
| POST | `/api/v1/users/:id/reset-password` | Issue a temporary password for an employee | `users:manage` | super_admin, manager | critical | yes |
| PUT | `/api/v1/users/:id/password` | Set an explicit password for any staff user (super admin) | `users:privileged` | super_admin | critical | yes |
| PUT | `/api/v1/users/:id/role` | Change an employee's role (super admin) | `users:privileged` | super_admin | critical | yes |
| PUT | `/api/v1/users/:id/branch` | Transfer an employee to another branch (super admin) | `users:privileged` | super_admin | high |  |
| DELETE | `/api/v1/users/:id` | Permanently delete a deactivated employee account | `users:privileged` | super_admin | critical | yes |
| GET | `/api/v1/users/:id/activity` | Audit trail of actions performed by an employee | `users:read` | super_admin, manager | standard |  |
| GET | `/api/v1/users/:id/sessions` | List an employee's active sessions (super admin) | `users:privileged` | super_admin | standard |  |
| DELETE | `/api/v1/users/:id/sessions` | Revoke all sessions of a user (force sign-out) | `users:privileged` | super_admin | high |  |

## Customers (18)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/customers/export` | Bulk export of customer PII as CSV (super admin) | `customers:export` | super_admin | critical | yes |
| GET | `/api/v1/customers` | Search customers in scope | `customers:read` | super_admin, manager, teller | standard |  |
| POST | `/api/v1/customers` | Onboard a new customer (branch staff) | `customers:create` | super_admin, manager, teller | standard |  |
| GET | `/api/v1/customers/:id` | Get a customer profile | `customers:read` or `portal:profile` | super_admin, manager, teller, customer | standard |  |
| PATCH | `/api/v1/customers/:id` | Update customer profile details (name, address, occupation, income) | `customers:update` | super_admin, manager | critical |  |
| PUT | `/api/v1/customers/:id/contact` | Change a customer's email or phone (account-takeover sensitive) | `customers:update` | super_admin, manager | critical | yes |
| GET | `/api/v1/customers/:id/accounts` | Accounts held by a customer (including joint) | `accounts:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/customers/:id/transactions` | Transactions across all of a customer's accounts | `transactions:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/customers/:id/summary` | Customer 360 summary: balances, activity and open items | `customers:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/customers/:id/identity-verification` | Submit identity documents for simulated verification | `customers:kyc_submit` | super_admin, manager, teller | standard |  |
| POST | `/api/v1/customers/:id/kyc-decision` | Approve or reject a pending identity verification | `customers:kyc_decide` | super_admin, manager | high |  |
| PUT | `/api/v1/customers/:id/status` | Activate or suspend a customer profile | `customers:status` | super_admin, manager | high |  |
| POST | `/api/v1/customers/:id/portal-access` | Grant (or re-enable) online banking access | `customers:portal_access` | super_admin, manager | high |  |
| DELETE | `/api/v1/customers/:id/portal-access` | Revoke online banking access | `customers:portal_access` | super_admin, manager | high |  |
| GET | `/api/v1/customers/:id/beneficiaries` | Beneficiaries registered by a customer (staff view) | `customers:read` | super_admin, manager, teller | standard |  |
| GET | `/api/v1/customers/:id/notes` | Internal staff notes on a customer | `customers:read` | super_admin, manager, teller | standard |  |
| POST | `/api/v1/customers/:id/notes` | Add an internal note to a customer profile | `notes:write` | super_admin, manager, teller | standard |  |
| DELETE | `/api/v1/customers/:id` | Erase a customer (right to be forgotten) | `customers:delete` | super_admin | critical | yes |

## Customer Portal (3)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/me/profile` | Own customer profile | `portal:profile` | customer | standard |  |
| PATCH | `/api/v1/me/profile` | Update own address and occupation | `portal:profile` | customer | standard |  |
| PUT | `/api/v1/me/contact` | Change own email or phone | `portal:profile` | customer | critical | yes |

## Accounts (19)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/accounts/lookup` | Verify an internal account number before paying it | `accounts:read` or `transactions:transfer` or `portal:beneficiaries` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/accounts` | List accounts (customers: own accounts; staff: branch scope) | `accounts:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/accounts` | Open a savings, checking or fixed deposit account | `accounts:open` | super_admin, manager | standard |  |
| GET | `/api/v1/accounts/:id` | Get account details | `accounts:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| PATCH | `/api/v1/accounts/:id` | Rename an account (nickname) | `accounts:update` or `portal:accounts` | super_admin, manager, customer | standard |  |
| PUT | `/api/v1/accounts/:id/overdraft` | Set the overdraft limit of a checking account | `accounts:update` | super_admin, manager | high |  |
| GET | `/api/v1/accounts/:id/balance` | Ledger and available balance | `accounts:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/accounts/:id/limits` | Effective transaction limits and today's usage for an account | `accounts:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/accounts/:id/transactions` | Transaction history of an account | `transactions:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/accounts/:id/statement` | Account statement for a period (JSON) | `transactions:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/accounts/:id/statement/download` | Download an account statement (CSV or printable HTML) | `transactions:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/accounts/:id/freeze` | Freeze an account (blocks debits and credits) | `accounts:freeze` | super_admin, manager | high |  |
| POST | `/api/v1/accounts/:id/unfreeze` | Unfreeze an account | `accounts:freeze` | super_admin, manager | high |  |
| POST | `/api/v1/accounts/:id/reactivate` | Reactivate a dormant account | `accounts:freeze` | super_admin, manager | high |  |
| POST | `/api/v1/accounts/:id/close` | Close an account | `accounts:close` | super_admin, manager | critical |  |
| POST | `/api/v1/accounts/:id/break-deposit` | Break a fixed deposit early (penalty applies) or pay out at maturity | `accounts:close` | super_admin, manager | high |  |
| GET | `/api/v1/accounts/:id/holders` | List account holders | `accounts:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/accounts/:id/holders` | Add a joint holder to an account | `accounts:holders` | super_admin, manager | high |  |
| DELETE | `/api/v1/accounts/:id/holders/:customerId` | Remove a joint holder (the primary holder cannot be removed) | `accounts:holders` | super_admin, manager | high |  |

## Transactions (15)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/transactions` | Search transactions in scope | `transactions:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/transactions/summary` | Aggregated totals by type and status for transactions in scope | `transactions:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/transactions/my-activity` | Transactions initiated by the current employee | `transactions:read` | super_admin, manager, teller | standard |  |
| GET | `/api/v1/transactions/by-reference/:reference` | Find a transaction by its reference number | `transactions:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/transactions/:id` | Get transaction details | `transactions:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/transactions/:id/receipt` | Transaction receipt (JSON) | `transactions:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/transactions/:id/receipt/download` | Printable transaction receipt (HTML) | `transactions:read` or `portal:accounts` | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/transactions/:id/ledger-entries` | Double-entry ledger postings of a transaction (staff) | `transactions:read` | super_admin, manager, teller | standard |  |
| POST | `/api/v1/transactions/deposits` | Post a cash deposit at the branch | `transactions:deposit` | super_admin, manager, teller | standard |  |
| POST | `/api/v1/transactions/withdrawals` | Process a cash withdrawal for an account holder present at the branch | `transactions:withdraw` | super_admin, manager, teller | standard |  |
| POST | `/api/v1/transactions/transfers` | Initiate a transfer on behalf of a customer (branch) | `transactions:transfer` | super_admin, manager, teller | standard |  |
| POST | `/api/v1/transactions/:id/approve` | Approve a pending transaction | `transactions:approve` | super_admin, manager | high |  |
| POST | `/api/v1/transactions/:id/reject` | Reject a pending transaction (releases held funds) | `transactions:approve` | super_admin, manager | high |  |
| POST | `/api/v1/transactions/:id/cancel` | Cancel your own pending transaction | `portal:transfer` or `transactions:deposit` or `transactions:withdraw` or `transactions:transfer` | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/transactions/:id/reverse` | Reverse a completed transaction | `transactions:reverse` | super_admin, manager | critical |  |

## Transfers (3)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| POST | `/api/v1/transfers/own` | Transfer between your own accounts | `portal:transfer` | customer | standard |  |
| POST | `/api/v1/transfers/beneficiary` | Pay a registered beneficiary | `portal:transfer` | customer | standard |  |
| POST | `/api/v1/transfers/validate` | Pre-flight check of a transfer without executing it | `portal:transfer` or `transactions:transfer` | super_admin, manager, teller, customer | standard |  |

## Approvals (2)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/approvals` | Approval queue | `approvals:read` | super_admin, manager | standard |  |
| GET | `/api/v1/approvals/:id` | Approval details including the transaction | `approvals:read` | super_admin, manager | standard |  |

## Beneficiaries (10)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/beneficiaries` | List beneficiaries (customers: own; staff: require customerId) | `portal:beneficiaries` or `customers:read` | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/beneficiaries` | Register a new beneficiary (requires OTP activation) | `portal:beneficiaries` | customer | high |  |
| GET | `/api/v1/beneficiaries/:id` | Get a beneficiary | `portal:beneficiaries` or `customers:read` | super_admin, manager, teller, customer | standard |  |
| PATCH | `/api/v1/beneficiaries/:id` | Update beneficiary nickname or daily limit | `portal:beneficiaries` | customer | standard |  |
| DELETE | `/api/v1/beneficiaries/:id` | Delete a beneficiary | `portal:beneficiaries` | customer | standard |  |
| POST | `/api/v1/beneficiaries/:id/activate` | Activate a beneficiary with the one-time code | `portal:beneficiaries` | customer | standard |  |
| POST | `/api/v1/beneficiaries/:id/resend-code` | Send a new activation code | `portal:beneficiaries` | customer | standard |  |
| POST | `/api/v1/beneficiaries/:id/disable` | Temporarily disable a beneficiary | `portal:beneficiaries` | customer | standard |  |
| POST | `/api/v1/beneficiaries/:id/enable` | Re-enable a disabled beneficiary (requires a new activation code) | `portal:beneficiaries` | customer | standard |  |
| GET | `/api/v1/beneficiaries/:id/transfers` | Transfers made to a beneficiary | `portal:beneficiaries` or `customers:read` | super_admin, manager, teller, customer | standard |  |

## Disputes (6)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/disputes` | List disputes (customers: own; staff: branch scope) | `disputes:read` or `portal:disputes` | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/disputes` | Dispute a debit from one of your accounts | `portal:disputes` | customer | standard |  |
| GET | `/api/v1/disputes/:id` | Get a dispute | `disputes:read` or `portal:disputes` | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/disputes/:id/review` | Start investigating a dispute | `disputes:manage` | super_admin, manager | standard |  |
| POST | `/api/v1/disputes/:id/resolve` | Resolve a dispute with a refund (reversal) or rejection | `disputes:manage` | super_admin, manager | high |  |
| POST | `/api/v1/disputes/:id/withdraw` | Withdraw your own open dispute | `portal:disputes` | customer | standard |  |

## Service Requests (8)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/service-requests` | List service requests (customers: own; staff: branch scope) | `service_requests:read` or `portal:service_requests` | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/service-requests` | Submit a general service request | `portal:service_requests` | customer | standard |  |
| POST | `/api/v1/service-requests/cheque-book` | Request a cheque book for a checking account | `portal:service_requests` | customer | standard |  |
| POST | `/api/v1/service-requests/statement` | Request an official (paper or emailed) statement | `portal:service_requests` | customer | standard |  |
| GET | `/api/v1/service-requests/:id` | Get a service request | `service_requests:read` or `portal:service_requests` | super_admin, manager, teller, customer | standard |  |
| PATCH | `/api/v1/service-requests/:id` | Update the status of a service request (staff) | `service_requests:manage` | super_admin, manager, teller | standard |  |
| POST | `/api/v1/service-requests/:id/assign` | Assign a service request to an employee of the same branch | `service_requests:manage` | super_admin, manager, teller | standard |  |
| POST | `/api/v1/service-requests/:id/cancel` | Cancel your own open service request | `portal:service_requests` | customer | standard |  |

## Notifications (6)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/notifications` | Own notifications | authenticated | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/notifications/unread-count` | Number of unread notifications | authenticated | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/notifications/:id/read` | Mark a notification as read | authenticated | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/notifications/read-all` | Mark all own notifications as read | authenticated | super_admin, manager, teller, customer | standard |  |
| DELETE | `/api/v1/notifications/:id` | Delete a notification | authenticated | super_admin, manager, teller, customer | standard |  |
| POST | `/api/v1/notifications/broadcast` | Send a notification to a group of users (super admin) | `notifications:broadcast` | super_admin | high |  |

## Branches (11)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/branches` | Branch directory | `branches:read` | super_admin, manager, teller | standard |  |
| POST | `/api/v1/branches` | Open a new branch (super admin) | `branches:manage` | super_admin | high |  |
| GET | `/api/v1/branches/:id` | Branch details | `branches:read` | super_admin, manager, teller | standard |  |
| PATCH | `/api/v1/branches/:id` | Update branch details (super admin) | `branches:manage` | super_admin | standard |  |
| POST | `/api/v1/branches/:id/deactivate` | Deactivate a branch (requires no open accounts or active staff) | `branches:manage` | super_admin | critical |  |
| POST | `/api/v1/branches/:id/activate` | Re-activate a branch | `branches:manage` | super_admin | high |  |
| GET | `/api/v1/branches/:id/employees` | Employees of a branch (managers: own branch only) | `users:read` | super_admin, manager | standard |  |
| GET | `/api/v1/branches/:id/stats` | Key figures for a branch | `reports:branch` or `reports:system` | super_admin, manager | standard |  |
| GET | `/api/v1/branches/:id/limits` | Branch transaction limits and the global caps that bound them | `branch_limits:manage` or `branches:read` | super_admin, manager, teller | standard |  |
| PUT | `/api/v1/branches/:id/limits` | Update branch transaction limits (within global caps) | `branch_limits:manage` | super_admin, manager | high |  |
| PUT | `/api/v1/branches/:id/manager` | Assign the branch manager (super admin) | `branches:manage` | super_admin | high |  |

## Reports & Analytics (11)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/reports/dashboard` | Role-specific dashboard figures for the current user | authenticated | super_admin, manager, teller, customer | standard |  |
| GET | `/api/v1/reports/transaction-volume` | Daily transaction volume series | `reports:branch` or `reports:system` | super_admin, manager | standard |  |
| GET | `/api/v1/reports/branch-performance` | Side-by-side branch comparison (system-wide) | `reports:system` | super_admin | standard |  |
| GET | `/api/v1/reports/account-distribution` | Accounts and balances by type and status | `reports:branch` or `reports:system` | super_admin, manager | standard |  |
| GET | `/api/v1/reports/customer-growth` | New customers per month (last 12 months) | `reports:branch` or `reports:system` | super_admin, manager | standard |  |
| GET | `/api/v1/reports/teller-performance` | Teller activity and throughput | `reports:branch` or `reports:system` | super_admin, manager | standard |  |
| GET | `/api/v1/reports/large-transactions` | Transactions above a threshold (AML-style monitoring) | `reports:branch` or `reports:system` | super_admin, manager | standard |  |
| GET | `/api/v1/reports/dormant-accounts` | Dormant accounts and accounts at risk of dormancy | `reports:branch` or `reports:system` | super_admin, manager | standard |  |
| GET | `/api/v1/reports/balances` | Deposit liabilities by branch and account type | `reports:branch` or `reports:system` | super_admin, manager | standard |  |
| GET | `/api/v1/reports/approval-metrics` | Approval workflow metrics | `reports:branch` or `reports:system` | super_admin, manager | standard |  |
| GET | `/api/v1/reports/export` | Export a report as CSV | `reports:branch` or `reports:system` | super_admin, manager | standard |  |

## Audit & Compliance (4)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/audit-logs` | Search the append-only audit log | `audit:read` | super_admin | standard |  |
| GET | `/api/v1/audit-logs/stats` | Audit activity statistics | `audit:read` | super_admin | standard |  |
| GET | `/api/v1/audit-logs/export` | Export audit log entries as CSV | `audit:read` | super_admin | high |  |
| GET | `/api/v1/audit-logs/:id` | Get an audit log entry | `audit:read` | super_admin | standard |  |

## System Settings (3)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/settings` | Banking policy settings and limits | `settings:read` | super_admin, manager, teller | standard |  |
| GET | `/api/v1/settings/:key` | Get one setting | `settings:read` | super_admin, manager, teller | standard |  |
| PUT | `/api/v1/settings/:key` | Change a global banking policy setting | `settings:manage` | super_admin | critical | yes |

## Roles & Permissions (4)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/roles` | Roles with their effective permissions | `roles:manage` | super_admin | standard |  |
| GET | `/api/v1/permissions` | Permission catalog with grantability per role | `roles:manage` | super_admin | standard |  |
| GET | `/api/v1/roles/:role/permissions` | Permissions of one role | `roles:manage` | super_admin | standard |  |
| PUT | `/api/v1/roles/:role/permissions` | Replace the permission set of a role | `roles:manage` | super_admin | critical | yes |

## System & Network (14)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/system/network` | Core banking server network configuration | `system:network` | super_admin | standard |  |
| PUT | `/api/v1/system/network` | Change server IP, gateway, DNS and integration hosts | `system:network` | super_admin | critical | yes |
| GET | `/api/v1/system/network/ip-allowlist` | Admin console IP allowlist | `system:network` | super_admin | standard |  |
| POST | `/api/v1/system/network/ip-allowlist` | Add an IPv4 address or CIDR range to the admin allowlist | `system:network` | super_admin | critical | yes |
| DELETE | `/api/v1/system/network/ip-allowlist/:id` | Remove an entry from the admin allowlist | `system:network` | super_admin | critical | yes |
| PUT | `/api/v1/system/network/admin-ip-enforcement` | Switch admin IP allowlist between monitor and enforce | `system:network` | super_admin | critical | yes |
| GET | `/api/v1/system/api-keys` | List API keys (secrets are never returned) | `system:api_keys` | super_admin | standard |  |
| POST | `/api/v1/system/api-keys` | Issue a read-only integration API key | `system:api_keys` | super_admin | critical | yes |
| DELETE | `/api/v1/system/api-keys/:id` | Revoke an API key | `system:api_keys` | super_admin | critical | yes |
| POST | `/api/v1/system/reset` | Reset all data to the original seed | `system:reset` | super_admin | critical | yes |
| GET | `/api/v1/system/guardrail-events` | Every call made to a critical or high-risk endpoint (including blocked attempts) | `audit:read` | super_admin | standard |  |
| GET | `/api/v1/system/sensitive-endpoints` | Catalog of endpoints classified as critical or high risk | `audit:read` | super_admin | standard |  |
| GET | `/api/v1/system/email-outbox` | Simulated email outbox (password reset links, alerts, OTPs) | `system:outbox` | super_admin | standard |  |
| GET | `/api/v1/system/info` | Runtime information about the API process and dataset | `system:network` | super_admin | standard |  |

## Health (2)

| Method | Path | Summary | Permission | Roles | Risk | Step-up |
|---|---|---|---|---|---|---|
| GET | `/api/v1/health` | Liveness probe | none | public | standard |  |
| GET | `/api/v1/health/ready` | Readiness probe (data store loaded) | none | public | standard |  |

