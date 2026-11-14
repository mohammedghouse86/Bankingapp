import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api } from '../api';
import { Alert, Async, Button, Card, PageHeader, useApi, useToast } from '../ui';

// Each dataset is served by /admin/restricted/<name>. The API does not check who is asking.
const DATASETS = [
  { name: 'accounts', title: 'Confidential accounts' },
  { name: 'customers', title: 'Customer PII' },
  { name: 'records', title: 'PII records' },
  { name: 'vault', title: 'Vault secrets' },
  { name: 'watchlist', title: 'Watchlist' },
  { name: 'payroll', title: 'Payroll' },
];

const BLANK = '{\n  \n}';

function Dataset({ name, title }) {
  const base = `/admin/restricted/${name}`;
  const q = useApi(base);
  const toast = useToast();
  const [mode, setMode] = useState(null); // null | 'new' | 'edit' | 'view'
  const [current, setCurrent] = useState(null);
  const [text, setText] = useState(BLANK);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const close = () => { setMode(null); setCurrent(null); setError(null); };

  const openNew = () => { setMode('new'); setCurrent(null); setText(BLANK); setError(null); };
  const openEdit = (row) => {
    const { id, ...rest } = row;
    setMode('edit'); setCurrent(row); setText(JSON.stringify(rest, null, 2)); setError(null);
  };
  const openView = async (row) => {
    setMode('view'); setCurrent(null); setError(null);
    try {
      const r = await api.get(`${base}/${row.id}`);
      setCurrent(r.data);
    } catch (e) {
      setError(e.message);
    }
  };

  const save = async () => {
    let body;
    try { body = JSON.parse(text); } catch { setError('The record must be valid JSON.'); return; }
    setBusy(true); setError(null);
    try {
      if (mode === 'new') await api.post(base, body);
      else await api.put(`${base}/${current.id}`, body);
      toast.success(mode === 'new' ? 'Record created' : 'Record saved');
      close();
      q.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete record ${row.id} from ${title}?`)) return;
    try {
      await api.del(`${base}/${row.id}`);
      toast.success('Record deleted');
      if (current && current.id === row.id) close();
      q.reload();
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <Card flush title={title} subtitle={base} actions={<Button onClick={openNew}>New record</Button>}>
      <Async q={q}>
        {(rows) => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {rows.length > 0 && Object.keys(rows[0]).map((k) => <th key={k}>{k}</th>)}
                  <th>actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {Object.keys(rows[0]).map((k) => <td key={k}>{r[k] === null || r[k] === undefined ? '' : String(r[k])}</td>)}
                    <td className="row-actions">
                      <Button variant="secondary" size="sm" onClick={() => openView(r)}>View</Button>{' '}
                      <Button variant="secondary" size="sm" onClick={() => openEdit(r)}>Edit</Button>{' '}
                      <Button variant="danger" size="sm" onClick={() => remove(r)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>

      {mode && (
        <div className="restricted-panel">
          {mode === 'view' && (
            <>
              <h3>Record {current ? current.id : ''}</h3>
              {current && <pre className="code-box">{JSON.stringify(current, null, 2)}</pre>}
            </>
          )}
          {(mode === 'new' || mode === 'edit') && (
            <>
              <h3>{mode === 'new' ? 'New record' : `Edit record ${current.id}`}</h3>
              <textarea className="textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label="Record JSON" />
              <div className="row-actions">
                <Button loading={busy} onClick={save}>Save</Button>{' '}
              </div>
            </>
          )}
          {error && <Alert>{error}</Alert>}
          <Button variant="secondary" onClick={close}>Close</Button>
        </div>
      )}
    </Card>
  );
}

export function RestrictedRecords() {
  return (
    <>
      <PageHeader title="Restricted records" subtitle="Confidential banking data and PII for administrators." />
      <Alert type="warning">
        <ShieldAlert size={14} /> Restricted area. The records below are confidential. Do not share them outside the bank.
      </Alert>
      {DATASETS.map((d) => <Dataset key={d.name} name={d.name} title={d.title} />)}
    </>
  );
}
