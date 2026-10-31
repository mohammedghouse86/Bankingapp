import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Repeat } from 'lucide-react';
import { Amount, StatusBadge, fmtDateTime, label, money } from '../ui';

export function acctName(a) {
  if (!a) return '—';
  if (a.accountNumberMasked) return `${a.holderName || 'Account'} ${a.accountNumberMasked}`;
  const name = a.nickname || label(a.type).replace(/^./, (c) => c.toUpperCase());
  return `${name} ••${String(a.accountNumber).slice(-4)}`;
}

export function counterpartyText(t) {
  if (t.beneficiary) return t.beneficiary.nickname || t.beneficiary.name;
  if (t.counterparty) return t.counterparty.name;
  if (t.type === 'deposit') return 'Cash / ACH deposit';
  if (t.type === 'withdrawal') return 'Cash withdrawal';
  if (t.type === 'interest') return 'Interest';
  if (t.type === 'fee') return 'Bank fee';
  return t.destinationAccount ? acctName(t.destinationAccount) : '—';
}

export function TxnIcon({ t, direction }) {
  const dir = direction || (t.type === 'deposit' || t.type === 'interest' ? 'credit' : t.type === 'transfer' ? 'transfer' : 'debit');
  const Icon = dir === 'credit' ? ArrowDownLeft : dir === 'transfer' ? Repeat : ArrowUpRight;
  return <span className={`stat-icon ${dir === 'credit' ? 'green' : dir === 'debit' ? 'red' : ''}`} style={{ width: 30, height: 30, borderRadius: 8 }}><Icon size={15} /></span>;
}

/** Column set for transaction tables; `accountId` switches to signed per-account view. */
export function txnColumns({ accountId, staff } = {}) {
  return [
    { key: 'date', label: 'Date', sort: 'createdAt', render: (t) => <span className="nowrap">{fmtDateTime(t.createdAt)}</span> },
    { key: 'desc', label: 'Description', render: (t) => (
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <TxnIcon t={t} direction={t.direction} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{t.description || label(t.type)}</div>
          <div className="subtle mono">{t.reference}</div>
        </div>
      </div>
    ) },
    { key: 'type', label: 'Type', render: (t) => <span className="muted" style={{ textTransform: 'capitalize' }}>{label(t.type)}</span> },
    ...(staff ? [{ key: 'branch', label: 'Branch', render: (t) => t.branchName || '—' }] : []),
    { key: 'status', label: 'Status', sort: 'status', render: (t) => <StatusBadge status={t.status} /> },
    { key: 'amount', label: 'Amount', num: true, sort: 'amount', render: (t) => (accountId ? <Amount value={t.amount} direction={t.direction} /> : money(t.amount)) },
    ...(accountId ? [{ key: 'bal', label: 'Balance', num: true, render: (t) => (t.balanceAfter == null ? '—' : money(t.balanceAfter)) }] : []),
  ];
}

export function MiniTxnList({ items, empty = 'No transactions yet' }) {
  if (!items || !items.length) return <p className="muted" style={{ margin: 0 }}>{empty}</p>;
  return (
    <ul className="timeline">
      {items.map((t) => (
        <li key={t.id}>
          <TxnIcon t={t} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link to={`/transactions/${t.id}`} style={{ fontWeight: 500, color: 'var(--text)' }}>{t.description || label(t.type)}</Link>
            <div className="subtle">{fmtDateTime(t.createdAt)} · {counterpartyText(t)}</div>
          </div>
          <div className="right">
            <div style={{ fontWeight: 600 }}>{money(t.amount)}</div>
            <StatusBadge status={t.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}
