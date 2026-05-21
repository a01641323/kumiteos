// Admin panel served at /admin-panel.
//
// Single-file dark-theme HTML+JS app. Auth: superadmin claim code → JWT. The
// JWT is stored in sessionStorage. No username/password anywhere.

const STYLE = `
  :root {
    color-scheme: dark;
    --bg: #0f1117;
    --panel: #161a23;
    --panel-2: #1d2230;
    --border: #2a3142;
    --text: #e6ebf2;
    --muted: #8a93a6;
    --accent: #4f8cff;
    --danger: #e25c5c;
    --good: #4caf78;
    --warn: #d8a84b;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  header { display: flex; align-items: center; justify-content: space-between;
    padding: 12px 24px; border-bottom: 1px solid var(--border); background: var(--panel); }
  header h1 { margin: 0; font-size: 16px; letter-spacing: 0.02em; }
  header .who { color: var(--muted); font-size: 13px; }
  nav { display: flex; gap: 4px; padding: 0 24px; background: var(--panel-2);
    border-bottom: 1px solid var(--border); }
  nav button { background: transparent; color: var(--muted); border: 0; padding: 12px 18px;
    border-bottom: 2px solid transparent; cursor: pointer; font-size: 13px; }
  nav button.active { color: var(--text); border-bottom-color: var(--accent); }
  main { padding: 24px; max-width: 1200px; margin: 0 auto; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    padding: 18px; margin-bottom: 16px; }
  .card h2 { margin: 0 0 12px; font-size: 15px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  th { color: var(--muted); font-weight: 500; }
  input, select, textarea, button {
    font: inherit; color: inherit; background: var(--panel-2); border: 1px solid var(--border);
    border-radius: 6px; padding: 8px 10px;
  }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  button { cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.danger  { background: var(--danger); border-color: var(--danger); color: #fff; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; }
  .pill.good { background: rgba(76,175,120,.15); color: var(--good); }
  .pill.bad  { background: rgba(226,92,92,.15);  color: var(--danger); }
  .pill.warn { background: rgba(216,168,75,.15); color: var(--warn); }
  .pill.muted { background: rgba(138,147,166,.15); color: var(--muted); }
  textarea { width: 100%; min-height: 280px; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  .muted { color: var(--muted); }
  .right { margin-left: auto; }
  .login { max-width: 360px; margin: 80px auto; background: var(--panel);
    border: 1px solid var(--border); padding: 32px; border-radius: 12px; }
  .login h1 { margin: 0 0 16px; font-size: 18px; }
  .login p { color: var(--muted); margin: 0 0 16px; font-size: 13px; }
  .login input { width: 100%; text-align: center; letter-spacing: 8px; font-size: 22px; font-family: ui-monospace, Menlo, monospace; }
  .login button { width: 100%; margin-top: 20px; padding: 10px; }
  .err { color: var(--danger); margin-top: 12px; font-size: 13px; }
  .code-display { font-family: ui-monospace, Menlo, monospace; font-size: 32px;
    letter-spacing: 12px; text-align: center; padding: 18px; background: var(--panel-2);
    border-radius: 8px; margin: 12px 0; }
`;

const APP_JS = `
const API = location.origin;
let token = sessionStorage.getItem('karate.adminToken') || null;
let me = null;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  if (!res.ok) {
    let body; try { body = await res.json(); } catch { body = { error: res.statusText }; }
    throw new Error(body.error || 'request_failed');
  }
  return res.json();
}

function logout() {
  sessionStorage.removeItem('karate.adminToken');
  sessionStorage.removeItem('karate.adminUser');
  token = null; me = null;
  render();
}

function generateMachineFp() {
  // Browsers can't read OS-level fingerprints, so we fabricate a stable
  // per-browser one. The admin panel never runs offline so this is just to
  // satisfy the server's input validation.
  let fp = localStorage.getItem('karate.adminFp');
  if (!fp) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    fp = Array.from(buf).map(b => b.toString(16).padStart(2,'0')).join('');
    localStorage.setItem('karate.adminFp', fp);
  }
  return fp;
}

async function activate(code) {
  const machineFingerprint = generateMachineFp();
  const r = await fetch(API + '/api/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, machineFingerprint }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || 'activation_failed');
  if (body.payload.role !== 'superadmin') throw new Error('not_superadmin');
  token = body.token;
  me = { role: body.payload.role, features: body.payload.features };
  sessionStorage.setItem('karate.adminToken', token);
  sessionStorage.setItem('karate.adminUser', JSON.stringify(me));
  render();
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'on') for (const [evt,fn] of Object.entries(v)) e.addEventListener(evt, fn);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

let activeTab = 'licenses';

function render() {
  const root = document.getElementById('app');
  root.innerHTML = '';
  if (!token) { root.appendChild(loginView()); return; }
  if (!me) {
    me = JSON.parse(sessionStorage.getItem('karate.adminUser') || 'null');
    if (!me) { logout(); return; }
  }
  root.appendChild(headerView());
  root.appendChild(navView());
  const main = el('main');
  root.appendChild(main);
  if (activeTab === 'licenses') renderLicenses(main);
  if (activeTab === 'content')  renderContent(main);
  if (activeTab === 'files')    renderFiles(main);
  if (activeTab === 'activity') renderActivity(main);
  if (activeTab === 'config')   renderConfig(main);
}

function loginView() {
  const wrap = el('div', { class: 'login' });
  wrap.appendChild(el('h1', {}, 'Karate Admin Panel'));
  wrap.appendChild(el('p', {}, 'Enter your 6-digit superadmin claim code.'));
  const code = el('input', {
    type: 'text', placeholder: '000000', maxlength: '6',
    inputmode: 'numeric', autocomplete: 'one-time-code',
  });
  const err = el('div', { class: 'err' });
  const btn = el('button', { class: 'primary', on: { click: async () => {
    err.textContent = '';
    const value = code.value.trim();
    if (!/^\\d{6}$/.test(value)) { err.textContent = 'Code must be 6 digits.'; return; }
    btn.disabled = true;
    try { await activate(value); }
    catch (e) { err.textContent = e.message; }
    finally { btn.disabled = false; }
  }}}, 'Activate');
  code.addEventListener('input', () => {
    code.value = code.value.replace(/\\D/g, '').slice(0, 6);
  });
  code.addEventListener('keydown', e => e.key === 'Enter' && btn.click());
  wrap.append(code, btn, err);
  setTimeout(() => code.focus(), 0);
  return wrap;
}

function headerView() {
  return el('header', {},
    el('h1', {}, 'Karate Tournament — Admin Panel'),
    el('div', { class: 'row' },
      el('span', { class: 'who' }, 'superadmin'),
      el('button', { on: { click: logout } }, 'Sign out')
    )
  );
}

function navView() {
  const tabs = [
    ['licenses', 'Licenses'],
    ['content', 'Content'],
    ['files', 'Files'],
    ['activity', 'Activity Log'],
    ['config', 'Config'],
  ];
  const nav = el('nav');
  for (const [id, label] of tabs) {
    nav.appendChild(el('button', {
      class: activeTab === id ? 'active' : '',
      on: { click: () => { activeTab = id; render(); } },
    }, label));
  }
  return nav;
}

// ---------------- Licenses ----------------
async function renderLicenses(main) {
  // Create new code
  const create = el('div', { class: 'card' });
  create.appendChild(el('h2', {}, 'Generate claim code'));
  const label = el('input', { type: 'text', placeholder: 'Label (e.g. Club Guadalajara — Area 1)' });
  const role = el('select');
  role.appendChild(el('option', { value: 'referee' }, 'Referee'));
  role.appendChild(el('option', { value: 'superadmin' }, 'Superadmin'));
  const ttl = el('input', { type: 'number', min: '1', max: '365', value: '30', style: 'width: 80px' });
  const err = el('div', { class: 'err' });
  const codeBox = el('div');
  const submit = el('button', { class: 'primary', on: { click: async () => {
    err.textContent = ''; codeBox.innerHTML = '';
    try {
      const r = await api('/api/admin/licenses', {
        method: 'POST',
        body: JSON.stringify({
          role: role.value,
          label: label.value.trim(),
          ttlDays: Number(ttl.value) || 30,
        }),
      });
      const display = el('div', { class: 'card', style: 'margin-top: 12px' });
      display.appendChild(el('h2', {}, 'New code (shown once)'));
      display.appendChild(el('div', { class: 'code-display' }, r.code));
      display.appendChild(el('p', { class: 'muted' },
        'Copy this code now. It cannot be retrieved again.'));
      codeBox.appendChild(display);
      label.value = '';
      list();
    } catch (e) { err.textContent = e.message; }
  }}}, 'Generate');
  create.append(
    el('div', { class: 'row' },
      label, role,
      el('span', { class: 'muted' }, 'TTL (days)'), ttl,
      submit),
    err,
    codeBox,
  );
  main.appendChild(create);

  // List
  const listCard = el('div', { class: 'card' });
  listCard.appendChild(el('h2', {}, 'All licenses'));
  const tbl = el('table');
  tbl.appendChild(el('thead', {}, el('tr', {},
    el('th',{},'Label'),
    el('th',{},'Role'),
    el('th',{},'Code'),
    el('th',{},'Status'),
    el('th',{},'Created'),
    el('th',{},'Expires'),
    el('th',{},'Machine'),
    el('th',{},'Last renewal'),
    el('th',{},'Actions'),
  )));
  const tb = el('tbody');
  tbl.appendChild(tb);
  listCard.appendChild(tbl);
  main.appendChild(listCard);

  async function list() {
    tb.innerHTML = '';
    try {
      const { licenses } = await api('/api/admin/licenses');
      for (const l of licenses) {
        const statusCls = l.status === 'active' ? 'good'
                        : l.status === 'expired' ? 'warn'
                        : l.status === 'revoked' ? 'bad' : 'muted';
        const tr = el('tr', {},
          el('td', {}, l.label),
          el('td', {}, l.role),
          el('td', { class: 'muted' }, l.codePreview || ''),
          el('td', {}, el('span', { class: 'pill ' + statusCls }, l.status)),
          el('td', { class: 'muted' }, new Date(l.createdAt).toLocaleDateString()),
          el('td', { class: 'muted' }, new Date(l.expiresAt).toLocaleDateString()),
          el('td', { class: 'muted' }, l.machineFingerprintTail || '—'),
          el('td', { class: 'muted' }, l.lastRenewalAt ? new Date(l.lastRenewalAt).toLocaleString() : '—'),
          el('td', {}, el('div', { class: 'row' },
            l.status !== 'revoked' && el('button', { class: 'danger', on: { click: async () => {
              if (!confirm('Revoke this license? Future renewals will fail on the registered device.')) return;
              await api('/api/admin/licenses/' + encodeURIComponent(l.userId) + '/revoke', { method: 'POST' });
              list();
            }}}, 'Revoke'),
            l.status === 'active' && el('button', { on: { click: async () => {
              if (!confirm('Reset the registered machine? The original code becomes reclaimable on a new device.')) return;
              await api('/api/admin/licenses/' + encodeURIComponent(l.userId) + '/transfer', { method: 'POST' });
              list();
            }}}, 'Transfer'),
            l.status === 'unused' && el('button', { on: { click: async () => {
              const days = Number(prompt('Extend by how many days?', '30')) || 0;
              if (days <= 0) return;
              await api('/api/admin/licenses/' + encodeURIComponent(l.userId) + '/extend',
                { method: 'POST', body: JSON.stringify({ days }) });
              list();
            }}}, 'Extend'),
          ))
        );
        tb.appendChild(tr);
      }
    } catch (e) {
      listCard.appendChild(el('div', { class: 'err' }, e.message));
    }
  }
  list();
}

// ---------------- Content ----------------
async function renderContent(main) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, 'Tournament data (JSON)'));
  card.appendChild(el('p', { class: 'muted' },
    'Edit the live tournament JSON. Saving overwrites the server copy and is fetched by clients on next launch.'));
  const ta = el('textarea');
  card.appendChild(ta);
  const err = el('div', { class: 'err' });
  const meta = el('div', { class: 'muted' });
  card.appendChild(el('div', { class: 'row' },
    el('button', { class: 'primary', on: { click: async () => {
      err.textContent = '';
      let parsed;
      try { parsed = JSON.parse(ta.value); }
      catch (e) { err.textContent = 'Invalid JSON: ' + e.message; return; }
      try {
        const r = await api('/api/data', { method: 'PUT', body: JSON.stringify(parsed.data ?? parsed) });
        meta.textContent = 'Saved. ETag ' + r.etag.slice(0,8) + ' at ' + new Date(r.updatedAt).toLocaleString();
      } catch (e) { err.textContent = e.message; }
    }}}, 'Save'),
    el('button', { on: { click: async () => { await load(); }}}, 'Reload'),
    meta,
  ));
  card.appendChild(err);
  main.appendChild(card);
  async function load() {
    try {
      const f = await api('/api/data');
      ta.value = JSON.stringify(f, null, 2);
      meta.textContent = 'ETag ' + (f.etag || '').slice(0,8) + ' updated ' + new Date(f.updatedAt).toLocaleString();
    } catch (e) { err.textContent = e.message; }
  }
  load();
}

// ---------------- Files ----------------
async function renderFiles(main) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, 'Logo'));
  const preview = el('div', {});
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml' });
  const err = el('div', { class: 'err' });
  card.append(
    preview,
    el('div', { class: 'row' },
      fileInput,
      el('button', { class: 'primary', on: { click: async () => {
        err.textContent = '';
        const f = fileInput.files && fileInput.files[0];
        if (!f) { err.textContent = 'Choose a file first.'; return; }
        const fd = new FormData(); fd.append('logo', f);
        const r = await fetch(API + '/api/upload-logo', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd,
        });
        if (!r.ok) { err.textContent = (await r.json().catch(()=>({}))).error || 'upload_failed'; return; }
        await refresh();
      }}}, 'Upload'),
      el('button', { class: 'danger', on: { click: async () => {
        if (!confirm('Remove the current logo?')) return;
        await api('/api/upload-logo', { method: 'DELETE' });
        await refresh();
      }}}, 'Remove'),
    ),
    err,
  );
  main.appendChild(card);
  async function refresh() {
    preview.innerHTML = '';
    const { logo } = await api('/api/logo-info');
    if (logo) {
      preview.appendChild(el('img', { src: '/api/logo?ts=' + Date.now(),
        style: 'max-width:200px; max-height:200px; background:#fff; padding:8px; border-radius:6px;' }));
      preview.appendChild(el('div', { class: 'muted' }, logo.filename + ' · ' + logo.size + ' bytes'));
    } else {
      preview.appendChild(el('div', { class: 'muted' }, 'No logo uploaded.'));
    }
  }
  refresh();
}

// ---------------- Activity ----------------
async function renderActivity(main) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, 'Activity log (most recent first)'));
  const tbl = el('table');
  tbl.appendChild(el('thead', {}, el('tr', {},
    el('th',{},'Time'), el('th',{},'Event'), el('th',{},'User'),
    el('th',{},'Result'), el('th',{},'IP'), el('th',{},'Machine'), el('th',{},'Reason'),
  )));
  const tb = el('tbody');
  tbl.appendChild(tb);
  card.appendChild(tbl);
  main.appendChild(card);
  const { entries } = await api('/api/activity?max=500');
  for (const e of entries) {
    tb.appendChild(el('tr', {},
      el('td', {}, new Date(e.ts).toLocaleString()),
      el('td', {}, e.event),
      el('td', { class: 'muted' }, e.userId || '—'),
      el('td', {}, el('span', { class: 'pill ' + (e.result === 'success' ? 'good' : 'bad') }, e.result)),
      el('td', { class: 'muted' }, e.ip || '—'),
      el('td', { class: 'muted' }, e.machineFingerprint ? e.machineFingerprint.slice(-8) : '—'),
      el('td', { class: 'muted' }, e.reason || e.message || ''),
    ));
  }
}

// ---------------- Config ----------------
async function renderConfig(main) {
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, 'App configuration'));
  const cfg = await api('/api/app-config');
  const ttl = el('input', { type: 'number', min: '1', value: String(cfg.sessionTtlMinutes) });
  const out = el('div', { class: 'muted' });
  card.appendChild(el('div', { class: 'row' },
    el('span', {}, 'Kiosk session TTL (minutes)'),
    ttl,
    el('button', { class: 'primary', on: { click: async () => {
      try {
        const r = await api('/api/app-config', {
          method: 'PUT',
          body: JSON.stringify({ sessionTtlMinutes: Number(ttl.value) || 480 }),
        });
        out.textContent = 'Saved: ' + r.sessionTtlMinutes + ' min';
      } catch (e) { out.textContent = e.message; }
    }}}, 'Save'),
    out,
  ));
  main.appendChild(card);
}

document.addEventListener('DOMContentLoaded', render);
`;

export function renderAdminPanelHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Karate Admin Panel</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>${STYLE}</style>
</head>
<body>
<div id="app"></div>
<script>${APP_JS}</script>
</body>
</html>`;
}

export function renderAdminLoginHtml(): string {
  return `<!DOCTYPE html><meta http-equiv="refresh" content="0;url=/admin-panel" />`;
}
