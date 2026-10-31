import { Component } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Compass, Lock } from 'lucide-react';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './layout';
import { EmptyState, ErrorState, Loading, StepUpProvider, ToastProvider, useApi, Button } from './ui';
import { Login, Register, ForgotPassword, ResetPassword } from './pages/auth';
import Dashboard from './pages/dashboard';
import { CustomersList, CustomerDetail } from './pages/customers';
import { AccountsList, AccountDetail } from './pages/accounts';
import { TransactionsList, TransactionDetail, ApprovalsList } from './pages/transactions';
import TellerOps from './pages/teller';
import { Transfer, Beneficiaries } from './pages/portal';
import { ServiceRequests, ServiceRequestDetail, Disputes, DisputeDetail } from './pages/service';
import { Employees, EmployeeDetail, Branches, BranchDetail } from './pages/org';
import { Reports, AuditLogs, SettingsPage, SecurityPage } from './pages/admin';
import { Profile, Notifications } from './pages/me';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40 }}>
          <ErrorState error={{ message: 'The page crashed unexpectedly. Reload to continue.' }} />
          <div className="row" style={{ justifyContent: 'center' }}><Button onClick={() => window.location.reload()}>Reload</Button></div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

function PublicOnly({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  return user ? <Navigate to="/" replace /> : children;
}

/** Permission guard for pages; the API enforces the same rules server-side. */
export function Guard({ perms, roles, children }) {
  const { can, role } = useAuth();
  const allowed = (!perms || can(...perms)) && (!roles || roles.includes(role));
  if (!allowed) return <EmptyState icon={Lock} title="Access denied" message="Your role does not have access to this page." />;
  return children;
}

function ApprovalRedirect() {
  const { id } = useParams();
  const q = useApi(`/approvals/${id}`);
  if (q.loading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  return <Navigate to={`/transactions/${q.data.transaction.id}`} replace />;
}

function NotFound() {
  return <EmptyState icon={Compass} title="Page not found" message="The page you are looking for does not exist." action={<Button onClick={() => { window.location.hash = '#/'; }}>Go to dashboard</Button>} />;
}

const STAFF = ['super_admin', 'manager', 'teller'];

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <StepUpProvider>
            <HashRouter>
              <Routes>
                <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
                <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
                <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route element={<RequireAuth><Layout /></RequireAuth>}>
                  <Route index element={<Dashboard />} />
                  <Route path="customers" element={<Guard perms={['customers:read']}><CustomersList /></Guard>} />
                  <Route path="customers/:id" element={<Guard perms={['customers:read']}><CustomerDetail /></Guard>} />
                  <Route path="accounts" element={<Guard perms={['accounts:read', 'portal:accounts']}><AccountsList /></Guard>} />
                  <Route path="accounts/:id" element={<Guard perms={['accounts:read', 'portal:accounts']}><AccountDetail /></Guard>} />
                  <Route path="transactions" element={<Guard perms={['transactions:read', 'portal:accounts']}><TransactionsList /></Guard>} />
                  <Route path="transactions/:id" element={<Guard perms={['transactions:read', 'portal:accounts']}><TransactionDetail /></Guard>} />
                  <Route path="approvals" element={<Guard perms={['approvals:read']}><ApprovalsList /></Guard>} />
                  <Route path="approvals/:id" element={<Guard perms={['approvals:read']}><ApprovalRedirect /></Guard>} />
                  <Route path="teller" element={<Guard perms={['transactions:deposit', 'transactions:withdraw', 'transactions:transfer']} roles={STAFF}><TellerOps /></Guard>} />
                  <Route path="transfer" element={<Guard perms={['portal:transfer']} roles={['customer']}><Transfer /></Guard>} />
                  <Route path="beneficiaries" element={<Guard perms={['portal:beneficiaries']} roles={['customer']}><Beneficiaries /></Guard>} />
                  <Route path="beneficiaries/:id" element={<Guard perms={['portal:beneficiaries']} roles={['customer']}><Beneficiaries /></Guard>} />
                  <Route path="service-requests" element={<Guard perms={['service_requests:read', 'portal:service_requests']}><ServiceRequests /></Guard>} />
                  <Route path="service-requests/:id" element={<Guard perms={['service_requests:read', 'portal:service_requests']}><ServiceRequestDetail /></Guard>} />
                  <Route path="disputes" element={<Guard perms={['disputes:read', 'portal:disputes']}><Disputes /></Guard>} />
                  <Route path="disputes/:id" element={<Guard perms={['disputes:read', 'portal:disputes']}><DisputeDetail /></Guard>} />
                  <Route path="employees" element={<Guard perms={['users:read']}><Employees /></Guard>} />
                  <Route path="employees/:id" element={<Guard perms={['users:read']}><EmployeeDetail /></Guard>} />
                  <Route path="branches" element={<Guard perms={['branches:manage']}><Branches /></Guard>} />
                  <Route path="branches/:id" element={<Guard perms={['branches:read']} roles={STAFF}><BranchDetail /></Guard>} />
                  <Route path="reports" element={<Guard perms={['reports:branch', 'reports:system']}><Reports /></Guard>} />
                  <Route path="audit-logs" element={<Guard perms={['audit:read']}><AuditLogs /></Guard>} />
                  <Route path="settings" element={<Guard perms={['settings:manage', 'roles:manage']}><SettingsPage /></Guard>} />
                  <Route path="security" element={<Guard perms={['system:network', 'system:api_keys', 'audit:read']}><SecurityPage /></Guard>} />
                  <Route path="notifications" element={<Notifications />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </HashRouter>
          </StepUpProvider>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
