import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alert, Button, Field, useApi, useForm, useToast } from '../ui';

export const DEMO_ACCOUNTS = [
  { label: 'Super admin', email: 'admin@kestrelbank.test', password: 'Admin@Kestrel2026!' },
  { label: 'Manager (Downtown)', email: 'manager.downtown@kestrelbank.test', password: 'Manager@Kestrel1!' },
  { label: 'Teller (Downtown)', email: 'teller1.downtown@kestrelbank.test', password: 'Teller@Kestrel1!' },
  { label: 'Customer', email: 'samir.thompson1@example.com', password: 'Customer@Kestrel1!' },
];

function AuthShell({ children }) {
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="brand" style={{ padding: 0 }}><div className="brand-mark">K</div><div>Kestrel Bank<small>Simulated core banking</small></div></div>
        <div>
          <h2>Banking that keeps up with you.</h2>
          <p>Accounts, transfers, approvals and branch operations in one secure platform. This is a simulated environment built for authorized security testing — every customer and transaction is fictional.</p>
        </div>
        <div className="row" style={{ color: '#c3d3e8', fontSize: 13 }}><ShieldCheck size={16} />Role-based access · Step-up authentication · Full audit trail</div>
      </aside>
      <main className="auth-main"><div className="auth-box">{children}</div></main>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const f = useForm({ email: '', password: '' });
  const onSubmit = f.submit(async (v) => {
    await login(v.email.trim(), v.password);
    navigate((location.state && location.state.from) || '/', { replace: true });
  });
  return (
    <AuthShell>
      <h1>Sign in</h1>
      <p className="muted" style={{ marginTop: 4 }}>Staff and customers use the same sign-in.</p>
      <form className="form" onSubmit={onSubmit} style={{ marginTop: 20 }}>
        <Field label="Email" htmlFor="email" error={f.errors.email}><input id="email" type="email" className="input" autoComplete="username" value={f.values.email} onChange={f.set('email')} required /></Field>
        <Field label="Password" htmlFor="password" error={f.errors.password}><input id="password" type="password" className="input" autoComplete="current-password" value={f.values.password} onChange={f.set('password')} required /></Field>
        <Alert>{f.formError}</Alert>
        <Button type="submit" loading={f.busy} className="btn-block">Sign in</Button>
        <div className="row between" style={{ fontSize: 13 }}>
          <Link to="/forgot-password">Forgot password?</Link>
          <Link to="/register">Open an account online</Link>
        </div>
      </form>
      <div className="demo-accounts">
        <div className="subtle" style={{ marginBottom: 8 }}>Demo accounts (fictional) — click to fill</div>
        <div className="row">
          {DEMO_ACCOUNTS.map((a) => (
            <Button key={a.email} variant="secondary" size="sm" onClick={() => f.setValues({ email: a.email, password: a.password })}>{a.label}</Button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}

export function Register() {
  const navigate = useNavigate();
  const toast = useToast();
  const { login } = useAuth();
  const branches = useApi('/public/branches');
  const f = useForm({ firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '', branchId: '', line1: '', city: '', state: '', postalCode: '', password: '', confirm: '' });
  const v = f.values;
  const onSubmit = f.submit(async (x) => {
    if (x.password !== x.confirm) throw new Error('Passwords do not match');
    await api.post('/auth/register', {
      firstName: x.firstName, lastName: x.lastName, email: x.email, phone: x.phone, dateOfBirth: x.dateOfBirth, branchId: Number(x.branchId),
      address: { line1: x.line1, city: x.city, state: x.state, postalCode: x.postalCode, country: 'US' }, password: x.password,
    });
    await login(x.email, x.password);
    toast.success('Welcome to Kestrel Bank', 'Visit your branch to verify your identity and open an account.');
    navigate('/', { replace: true });
  });
  const err = (k) => f.errors[k] || f.errors[`address.${k}`];
  return (
    <AuthShell>
      <h1>Open an account</h1>
      <p className="muted" style={{ marginTop: 4 }}>Create your online banking profile. Identity is verified at your branch.</p>
      <form className="form" onSubmit={onSubmit} style={{ marginTop: 20 }}>
        <div className="form-grid">
          <Field label="First name" error={err('firstName')}><input className="input" value={v.firstName} onChange={f.set('firstName')} required /></Field>
          <Field label="Last name" error={err('lastName')}><input className="input" value={v.lastName} onChange={f.set('lastName')} required /></Field>
          <Field label="Email" error={err('email')} className="full"><input type="email" className="input" value={v.email} onChange={f.set('email')} required /></Field>
          <Field label="Phone" error={err('phone')}><input className="input" placeholder="+1-555-0100" value={v.phone} onChange={f.set('phone')} required /></Field>
          <Field label="Date of birth" error={err('dateOfBirth')}><input type="date" className="input" value={v.dateOfBirth} onChange={f.set('dateOfBirth')} required /></Field>
          <Field label="Home branch" error={err('branchId')} className="full">
            <select className="select" value={v.branchId} onChange={f.set('branchId')} required>
              <option value="">Select a branch…</option>
              {(branches.data || []).map((b) => <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>)}
            </select>
          </Field>
          <Field label="Street address" error={err('line1')} className="full"><input className="input" value={v.line1} onChange={f.set('line1')} required /></Field>
          <Field label="City" error={err('city')}><input className="input" value={v.city} onChange={f.set('city')} required /></Field>
          <Field label="State" error={err('state')}><input className="input" value={v.state} onChange={f.set('state')} required /></Field>
          <Field label="Postal code" error={err('postalCode')}><input className="input" value={v.postalCode} onChange={f.set('postalCode')} required /></Field>
          <div />
          <Field label="Password" error={err('password')} hint="10+ characters with upper, lower, number and symbol"><input type="password" className="input" autoComplete="new-password" value={v.password} onChange={f.set('password')} required /></Field>
          <Field label="Confirm password"><input type="password" className="input" autoComplete="new-password" value={v.confirm} onChange={f.set('confirm')} required /></Field>
        </div>
        <Alert>{f.formError}</Alert>
        <Button type="submit" loading={f.busy} className="btn-block">Create profile</Button>
        <p className="subtle" style={{ textAlign: 'center' }}>Already a customer? <Link to="/login">Sign in</Link></p>
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const f = useForm({ email: '' });
  const onSubmit = f.submit(async (v) => { await api.post('/auth/forgot-password', { email: v.email }); setSent(true); });
  return (
    <AuthShell>
      <h1>Reset your password</h1>
      {sent ? (
        <div className="stack" style={{ marginTop: 16 }}>
          <Alert type="success">If that email is registered, a reset link has been sent. In this simulated environment, emails are delivered to the administrator&apos;s email outbox (Security &amp; network → Email outbox).</Alert>
          <Link to="/reset-password">I have a reset token</Link>
          <Link to="/login">Back to sign in</Link>
        </div>
      ) : (
        <form className="form" onSubmit={onSubmit} style={{ marginTop: 20 }}>
          <Field label="Email" error={f.errors.email}><input type="email" className="input" value={f.values.email} onChange={f.set('email')} required /></Field>
          <Alert>{f.formError}</Alert>
          <Button type="submit" loading={f.busy} className="btn-block">Send reset link</Button>
          <Link to="/login" style={{ textAlign: 'center' }}>Back to sign in</Link>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const f = useForm({ token: params.get('token') || '', newPassword: '', confirm: '' });
  const onSubmit = f.submit(async (v) => {
    if (v.newPassword !== v.confirm) throw new Error('Passwords do not match');
    await api.post('/auth/reset-password', { token: v.token.trim(), newPassword: v.newPassword });
    toast.success('Password reset', 'Sign in with your new password.');
    navigate('/login', { replace: true });
  });
  return (
    <AuthShell>
      <h1>Choose a new password</h1>
      <form className="form" onSubmit={onSubmit} style={{ marginTop: 20 }}>
        <Field label="Reset token" error={f.errors.token}><input className="input mono" value={f.values.token} onChange={f.set('token')} required /></Field>
        <Field label="New password" error={f.errors.newPassword} hint="10+ characters with upper, lower, number and symbol"><input type="password" className="input" autoComplete="new-password" value={f.values.newPassword} onChange={f.set('newPassword')} required /></Field>
        <Field label="Confirm new password"><input type="password" className="input" autoComplete="new-password" value={f.values.confirm} onChange={f.set('confirm')} required /></Field>
        <Alert>{f.formError}</Alert>
        <Button type="submit" loading={f.busy} className="btn-block">Reset password</Button>
        <Link to="/login" style={{ textAlign: 'center' }}>Back to sign in</Link>
      </form>
    </AuthShell>
  );
}
