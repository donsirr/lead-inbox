'use strict';

const TIMEOUT_MS = 5000;

// Fire-and-forget. Never throws and never rejects; failures are only logged.
function notifyLeadCreated(lead, url = process.env.WEBHOOK_URL) {
  if (!url) return Promise.resolve();
  return (async () => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'lead.created', lead }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) console.error(`[webhook] lead ${lead.id}: HTTP ${res.status}`);
      await res.body?.cancel();
    } catch (err) {
      console.error(`[webhook] lead ${lead.id}: ${err.name}: ${err.message}`);
    }
  })();
}

module.exports = { notifyLeadCreated };
