/*
 * Object-level and branch-level authorization helpers. Every handler that
 * loads a resource by ID goes through one of these loaders, which return 404
 * for anything outside the caller's scope.
 */
const { db, findById } = require('../store');
const { notFound } = require('./errors');

const isCustomer = (u) => u.role === 'customer';
const isStaff = (u) => ['super_admin', 'manager', 'teller', 'api_client'].includes(u.role);
const isGlobal = (u) => u.role === 'super_admin' || u.role === 'api_client';

/** Branch the caller is restricted to, or null for global roles. */
const branchScope = (u) => (isGlobal(u) ? null : u.branchId);
const inBranchScope = (u, branchId) => isGlobal(u) || (u.role !== 'customer' && u.branchId === branchId);

function holderCustomerIds(accountId) {
  return db.accountHolders.filter((h) => h.accountId === accountId).map((h) => h.customerId);
}

function accountIdsForCustomer(customerId) {
  return db.accountHolders.filter((h) => h.customerId === customerId).map((h) => h.accountId);
}

function canAccessCustomer(u, customer) {
  if (!customer) return false;
  if (isCustomer(u)) return u.customerId === customer.id;
  return inBranchScope(u, customer.branchId);
}

function canAccessAccount(u, account) {
  if (!account) return false;
  if (isCustomer(u)) return holderCustomerIds(account.id).includes(u.customerId);
  return inBranchScope(u, account.branchId);
}

function canAccessTransaction(u, t) {
  if (!t) return false;
  const accIds = [t.sourceAccountId, t.destinationAccountId].filter(Boolean);
  if (isCustomer(u)) {
    // Customers see a transaction only through an account they hold. A
    // transfer *into* a customer's account is visible to them, but the
    // sender's account details are stripped by the serializer.
    const own = accountIdsForCustomer(u.customerId);
    return accIds.some((a) => own.includes(a));
  }
  if (isGlobal(u)) return true;
  if (t.branchId === u.branchId) return true;
  return accIds.some((a) => { const acc = findById('accounts', a); return acc && acc.branchId === u.branchId; });
}

function loadCustomer(u, id) {
  const c = findById('customers', id);
  if (!canAccessCustomer(u, c)) throw notFound('Customer');
  return c;
}

function loadAccount(u, id) {
  const a = findById('accounts', id);
  if (!canAccessAccount(u, a)) throw notFound('Account');
  return a;
}

function loadTransaction(u, id) {
  const t = findById('transactions', id);
  if (!canAccessTransaction(u, t)) throw notFound('Transaction');
  return t;
}

/** Customer the caller acts for: own profile for customers, explicit for staff. */
function customerIdFor(u, requestedCustomerId) {
  if (isCustomer(u)) return u.customerId;
  return requestedCustomerId;
}

module.exports = {
  isCustomer, isStaff, isGlobal, branchScope, inBranchScope, holderCustomerIds, accountIdsForCustomer,
  canAccessCustomer, canAccessAccount, canAccessTransaction, loadCustomer, loadAccount, loadTransaction, customerIdFor,
};
