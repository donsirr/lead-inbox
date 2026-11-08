'use strict';

// End-to-end API tests against a running server. No framework needed.
//
//   BASE_URL=http://localhost:3000 API_TOKEN=... node test/api.test.js
//
// Optional env:
//   OWNER_USER / OWNER_PASS  test POST /api/login
//   DATABASE_URL             run the webhook tests: they start extra copies of
//                            the server (on spare ports, same database) whose
//                            WEBHOOK_URL points at a working, hanging, or dead
//                            endpoint. Skipped when DATABASE_URL is unset (for
//                            example when testing a deployed server).

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN = process.env.API_TOKEN;
if (!TOKEN) {
  console.error('API_TOKEN must be set (the same value the server uses).');
  process.exit(2);
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL ${name}${detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''}`);
  }
}

async function req(method, url, { body, raw, token, headers = {}, base = BASE } = {}) {
  const h = { ...headers };
  if (token !== undefined) h.Authorization = token;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }
  const started = Date.now();
  const res = await fetch(base + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text, headers: res.headers, ms: Date.now() - started };
}

const auth = 'Bearer ' + TOKEN;
const LEAD_KEYS = ['id', 'name', 'email', 'phone', 'service', 'message', 'category', 'urgency',
  'status', 'note', 'created_at'];
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const valid = (over = {}) => ({
  name: 'Test Person',
  email: 'test@example.com',
  service: 'cleaning',
  message: 'Hello there',
  ...over,
});

async function createLead(over) {
  const r = await req('POST', '/api/leads', { body: valid(over) });
  if (r.status !== 201) throw new Error('setup: create failed ' + r.status + ' ' + r.text);
  return r.json;
}

// ---------------------------------------------------------------------------

async function testHealth() {
  console.log('\nhealth');
  const r = await req('GET', '/health');
  check('GET /health returns 200', r.status === 200, r.status);
}

async function testCreate() {
  console.log('\nPOST /api/leads');
  const input = {
    name: '  Ana <b>Cruz</b> & "co"  ',
    email: 'ana@example.com',
    phone: '+63 912 345 6789',
    service: 'cleaning',
    message: "  Line one\nLine two <script>alert('x')</script>  ",
  };
  const r = await req('POST', '/api/leads', { body: input });
  check('returns 201', r.status === 201, r.status);
  const lead = r.json || {};
  check('returns exactly the lead fields', JSON.stringify(Object.keys(lead).sort()) === JSON.stringify([...LEAD_KEYS].sort()), Object.keys(lead));
  check('id is a number', Number.isInteger(lead.id), lead.id);
  check('name stored exactly as typed', lead.name === input.name, lead.name);
  check('message stored exactly as typed', lead.message === input.message, lead.message);
  check('phone stored exactly as typed', lead.phone === input.phone, lead.phone);
  check('status defaults to "new"', lead.status === 'new', lead.status);
  check('note defaults to ""', lead.note === '', lead.note);
  check('created_at is ISO 8601 UTC with Z', ISO_Z.test(lead.created_at || ''), lead.created_at);
  check('created_at is close to now', Math.abs(Date.parse(lead.created_at) - Date.now()) < 5 * 60_000, lead.created_at);

  const noPhone = await req('POST', '/api/leads', { body: valid() });
  check('phone defaults to "" when omitted', noPhone.status === 201 && noPhone.json.phone === '', noPhone.json);

  const fetched = await req('GET', `/api/leads/${lead.id}`, { token: auth });
  check('GET /api/leads/:id returns the same lead', fetched.status === 200 && JSON.stringify(fetched.json) === JSON.stringify(lead), fetched.json);

  const edge = await req('POST', '/api/leads', {
    body: valid({ name: 'n'.repeat(100), message: 'm'.repeat(2000), service: 'consultation' }),
  });
  check('accepts name of exactly 100 and message of exactly 2000 chars', edge.status === 201, edge.status);

  for (const service of ['repair', 'other']) {
    const s = await req('POST', '/api/leads', { body: valid({ service }) });
    check(`accepts service "${service}"`, s.status === 201, s.status);
  }

  const noType = await req('POST', '/api/leads', { raw: JSON.stringify(valid()) });
  check('accepts a JSON body sent without a Content-Type header', noType.status === 201, noType.status);

  const preflight = await req('OPTIONS', '/api/leads', {
    headers: { Origin: 'https://example.org', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  check('CORS preflight for POST /api/leads is allowed', preflight.status < 300 && !!preflight.headers.get('access-control-allow-origin'), preflight.status);
  const corsPost = await req('POST', '/api/leads', { body: valid(), headers: { Origin: 'https://example.org' } });
  check('POST /api/leads sends Access-Control-Allow-Origin', !!corsPost.headers.get('access-control-allow-origin'));
}

async function testValidation() {
  console.log('\nPOST /api/leads validation (400 + {error})');
  const omit = (k) => { const v = valid(); delete v[k]; return v; };
  const cases = [
    ['name missing', { body: omit('name') }],
    ['name empty', { body: valid({ name: '' }) }],
    ['name only spaces', { body: valid({ name: '   ' }) }],
    ['name over 100 chars', { body: valid({ name: 'n'.repeat(101) }) }],
    ['name is a number', { body: valid({ name: 42 }) }],
    ['name is an object', { body: valid({ name: { first: 'A' } }) }],
    ['name is null', { body: valid({ name: null }) }],
    ['email missing', { body: omit('email') }],
    ['email invalid (no @)', { body: valid({ email: 'not-an-email' }) }],
    ['email invalid (no domain dot)', { body: valid({ email: 'a@b' }) }],
    ['email invalid (spaces)', { body: valid({ email: 'a b@example.com' }) }],
    ['email is a number', { body: valid({ email: 123 }) }],
    ['email is an array', { body: valid({ email: ['a@example.com'] }) }],
    ['phone is a number', { body: valid({ phone: 5551234 }) }],
    ['phone is a boolean', { body: valid({ phone: true }) }],
    ['service missing', { body: omit('service') }],
    ['service not allowed', { body: valid({ service: 'plumbing' }) }],
    ['service wrong case', { body: valid({ service: 'Cleaning' }) }],
    ['service is a number', { body: valid({ service: 1 }) }],
    ['message missing', { body: omit('message') }],
    ['message empty', { body: valid({ message: '' }) }],
    ['message over 2000 chars', { body: valid({ message: 'm'.repeat(2001) }) }],
    ['message is an array', { body: valid({ message: ['hi'] }) }],
    ['message contains a NUL byte', { body: valid({ message: 'hi\u0000there' }) }],
    ['missing body', { raw: undefined, headers: { 'Content-Type': 'application/json' } }],
    ['empty body string', { raw: '', headers: { 'Content-Type': 'application/json' } }],
    ['malformed JSON', { raw: '{"name": "Ana",', headers: { 'Content-Type': 'application/json' } }],
    ['JSON array body', { raw: '[1,2]', headers: { 'Content-Type': 'application/json' } }],
    ['JSON null body', { raw: 'null', headers: { 'Content-Type': 'application/json' } }],
    ['JSON string body', { raw: '"hello"', headers: { 'Content-Type': 'application/json' } }],
    ['form-encoded body', { raw: 'name=Ana&email=a@example.com', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }],
  ];
  for (const [name, opts] of cases) {
    const r = await req('POST', '/api/leads', opts);
    check(name, r.status === 400 && r.json && typeof r.json.error === 'string' && r.json.error.length > 0, { status: r.status, body: r.text.slice(0, 120) });
  }
}

async function testAuth() {
  console.log('\nauth (401 + {error} on every protected route)');
  const lead = await createLead();
  const routes = [
    ['GET', '/api/leads'],
    ['GET', '/api/leads?status=new&category=other'],
    ['GET', `/api/leads/${lead.id}`],
    ['GET', '/api/leads/999999999'],
    ['GET', '/api/leads/abc'],
    ['PATCH', `/api/leads/${lead.id}`, { status: 'won' }],
    ['PATCH', '/api/leads/999999999', { status: 'won' }],
    ['PATCH', `/api/leads/${lead.id}`, { status: 'bogus' }],
  ];
  const tokens = [
    ['missing token', undefined],
    ['wrong token', 'Bearer wrong-' + TOKEN],
    ['token without Bearer prefix', TOKEN],
    ['empty Bearer', 'Bearer '],
    ['wrong scheme', 'Basic ' + Buffer.from('a:b').toString('base64')],
  ];
  for (const [label, token] of tokens) {
    for (const [method, url, body] of routes) {
      const r = await req(method, url, { token, body });
      check(`${label}: ${method} ${url}`, r.status === 401 && r.json && typeof r.json.error === 'string', r.status);
    }
  }
  const malformed = await req('PATCH', `/api/leads/${lead.id}`, { raw: '{bad', headers: { 'Content-Type': 'application/json' } });
  check('auth is checked before body parsing (malformed JSON, no token -> 401)', malformed.status === 401, malformed.status);
  const unchanged = await req('GET', `/api/leads/${lead.id}`, { token: auth });
  check('rejected PATCH did not change the lead', unchanged.json && unchanged.json.status === 'new', unchanged.json);
}

async function testNotFound() {
  console.log('\n404s');
  for (const id of ['999999999', 'abc', '1.5', '-1', '0', '99999999999999999999', '1e3']) {
    const g = await req('GET', `/api/leads/${id}`, { token: auth });
    check(`GET /api/leads/${id} -> 404`, g.status === 404 && g.json && g.json.error, g.status);
    const p = await req('PATCH', `/api/leads/${id}`, { token: auth, body: { status: 'won' } });
    check(`PATCH /api/leads/${id} -> 404`, p.status === 404 && p.json && p.json.error, p.status);
  }
}

async function testPatch() {
  console.log('\nPATCH /api/leads/:id');
  const lead = await createLead();
  const url = `/api/leads/${lead.id}`;
  const bad = [
    ['bad status value', { status: 'archived' }],
    ['status wrong case', { status: 'WON' }],
    ['status is a number', { status: 1 }],
    ['status is null', { status: null }],
    ['note is a number', { note: 5 }],
    ['note is null', { note: null }],
    ['note is an object', { note: { text: 'x' } }],
    ['valid note but bad status', { note: 'ok', status: 'nope' }],
    ['empty object', {}],
  ];
  for (const [name, body] of bad) {
    const r = await req('PATCH', url, { token: auth, body });
    check(`400 on ${name}`, r.status === 400 && r.json && typeof r.json.error === 'string', r.status);
  }
  const malformed = await req('PATCH', url, { token: auth, raw: '{"status":', headers: { 'Content-Type': 'application/json' } });
  check('400 on malformed JSON', malformed.status === 400, malformed.status);
  const arr = await req('PATCH', url, { token: auth, raw: '["won"]', headers: { 'Content-Type': 'application/json' } });
  check('400 on array body', arr.status === 400, arr.status);

  const after = await req('GET', url, { token: auth });
  check('failed PATCHes left the lead unchanged', after.json.status === 'new' && after.json.note === '', after.json);

  for (const status of ['contacted', 'won', 'lost', 'new']) {
    const s = await req('PATCH', url, { token: auth, body: { status } });
    check(`status -> ${status}`, s.status === 200 && s.json.status === status, s.json);
  }
  const note = '  Called <b>twice</b>\nno answer  ';
  const n = await req('PATCH', url, { token: auth, body: { note } });
  check('note only -> 200, stored exactly', n.status === 200 && n.json.note === note && n.json.status === 'new', n.json);

  const both = await req('PATCH', url, { token: auth, body: { status: 'won', note: 'Booked for Tuesday' } });
  check('status + note together -> 200', both.status === 200 && both.json.status === 'won' && both.json.note === 'Booked for Tuesday', both.json);
  check('PATCH returns the full lead', both.json && JSON.stringify(Object.keys(both.json).sort()) === JSON.stringify([...LEAD_KEYS].sort()));
  check('PATCH keeps other fields', both.json.name === lead.name && both.json.created_at === lead.created_at && both.json.id === lead.id);

  const persisted = await req('GET', url, { token: auth });
  check('changes are persisted', persisted.json.status === 'won' && persisted.json.note === 'Booked for Tuesday', persisted.json);

  const cleared = await req('PATCH', url, { token: auth, body: { note: '' } });
  check('note can be cleared to ""', cleared.status === 200 && cleared.json.note === '', cleared.json);
}

async function testListAndFilters() {
  console.log('\nGET /api/leads (ordering + filters)');
  const a = await createLead({ message: 'I want a refund, this was terrible' }); // complaint
  const b = await createLead({ message: 'Can I book an appointment?' }); // booking
  const c = await createLead({ message: 'How much do you charge?' }); // question
  await req('PATCH', `/api/leads/${b.id}`, { token: auth, body: { status: 'contacted' } });
  await req('PATCH', `/api/leads/${c.id}`, { token: auth, body: { status: 'contacted' } });

  const all = await req('GET', '/api/leads', { token: auth });
  check('returns 200 + {leads: [...]}', all.status === 200 && Array.isArray(all.json && all.json.leads), all.status);
  if (!Array.isArray(all.json && all.json.leads)) return; // nothing to inspect; the failure is recorded above
  const leads = all.json.leads;
  check('returns at least 3 leads', leads.length >= 3, leads.length);
  check('every item has exactly the lead fields', leads.every((l) => JSON.stringify(Object.keys(l).sort()) === JSON.stringify([...LEAD_KEYS].sort())));
  const ids = leads.slice(0, 3).map((l) => l.id);
  check('newest first: the 3 just created are on top, newest first', JSON.stringify(ids) === JSON.stringify([c.id, b.id, a.id]), ids);
  let sorted = true;
  for (let i = 1; i < leads.length; i++) {
    const prev = Date.parse(leads[i - 1].created_at);
    const cur = Date.parse(leads[i].created_at);
    if (prev < cur || (prev === cur && leads[i - 1].id < leads[i].id)) sorted = false;
  }
  check('whole list sorted by created_at desc, id desc', sorted);

  const st = await req('GET', '/api/leads?status=contacted', { token: auth });
  check('?status=contacted -> only contacted', st.status === 200 && st.json.leads.length > 0 && st.json.leads.every((l) => l.status === 'contacted'), st.json && st.json.leads.length);
  check('?status=contacted includes the patched leads', [b.id, c.id].every((id) => st.json.leads.some((l) => l.id === id)));

  const cat = await req('GET', '/api/leads?category=complaint', { token: auth });
  check('?category=complaint -> only complaints', cat.status === 200 && cat.json.leads.length > 0 && cat.json.leads.every((l) => l.category === 'complaint'));
  check('?category=complaint includes the complaint lead', cat.json.leads.some((l) => l.id === a.id));

  const both = await req('GET', '/api/leads?status=contacted&category=booking', { token: auth });
  check('?status=contacted&category=booking -> both match', both.status === 200 && both.json.leads.length > 0 && both.json.leads.every((l) => l.status === 'contacted' && l.category === 'booking'));
  check('combined filter includes lead b, excludes a and c', both.json.leads.some((l) => l.id === b.id) && !both.json.leads.some((l) => l.id === a.id || l.id === c.id));

  const none = await req('GET', '/api/leads?status=new&category=booking', { token: auth });
  check('combined filter excludes non-matching lead b', none.status === 200 && !none.json.leads.some((l) => l.id === b.id));

  for (const q of ['status=bogus', 'category=bogus', 'status=NEW', 'status=new&category=bogus', 'status=new&status=won']) {
    const r = await req('GET', `/api/leads?${q}`, { token: auth });
    check(`invalid filter ?${q} -> 200 + empty list`, r.status === 200 && Array.isArray(r.json.leads) && r.json.leads.length === 0, r.json);
  }
}

async function testClassifier() {
  console.log('\nclassifier (category / urgency on create)');
  const samples = [
    ['I want a refund, this was terrible', 'complaint', 'high'],
    ['The cleaner was RUDE. Never again.', 'complaint', 'high'],
    ['Very disappointed, the tap is still broken. No rush on the reply.', 'complaint', 'high'],
    ['Can I book a cleaning for Friday?', 'booking', 'normal'],
    ['Please schedule an appointment, it is urgent', 'booking', 'high'],
    ['Are you available next month? No rush.', 'booking', 'low'],
    ['I would like a quote for repairs', 'booking', 'normal'],
    ['How much do you charge?', 'question', 'normal'],
    ['What is your hourly rate', 'question', 'normal'],
    ['Pipe burst, need someone tonight', 'other', 'high'],
    ['EMERGENCY: water everywhere', 'other', 'high'],
    ['Just curious about your services', 'other', 'low'],
    ['Hello, I found you on Facebook', 'other', 'normal'],
    ['I am angry, can you book me a refund today?', 'complaint', 'high'],
    ['Can you book me in asap?', 'booking', 'high'],
    ['Price list please, whenever you can', 'question', 'low'],
  ];
  for (const [message, category, urgency] of samples) {
    const r = await req('POST', '/api/leads', { body: valid({ message }) });
    check(`"${message}" -> ${category}/${urgency}`, r.status === 201 && r.json.category === category && r.json.urgency === urgency, r.json && `${r.json.category}/${r.json.urgency}`);
  }
}

async function testLogin() {
  console.log('\nPOST /api/login');
  const { OWNER_USER, OWNER_PASS } = process.env;
  const wrong = await req('POST', '/api/login', { body: { username: 'nobody', password: 'nope' } });
  check('wrong credentials -> 401', wrong.status === 401 && wrong.json && wrong.json.error, wrong.status);
  const empty = await req('POST', '/api/login', { body: {} });
  check('missing credentials -> 401', empty.status === 401, empty.status);
  if (!OWNER_USER || !OWNER_PASS) {
    console.log('  skip correct-credentials test (set OWNER_USER and OWNER_PASS)');
    return;
  }
  const wrongPass = await req('POST', '/api/login', { body: { username: OWNER_USER, password: OWNER_PASS + 'x' } });
  check('right user, wrong password -> 401', wrongPass.status === 401, wrongPass.status);
  const ok = await req('POST', '/api/login', { body: { username: OWNER_USER, password: OWNER_PASS } });
  check('correct credentials -> 200 + token', ok.status === 200 && ok.json && ok.json.token === TOKEN, ok.status);
}

// ---------------------------------------------------------------------------
// Webhook tests: start the app on a spare port with a chosen WEBHOOK_URL.

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function startApp(webhookUrl) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT: String(port), WEBHOOK_URL: webhookUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => (logs += d));
  child.stderr.on('data', (d) => (logs += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base + '/health');
      if (r.ok) return { base, child, logs: () => logs };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('app did not start: ' + logs);
}

async function testWebhook() {
  console.log('\nwebhook');
  if (!process.env.DATABASE_URL) {
    console.log('  skip (set DATABASE_URL to run webhook tests against a local copy of the server)');
    return;
  }

  // 1. Working receiver: payload shape.
  let received;
  let onReceived;
  const gotIt = new Promise((resolve) => (onReceived = resolve));
  const receiver = await listen((rq, rs) => {
    let data = '';
    rq.on('data', (d) => (data += d));
    rq.on('end', () => {
      received = { method: rq.method, type: rq.headers['content-type'], body: data };
      rs.end('ok');
      onReceived();
    });
  });
  let app = await startApp(`http://127.0.0.1:${receiver.address().port}/hook`);
  try {
    const r = await req('POST', '/api/leads', { base: app.base, body: valid({ message: 'webhook payload test' }) });
    await Promise.race([gotIt, new Promise((r2) => setTimeout(r2, 3000))]);
    let payload;
    try { payload = JSON.parse(received && received.body); } catch { payload = null; }
    check('webhook receives POST application/json', received && received.method === 'POST' && /application\/json/.test(received.type), received);
    check('payload is {event: "lead.created", lead}', payload && payload.event === 'lead.created' && JSON.stringify(payload.lead) === JSON.stringify(r.json), payload);
  } finally {
    app.child.kill();
    receiver.close();
  }

  // 2. Hanging receiver: must not delay the 201.
  const hanging = await listen(() => { /* never respond */ });
  app = await startApp(`http://127.0.0.1:${hanging.address().port}/hook`);
  try {
    const r = await req('POST', '/api/leads', { base: app.base, body: valid({ message: 'slow webhook test' }) });
    check('slow webhook: still 201', r.status === 201, r.status);
    check(`slow webhook: response not delayed (${r.ms}ms < 1500ms)`, r.ms < 1500, r.ms);
    const g = await req('GET', `/api/leads/${r.json.id}`, { base: app.base, token: auth });
    check('slow webhook: lead was saved', g.status === 200 && g.json.message === 'slow webhook test');
    await new Promise((r2) => setTimeout(r2, 5600));
    check('slow webhook: times out after 5s and is logged', /\[webhook\].*(Timeout|abort)/i.test(app.logs()), app.logs().slice(-300));
    check('slow webhook: server still healthy after timeout', (await req('GET', '/health', { base: app.base })).status === 200);
  } finally {
    app.child.kill();
    hanging.closeAllConnections();
    hanging.close();
  }

  // 3. Dead endpoint, server error, and garbage URL: save still succeeds.
  const erroring = await listen((_rq, rs) => { rs.statusCode = 500; rs.end('boom'); });
  const closed = await listen(() => {});
  const deadPort = closed.address().port;
  await new Promise((r) => closed.close(r)); // nothing listens there now
  for (const [label, url] of [
    ['connection refused', `http://127.0.0.1:${deadPort}/hook`],
    ['HTTP 500 from webhook', `http://127.0.0.1:${erroring.address().port}/hook`],
    ['invalid WEBHOOK_URL', 'not a url'],
  ]) {
    app = await startApp(url);
    try {
      const r = await req('POST', '/api/leads', { base: app.base, body: valid({ message: `webhook ${label}` }) });
      check(`${label}: still 201`, r.status === 201, r.status);
      const g = r.json && (await req('GET', `/api/leads/${r.json.id}`, { base: app.base, token: auth }));
      check(`${label}: lead was saved`, g && g.status === 200);
      await new Promise((r2) => setTimeout(r2, 300));
      check(`${label}: error logged, server alive`, /\[webhook\]/.test(app.logs()) && (await req('GET', '/health', { base: app.base })).status === 200, app.logs().slice(-300));
    } finally {
      app.child.kill();
    }
  }
  erroring.close();
}

// ---------------------------------------------------------------------------

(async () => {
  console.log(`Testing ${BASE}`);

  // Fail fast with a clear message instead of dozens of confusing 401s.
  try {
    const probe = await req('GET', '/api/leads?status=__probe__', { token: auth });
    if (probe.status === 401) {
      console.error(
        '\nThe server rejected API_TOKEN (401).\n' +
        'The token this test is using does not match the one the server started with.\n' +
        'The server reads .env only at startup: if you changed API_TOKEN, restart the server (Ctrl+C, then npm run dev).'
      );
      process.exit(1);
    }
  } catch (err) {
    console.error(`\nCould not reach ${BASE}: ${err.cause?.code || err.message}\nIs the server running? Start it with: npm run dev`);
    process.exit(1);
  }

  try {
    await testHealth();
    await testCreate();
    await testValidation();
    await testAuth();
    await testNotFound();
    await testPatch();
    await testListAndFilters();
    await testClassifier();
    await testLogin();
    await testWebhook();
  } catch (err) {
    failed++;
    failures.push('crashed: ' + err.message);
    console.error('\nTest run crashed:', err);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) console.log('Failures:\n  - ' + failures.join('\n  - '));
  process.exit(failed ? 1 : 0);
})();
