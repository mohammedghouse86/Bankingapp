import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeftRight, Banknote, CheckSquare, Clock, FileWarning, LifeBuoy, PiggyBank, ShieldAlert, Snowflake, Users, Wallet } from 'lucide-react';
import { useAuth } from '../auth';
import { Async, Button, Card, PageHeader, Stat, StatusBadge, money, useApi, label, Alert } from '../ui';
import { AreaChart, BarList } from '../charts';
import { MiniTxnList, acctName } from './common';

const dayLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function CustomerDashboard() {
  const { user, customer } = useAuth();
  const navigate = useNavigate();
  const q = useApi('/reports/dashboard');
  const accounts = useApi('/accounts', { pageSize: 50, sort: 'openedAt', order: 'asc' });
  return (
    <>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${user.firstName}`} subtitle="Here is an overview of your finances."
        actions={<><Button variant="secondary" onClick={() => navigate('/beneficiaries')}>Manage payees</Button><Button onClick={() => navigate('/transfer')}><ArrowLeftRight size={16} />Transfer money</Button></>} />
      {customer && customer.status === 'pending_verification' && (
        <div style={{ marginBottom: 16 }}><Alert type="warning">Your profile is awaiting identity verification. Visit {customer.branchName} with a photo ID to verify your identity and open your first account.</Alert></div>
      )}
      <Async q={q}>{(d) => (
        <div className="stack">
          <div className="hero-card">
            <div className="label">Total balance across all accounts</div>
            <div className="amount">{money(d.totalBalance)}</div>
            <div className="meta">
              <div><span>Available to spend</span><b>{money(d.availableBalance)}</b></div>
              <div><span>Money in (30 days)</span><b>{money(d.inflow30d)}</b></div>
              <div><span>Money out (30 days)</span><b>{money(d.outflow30d)}</b></div>
              <div><span>Pending</span><b>{d.pendingTransactions}</b></div>
            </div>
          </div>
          <div className="grid grid-main">
            <Card title="Your accounts" actions={<Link to="/accounts">View all</Link>}>
              <Async q={accounts}>{(list) => (list.length ? (
                <div className="grid grid-2">
                  {list.filter((a) => a.status !== 'closed').map((a) => (
                    <Link key={a.id} to={`/accounts/${a.id}`} className="acct-card">
                      <div className="row between"><span className="type">{label(a.type)}</span><StatusBadge status={a.status} /></div>
                      <div className="bal">{money(a.ledgerBalance)}</div>
                      <div className="subtle">{acctName(a)} · Available {money(a.availableBalance)}</div>
                    </Link>
                  ))}
                </div>
              ) : <p className="muted">You do not have any accounts yet.</p>)}</Async>
            </Card>
            <Card title="Recent activity" actions={<Link to="/transactions">See all</Link>}>
              <MiniTxnList items={d.recentTransactions} />
            </Card>
          </div>
        </div>
      )}</Async>
    </>
  );
}

function StaffDashboard() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const q = useApi('/reports/dashboard');
  const perf = useApi(can('reports:system') ? '/reports/branch-performance' : null);
  const isTeller = user.role === 'teller';
  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.firstName}`}
        subtitle={user.role === 'super_admin' ? 'System-wide overview of all branches.' : `${user.branchName} branch overview.`}
        actions={(
          <>
            {can('transactions:deposit') && <Button variant="secondary" onClick={() => navigate('/teller')}><Banknote size={16} />Teller operations</Button>}
            {can('approvals:read') && <Button onClick={() => navigate('/approvals')}><CheckSquare size={16} />Approval queue</Button>}
          </>
        )}
      />
      <Async q={q}>{(d) => (
        <div className="stack">
          <div className="grid grid-4">
            <Stat icon={Users} label="Customers" value={d.customers.toLocaleString()} sub={`${d.accounts} accounts`} />
            <Stat icon={PiggyBank} label="Total deposits" value={money(d.totalDeposits)} tone="green" />
            <Stat icon={Wallet} label="Transactions today" value={d.transactionsToday} sub={`${money(d.volumeToday)} volume`} />
            {isTeller
              ? <Stat icon={Clock} label="My transactions today" value={d.myTransactionsToday} sub={`${d.myPending} awaiting approval`} tone="amber" />
              : <Stat icon={CheckSquare} label="Pending approvals" value={d.pendingApprovals} tone="amber" sub="Awaiting a decision" />}
          </div>
          <div className="grid grid-main">
            <Card title="Transaction volume" subtitle="Last 14 days">
              <AreaChart data={d.volumeSeries} xKey="date" xFormat={dayLabel} valueFormat={money} series={[{ key: 'total', label: 'Total volume' }, { key: 'deposits', label: 'Deposits' }]} />
            </Card>
            <Card title="Needs attention">
              <ul className="timeline">
                <li><Snowflake size={18} color="var(--info)" /><div style={{ flex: 1 }}>Frozen accounts</div><Link to="/accounts?status=frozen"><b>{d.frozenAccounts}</b></Link></li>
                <li><Clock size={18} color="var(--warning)" /><div style={{ flex: 1 }}>Dormant accounts</div><Link to="/accounts?status=dormant"><b>{d.dormantAccounts}</b></Link></li>
                <li><LifeBuoy size={18} color="var(--primary)" /><div style={{ flex: 1 }}>Open service requests</div><Link to="/service-requests?status=open"><b>{d.openServiceRequests}</b></Link></li>
                <li><FileWarning size={18} color="var(--danger)" /><div style={{ flex: 1 }}>Open disputes</div><Link to="/disputes"><b>{d.openDisputes}</b></Link></li>
                {user.role === 'super_admin' && <li><ShieldAlert size={18} color="var(--danger)" /><div style={{ flex: 1 }}>Critical API calls (24h)</div><Link to="/security?tab=guardrails"><b>{d.criticalEvents24h}</b></Link></li>}
                {user.role === 'super_admin' && <li><AlertTriangle size={18} color="var(--warning)" /><div style={{ flex: 1 }}>Failed logins (24h)</div><Link to="/audit-logs?action=auth.login_failed"><b>{d.failedLogins24h}</b></Link></li>}
              </ul>
            </Card>
          </div>
          {isTeller && <Card title="My recent transactions" actions={<Link to="/transactions?mine=1">View all</Link>}><MiniTxnList items={d.myRecent} empty="You have not processed any transactions yet." /></Card>}
          {perf.data && (
            <Card title="Deposits by branch" actions={<Link to="/reports">Open reports</Link>}>
              <BarList items={perf.data.map((b) => ({ label: b.name, value: b.totalDeposits }))} />
            </Card>
          )}
        </div>
      )}</Async>
    </>
  );
}

export default function Dashboard() {
  const { isCustomer } = useAuth();
  return isCustomer ? <CustomerDashboard /> : <StaffDashboard />;
}
