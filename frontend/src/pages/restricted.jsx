import { ShieldAlert } from 'lucide-react';
import { Alert, Async, Card, PageHeader, useApi } from '../ui';

// Each dataset is served by /admin/restricted/<name>. The API does not check who is asking.
const DATASETS = [
  { name: 'accounts', title: 'Confidential accounts' },
  { name: 'customers', title: 'Customer PII' },
  { name: 'records', title: 'PII records' },
  { name: 'vault', title: 'Vault secrets' },
  { name: 'watchlist', title: 'Watchlist' },
  { name: 'payroll', title: 'Payroll' },
];

function Dataset({ name, title }) {
  const q = useApi(`/admin/restricted/${name}`);
  return (
    <Card flush title={title} subtitle={`/admin/restricted/${name}`}>
      <Async q={q}>
        {(rows) => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>{rows.length > 0 && Object.keys(rows[0]).map((k) => <th key={k}>{k}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>{Object.keys(rows[0]).map((k) => <td key={k}>{r[k] === null || r[k] === undefined ? '' : String(r[k])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
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
