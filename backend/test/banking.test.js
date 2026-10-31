// Money movement, approvals, separation of duties, limits, concurrency and integrity.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, as, asCustomer, accountsOf, richCustomer, checkingOf, otherActiveAccount, client, login, holders } = require('./helpers');

const acct = (id) => db.accounts.find((a) => a.id === id);
const available = (a) => a.balanceCents + a.overdraftLimitCents - a.holdCents;
const idCheck = (c) => ({ documentType: c.kyc.documentType, documentNumberLast4: c.kyc.documentNumber.slice(-4) });

const cust = richCustomer(1, 2000000);
const chk = checkingOf(cust);

test('teller deposit posts immediately and writes balanced ledger entries', async () => {
  const t = await as('tellerDowntown');
  const before = acct(chk.id).balanceCents;
  const res = await t.post('/transactions/deposits', { accountId: chk.id, amount: 250.75, depositorName: 'Walk In' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.status, 'completed');
  assert.equal(acct(chk.id).balanceCents, before + 25075);
  const entries = await t.get(`/transactions/${res.body.data.id}/ledger-entries`);
  assert.equal(entries.body.data.length, 1);
  assert.equal(entries.body.data[0].direction, 'credit');
});

test('amount validation rejects negative, zero, NaN and sub-cent values', async () => {
  const t = await as('tellerDowntown');
  for (const amount of [-100, 0, 0.001, '100', 1e9, null]) {
    const res = await t.post('/transactions/deposits', { accountId: chk.id, amount, depositorName: 'Bad Amount' });
    assert.equal(res.status, 400, `amount ${amount}`);
  }
});

test('withdrawal requires the account holder\'s identity to match the document on file', async () => {
  const t = await as('tellerDowntown');
  const base = { accountId: chk.id, customerId: cust.id, amount: 100 };
  const bad = await t.post('/transactions/withdrawals', { ...base, idVerification: { documentType: cust.kyc.documentType, documentNumberLast4: '0000' } });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'IDENTITY_VERIFICATION_FAILED');
  const other = richCustomer(1, 100000, [cust.id]);
  const notHolder = await t.post('/transactions/withdrawals', { ...base, customerId: other.id, idVerification: idCheck(other) });
  assert.equal(notHolder.status, 422);
  assert.equal(notHolder.body.error.code, 'NOT_ACCOUNT_HOLDER');
  const ok = await t.post('/transactions/withdrawals', { ...base, idVerification: idCheck(cust) });
  assert.equal(ok.status, 201);
});

test('large teller withdrawal is held for approval; teller cannot approve; manager approves and funds move', async () => {
  const t = await as('tellerDowntown');
  const a = acct(chk.id);
  const before = { bal: a.balanceCents, hold: a.holdCents };
  const res = await t.post('/transactions/withdrawals', { accountId: chk.id, customerId: cust.id, amount: 6000, idVerification: idCheck(cust) });
  assert.equal(res.status, 202);
  assert.equal(res.body.data.status, 'pending_approval');
  assert.equal(a.holdCents, before.hold + 600000, 'funds placed on hold');
  assert.equal(a.balanceCents, before.bal, 'ledger balance unchanged while pending');
  assert.equal((await t.post(`/transactions/${res.body.data.id}/approve`, {})).status, 403);
  const m = await as('managerDowntown');
  const approved = await m.post(`/transactions/${res.body.data.id}/approve`, { note: 'Customer verified by phone' });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.status, 'completed');
  assert.equal(a.holdCents, before.hold);
  assert.equal(a.balanceCents, before.bal - 600000);
  assert.equal((await m.post(`/transactions/${res.body.data.id}/approve`, {})).status, 409, 'cannot approve twice');
});

test('separation of duties: an initiator can never approve or reverse their own transaction', async () => {
  const m = await as('managerDowntown');
  const res = await m.post('/transactions/withdrawals', { accountId: chk.id, customerId: cust.id, amount: 12000, idVerification: idCheck(cust) });
  assert.equal(res.status, 202);
  const self = await m.post(`/transactions/${res.body.data.id}/approve`, {});
  assert.equal(self.status, 403);
  assert.equal(self.body.error.code, 'SEPARATION_OF_DUTIES');
  const peer = await as('asstManagerDowntown');
  assert.equal((await peer.post(`/transactions/${res.body.data.id}/reject`, { reason: 'Not needed' })).status, 200);
  const dep = await m.post('/transactions/deposits', { accountId: chk.id, amount: 50, depositorName: 'Self Test' });
  const rev = await m.post(`/transactions/${dep.body.data.id}/reverse`, { reason: 'mistake' });
  assert.equal(rev.status, 403);
  assert.equal(rev.body.error.code, 'SEPARATION_OF_DUTIES');
});

test('rejecting a pending transaction releases the hold', async () => {
  const t = await as('tellerDowntown');
  const a = acct(chk.id);
  const hold = a.holdCents;
  const res = await t.post('/transactions/withdrawals', { accountId: chk.id, customerId: cust.id, amount: 5500, idVerification: idCheck(cust) });
  assert.equal(a.holdCents, hold + 550000);
  const m = await as('managerDowntown');
  assert.equal((await m.post(`/transactions/${res.body.data.id}/reject`, { reason: 'Customer left the branch' })).status, 200);
  assert.equal(a.holdCents, hold);
});

test('managers cannot approve above their authority; super admin can', async () => {
  const pending = db.approvals.find((x) => x.status === 'pending' && x.requiredRole === 'super_admin' && x.branchId === 1);
  const m = await as('managerDowntown');
  const res = await m.post(`/transactions/${pending.transactionId}/approve`, {});
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'APPROVAL_AUTHORITY_EXCEEDED');
  const admin = await as('admin');
  assert.equal((await admin.post(`/transactions/${pending.transactionId}/approve`, {})).status, 200);
});

test('frozen, dormant, closed and fixed-deposit accounts enforce their restrictions', async () => {
  const t = await as('admin');
  const frozen = db.accounts.find((a) => a.status === 'frozen');
  const closed = db.accounts.find((a) => a.status === 'closed');
  const fd = db.accounts.find((a) => a.type === 'fixed_deposit' && a.status === 'active');
  assert.equal((await t.post('/transactions/deposits', { accountId: frozen.id, amount: 10, depositorName: 'X Y' })).body.error.code, 'ACCOUNT_NOT_ACTIVE');
  assert.equal((await t.post('/transactions/deposits', { accountId: closed.id, amount: 10, depositorName: 'X Y' })).body.error.code, 'ACCOUNT_NOT_ACTIVE');
  assert.equal((await t.post('/transactions/deposits', { accountId: fd.id, amount: 10, depositorName: 'X Y' })).body.error.code, 'ACCOUNT_RESTRICTED');
  const fc = db.customers.find((c) => c.id === holders(frozen.id)[0]);
  if (fc.kyc) {
    const w = await t.post('/transactions/withdrawals', { accountId: frozen.id, customerId: fc.id, amount: 1, idVerification: idCheck(fc) });
    assert.equal(w.status, 422);
  }
  const dormant = db.accounts.find((a) => a.status === 'dormant');
  const dc = db.customers.find((c) => c.id === holders(dormant.id)[0]);
  const dw = await t.post('/transactions/withdrawals', { accountId: dormant.id, customerId: dc.id, amount: 1, idVerification: idCheck(dc) });
  assert.equal(dw.status, 422);
  assert.equal((await t.post(`/accounts/${closed.id}/freeze`, { reason: 'x' })).status, 409);
});

test('freeze blocks customer debits; unfreeze restores them', async () => {
  const c2 = richCustomer(1, 200000, [cust.id]);
  const a = checkingOf(c2);
  const target = otherActiveAccount(c2, a.id);
  const m = await as('managerDowntown');
  assert.equal((await m.post(`/accounts/${a.id}/freeze`, { reason: 'Fraud review' })).status, 200);
  const cc = await asCustomer(c2);
  const blocked = await cc.post('/transfers/own', { sourceAccountId: a.id, destinationAccountId: target.id, amount: 10 });
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.error.code, 'ACCOUNT_NOT_ACTIVE');
  assert.equal((await m.post(`/accounts/${a.id}/unfreeze`, { reason: 'Cleared' })).status, 200);
  assert.equal((await cc.post('/transfers/own', { sourceAccountId: a.id, destinationAccountId: target.id, amount: 10 })).status, 201);
});

test('insufficient funds and overdraft boundaries are enforced', async () => {
  const c3 = richCustomer(2, 10000);
  const a = checkingOf(c3);
  const target = otherActiveAccount(c3, a.id);
  const cc = await asCustomer(c3);
  const tooMuch = (available(a) + 1) / 100;
  const res = await cc.post('/transfers/own', { sourceAccountId: a.id, destinationAccountId: target.id, amount: Math.min(tooMuch, 20000) });
  if (tooMuch <= 20000) {
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INSUFFICIENT_FUNDS');
  }
  assert.ok(available(a) >= 0);
});

test('customers can only pay their own accounts or registered beneficiaries', async () => {
  const c2 = richCustomer(2, 100000);
  const stranger = db.accounts.find((a) => a.type === 'checking' && a.status === 'active' && !accountsOf(c2.id).includes(a));
  const cc = await asCustomer(c2);
  const src = checkingOf(c2);
  const res = await cc.post('/transfers/own', { sourceAccountId: src.id, destinationAccountId: stranger.id, amount: 5 });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'UNAUTHORIZED_DESTINATION');
  const foreignBen = db.beneficiaries.find((b) => b.customerId !== c2.id && b.status === 'active');
  assert.equal((await cc.post('/transfers/beneficiary', { sourceAccountId: src.id, beneficiaryId: foreignBen.id, amount: 5 })).status, 404);
  const otherCustAcct = db.accounts.find((a) => a.status === 'active' && a.type === 'checking' && a.balanceCents > 10000 && !accountsOf(c2.id).includes(a));
  assert.equal((await cc.post('/transfers/own', { sourceAccountId: otherCustAcct.id, destinationAccountId: src.id, amount: 5 })).status, 404, 'cannot debit someone else\'s account');
});

test('teller transfers on behalf of a customer cannot target unregistered third parties', async () => {
  const t = await as('tellerDowntown');
  const stranger = db.accounts.find((a) => a.type === 'checking' && a.status === 'active' && !accountsOf(cust.id).includes(a));
  const res = await t.post('/transactions/transfers', { customerId: cust.id, sourceAccountId: chk.id, destinationAccountId: stranger.id, amount: 10 });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'UNAUTHORIZED_DESTINATION');
  const ben = db.beneficiaries.find((b) => b.customerId === cust.id && b.status === 'active');
  if (ben) {
    const ok = await t.post('/transactions/transfers', { customerId: cust.id, sourceAccountId: chk.id, beneficiaryId: ben.id, amount: 10 });
    assert.equal(ok.status, 201);
  }
});

test('beneficiary OTP activation, new-beneficiary limit and daily limits', async () => {
  const c4 = richCustomer(3, 800000);
  const cc = await asCustomer(c4);
  const src = checkingOf(c4);
  const created = await cc.post('/beneficiaries', { name: 'Remote Payee', accountNumber: '12345678901', routingNumber: '999200111', bankName: 'Bluefin Savings Bank (Simulated)', dailyLimit: 5000 });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.status, 'pending_activation');
  const id = created.body.data.id;
  assert.equal((await cc.post('/transfers/beneficiary', { sourceAccountId: src.id, beneficiaryId: id, amount: 10 })).body.error.code, 'BENEFICIARY_NOT_ACTIVE');
  assert.equal((await cc.post(`/beneficiaries/${id}/activate`, { code: '000000' })).status, 422);
  const note = db.notifications.filter((n) => n.userId === c4.userId && n.title === 'Beneficiary activation code').pop();
  const code = note.message.match(/is (\d{6})/)[1];
  assert.equal((await cc.post(`/beneficiaries/${id}/activate`, { code })).status, 200);
  const big = await cc.post('/transfers/beneficiary', { sourceAccountId: src.id, beneficiaryId: id, amount: 2500 });
  assert.equal(big.body.error.code, 'NEW_BENEFICIARY_LIMIT');
  assert.equal((await cc.post('/transfers/beneficiary', { sourceAccountId: src.id, beneficiaryId: id, amount: 1500 })).status, 201);
  const dup = await cc.post('/beneficiaries', { name: 'Remote Payee', accountNumber: '12345678901', routingNumber: '999200111', bankName: 'Bluefin' });
  assert.equal(dup.status, 409);
});

test('online per-transaction limit and approval threshold', async () => {
  const c5 = richCustomer(4, 10000);
  const cc = await asCustomer(c5);
  const src = checkingOf(c5);
  acct(src.id).balanceCents += 3000000; // fixture: ensure funds exceed the amounts under test
  const dst = otherActiveAccount(c5, src.id);
  assert.equal((await cc.post('/transfers/own', { sourceAccountId: src.id, destinationAccountId: dst.id, amount: 25000.01 })).body.error.code, 'LIMIT_EXCEEDED');
  const v = await cc.post('/transfers/validate', { sourceAccountId: src.id, destinationAccountId: dst.id, amount: 15000 });
  assert.equal(v.status, 200);
  assert.equal(v.body.data.requiresApproval, true);
  const res = await cc.post('/transfers/own', { sourceAccountId: src.id, destinationAccountId: dst.id, amount: 15000 });
  assert.equal(res.status, 202);
  const cancel = await cc.post(`/transactions/${res.body.data.id}/cancel`);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.data.status, 'cancelled');
});

test('concurrent transfers never overdraw or double-debit (race condition)', async () => {
  const c6 = richCustomer(2, 200000);
  const src = checkingOf(c6);
  const dst = otherActiveAccount(c6, src.id);
  const a = acct(src.id);
  a.overdraftLimitCents = 0;
  // Leave exactly $1,000 available.
  a.balanceCents = 100000 + a.holdCents;
  const startTotal = a.balanceCents + acct(dst.id).balanceCents;
  const cc = await asCustomer(c6);
  const results = await Promise.all(Array.from({ length: 25 }, () => cc.post('/transfers/own', { sourceAccountId: src.id, destinationAccountId: dst.id, amount: 300 })));
  const ok = results.filter((r) => r.status === 201).length;
  assert.equal(ok, 3, 'only three $300 transfers fit into $1,000');
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 422));
  assert.equal(a.balanceCents - a.holdCents, 10000);
  assert.equal(a.balanceCents + acct(dst.id).balanceCents, startTotal, 'money is conserved');
});

test('idempotency key replays the original transaction and rejects key reuse', async () => {
  const c7 = richCustomer(3, 100000);
  const src = checkingOf(c7);
  const dst = otherActiveAccount(c7, src.id);
  const cc = client(await login(db.users.find((u) => u.id === c7.userId).email, 'Customer@Kestrel1!'), { 'Idempotency-Key': 'retry-key-0001' });
  const before = acct(src.id).balanceCents;
  const r1 = await cc.post('/transfers/own', { sourceAccountId: src.id, destinationAccountId: dst.id, amount: 42 });
  const r2 = await cc.post('/transfers/own', { sourceAccountId: src.id, destinationAccountId: dst.id, amount: 42 });
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 200);
  assert.equal(r2.headers['idempotent-replay'], 'true');
  assert.equal(r1.body.data.id, r2.body.data.id);
  assert.equal(acct(src.id).balanceCents, before - 4200, 'debited once');
  assert.equal((await cc.post('/transfers/own', { sourceAccountId: src.id, destinationAccountId: dst.id, amount: 43 })).status, 409);
});

test('completed transactions are immutable: only a compensating reversal is possible', async () => {
  const t = await as('tellerDowntown');
  const dep = await t.post('/transactions/deposits', { accountId: chk.id, amount: 77, depositorName: 'Reverse Me' });
  const id = dep.body.data.id;
  const admin = await as('admin');
  assert.equal((await admin.patch(`/transactions/${id}`, { amount: 1 })).status, 404);
  assert.equal((await admin.delete(`/transactions/${id}`)).status, 404);
  assert.equal((await admin.put(`/transactions/${id}`, { status: 'completed' })).status, 404);
  const before = acct(chk.id).balanceCents;
  const m = await as('managerDowntown');
  const rev = await m.post(`/transactions/${id}/reverse`, { reason: 'Counterfeit note' });
  assert.equal(rev.status, 200);
  assert.equal(rev.body.data.type, 'reversal');
  assert.equal(acct(chk.id).balanceCents, before - 7700);
  assert.equal((await m.post(`/transactions/${id}/reverse`, { reason: 'again' })).status, 409);
  assert.equal((await m.post(`/transactions/${rev.body.data.id}/reverse`, { reason: 'reverse the reversal' })).status, 422);
});

test('disputes: customer raises, manager refunds via reversal', async () => {
  const c8 = richCustomer(1, 100000, [cust.id]);
  const src = checkingOf(c8);
  const dst = otherActiveAccount(c8, src.id);
  const cc = await asCustomer(c8);
  const tr = await cc.post('/transfers/own', { sourceAccountId: src.id, destinationAccountId: dst.id, amount: 20 });
  const d = await cc.post('/disputes', { transactionId: tr.body.data.id, reason: 'duplicate', description: 'Charged twice' });
  assert.equal(d.status, 201);
  assert.equal((await cc.post('/disputes', { transactionId: tr.body.data.id, reason: 'duplicate', description: 'again' })).status, 409);
  const m = await as('managerDowntown');
  const r = await m.post(`/disputes/${d.body.data.id}/resolve`, { outcome: 'refund', resolution: 'Refunded' });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, 'resolved_refunded');
  assert.ok(r.body.data.refundTransactionId);
});

test('account opening requires verified customers and funds fixed deposits from own accounts', async () => {
  const m = await as('managerDowntown');
  const pending = db.customers.find((c) => c.branchId === 1 && c.status === 'pending_verification');
  if (pending) assert.equal((await m.post('/accounts', { customerId: pending.id, type: 'savings', initialDeposit: 500 })).body.error.code, 'CUSTOMER_NOT_ELIGIBLE');
  const sav = await m.post('/accounts', { customerId: cust.id, type: 'savings', initialDeposit: 500, nickname: 'Goals' });
  assert.equal(sav.status, 201);
  assert.equal(sav.body.data.ledgerBalance, 500);
  const before = acct(chk.id).balanceCents;
  const fd = await m.post('/accounts', { customerId: cust.id, type: 'fixed_deposit', fixedDeposit: { amount: 1000, termMonths: 12, fundingAccountId: chk.id } });
  assert.equal(fd.status, 201);
  assert.equal(acct(chk.id).balanceCents, before - 100000);
  const brk = await m.post(`/accounts/${fd.body.data.id}/break-deposit`, { reason: 'Customer needs funds' });
  assert.equal(brk.status, 200);
  assert.equal(brk.body.data.penalty, 10);
  assert.equal(acct(chk.id).balanceCents, before - 1000);
  const strangerAcct = db.accounts.find((a) => a.status === 'active' && a.type === 'checking' && a.branchId === 1 && !accountsOf(cust.id).includes(a));
  assert.equal((await m.post('/accounts', { customerId: cust.id, type: 'fixed_deposit', fixedDeposit: { amount: 1000, termMonths: 12, fundingAccountId: strangerAcct.id } })).status, 400);
});

test('account closure requires zero balance or a payout to the holder\'s own account', async () => {
  const m = await as('managerDowntown');
  const sav = await m.post('/accounts', { customerId: cust.id, type: 'savings', initialDeposit: 150 });
  const id = sav.body.data.id;
  assert.equal((await m.post(`/accounts/${id}/close`, { reason: 'test' })).body.error.code, 'BALANCE_REMAINING');
  const stranger = db.accounts.find((a) => a.status === 'active' && a.type === 'checking' && a.branchId === 1 && !accountsOf(cust.id).includes(a));
  assert.equal((await m.post(`/accounts/${id}/close`, { reason: 'test', transferToAccountId: stranger.id })).status, 400);
  const closed = await m.post(`/accounts/${id}/close`, { reason: 'test', transferToAccountId: chk.id });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.data.status, 'closed');
  assert.equal(acct(id).balanceCents, 0);
  const t = await as('tellerDowntown');
  assert.equal((await t.post('/transactions/deposits', { accountId: id, amount: 5, depositorName: 'Late Deposit' })).status, 422);
});

test('KYC decision enforces separation of duties', async () => {
  const t = await as('tellerDowntown');
  const created = await t.post('/customers', { firstName: 'Kyc', lastName: 'Subject', email: 'kyc.subject@example.com', phone: '+1-555-0177', dateOfBirth: '1985-06-15', nationalId: '123-45-6789', address: { line1: '5 Harbor Way', city: 'Harbor City', state: 'CA', postalCode: '90001', country: 'US' } });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  const kyc = await t.post(`/customers/${id}/identity-verification`, { documentType: 'passport', documentNumber: 'P1234567', issuingCountry: 'US', expiryDate: '2033-01-01', dateOfBirth: '1985-06-15' });
  assert.equal(kyc.body.data.kycStatus, 'pending_review');
  assert.equal((await t.post(`/customers/${id}/kyc-decision`, { decision: 'approve', note: 'ok' })).status, 403);
  const m = await as('managerDowntown');
  const dec = await m.post(`/customers/${id}/kyc-decision`, { decision: 'approve', note: 'Documents verified' });
  assert.equal(dec.status, 200);
  assert.equal(dec.body.data.status, 'active');
});
