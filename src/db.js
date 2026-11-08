'use strict';

const { Pool } = require('pg');

const LIST_LIMIT = 500;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// An idle client erroring (e.g. Neon suspending the compute) must not crash the process.
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL,
      phone      TEXT NOT NULL DEFAULT '',
      service    TEXT NOT NULL,
      message    TEXT NOT NULL,
      category   TEXT NOT NULL,
      urgency    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'new',
      note       TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(
    'CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC, id DESC)'
  );
}

// "2026-11-07T09:30:00Z": UTC, Z suffix, whole seconds (matches the spec example).
const toIso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

function toLead(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    service: row.service,
    message: row.message,
    category: row.category,
    urgency: row.urgency,
    status: row.status,
    note: row.note,
    created_at: toIso(row.created_at),
  };
}

async function createLead(lead) {
  const { rows } = await pool.query(
    `INSERT INTO leads (name, email, phone, service, message, category, urgency)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [lead.name, lead.email, lead.phone, lead.service, lead.message, lead.category, lead.urgency]
  );
  return toLead(rows[0]);
}

async function listLeads({ status, category } = {}) {
  const where = [];
  const params = [];
  if (status !== undefined) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (category !== undefined) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  params.push(LIST_LIMIT);
  const { rows } = await pool.query(
    `SELECT * FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params
  );
  return rows.map(toLead);
}

async function getLead(id) {
  const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
  return rows[0] ? toLead(rows[0]) : null;
}

async function updateLead(id, changes) {
  const sets = [];
  const params = [];
  for (const field of ['status', 'note']) {
    if (Object.hasOwn(changes, field)) {
      params.push(changes[field]);
      sets.push(`${field} = $${params.length}`);
    }
  }
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE leads SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0] ? toLead(rows[0]) : null;
}

module.exports = { pool, init, createLead, listLeads, getLead, updateLead };
