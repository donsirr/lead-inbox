'use strict';

// Validation returns an error string, or null when the input is fine.
// Values are never trimmed or rewritten: what passes is stored exactly as sent.

const SERVICES = ['cleaning', 'repair', 'consultation', 'other'];
const STATUSES = ['new', 'contacted', 'won', 'lost'];

const LIMITS = { name: 100, email: 254, phone: 50, message: 2000, note: 5000 };

// Pragmatic check: one @, no spaces, a dot in the domain, no dot at either end.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// Length in characters (code points), so an emoji counts as 1, not 2.
const charLength = (s) => [...s].length;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Postgres text columns reject NUL bytes, and lone surrogates can't be stored
// as UTF-8 unchanged. Rejecting both up front keeps them from causing a 500.
function storable(field, value) {
  if (value.includes('\u0000')) return `${field} contains an invalid character`;
  if (typeof value.isWellFormed === 'function' && !value.isWellFormed()) {
    return `${field} contains an invalid character`;
  }
  return null;
}

function checkText(body, field, { required }) {
  const value = body[field];
  if (value === undefined || value === null) return required ? `${field} is required` : null;
  if (typeof value !== 'string') return `${field} must be a string`;
  if (required && value.trim() === '') return `${field} is required`;
  if (charLength(value) > LIMITS[field]) return `${field} must be at most ${LIMITS[field]} characters`;
  return storable(field, value);
}

// Returns { error } or { lead: { name, email, phone, service, message } }.
function validateNewLead(body) {
  if (!isPlainObject(body)) return { error: 'request body must be a JSON object' };

  const error =
    checkText(body, 'name', { required: true }) ||
    checkText(body, 'email', { required: true }) ||
    (!EMAIL_RE.test(body.email) ? 'email must be a valid email address' : null) ||
    checkText(body, 'phone', { required: false }) ||
    (body.service === undefined || body.service === null ? 'service is required' : null) ||
    (!SERVICES.includes(body.service) ? `service must be one of: ${SERVICES.join(', ')}` : null) ||
    checkText(body, 'message', { required: true });
  if (error) return { error };

  return {
    lead: {
      name: body.name,
      email: body.email,
      phone: typeof body.phone === 'string' ? body.phone : '',
      service: body.service,
      message: body.message,
    },
  };
}

// Returns { error } or { changes: { status?, note? } }.
function validatePatch(body) {
  if (!isPlainObject(body)) return { error: 'request body must be a JSON object' };

  const hasStatus = Object.hasOwn(body, 'status');
  const hasNote = Object.hasOwn(body, 'note');
  if (!hasStatus && !hasNote) return { error: 'provide status and/or note' };

  const changes = {};
  if (hasStatus) {
    if (!STATUSES.includes(body.status)) {
      return { error: `status must be one of: ${STATUSES.join(', ')}` };
    }
    changes.status = body.status;
  }
  if (hasNote) {
    if (typeof body.note !== 'string') return { error: 'note must be a string' };
    if (charLength(body.note) > LIMITS.note) {
      return { error: `note must be at most ${LIMITS.note} characters` };
    }
    const bad = storable('note', body.note);
    if (bad) return { error: bad };
    changes.note = body.note;
  }
  return { changes };
}

module.exports = { validateNewLead, validatePatch, SERVICES, STATUSES, LIMITS };
