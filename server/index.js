import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
app.use(cors(), express.json());
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '', database: 'harbour', decimalNumbers: true,
});
const SECRET = process.env.JWT_SECRET || 'dev-secret';
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });
const audit = (actor, action, details = '') =>
  db.query('INSERT INTO audit_log(actor_id,action,details) VALUES(?,?,?)', [actor, action, details]);

// Role guard: unauthorized users never reach restricted routes
const auth = (...roles) => (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').slice(7), SECRET);
  } catch { return fail(res, 'Please sign in again', 401); }
  if (roles.length && !roles.includes(req.user.role)) return fail(res, 'You do not have access to this', 403);
  next();
};

const newAccountNo = async () => {
  for (;;) {
    const n = String(Math.floor(1e11 + Math.random() * 9e11));
    const [r] = await db.query('SELECT 1 FROM accounts WHERE account_no=?', [n]);
    if (!r.length) return n;
  }
};

async function createUser(d, actorId, opening = 0) {
  const missing = ['fullName', 'username', 'password', 'role'].filter((k) => !String(d[k] || '').trim());
  if (d.role === 'customer') ['email', 'phone', 'address'].forEach((k) => !String(d[k] || '').trim() && missing.push(k));
  if (missing.length) throw new Error('Missing required fields: ' + missing.join(', '));
  if (String(d.password).length < 6) throw new Error('Password must be at least 6 characters');
  const [dup] = await db.query('SELECT 1 FROM users WHERE username=?', [d.username]);
  if (dup.length) throw new Error('That username is already taken');
  const [r] = await db.query(
    'INSERT INTO users(username,password_hash,full_name,role,email,phone,address) VALUES(?,?,?,?,?,?,?)',
    [d.username, await bcrypt.hash(d.password, 10), d.fullName, d.role, d.email || null, d.phone || null, d.address || null]);
  let accountNo = null;
  if (d.role === 'customer') {
    accountNo = await newAccountNo();
    await db.query('INSERT INTO accounts(account_no,user_id,balance) VALUES(?,?,?)', [accountNo, r.insertId, opening]);
  }
  await audit(actorId, d.role === 'customer' ? 'CREATE_CUSTOMER' : 'CREATE_USER', `${d.username} (${d.role})`);
  return { id: r.insertId, accountNo };
}

app.post('/api/login', async (req, res) => {
  const [[u]] = await db.query('SELECT * FROM users WHERE username=?', [req.body.username]);
  if (!u || !(await bcrypt.compare(req.body.password || '', u.password_hash))) return fail(res, 'Wrong username or password', 401);
  const user = { id: u.id, role: u.role, name: u.full_name };
  res.json({ token: jwt.sign(user, SECRET, { expiresIn: '8h' }), user });
});

/* ---------- Customer ---------- */
app.get('/api/me', auth('customer'), async (req, res) => {
  const [[acc]] = await db.query('SELECT account_no,balance FROM accounts WHERE user_id=?', [req.user.id]);
  const [txns] = await db.query(
    'SELECT * FROM transactions WHERE from_account=? OR to_account=? ORDER BY id DESC LIMIT 20', [acc.account_no, acc.account_no]);
  const [loans] = await db.query('SELECT * FROM loans WHERE user_id=? ORDER BY id DESC', [req.user.id]);
  const [notes] = await db.query('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 10', [req.user.id]);
  res.json({ account: acc, txns, loans, notes });
});

app.get('/api/validate/:no', auth('customer'), async (req, res) => {
  const [[r]] = await db.query(
    "SELECT u.full_name FROM accounts a JOIN users u ON u.id=a.user_id WHERE a.account_no=? AND a.status='active'", [req.params.no]);
  if (!r) return fail(res, 'No active account with this number', 404);
  res.json({ name: r.full_name });
});

app.post('/api/transfer', auth('customer'), async (req, res) => {
  const { toAccount, amount, note } = req.body, amt = Number(amount);
  if (!/^\d{12}$/.test(toAccount || '') || !(amt > 0)) return fail(res, 'Enter a 12-digit account number and an amount above zero');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[from]] = await conn.query('SELECT * FROM accounts WHERE user_id=? FOR UPDATE', [req.user.id]);
    const [[to]] = await conn.query('SELECT * FROM accounts WHERE account_no=? FOR UPDATE', [toAccount]);
    if (!to || to.status !== 'active') throw new Error('Beneficiary account not found');
    if (to.id === from.id) throw new Error('You cannot send money to your own account');
    if (from.balance < amt) throw new Error('Insufficient balance');
    const txnId = 'HB' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1e4);
    await conn.query('UPDATE accounts SET balance=balance-? WHERE id=?', [amt, from.id]);
    await conn.query('UPDATE accounts SET balance=balance+? WHERE id=?', [amt, to.id]);
    await conn.query('INSERT INTO transactions(txn_id,from_account,to_account,amount,note) VALUES(?,?,?,?,?)',
      [txnId, from.account_no, to.account_no, amt, note || null]);
    await conn.query('INSERT INTO notifications(user_id,message) VALUES(?,?)', [to.user_id, `You received ₹${amt} (${txnId})`]);
    await conn.commit();
    res.json({ txnId, message: `Transfer complete. Transaction ID: ${txnId}` });
  } catch (e) { await conn.rollback(); fail(res, e.message); } finally { conn.release(); }
});

app.post('/api/loans', auth('customer'), async (req, res) => {
  const { amount, purpose, tenure } = req.body;
  if (!(Number(amount) > 0) || !(Number(tenure) > 0)) return fail(res, 'Enter a loan amount and tenure');
  await db.query('INSERT INTO loans(user_id,amount,purpose,tenure_months) VALUES(?,?,?,?)', [req.user.id, amount, purpose, tenure]);
  res.json({ message: 'Loan application sent to the manager' });
});

/* ---------- Employee ---------- */
app.post('/api/employee/customers', auth('employee'), async (req, res) => {
  try {
    const out = await createUser({ ...req.body, role: 'customer' }, req.user.id, Number(req.body.opening) || 0);
    res.json({ message: 'Customer account created', accountNo: out.accountNo });
  } catch (e) { fail(res, e.message); }
});

/* ---------- Manager ---------- */
app.get('/api/manager/loans', auth('manager'), async (req, res) => {
  const [rows] = await db.query(
    "SELECT l.*, u.full_name FROM loans l JOIN users u ON u.id=l.user_id WHERE l.status='pending' ORDER BY l.id");
  res.json(rows);
});
app.post('/api/manager/loans/:id', auth('manager'), async (req, res) => {
  const status = req.body.decision === 'approve' ? 'approved' : req.body.decision === 'reject' ? 'rejected' : null;
  if (!status) return fail(res, 'Decision must be approve or reject');
  const [[loan]] = await db.query("SELECT * FROM loans WHERE id=? AND status='pending'", [req.params.id]);
  if (!loan) return fail(res, 'This application was already decided', 404);
  await db.query('UPDATE loans SET status=?, decided_by=?, decided_at=NOW() WHERE id=?', [status, req.user.id, loan.id]);
  await db.query('INSERT INTO notifications(user_id,message) VALUES(?,?)',
    [loan.user_id, `Your loan of ₹${loan.amount} was ${status}.`]);
  await audit(req.user.id, 'LOAN_' + status.toUpperCase(), `loan #${loan.id}`);
  res.json({ message: `Loan ${status}` });
});

/* ---------- Admin ---------- */
app.get('/api/admin/users', auth('admin'), async (req, res) => {
  const [rows] = await db.query('SELECT id,username,full_name,role,created_at FROM users ORDER BY id');
  res.json(rows);
});
app.post('/api/admin/users', auth('admin'), async (req, res) => {
  try { await createUser(req.body, req.user.id); res.json({ message: 'User created' }); }
  catch (e) { fail(res, e.message); }
});
app.put('/api/admin/users/:id', auth('admin'), async (req, res) => {
  const { role, fullName, password } = req.body;
  if (!['customer', 'employee', 'manager', 'admin'].includes(role)) return fail(res, 'Unknown role');
  await db.query('UPDATE users SET role=?, full_name=COALESCE(?,full_name) WHERE id=?', [role, fullName || null, req.params.id]);
  if (password) await db.query('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash(password, 10), req.params.id]);
  await audit(req.user.id, 'UPDATE_USER', `user #${req.params.id} -> ${role}`);
  res.json({ message: 'User updated' });
});
app.delete('/api/admin/users/:id', auth('admin'), async (req, res) => {
  if (Number(req.params.id) === req.user.id) return fail(res, 'You cannot delete your own account');
  await db.query('DELETE FROM users WHERE id=?', [req.params.id]);
  await audit(req.user.id, 'DELETE_USER', `user #${req.params.id}`);
  res.json({ message: 'User deleted' });
});
app.get('/api/admin/audit', auth('admin'), async (req, res) => {
  const [rows] = await db.query(
    'SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100');
  res.json(rows);
});

/* ---------- First-run demo data ---------- */
async function seed() {
  const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM users');
  if (n) return;
  const mk = (username, password, fullName, role, extra = {}) =>
    createUser({ username, password, fullName, role, email: username + '@harbour.test', phone: '9000000000', address: 'Demo Street' }, null, extra.open || 0);
  await mk('admin', 'admin123', 'Asha Admin', 'admin');
  await mk('manager', 'manager123', 'Mohan Manager', 'manager');
  await mk('employee', 'employee123', 'Eli Employee', 'employee');
  await mk('demo', 'demo123', 'Divya Demo', 'customer', { open: 50000 });
  await mk('friend', 'friend123', 'Farhan Friend', 'customer', { open: 10000 });
  console.log('Seeded demo users: admin, manager, employee, demo, friend');
}
seed().then(() => app.listen(5000, () => console.log('Harbour API on http://localhost:5000')));
