'use strict';

(() => {
  if (!window.api || !window.api.firejail) return;
  const home = document.querySelector('#view-home');
  if (!home) return;

  const card = document.createElement('section');
  card.className = 'card';
  card.style.marginTop = '24px';
  card.innerHTML = `
    <h2 class="card-title">Sandbox an app with Firejail</h2>
    <p class="muted">Choose a Linux program or AppImage, review its access, then launch it in an isolated home directory. Flatpak apps already have their own sandbox.</p>
    <div class="row-cards" style="margin-top:14px;align-items:center">
      <button class="btn" id="fj-pick">Choose an app…</button>
      <span class="muted" id="fj-file">No app selected</span>
      <button class="btn primary" id="fj-analyze" disabled>Analyze</button>
    </div>
    <div id="fj-options" class="hidden">
      <p id="fj-summary" class="muted" style="margin-top:12px"></p>
      <ul class="checks" id="fj-checks"></ul>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="fj-preview">Show command</button>
        <button class="btn primary" id="fj-launch">Start in sandbox</button>
      </div>
      <pre class="log hidden" id="fj-command" style="margin-top:12px"></pre>
    </div>
    <p class="muted" id="fj-status" role="status" aria-live="polite" style="margin-top:12px"></p>`;
  home.appendChild(card);

  const $ = (selector) => card.querySelector(selector);
  const keys = [
    ['network', 'Allow network access', 'Turn off to block network access.'],
    ['sound', 'Allow sound and microphone', ''],
    ['camera', 'Allow camera and video', ''],
    ['downloads', 'Allow Downloads folder', ''],
    ['documents', 'Allow Documents folder', ''],
    ['media', 'Allow Pictures, Music and Videos', ''],
  ];
  let file = null;
  let app = null;
  let installed = false;

  const setStatus = (text) => { $('#fj-status').textContent = text || ''; };
  const readOptions = () => Object.fromEntries(keys.map(([key]) => [key, $(`#fj-${key}`).checked]));

  window.api.firejail.status().then((result) => {
    installed = !!result.installed;
    if (!installed) setStatus('Firejail is not installed. Install it with rpm-ostree and restart before launching sandboxed apps.');
  }).catch((error) => setStatus(error.message || String(error)));

  $('#fj-pick').addEventListener('click', async () => {
    try {
      const selected = await window.api.firejail.pick();
      if (!selected) return;
      file = selected;
      app = null;
      $('#fj-file').textContent = selected.split('/').pop();
      $('#fj-analyze').disabled = false;
      $('#fj-options').classList.add('hidden');
      $('#fj-command').classList.add('hidden');
      setStatus('');
    } catch (error) { setStatus(error.message || String(error)); }
  });

  $('#fj-analyze').addEventListener('click', async () => {
    $('#fj-analyze').disabled = true;
    setStatus('Analyzing…');
    try {
      app = await window.api.firejail.analyze(file);
      $('#fj-summary').textContent = `${app.name} · ${app.kind === 'appimage' ? 'AppImage' : 'Linux program'} · ${Math.round(app.size / 1024)} KB`;
      const host = $('#fj-checks');
      host.replaceChildren();
      for (const [key, label, hint] of keys) {
        const row = document.createElement('li');
        row.className = 'check-row';
        const text = document.createElement('div');
        text.className = 'check-text';
        const title = document.createElement('div');
        title.className = 'check-title';
        title.textContent = label;
        const detail = document.createElement('div');
        detail.className = 'check-desc';
        detail.textContent = hint;
        text.append(title, detail);
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.id = `fj-${key}`;
        check.checked = !!app.options[key];
        check.setAttribute('aria-label', label);
        row.append(text, check);
        host.appendChild(row);
      }
      $('#fj-options').classList.remove('hidden');
      setStatus(installed ? 'Review the permissions before starting the app.' : 'Firejail is not installed; install it and restart before launching.');
    } catch (error) {
      $('#fj-options').classList.add('hidden');
      setStatus(error.message || String(error));
    } finally { $('#fj-analyze').disabled = false; }
  });

  $('#fj-preview').addEventListener('click', async () => {
    try {
      const result = await window.api.firejail.preview(file, readOptions());
      $('#fj-command').textContent = result.command;
      $('#fj-command').classList.toggle('hidden');
      setStatus('Review the exact command Firejail will receive.');
    } catch (error) { setStatus(error.message || String(error)); }
  });

  $('#fj-launch').addEventListener('click', async () => {
    if (!installed) { setStatus('Firejail is not installed. Install it with rpm-ostree and restart first.'); return; }
    if (!window.confirm(`Start ${app.name} in a Firejail sandbox?`)) return;
    $('#fj-launch').disabled = true;
    setStatus('Starting sandbox…');
    try {
      const result = await window.api.firejail.launch(file, readOptions());
      setStatus(result.message);
    } catch (error) { setStatus(error.message || String(error)); }
    finally { $('#fj-launch').disabled = false; }
  });
})();
