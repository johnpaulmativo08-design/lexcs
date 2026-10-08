// Checkout field checks (the same rules the database enforces, phase 43). Each field shows its requirement
// underneath; it turns green with a ✓ once met, and red with the problem after the customer leaves the field
// or tries to place the order. LexcCheckoutChecks.firstProblem() is used before the order is placed.
(function () {
  const phoneDigits = (value) => {
    let d = String(value || '').replace(/\D/g, '');
    if (/^639\d{9}$/.test(d)) d = '0' + d.slice(2);
    return d;
  };
  const prettyPhone = (d) => (/^09\d{9}$/.test(d) ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : null);
  const delivery = () => !document.getElementById('coAddressGroup')?.hidden;

  const RULES = {
    coName: {
      need: 'Your full name, at least 2 letters.',
      check(v) {
        const t = v.trim().replace(/\s+/g, ' ');
        if (!t) return 'Enter your full name.';
        if ((t.match(/\p{L}/gu) || []).length < 2) return 'Use at least 2 letters, like Maria Santos.';
        if (t.length > 150) return 'Keep the name under 150 characters.';
        return null;
      },
      ok: 'Name looks good.'
    },
    coContact: {
      need: 'Philippine mobile number: 11 digits starting with 09.',
      check(v) {
        const d = phoneDigits(v);
        if (!d) return 'Enter your mobile number, like 0917 123 4567.';
        if (!d.startsWith('09')) return 'Mobile numbers start with 09 (or +63 9).';
        if (d.length < 11) return `${11 - d.length} more digit${11 - d.length === 1 ? '' : 's'} needed (11 in total).`;
        if (d.length > 11) return 'That is more than 11 digits.';
        return null;
      },
      ok: 'We’ll text or call this number about your order.',
      tidy: (v) => prettyPhone(phoneDigits(v)) || v
    },
    coAddress: {
      need: 'House/unit, street, barangay and city (at least 10 characters).',
      when: delivery,
      check(v) {
        const t = v.trim();
        if (!t) return 'Enter the delivery address.';
        if (t.length < 10) return 'Add more detail: house/unit, street, barangay and city.';
        return null;
      },
      ok: 'Address added. You pay the Lalamove rider directly.'
    },
    coNotes: {
      need: 'Optional · up to 1,000 characters.',
      check(v) { return v.length > 1000 ? `Too long by ${v.length - 1000} characters.` : null; },
      ok: null,
      count: 1000
    }
  };

  const touched = new Set();
  function hintFor(id) {
    const input = document.getElementById(id); if (!input) return null;
    let hint = document.getElementById(id + 'Hint');
    if (!hint) {
      hint = document.createElement('p'); hint.id = id + 'Hint'; hint.className = 'co-hint'; hint.setAttribute('aria-live', 'polite');
      input.insertAdjacentElement('afterend', hint);
      input.setAttribute('aria-describedby', hint.id);
    }
    return hint;
  }
  function show(id) {
    const rule = RULES[id], input = document.getElementById(id), hint = hintFor(id);
    if (!rule || !input || !hint) return null;
    const active = !rule.when || rule.when();
    const problem = active ? rule.check(input.value) : null;
    const value = input.value.trim();
    let state = 'need', text = rule.need;
    if (problem && touched.has(id)) { state = 'bad'; text = problem; }
    else if (!problem && value && rule.ok) { state = 'good'; text = rule.ok; }
    else if (!problem && rule.count && value) { text = `${input.value.length} / ${rule.count} characters`; }
    hint.className = 'co-hint is-' + state;
    hint.innerHTML = (state === 'good' ? '<span aria-hidden="true">✓</span> ' : state === 'bad' ? '<span aria-hidden="true">!</span> ' : '') + escapeText(text);
    input.classList.toggle('is-invalid', state === 'bad');
    input.classList.toggle('is-valid', state === 'good');
    input.setAttribute('aria-invalid', state === 'bad' ? 'true' : 'false');
    return problem;
  }
  const escapeText = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function wire() {
    for (const id of Object.keys(RULES)) {
      const input = document.getElementById(id); if (!input || input.dataset.checked) continue;
      input.dataset.checked = '1';
      if (id === 'coContact') { input.setAttribute('inputmode', 'tel'); input.setAttribute('autocomplete', 'tel'); input.placeholder = '0917 123 4567'; }
      if (id === 'coName') input.setAttribute('autocomplete', 'name');
      input.addEventListener('input', () => show(id));
      input.addEventListener('blur', () => {
        if (input.value.trim()) touched.add(id);
        if (RULES[id].tidy && !RULES[id].check(input.value)) input.value = RULES[id].tidy(input.value);
        show(id);
      });
      show(id);
    }
  }

  window.LexcCheckoutChecks = {
    wire,
    refresh() { Object.keys(RULES).forEach(show); },
    // Marks every field as checked and returns the first problem (or null); the phone is tidied when valid.
    firstProblem() {
      wire();
      let first = null;
      for (const id of Object.keys(RULES)) {
        touched.add(id);
        const problem = show(id);
        if (problem && !first) first = { id, message: problem };
      }
      const phone = document.getElementById('coContact');
      if (phone && !RULES.coContact.check(phone.value)) phone.value = RULES.coContact.tidy(phone.value);
      return first;
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
