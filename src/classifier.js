'use strict';

// Rule-based lead sorter. No network calls, no API keys.
//
// classify(message) -> { category, urgency }
//
// To add an AI step later, wrap this: call the AI, validate its answer against
// CATEGORIES / URGENCIES, and fall back to classify() on any error or timeout.

const CATEGORIES = ['booking', 'question', 'complaint', 'other'];
const URGENCIES = ['high', 'normal', 'low'];

// Checked in this order; the first category with a match wins.
const CATEGORY_RULES = [
  ['complaint', ['refund', 'terrible', 'awful', 'angry', 'broken', 'unhappy', 'complain',
    'disappointed', 'worst', 'rude', 'never again']],
  ['booking', ['book', 'schedule', 'appointment', 'available', 'availability', 'reserve',
    'come on', 'quote']],
  ['question', ['?', 'how much', 'do you', 'can you', 'what', 'when', 'price', 'rate', 'cost']],
];

const HIGH_URGENCY = ['urgent', 'asap', 'emergency', 'today', 'immediately', 'right now', 'tonight'];
const LOW_URGENCY = ['whenever', 'no rush', 'just curious', 'next month'];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A keyword matches when it starts at a word boundary, so "book" matches
// "booking" and "booked" but not "facebook", and "rate" matches "rates" but not
// "separate". Spaces inside a phrase match any whitespace. Punctuation
// keywords like "?" match anywhere.
function compile(keyword) {
  const body = keyword.split(/\s+/).map(escapeRegExp).join('\\s+');
  const prefix = /^[a-z0-9]/i.test(keyword) ? '(?<![\\p{L}\\p{N}])' : '';
  return new RegExp(prefix + body, 'iu');
}

const compiled = (list) => list.map(compile);
const CATEGORY_MATCHERS = CATEGORY_RULES.map(([category, words]) => [category, compiled(words)]);
const HIGH_MATCHERS = compiled(HIGH_URGENCY);
const LOW_MATCHERS = compiled(LOW_URGENCY);

const anyMatch = (matchers, text) => matchers.some((re) => re.test(text));

function classify(message) {
  const text = typeof message === 'string' ? message : '';

  let category = 'other';
  for (const [name, matchers] of CATEGORY_MATCHERS) {
    if (anyMatch(matchers, text)) {
      category = name;
      break;
    }
  }

  let urgency = 'normal';
  if (anyMatch(HIGH_MATCHERS, text) || category === 'complaint') urgency = 'high';
  else if (anyMatch(LOW_MATCHERS, text)) urgency = 'low';

  return { category, urgency };
}

module.exports = { classify, CATEGORIES, URGENCIES };
