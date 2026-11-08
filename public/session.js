// Esecuzione di una sessione: esiti salvati senza ricaricare la pagina e tasti rapidi.
// Senza questo script i form funzionano lo stesso, con un ricaricamento a ogni salvataggio.
const KEYS = { p: 'PASSED', f: 'NOT PASSED', n: 'NOT TESTED', a: 'NOT AVAILABLE' };
const status = document.getElementById('save-status');
const rows = () => [...document.querySelectorAll('tr.trow')];

function showCounts(c) {
  const tabs = { tutti: c.total, aperti: c['NOT TESTED'] + c['NOT PASSED'], falliti: c['NOT PASSED'], note: c.notes };
  for (const el of document.querySelectorAll('[data-count]')) el.textContent = c[el.dataset.count] ?? tabs[el.dataset.count] ?? el.textContent;
  for (const el of document.querySelectorAll('[data-meter]')) el.style.width = `${c.total ? (100 * c[el.dataset.meter]) / c.total : 0}%`;
}

// Restituisce true solo se il server ha confermato il salvataggio: altrimenti la riga resta com'era.
async function save(form, submitter) {
  status.textContent = 'Salvataggio…';
  try {
    const res = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form, submitter)), headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `errore del server (${res.status})`);
    const row = form.closest('tr');
    for (const b of row.querySelectorAll('button[name="outcome"]')) b.setAttribute('aria-pressed', String(b.value === data.outcome));
    const note = row.querySelector('textarea[name="note"]');
    const preview = row.querySelector('.note-preview');
    if (note && preview) preview.textContent = note.value.trim() ? `Nota: ${note.value.trim()}` : '';
    // "Togli dalla sessione" vale solo per i test ancora vuoti: il server rifiuta gli altri.
    row.querySelector(`button[form="r${form.id.slice(1)}"]`)?.toggleAttribute('hidden', data.outcome !== 'NOT TESTED' || Boolean(note?.value.trim()));
    showCounts(data.counts);
    status.textContent = `Salvato: test ${row.id.slice(2)}`;
    status.classList.remove('error');
    return true;
  } catch (err) {
    status.textContent = `Test ${form.id.slice(1)} non salvato: ${err.message === 'Failed to fetch' ? 'connessione assente' : err.message}. Riprova.`;
    status.classList.add('error');
    return false;
  }
}

// I salvataggi partono uno alla volta, nell'ordine dei tasti: chi scrive veloce non perde né scambia esiti.
let queue = Promise.resolve();
const enqueue = (form, submitter) => (queue = queue.then(() => save(form, submitter)));

document.addEventListener('submit', (e) => {
  if (!e.target.matches('form.result')) return;
  e.preventDefault();
  enqueue(e.target, e.submitter);
});

// Nota e "Problema grafico" si salvano quando si esce dal campo.
document.addEventListener('change', (e) => {
  const field = e.target.closest('textarea[name="note"], input[name="graphic_issue"]');
  if (field) document.getElementById(field.getAttribute('form'))?.requestSubmit();
});

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select')) return;
  const list = rows();
  const row = document.activeElement?.closest?.('tr.trow');
  const i = list.indexOf(row);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    list[e.key === 'ArrowDown' ? Math.min(i + 1, list.length - 1) : Math.max(i - 1, 0)]?.focus();
  } else if (row && KEYS[e.key.toLowerCase()]) {
    e.preventDefault();
    const button = row.querySelector(`button[name="outcome"][value="${KEYS[e.key.toLowerCase()]}"]`);
    if (!button || button.disabled) return;
    list[i + 1]?.focus(); // si passa subito al test successivo: il tasto dopo vale per quello
    enqueue(button.form, button);
  } else if (row && e.key === 'Enter' && e.target === row) {
    e.preventDefault();
    const details = row.querySelector('details');
    details.open = !details.open;
  }
});
