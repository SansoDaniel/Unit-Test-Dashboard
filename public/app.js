// Un form inviato blocca i suoi pulsanti finché arriva la pagina successiva: un doppio clic non crea due sessioni o due test.
// I form degli esiti (form.result) li gestisce session.js senza ricaricare la pagina.
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.matches('form.result')) return;
  // form.elements: i pulsanti di questo form, anche quelli fuori collegati con form="…", non quelli di altri form annidati nel markup.
  const buttons = [...form.elements].filter((el) => el.tagName === 'BUTTON' && el.type === 'submit');
  form.setAttribute('aria-busy', 'true');
  // Dopo l'invio, non durante: un pulsante disabilitato subito non manderebbe il proprio valore.
  setTimeout(() => buttons.filter((b) => !b.disabled).forEach((b) => { b.dataset.busy = ''; b.disabled = true; }));
});

// Tornando indietro il browser può mostrare la pagina com'era: i pulsanti bloccati qui tornano attivi.
addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  document.querySelectorAll('form[aria-busy]').forEach((f) => f.removeAttribute('aria-busy'));
  document.querySelectorAll('button[data-busy]').forEach((b) => { b.disabled = false; delete b.dataset.busy; });
});
