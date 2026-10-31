# Role-permission matrix

Generated from `backend/src/lib/permissions.js` (`npm run inventory`). ✅ = granted by default, ◻️ = not granted by default but a super admin may grant it at runtime, — = can never be granted to this role. `super_admin` always holds every permission and cannot be edited.

Object-level rules apply on top of permissions: managers and tellers are confined to their branch, customers to records they own, and nobody may approve or reverse their own transactions.

| Permission | Description | super_admin | manager | teller | customer |
|---|---|:-:|:-:|:-:|:-:|
| `branches:read` | View branch directory and details | ✅ | ✅ | ✅ | — |
| `branches:manage` | Create, update and deactivate branches | ✅ | — | — | — |
| `branch_limits:manage` | Adjust transaction limits for own branch | ✅ | ✅ | — | — |
| `users:read` | View employee records in scope | ✅ | ✅ | — | — |
| `users:manage` | Create and manage tellers in own branch | ✅ | ✅ | — | — |
| `users:privileged` | Manage managers/admins, roles, passwords and branch assignment | ✅ | — | — | — |
| `customers:read` | Search and view customer profiles in scope | ✅ | ✅ | ✅ | — |
| `customers:create` | Onboard new customers | ✅ | ✅ | ✅ | — |
| `customers:update` | Edit customer profile and contact details | ✅ | ✅ | ◻️ | — |
| `customers:kyc_submit` | Submit identity verification documents | ✅ | ✅ | ✅ | — |
| `customers:kyc_decide` | Approve or reject identity verification | ✅ | ✅ | — | — |
| `customers:status` | Activate or suspend customer profiles | ✅ | ✅ | — | — |
| `customers:portal_access` | Grant or revoke customer online banking access | ✅ | ✅ | — | — |
| `customers:export` | Bulk export of customer PII | ✅ | — | — | — |
| `customers:delete` | Erase customer records (right to be forgotten) | ✅ | — | — | — |
| `notes:write` | Add internal notes to customer profiles | ✅ | ✅ | ✅ | — |
| `accounts:read` | View accounts in scope | ✅ | ✅ | ✅ | — |
| `accounts:open` | Open new accounts | ✅ | ✅ | ◻️ | — |
| `accounts:update` | Update account settings (nickname, overdraft) | ✅ | ✅ | — | — |
| `accounts:freeze` | Freeze, unfreeze and reactivate accounts | ✅ | ✅ | — | — |
| `accounts:close` | Close accounts and break fixed deposits | ✅ | ✅ | — | — |
| `accounts:holders` | Add or remove joint account holders | ✅ | ✅ | — | — |
| `transactions:read` | View transactions in scope | ✅ | ✅ | ✅ | — |
| `transactions:deposit` | Post cash deposits | ✅ | ✅ | ✅ | — |
| `transactions:withdraw` | Process cash withdrawals | ✅ | ✅ | ✅ | — |
| `transactions:transfer` | Initiate transfers on behalf of customers | ✅ | ✅ | ✅ | — |
| `transactions:approve` | Approve or reject pending transactions | ✅ | ✅ | — | — |
| `transactions:reverse` | Reverse completed transactions | ✅ | ✅ | — | — |
| `approvals:read` | View the approval queue | ✅ | ✅ | — | — |
| `disputes:read` | View transaction disputes in scope | ✅ | ✅ | ✅ | — |
| `disputes:manage` | Investigate and resolve disputes | ✅ | ✅ | — | — |
| `service_requests:read` | View service requests in scope | ✅ | ✅ | ✅ | — |
| `service_requests:manage` | Assign and update service requests | ✅ | ✅ | ✅ | — |
| `reports:branch` | Branch-level reports and analytics | ✅ | ✅ | — | — |
| `reports:system` | System-wide reports and analytics | ✅ | — | — | — |
| `audit:read` | View and export audit logs | ✅ | — | — | — |
| `settings:read` | View banking policy settings | ✅ | ✅ | ✅ | — |
| `settings:manage` | Change global banking policy settings | ✅ | — | — | — |
| `roles:manage` | Edit role permissions | ✅ | — | — | — |
| `notifications:broadcast` | Send notifications to user groups | ✅ | — | — | — |
| `system:network` | Manage network configuration and admin IP allowlist | ✅ | — | — | — |
| `system:api_keys` | Issue and revoke API keys | ✅ | — | — | — |
| `system:reset` | Reset the simulated dataset | ✅ | — | — | — |
| `system:outbox` | View the simulated email outbox | ✅ | — | — | — |
| `portal:accounts` | View own accounts, transactions and statements | ✅ | — | — | ✅ |
| `portal:transfer` | Transfer funds from own accounts | ✅ | — | — | ✅ |
| `portal:beneficiaries` | Manage own beneficiaries | ✅ | — | — | ✅ |
| `portal:service_requests` | Create and track own service requests | ✅ | — | — | ✅ |
| `portal:disputes` | Raise and track disputes on own transactions | ✅ | — | — | ✅ |
| `portal:profile` | Update own contact details | ✅ | — | — | ✅ |

