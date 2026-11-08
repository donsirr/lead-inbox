'use strict';

// All lead data is rendered with textContent / element properties only, never
// innerHTML, so names, messages and notes can't inject markup (XSS safe).

(function () {
  const TOKEN_KEY = 'leadInboxToken';
  const STATUSES = ['new', 'contacted', 'won', 'lost'];
  const $ = (id) => document.getElementById(id);

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  }
  function setToken(t) {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch { /* storage unavailable: token lives only in memory */ }
    memoryToken = t;
  }
  let memoryToken = getToken();

  // Small DOM builder: el('div', { className: 'x' }, child1, 'text', ...)
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    for (const c of children) {
      if (c == null) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + memoryToken,
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      logout('Your session expired. Please sign in again.');
      throw new Error('unauthorized');
    }
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  }

  function showView(loggedIn) {
    $('login-view').hidden = loggedIn;
    $('app-view').hidden = !loggedIn;
    $('logout').hidden = !loggedIn;
  }

  function logout(message) {
    setToken(null);
    $('leads').replaceChildren();
    $('login-alert').textContent = message || '';
    showView(false);
    $('username').focus();
  }

  // ---- Login ----
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('login-btn');
    $('login-alert').textContent = '';
    btn.disabled = true;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('username').value, password: $('password').value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        $('login-alert').textContent = res.status === 401 ? 'Wrong username or password.' : 'Sign in failed.';
        return;
      }
      setToken(data.token);
      $('password').value = '';
      showView(true);
      loadLeads();
    } catch {
      $('login-alert').textContent = 'Network error. Please try again.';
    } finally {
      btn.disabled = false;
    }
  });

  $('logout').addEventListener('click', () => logout());

  // ---- Leads ----
  $('filter-status').addEventListener('change', loadLeads);
  $('filter-category').addEventListener('change', loadLeads);

  let loadSeq = 0;
  async function loadLeads() {
    const seq = ++loadSeq;
    const params = new URLSearchParams();
    if ($('filter-status').value) params.set('status', $('filter-status').value);
    if ($('filter-category').value) params.set('category', $('filter-category').value);
    $('app-alert').textContent = '';
    try {
      const { leads } = await api('/api/leads' + (params.size ? '?' + params : ''));
      if (seq !== loadSeq) return; // a newer filter change already won
      renderLeads(leads);
      loadStats(params.size ? null : leads);
    } catch (err) {
      if (err.message !== 'unauthorized') $('app-alert').textContent = err.message;
    }
  }

  // Status counts always cover all leads, whatever the filters show.
  // Reuses the list when it is already unfiltered; otherwise fetches it.
  async function loadStats(allLeads) {
    try {
      const leads = allLeads || (await api('/api/leads')).leads;
      for (const s of STATUSES) {
        document.querySelector('[data-stat="' + s + '"]').textContent =
          leads.filter((l) => l.status === s).length;
      }
    } catch { /* counts are a nice-to-have; the list itself reports errors */ }
  }

  function renderLeads(leads) {
    $('count').textContent = leads.length === 1 ? '1 lead' : leads.length + ' leads';
    const list = $('leads');
    if (!leads.length) {
      list.replaceChildren(el('p', { className: 'empty' }, 'No leads match these filters.'));
      return;
    }
    list.replaceChildren(...leads.map(renderCard));
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function renderCard(lead) {
    const id = 'lead-' + lead.id;

    const contact = el('div', { className: 'card-contact' },
      el('a', { href: 'mailto:' + encodeURIComponent(lead.email).replace(/%40/g, '@') }, lead.email),
      lead.phone ? ' · ' : null,
      lead.phone ? el('a', { href: 'tel:' + lead.phone.replace(/[^\d+]/g, '') }, lead.phone) : null
    );

    const statusSelect = el('select', { id: id + '-status' },
      ...STATUSES.map((s) => el('option', { value: s, selected: s === lead.status }, s[0].toUpperCase() + s.slice(1)))
    );
    statusSelect.value = lead.status;
    const note = el('textarea', { id: id + '-note', value: lead.note, maxLength: 5000, placeholder: 'Add a note…' });
    const saveBtn = el('button', { type: 'button', className: 'link-btn' }, 'Save note');
    const saveState = el('span', { className: 'save-state', role: 'status' });

    async function patch(changes, label) {
      saveState.textContent = 'Saving…';
      statusSelect.disabled = saveBtn.disabled = true;
      try {
        const updated = await api('/api/leads/' + lead.id, { method: 'PATCH', body: JSON.stringify(changes) });
        Object.assign(lead, updated);
        saveState.textContent = label + ' saved';
        // Drop the card if it no longer matches the active status filter.
        const f = $('filter-status').value;
        if (f && f !== lead.status) loadLeads();
        else loadStats();
      } catch (err) {
        saveState.textContent = err.message === 'unauthorized' ? '' : 'Error: ' + err.message;
        statusSelect.value = lead.status;
      } finally {
        statusSelect.disabled = saveBtn.disabled = false;
      }
    }

    statusSelect.addEventListener('change', () => patch({ status: statusSelect.value }, 'Status'));
    saveBtn.addEventListener('click', () => patch({ note: note.value }, 'Note'));

    return el('article', { className: 'card' },
      el('div', { className: 'card-head' },
        el('span', { className: 'card-name' }, lead.name),
        el('time', { className: 'card-date', dateTime: lead.created_at }, formatDate(lead.created_at))
      ),
      contact,
      el('div', { className: 'badges' },
        el('span', { className: 'badge' }, lead.service),
        el('span', { className: 'badge' }, lead.category),
        el('span', { className: 'badge urgency-' + lead.urgency }, lead.urgency + ' urgency')
      ),
      el('p', { className: 'card-message' }, lead.message),
      el('div', { className: 'card-controls' },
        el('label', { htmlFor: id + '-status' }, 'Status'),
        statusSelect,
        el('label', { htmlFor: id + '-note' }, 'Note'),
        note,
        el('div', { className: 'note-row' }, saveBtn, saveState)
      )
    );
  }

  // ---- Boot ----
  if (memoryToken) {
    showView(true);
    loadLeads();
  } else {
    showView(false);
  }
})();
