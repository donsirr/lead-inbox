'use strict';

(function () {
  const form = document.getElementById('lead-form');
  const alertBox = document.getElementById('alert');
  const submitBtn = document.getElementById('submit');
  const FIELDS = ['name', 'email', 'phone', 'service', 'message'];
  const SERVICES = ['cleaning', 'repair', 'consultation', 'other'];
  const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
  const len = (s) => [...s].length;

  // Mirrors the server rules; the server is still the source of truth.
  function validate(v) {
    const errors = {};
    if (!v.name.trim()) errors.name = 'Please enter your name.';
    else if (len(v.name) > 100) errors.name = 'Name must be at most 100 characters.';
    if (!v.email.trim()) errors.email = 'Please enter your email.';
    else if (!EMAIL_RE.test(v.email)) errors.email = 'Please enter a valid email address.';
    if (len(v.phone) > 50) errors.phone = 'Phone must be at most 50 characters.';
    if (!SERVICES.includes(v.service)) errors.service = 'Please choose a service.';
    if (!v.message.trim()) errors.message = 'Please enter a message.';
    else if (len(v.message) > 2000) errors.message = 'Message must be at most 2000 characters.';
    return errors;
  }

  function showErrors(errors) {
    for (const f of FIELDS) {
      const input = document.getElementById(f);
      document.getElementById(f + '-error').textContent = errors[f] || '';
      if (errors[f]) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    const first = FIELDS.find((f) => errors[f]);
    if (first) document.getElementById(first).focus();
  }

  function setAlert(kind, text) {
    alertBox.className = 'alert ' + kind;
    alertBox.textContent = text;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setAlert('', '');
    const values = {};
    for (const f of FIELDS) values[f] = form.elements[f].value;

    const errors = validate(values);
    showErrors(errors);
    if (Object.keys(errors).length) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        form.reset();
        setAlert('success', "Thanks! Your request was sent. We'll be in touch soon.");
      } else {
        setAlert('error', data.error ? 'Could not send: ' + data.error : 'Something went wrong. Please try again.');
      }
    } catch {
      setAlert('error', 'Network error. Please check your connection and try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send request';
      alertBox.scrollIntoView({ block: 'nearest' });
    }
  });
})();
