import { useState, useEffect, useCallback } from 'react';

const api = async (path, method = 'GET', body) => {
  const r = await fetch('/api' + path, {
    method, body: body && JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
};
const money = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const when = (t) => new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const roleName = { customer: 'Customer', employee: 'Bank employee', manager: 'Branch manager', admin: 'Administrator' };

const useForm = (init) => {
  const [v, set] = useState(init);
  return [v, (e) => set({ ...v, [e.target.name]: e.target.value }), set];
};
const Msg = ({ m }) => (m ? <p className={'msg ' + m.kind} role="status">{m.text}</p> : null);

function Login({ onLogin }) {
  const [f, on] = useForm({ username: '', password: '' });
  const [m, setM] = useState();
  const submit = async (e) => {
    e.preventDefault();
    try { const d = await api('/login', 'POST', f); localStorage.setItem('token', d.token); onLogin(d.user); }
    catch (err) { setM({ kind: 'bad', text: err.message }); }
  };
  return (
    <main className="login">
      <section className="login-hero">
        <h1>Harbour</h1>
        <p>Money should arrive the way ships do: on time, and with a record of the trip.</p>
      </section>
      <form onSubmit={submit} className="login-form">
        <h2>Sign in</h2>
        <label>Username<input name="username" value={f.username} onChange={on} autoFocus /></label>
        <label>Password<input name="password" type="password" value={f.password} onChange={on} /></label>
        <button className="primary">Sign in</button>
        <Msg m={m} />
        <small>Demo: demo / demo123 · employee / employee123 · manager / manager123 · admin / admin123</small>
      </form>
    </main>
  );
}

function Customer() {
  const [d, setD] = useState();
  const [f, on, setF] = useForm({ toAccount: '', amount: '', note: '' });
  const [payee, setPayee] = useState();
  const [m, setM] = useState();
  const [l, onL, setL] = useForm({ amount: '', tenure: '12', purpose: '' });
  const load = useCallback(() => api('/me').then(setD), []);
  useEffect(() => { load(); }, [load]);

  const check = async () => {
    setPayee(undefined);
    if (f.toAccount.length !== 12) return;
    try { setPayee({ ok: true, text: (await api('/validate/' + f.toAccount)).name }); }
    catch (e) { setPayee({ ok: false, text: e.message }); }
  };
  const send = async (e) => {
    e.preventDefault();
    try { const r = await api('/transfer', 'POST', f); setM({ kind: 'good', text: r.message }); setF({ toAccount: '', amount: '', note: '' }); setPayee(); load(); }
    catch (err) { setM({ kind: 'bad', text: err.message }); }
  };
  const apply = async (e) => {
    e.preventDefault();
    try { const r = await api('/loans', 'POST', l); setM({ kind: 'good', text: r.message }); setL({ amount: '', tenure: '12', purpose: '' }); load(); }
    catch (err) { setM({ kind: 'bad', text: err.message }); }
  };
  if (!d) return <p>Loading…</p>;
  return (
    <>
      <section className="balance">
        <span>Balance in account {d.account.account_no}</span>
        <strong>{money(d.account.balance)}</strong>
      </section>
      <Msg m={m} />
      <div className="split">
        <form onSubmit={send}>
          <h3>Send money</h3>
          <label>Beneficiary account number
            <input name="toAccount" value={f.toAccount} onChange={on} onBlur={check} maxLength={12} inputMode="numeric" /></label>
          {payee && <p className={'msg ' + (payee.ok ? 'good' : 'bad')}>{payee.ok ? 'Account holder: ' : ''}{payee.text}</p>}
          <label>Amount (₹)<input name="amount" type="number" min="1" value={f.amount} onChange={on} /></label>
          <label>Note (optional)<input name="note" value={f.note} onChange={on} /></label>
          <button className="primary">Send money</button>
        </form>
        <form onSubmit={apply}>
          <h3>Apply for a loan</h3>
          <label>Amount (₹)<input name="amount" type="number" min="1" value={l.amount} onChange={onL} /></label>
          <label>Tenure (months)<input name="tenure" type="number" min="1" value={l.tenure} onChange={onL} /></label>
          <label>Purpose<input name="purpose" value={l.purpose} onChange={onL} /></label>
          <button>Send application</button>
          {d.loans.map((x) => <p key={x.id} className="row">{money(x.amount)} <span className={'tag ' + x.status}>{x.status}</span></p>)}
        </form>
      </div>
      <h3>Notifications</h3>
      {d.notes.length ? d.notes.map((n) => <p className="row" key={n.id}>{n.message}<small>{when(n.created_at)}</small></p>) : <p className="empty">Nothing new. Loan decisions and incoming transfers show up here.</p>}
      <h3>Recent transactions</h3>
      <table><thead><tr><th>Transaction ID</th><th>Direction</th><th>Other account</th><th>Amount</th><th>When</th></tr></thead>
        <tbody>{d.txns.map((t) => {
          const out = t.from_account === d.account.account_no;
          return <tr key={t.id}><td>{t.txn_id}</td><td>{out ? 'Sent' : 'Received'}</td><td>{out ? t.to_account : t.from_account}</td>
            <td className={out ? 'neg' : 'pos'}>{out ? '−' : '+'}{money(t.amount)}</td><td>{when(t.created_at)}</td></tr>;
        })}</tbody></table>
    </>
  );
}

function Employee() {
  const blank = { fullName: '', username: '', password: '', email: '', phone: '', address: '', opening: '' };
  const [f, on, setF] = useForm(blank);
  const [m, setM] = useState();
  const submit = async (e) => {
    e.preventDefault();
    try { const r = await api('/employee/customers', 'POST', f); setM({ kind: 'good', text: `${r.message}. Account number: ${r.accountNo}` }); setF(blank); }
    catch (err) { setM({ kind: 'bad', text: err.message }); }
  };
  return (
    <form onSubmit={submit} className="wide">
      <h3>Open a customer account</h3>
      <div className="grid">
        <label>Full name<input name="fullName" value={f.fullName} onChange={on} /></label>
        <label>Username<input name="username" value={f.username} onChange={on} /></label>
        <label>Temporary password<input name="password" type="password" value={f.password} onChange={on} /></label>
        <label>Email<input name="email" type="email" value={f.email} onChange={on} /></label>
        <label>Phone<input name="phone" value={f.phone} onChange={on} /></label>
        <label>Opening deposit (₹)<input name="opening" type="number" min="0" value={f.opening} onChange={on} /></label>
      </div>
      <label>Address<input name="address" value={f.address} onChange={on} /></label>
      <button className="primary">Create account</button>
      <Msg m={m} />
    </form>
  );
}

function Manager() {
  const [rows, setRows] = useState([]);
  const [m, setM] = useState();
  const load = useCallback(() => api('/manager/loans').then(setRows), []);
  useEffect(() => { load(); }, [load]);
  const decide = async (id, decision) => {
    try { const r = await api('/manager/loans/' + id, 'POST', { decision }); setM({ kind: 'good', text: r.message }); load(); }
    catch (err) { setM({ kind: 'bad', text: err.message }); }
  };
  return (
    <>
      <h3>Pending loan applications</h3><Msg m={m} />
      {rows.length ? <table><thead><tr><th>Customer</th><th>Amount</th><th>Tenure</th><th>Purpose</th><th>Applied</th><th></th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{r.full_name}</td><td>{money(r.amount)}</td><td>{r.tenure_months} months</td><td>{r.purpose}</td><td>{when(r.created_at)}</td>
          <td className="actions"><button className="primary" onClick={() => decide(r.id, 'approve')}>Approve</button><button className="danger" onClick={() => decide(r.id, 'reject')}>Reject</button></td></tr>)}</tbody></table>
        : <p className="empty">No applications waiting. New ones appear here as customers apply.</p>}
    </>
  );
}

function Admin() {
  const [users, setUsers] = useState([]);
  const [log, setLog] = useState([]);
  const blank = { fullName: '', username: '', password: '', role: 'employee' };
  const [f, on, setF] = useForm(blank);
  const [m, setM] = useState();
  const load = useCallback(() => { api('/admin/users').then(setUsers); api('/admin/audit').then(setLog); }, []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn) => { try { const r = await fn(); setM({ kind: 'good', text: r.message }); load(); return true; } catch (e) { setM({ kind: 'bad', text: e.message }); return false; } };
  return (
    <>
      <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => api('/admin/users', 'POST', { ...f, email: f.username + '@harbour.test', phone: '0', address: '-' }))) setF(blank); }} className="wide">
        <h3>Add a user</h3>
        <div className="grid">
          <label>Full name<input name="fullName" value={f.fullName} onChange={on} /></label>
          <label>Username<input name="username" value={f.username} onChange={on} /></label>
          <label>Password<input name="password" type="password" value={f.password} onChange={on} /></label>
          <label>Role<select name="role" value={f.role} onChange={on}>{Object.entries(roleName).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <button className="primary">Create user</button><Msg m={m} />
      </form>
      <h3>Users and roles</h3>
      <table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th></th></tr></thead>
        <tbody>{users.map((u) => <tr key={u.id}><td>{u.full_name}</td><td>{u.username}</td>
          <td><select value={u.role} onChange={(e) => run(() => api('/admin/users/' + u.id, 'PUT', { role: e.target.value }))}>
            {Object.entries(roleName).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
          <td><button className="danger" onClick={() => confirm(`Delete ${u.username}?`) && run(() => api('/admin/users/' + u.id, 'DELETE'))}>Delete</button></td></tr>)}</tbody></table>
      <h3>Audit log</h3>
      <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>{log.map((a) => <tr key={a.id}><td>{when(a.created_at)}</td><td>{a.username || 'system'}</td><td>{a.action}</td><td>{a.details}</td></tr>)}</tbody></table>
    </>
  );
}

const panels = { customer: Customer, employee: Employee, manager: Manager, admin: Admin };

export default function App() {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } });
  const login = (u) => { localStorage.setItem('user', JSON.stringify(u)); setUser(u); };
  const logout = () => { localStorage.clear(); setUser(null); };
  if (!user) return <Login onLogin={login} />;
  const Panel = panels[user.role];
  return (
    <div className="shell">
      <aside>
        <h1>Harbour</h1>
        <p className="who">{user.name}<br /><small>{roleName[user.role]}</small></p>
        <button onClick={logout}>Sign out</button>
      </aside>
      <main><Panel /></main>
    </div>
  );
}
