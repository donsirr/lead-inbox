'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');

const db = require('./db');
const { classify, CATEGORIES } = require('./classifier');
const { validateNewLead, validatePatch, STATUSES } = require('./validate');
const { notifyLeadCreated } = require('./webhook');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_ID = 2147483647; // Postgres SERIAL (int4) upper bound

// Constant-time string comparison (hashing first makes lengths equal).
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Routes reachable without a token. Express matches paths case-insensitively
// and ignores a trailing slash, so normalize the same way here.
function isPublicApiRoute(req) {
  const p = req.path.toLowerCase().replace(/\/+$/, '');
  return req.method === 'POST' && (p === '/leads' || p === '/login');
}

function requireToken(req, res, next) {
  if (isPublicApiRoute(req) || req.method === 'OPTIONS') return next();
  const token = process.env.API_TOKEN;
  const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!token || !match || !safeEqual(match[1], token)) {
    return res.status(401).json({ error: 'missing or invalid API token' });
  }
  next();
}

// "12" -> 12; anything else (abc, 1.5, -1, out of range) -> null, which becomes a 404.
function parseId(raw) {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return id >= 1 && id <= MAX_ID ? id : null;
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

  // CORS only for the public create endpoint (handles the preflight too).
  const publicCors = cors({ origin: '*', methods: ['POST'], allowedHeaders: ['Content-Type'] });
  app.options('/api/leads', publicCors);
  app.use('/api/leads', (req, res, next) =>
    req.method === 'POST' && (req.path === '/' || req.path === '') ? publicCors(req, res, next) : next()
  );

  // Auth runs before body parsing, so a bad token wins over bad JSON,
  // and before any 404 or validation check.
  app.use('/api', requireToken);

  // Parse any content type as JSON so clients that forget the header still work.
  app.use('/api', express.json({ type: () => true, limit: '100kb' }));

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = process.env.OWNER_USER;
    const pass = process.env.OWNER_PASS;
    const ok =
      user && pass && process.env.API_TOKEN &&
      typeof username === 'string' && typeof password === 'string' &&
      safeEqual(username, user) & safeEqual(password, pass); // & not &&: no short-circuit
    if (!ok) return res.status(401).json({ error: 'invalid username or password' });
    res.json({ token: process.env.API_TOKEN });
  });

  app.post('/api/leads', async (req, res) => {
    const { error, lead } = validateNewLead(req.body);
    if (error) return res.status(400).json({ error });

    const saved = await db.createLead({ ...lead, ...classify(lead.message) });
    res.status(201).json(saved);
    notifyLeadCreated(saved); // not awaited: the response never waits on the webhook
  });

  app.get('/api/leads', async (req, res) => {
    const { status, category } = req.query;
    // An empty value (?status=) means "no filter", like the dashboard's "All" option.
    const filter = {};
    for (const [key, value, allowed] of [
      ['status', status, STATUSES],
      ['category', category, CATEGORIES],
    ]) {
      if (value === undefined || value === '') continue;
      if (typeof value !== 'string' || !allowed.includes(value)) return res.json({ leads: [] });
      filter[key] = value;
    }
    res.json({ leads: await db.listLeads(filter) });
  });

  app.get('/api/leads/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const lead = id && (await db.getLead(id));
    if (!lead) return res.status(404).json({ error: 'lead not found' });
    res.json(lead);
  });

  app.patch('/api/leads/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'lead not found' });
    const { error, changes } = validatePatch(req.body);
    if (error) return res.status(400).json({ error });
    const lead = await db.updateLead(id, changes);
    if (!lead) return res.status(404).json({ error: 'lead not found' });
    res.json(lead);
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  app.get('/dashboard', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));
  app.use(express.static(PUBLIC_DIR, { index: false }));

  app.use((req, res) => res.status(404).type('text').send('Not found'));

  // Body-parser errors (malformed JSON, bad charset, too large) are client errors.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type || (err.status >= 400 && err.status < 500)) {
      const message =
        err.type === 'entity.parse.failed' ? 'malformed JSON body'
        : err.type === 'entity.too.large' ? 'request body too large'
        : 'invalid request body';
      return res.status(400).json({ error: message });
    }
    console.error('[error]', req.method, req.originalUrl, err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

module.exports = { createApp };
