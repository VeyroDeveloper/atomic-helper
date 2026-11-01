'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ------------------------------------------------------------------ */
/* icons                                                               */
/* ------------------------------------------------------------------ */

const ICONS = {
  atom: '<circle cx="12" cy="12" r="1.7" fill="currentColor"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>',
  apps: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  broom: '<path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7"/><path d="M10 11v6M14 11v6"/>',
  undo: '<path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/>',
  store: '<path d="M4 8l1.5-4h13L20 8"/><path d="M4 8v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8"/><path d="M4 8h16"/><path d="M12 12v5M9.5 14.5h5"/>',
  power: '<path d="M12 3v9"/><path d="M17.7 6.3a8 8 0 1 1-11.4 0"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.5 9.5"/>',
  alert: '<path d="M12 3.5L2.8 19.5h18.4L12 3.5z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  disk: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 16v4M17 18h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
};

function icon(name) {
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

const state = {
  status: null,
  busy: false,
  setup: null,
  lastCheck: null, // { result: 'available' | 'none', at: ISO string, version: string|null }
};

try {
  const saved = JSON.parse(localStorage.getItem('lastCheck') || 'null');
  if (saved && saved.result) state.lastCheck = saved;
} catch (_) { /* storage may be unavailable */ }

function saveLastCheck() {
  try { localStorage.setItem('lastCheck', JSON.stringify(state.lastCheck)); } catch (_) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* quick-action tiles                                                  */
/* ------------------------------------------------------------------ */

const TILES = [
  { action: 'update-system', icon: 'download', title: 'Update system', desc: 'Download the newest Fedora version. It starts after your next restart.' },
  { action: 'update-apps', icon: 'apps', title: 'Update apps', desc: 'Bring all your Flatpak apps to their newest versions.' },
  { action: 'firmware-check', icon: 'chip', title: 'Check firmware', desc: 'Look for BIOS and device firmware updates.' },
  { action: 'cleanup', icon: 'broom', title: 'Clean up', desc: 'Clear caches and unused app runtimes to free up space.' },
  {
    action: 'rollback', icon: 'undo', title: 'Roll back', desc: 'Return to the previous system version if something broke.',
    confirm: { title: 'Go back to the previous version?', body: 'Your next restart will start the previous system version. Your files and apps are not affected.', ok: 'Roll back' },
  },
  { action: 'add-flathub', icon: 'store', title: 'Enable Flathub', desc: 'Add the biggest source of Flatpak apps.' },
  {
    action: 'reboot', icon: 'power', title: 'Restart', desc: 'Restart now to apply pending changes.',
    confirm: { title: 'Restart your computer now?', body: 'Save your work first. Open apps will be closed.', ok: 'Restart' },
  },
];

const CONFIRMS = Object.fromEntries(TILES.filter((t) => t.confirm).map((t) => [t.action, t.confirm]));

function buildTiles() {
  const host = $('#tiles');
  host.innerHTML = '';
  for (const t of TILES) {
    const b = document.createElement('button');
    b.className = 'tile';
    b.dataset.action = t.action;
    b.innerHTML = `<span class="tile-icon">${icon(t.icon)}</span><span><div class="tile-title">${t.title}</div><div class="tile-desc">${t.desc}</div></span>`;
    b.addEventListener('click', () => perform(t.action));
    host.appendChild(b);
  }
}

/* ------------------------------------------------------------------ */
/* confirm dialog                                                      */
/* ------------------------------------------------------------------ */

function confirmDialog({ title, body, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    $('#dialog-title').textContent = title;
    $('#dialog-body').textContent = body;
    const okBtn = $('#dialog-ok');
    const cancelBtn = $('#dialog-cancel');
    okBtn.textContent = ok;
    okBtn.classList.toggle('danger', danger);
    $('#dialog').classList.remove('hidden');
    cancelBtn.focus();

    const close = (v) => {
      $('#dialog').classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onOk = () => close(true);
    const onCancel = () => close(false);
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

/* ------------------------------------------------------------------ */
/* activity sheet                                                      */
/* ------------------------------------------------------------------ */

const log = { lines: [''], carriage: false };

function resetLog() {
  log.lines = [''];
  log.carriage = false;
  $('#log').textContent = '';
}

// Minimal terminal behaviour: "\n" starts a new line, "\r" rewrites the current one.
function appendLog(text) {
  for (const ch of text) {
    if (ch === '\n') { log.lines.push(''); log.carriage = false; }
    else if (ch === '\r') { log.carriage = true; }
    else {
      if (log.carriage) { log.lines[log.lines.length - 1] = ''; log.carriage = false; }
      log.lines[log.lines.length - 1] += ch;
    }
  }
  if (log.lines.length > 600) log.lines = log.lines.slice(-400);
  const el = $('#log');
  el.textContent = log.lines.join('\n');
  el.scrollTop = el.scrollHeight;

  const pct = [...text.matchAll(/(\d{1,3})%/g)].map((m) => Number(m[1])).filter((n) => n <= 100).pop();
  if (pct !== undefined) {
    const bar = $('#sheet-bar');
    bar.classList.remove('indeterminate');
    bar.style.width = `${pct}%`;
  }
}

function setSheetIcon(kind, name) {
  const el = $('#sheet-icon');
  el.className = `sheet-icon ${kind}`;
  el.innerHTML = icon(name);
}

let sheetLive = false;

function openSheet(title) {
  sheetLive = true;
  resetLog();
  setSheetIcon('spin', 'refresh');
  $('#sheet-title').textContent = title;
  $('#sheet-sub').textContent = 'This can take a few minutes. You can keep using your computer.';
  const bar = $('#sheet-bar');
  bar.className = 'bar indeterminate';
  bar.style.width = '';
  $('#log').classList.add('hidden');
  $('#btn-toggle-log').textContent = 'Show details';
  $('#btn-cancel').classList.remove('hidden');
  $('#btn-cancel').disabled = false;
  $('#btn-close').classList.add('hidden');
  $('#btn-sheet-restart').classList.add('hidden');
  $('#sheet').classList.remove('hidden');
}

function finishSheet(res) {
  const bar = $('#sheet-bar');
  bar.classList.remove('indeterminate');
  bar.style.width = '';
  bar.classList.add(res.ok ? 'done' : res.tone === 'info' ? 'done' : 'failed');
  if (res.ok) setSheetIcon('good', 'check');
  else if (res.tone === 'info') setSheetIcon('info', 'info');
  else setSheetIcon('bad', 'alert');
  $('#sheet-title').textContent = res.headline;
  $('#sheet-sub').textContent = res.detail || '';
  $('#btn-cancel').classList.add('hidden');
  $('#btn-close').classList.remove('hidden');
  $('#btn-close').focus();
  if (!res.ok && res.tone === 'error') {
    $('#log').classList.remove('hidden');
    $('#btn-toggle-log').textContent = 'Hide details';
  }
}

/* ------------------------------------------------------------------ */
/* running actions                                                     */
/* ------------------------------------------------------------------ */

async function perform(action, arg) {
  if (state.busy) return;

  const c = CONFIRMS[action];
  if (c) {
    const ok = await confirmDialog({ ...c, danger: action === 'rollback' });
    if (!ok) return;
  }
  if (action === 'firmware-install') {
    const ok = await confirmDialog({
      title: 'Install firmware updates?',
      body: 'Firmware updates change low-level device software. Keep your computer plugged in and do not turn it off while this runs.',
      ok: 'Install',
    });
    if (!ok) return;
  }

  state.busy = true;
  openSheet('Working…');
  let res;
  try {
    res = await window.api.run(action, arg);
  } catch (e) {
    res = { ok: false, tone: 'error', headline: 'Something went wrong', detail: String(e && e.message ? e.message : e) };
  }
  state.busy = false;
  sheetLive = false; // late progress events from the main process are ignored from here on
  if (res.log) { resetLog(); appendLog(res.log); }

  if (action === 'check' && res.updates) {
    const v = (res.detail.match(/Version (\S+)/) || [])[1] || null;
    state.lastCheck = { result: res.updates, at: new Date().toISOString(), version: v, booted: bootedVersion() };
    saveLastCheck();
  } else if (res.ok && res.updates === 'none' && action !== 'check') {
    state.lastCheck = { result: 'none', at: new Date().toISOString(), version: null, booted: bootedVersion() };
    saveLastCheck();
  }

  finishSheet(res);

  // The sheet offers a restart shortcut whenever a restart is now needed.
  await refreshStatus();
  if (res.ok && state.status && state.status.pendingReboot && action !== 'reboot') {
    $('#btn-sheet-restart').classList.remove('hidden');
  }
  if (action === 'firmware-check' && res.firmware === 'available') {
    offerFirmwareInstall();
  }
  if ($('#view-packages').classList.contains('active')) renderPackages();
  if ($('#view-setup').classList.contains('active') || $('#view-security').classList.contains('active')) refreshSetup();
}

function offerFirmwareInstall() {
  const actions = $('.sheet-actions', $('#sheet'));
  if ($('#btn-fw-install')) return;
  const b = document.createElement('button');
  b.className = 'btn';
  b.id = 'btn-fw-install';
  b.textContent = 'Install firmware updates';
  b.addEventListener('click', async () => {
    b.remove();
    $('#sheet').classList.add('hidden');
    await perform('firmware-install');
  });
  actions.insertBefore(b, $('#btn-close'));
}

function bootedVersion() {
  return state.status && state.status.booted ? state.status.booted.version : null;
}

/* ------------------------------------------------------------------ */
/* status rendering                                                    */
/* ------------------------------------------------------------------ */

function fmtBytes(n) {
  if (n == null) return '–';
  const gb = n / 1e9;
  return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
}

function setHero(kind, iconName, title, sub) {
  const el = $('#hero-icon');
  el.className = `hero-icon ${kind}`;
  el.innerHTML = icon(iconName);
  $('#hero-title').textContent = title;
  $('#hero-sub').textContent = sub;
}

async function refreshStatus() {
  let s;
  try { s = await window.api.status(); } catch (_) { s = null; }
  state.status = s;
  renderStatus();
}

function renderStatus() {
  const s = state.status;
  if (!s) {
    setHero('bad', 'alert', "Couldn't read system information", 'Try reopening the app.');
    return;
  }

  // a check from before the last restart is stale
  if (state.lastCheck && state.lastCheck.booted && s.booted && state.lastCheck.booted !== s.booted.version) {
    state.lastCheck = null;
    saveLastCheck();
  }

  // hero
  if (!s.atomic) {
    setHero('warn', 'info', "This doesn't look like an Atomic system", 'Atomic Helper is made for Fedora Silverblue, Kinoite and other Atomic desktops. Some buttons will not work here.');
  } else if (s.pendingReboot) {
    setHero('warn', 'power', 'Restart to finish', s.pendingVersion ? `Version ${s.pendingVersion} is ready. It starts on your next restart.` : 'Your changes are ready. They start on your next restart.');
  } else if (state.lastCheck && state.lastCheck.result === 'available') {
    setHero('warn', 'download', 'An update is available', 'Click "Update everything" to download it. You decide when to restart.');
  } else if (state.lastCheck && state.lastCheck.result === 'none') {
    setHero('good', 'check', "You're up to date", `Last checked at ${fmtTime(state.lastCheck.at)}.`);
  } else {
    setHero('', 'atom', 'Ready when you are', 'Update everything with one click, or check first to see what is waiting.');
  }

  const meta = [];
  if (s.booted && s.booted.version) meta.push(`Running version ${s.booted.version}`);
  if (s.layered.length) meta.push(`${s.layered.length} added package${s.layered.length === 1 ? '' : 's'}`);
  $('#hero-meta').textContent = meta.join(' · ');

  $('#btn-update-all').innerHTML = `${icon('refresh')}<span>Update everything</span>`;
  $('#btn-check').innerHTML = `${icon('info')}<span>Check for updates</span>`;

  // banner
  const banner = $('#banner-restart');
  banner.classList.toggle('hidden', !s.pendingReboot);
  $('#banner-icon').innerHTML = icon('power');

  // mini cards
  $('#mini-sys-icon').innerHTML = icon('desktop');
  $('#mini-sys-main').textContent = s.pretty;
  $('#mini-sys-sub').textContent = `Linux ${s.kernel}`;
  $('#mini-disk-icon').innerHTML = icon('disk');
  if (s.freeBytes != null && s.totalBytes) {
    $('#mini-disk-main').textContent = `${fmtBytes(s.freeBytes)} free of ${fmtBytes(s.totalBytes)}`;
    const usedPct = Math.round(((s.totalBytes - s.freeBytes) / s.totalBytes) * 100);
    const fill = $('#meter-fill');
    fill.style.width = `${usedPct}%`;
    fill.classList.toggle('low', usedPct >= 80 && usedPct < 92);
    fill.classList.toggle('crit', usedPct >= 92);
  } else {
    $('#mini-disk-main').textContent = '–';
  }

  // tile availability
  for (const t of $$('.tile')) {
    if (t.dataset.action === 'rollback') {
      t.disabled = !(s.atomic && s.rollbackAvailable);
      t.title = t.disabled ? 'There is no previous version to go back to yet.' : '';
    }
  }
}

/* ------------------------------------------------------------------ */
/* packages view                                                       */
/* ------------------------------------------------------------------ */

const PKG_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,100}$/;

function listItem(name, sub, onRemove) {
  const li = document.createElement('li');
  const n = document.createElement('span');
  n.className = 'name';
  n.textContent = name;
  if (sub) {
    const s = document.createElement('span');
    s.className = 'sub';
    s.textContent = sub;
    n.appendChild(s);
  }
  const b = document.createElement('button');
  b.className = 'btn small';
  b.textContent = 'Remove';
  b.addEventListener('click', onRemove);
  li.append(n, b);
  return li;
}

async function renderPackages() {
  const s = state.status;
  const pkgList = $('#pkg-list');
  pkgList.innerHTML = '';
  if (s && s.layered.length) {
    for (const p of s.layered) {
      pkgList.appendChild(listItem(p, '', async () => {
        const ok = await confirmDialog({ title: `Remove ${p}?`, body: 'It will be removed from your system after the next restart.', ok: 'Remove', danger: true });
        if (ok) perform('remove-pkg', p);
      }));
    }
  }
  const pkgHost = $('#pkg-list');
  const existingEmpty = $('#pkg-empty');
  if (existingEmpty) existingEmpty.remove();
  if (!s || !s.layered.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.id = 'pkg-empty';
    e.textContent = 'No extra system packages. Your system is exactly as shipped.';
    pkgHost.after(e);
  }

  $('#btn-pkg-add').innerHTML = `${icon('plus')}<span>Add</span>`;

  const fpList = $('#flatpak-list');
  fpList.innerHTML = '';
  const oldEmpty = $('#fp-empty');
  if (oldEmpty) oldEmpty.remove();
  let fp;
  try { fp = await window.api.flatpaks(); } catch (_) { fp = { installed: false, apps: [] }; }
  if (!fp.installed) {
    $('#flatpak-note').textContent = 'Flatpak was not found on this system.';
    return;
  }
  $('#flatpak-note').textContent = fp.apps.length
    ? `${fp.apps.length} app${fp.apps.length === 1 ? '' : 's'} installed from Flathub or Fedora Flatpaks.`
    : 'No Flatpak apps installed yet.';
  for (const a of fp.apps) {
    fpList.appendChild(listItem(a.name, a.id, async () => {
      const ok = await confirmDialog({ title: `Remove ${a.name}?`, body: 'The app is uninstalled. Its documents are not deleted.', ok: 'Remove', danger: true });
      if (ok) perform('remove-flatpak', a.id);
    }));
  }
}


/* ------------------------------------------------------------------ */
/* post-install + security views                                       */
/* ------------------------------------------------------------------ */

// st(setup) -> 'done' | 'todo' | 'restart' | 'blocked' | 'info-good' | 'info-warn'
const SETUP_ITEMS = [
  { id: 'flathub', icon: 'store', title: 'Enable Flathub', action: 'add-flathub', desc: 'The biggest source of apps. Most software should come from here.', st: (x) => (x.flathub ? 'done' : 'todo') },
  { id: 'flatseal', icon: 'lock', title: 'Install Flatseal', action: 'install-flatseal', desc: 'Lets you see and change what each Flatpak app may access.', st: (x) => (x.flatseal ? 'done' : x.flathub ? 'todo' : 'blocked'), note: 'Enable Flathub first' },
  { id: 'rpmfusion', icon: 'plus', title: 'Add RPM Fusion', action: 'setup-rpmfusion', desc: 'Extra software source for things Fedora cannot ship itself. Needs a restart.', st: (x) => x.rpmfusion },
  { id: 'codecs', icon: 'sparkle', title: 'Multimedia codecs', action: 'setup-codecs', desc: 'Full video and audio support (H.264, AAC and more). Needs a restart.', st: (x) => x.codecs, note: 'Add RPM Fusion and restart first' },
  { id: 'autoupdate', icon: 'refresh', title: 'Automatic updates', action: 'setup-autoupdate', desc: 'Download new system versions in the background. They start after you restart.', st: (x) => (x.autoupdate ? 'done' : 'todo') },
];

const AUTOUPDATE_ITEM = SETUP_ITEMS.find((i) => i.id === 'autoupdate');

const SECURITY_ITEMS = [
  { id: 'firewall', icon: 'shield', title: 'Firewall', action: 'firewall-on', btn: 'Turn on', desc: 'Blocks unwanted incoming connections from the network.', st: (x) => (x.firewall.active ? 'done' : 'todo') },
  {
    id: 'strict', icon: 'lock', title: 'Stricter firewall', action: 'firewall-strict', btn: 'Tighten',
    desc: 'Fedora Workstation opens most high ports by default. The stricter "public" zone only allows what you choose.',
    st: (x) => (!x.firewall.active ? 'blocked' : ['public', 'drop', 'block'].includes(x.firewall.zone) ? 'done' : 'todo'),
    note: 'Turn on the firewall first',
    confirm: { title: 'Switch to the stricter firewall?', body: 'Some local sharing features, like KDE Connect, file sharing or casting, may stop working until you allow them again.', ok: 'Tighten' },
  },
  AUTOUPDATE_ITEM,
  { id: 'selinux', icon: 'check', title: 'SELinux', desc: 'Keeps apps and services inside their own boundaries.', st: (x) => (x.selinux === 'enforcing' ? 'info-good' : 'info-warn'), label: (x) => (x.selinux === 'enforcing' ? 'Enforcing' : x.selinux) },
];

const DNS_CHOICES = [
  { id: 'auto', title: 'Automatic', desc: 'Use the DNS from your router or network (default).' },
  { id: 'cloudflare', title: 'Cloudflare', desc: 'Fast and privacy-focused (1.1.1.1).' },
  { id: 'google', title: 'Google', desc: 'Fast and widely used (8.8.8.8).' },
  { id: 'quad9', title: 'Quad9', desc: 'Blocks known malicious sites (9.9.9.9).' },
  { id: 'adguard', title: 'AdGuard', desc: 'Blocks ads and trackers (94.140.14.14).' },
];

function checkRow(item, setup) {
  const st = item.st(setup);
  const li = document.createElement('li');
  li.className = `check-row ${st === 'done' || st === 'info-good' ? 'done' : st === 'restart' || st === 'info-warn' ? 'restart' : ''}`;
  const ic = document.createElement('span');
  ic.className = 'check-icon';
  ic.innerHTML = icon(st === 'done' || st === 'info-good' ? 'check' : item.icon);
  const text = document.createElement('div');
  text.className = 'check-text';
  const t = document.createElement('div');
  t.className = 'check-title';
  t.textContent = item.title;
  const d = document.createElement('div');
  d.className = 'check-desc';
  d.textContent = item.desc;
  text.append(t, d);
  li.append(ic, text);

  const pill = (txt, kind) => {
    const p = document.createElement('span');
    p.className = `pill ${kind}`;
    p.textContent = txt;
    li.appendChild(p);
  };
  if (st === 'done') pill('Done', 'good');
  else if (st === 'restart') pill('Restart to finish', 'warn');
  else if (st === 'blocked') pill(item.note || 'Not available yet', '');
  else if (st === 'info-good') pill(item.label(setup), 'good');
  else if (st === 'info-warn') pill(item.label(setup), 'warn');
  else {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = item.btn || 'Set up';
    b.addEventListener('click', async () => {
      if (item.confirm && !(await confirmDialog(item.confirm))) return;
      perform(item.action);
    });
    li.appendChild(b);
  }
  return li;
}

async function refreshSetup() {
  try { state.setup = await window.api.setupStatus(); } catch (_) { state.setup = null; }
  renderSetup();
  renderSecurity();
}

function renderSetup() {
  const x = state.setup;
  const host = $('#setup-list');
  host.innerHTML = '';
  $('#btn-setup-all').innerHTML = `${icon('sparkle')}<span>Set up everything</span>`;
  if (!x) {
    $('#btn-setup-all').disabled = true;
    return;
  }
  for (const item of SETUP_ITEMS) host.appendChild(checkRow(item, x));

  const states = SETUP_ITEMS.map((i) => i.st(x));
  const done = states.filter((v) => v === 'done').length;
  const todo = states.filter((v) => v === 'todo').length;
  const waiting = states.some((v) => v === 'restart');
  const blocked = states.some((v) => v === 'blocked');
  const allDone = done === SETUP_ITEMS.length;

  const hero = $('#setup-hero-icon');
  hero.className = `hero-icon ${allDone ? 'good' : waiting ? 'warn' : ''}`;
  hero.innerHTML = icon(allDone ? 'check' : waiting ? 'power' : 'sparkle');
  $('#setup-title').textContent = allDone ? 'All set' : waiting && !todo ? 'Restart to continue' : 'Post-install setup';
  $('#setup-sub').textContent = allDone
    ? 'Everything recommended is already done.'
    : waiting && !todo
      ? 'Restart your computer, then come back to finish the remaining steps.'
      : `${done} of ${SETUP_ITEMS.length} done. One click sets up the rest${blocked ? '; the codecs follow after a restart' : ''}.`;
  $('#btn-setup-all').disabled = todo === 0;
}

function renderSecurity() {
  const x = state.setup;
  const host = $('#security-list');
  host.innerHTML = '';
  const tiles = $('#dns-tiles');
  tiles.innerHTML = '';
  if (!x) return;
  for (const item of SECURITY_ITEMS) host.appendChild(checkRow(item, x));

  const cur = x.dns.current;
  const noConn = x.dns.connections.length === 0;
  const labels = { none: 'No active Wi-Fi or Ethernet connection found.', mixed: 'Your connections use different DNS servers.', custom: 'Using custom DNS servers.' };
  const choice = DNS_CHOICES.find((c) => c.id === cur);
  $('#dns-note').textContent = choice
    ? `Currently: ${choice.title}. DNS turns website names into addresses, so pick a provider you trust.`
    : `${labels[cur] || ''} DNS turns website names into addresses, so pick a provider you trust.`.trim();

  for (const c of DNS_CHOICES) {
    const b = document.createElement('button');
    b.className = `tile${cur === c.id ? ' selected' : ''}`;
    b.disabled = noConn;
    b.innerHTML = `<span class="tile-icon">${icon(c.id === 'auto' ? 'refresh' : 'globe')}</span><span><div class="tile-title"></div><div class="tile-desc"></div></span>`;
    $('.tile-title', b).textContent = c.title;
    $('.tile-desc', b).textContent = c.desc;
    b.addEventListener('click', async () => {
      if (cur === c.id) return;
      const ok = await confirmDialog({
        title: c.id === 'auto' ? 'Use the network’s DNS again?' : `Switch DNS to ${c.title}?`,
        body: 'This applies to your active Wi-Fi and Ethernet connections. Your connection may drop for a second.',
        ok: 'Switch',
      });
      if (ok) perform(c.id === 'auto' ? 'dns-reset' : 'dns-set', c.id);
    });
    tiles.appendChild(b);
  }
}

function wireSetup() {
  $('#btn-setup-all').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Set up everything?',
      body: 'This enables Flathub, adds Flatseal, turns on automatic updates and adds RPM Fusion. You may be asked for your password a few times. System changes finish after a restart; the codecs can be added once RPM Fusion is active.',
      ok: 'Set up',
    });
    if (ok) perform('postinstall-all');
  });

  $('#dns-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#dns-error');
    const list = $('#dns-input').value.split(/[\s,]+/).filter(Boolean);
    const v4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const v6 = /^[0-9a-fA-F:]+$/;
    if (!list.length || list.length > 4 || !list.every((a) => (v4.test(a) && a.split('.').every((n) => Number(n) <= 255)) || (a.includes(':') && v6.test(a)))) {
      err.textContent = 'Enter up to 4 valid IP addresses, like 1.1.1.1, 9.9.9.9';
      err.classList.remove('hidden');
      return;
    }
    err.classList.add('hidden');
    const ok = await confirmDialog({ title: 'Use these DNS servers?', body: `${list.join(', ')} will be used on your active Wi-Fi and Ethernet connections.`, ok: 'Use them' });
    if (!ok) return;
    $('#dns-input').value = '';
    perform('dns-set', `custom:${list.join(',')}`);
  });
}


/* ------------------------------------------------------------------ */
/* app updates                                                         */
/* ------------------------------------------------------------------ */

const appUpdate = { info: null, dismissed: false };

async function checkAppUpdate(manual) {
  const note = $('#about-update');
  if (manual) { note.textContent = 'Checking…'; $('#btn-check-app-update').disabled = true; }
  let r;
  try { r = await window.api.appUpdateCheck(); } catch (_) { r = { status: 'unavailable' }; }
  appUpdate.info = r;
  $('#btn-check-app-update').disabled = false;

  if (r.status === 'available') {
    note.textContent = `Version ${r.latest} is available.`;
    if (!appUpdate.dismissed || manual) {
      appUpdate.dismissed = false;
      $('#banner-update-title').textContent = `Update available: version ${r.latest}`;
      $('#banner-update-sub').textContent = r.canInstall ? 'Install it now. The app restarts by itself.' : 'Open the download page to get the new version.';
      $('#btn-update-app').textContent = r.canInstall ? 'Update app' : 'Open download page';
      $('#banner-update').classList.remove('hidden');
    }
  } else if (r.status === 'current') {
    note.textContent = 'You have the newest version.';
  } else {
    note.textContent = manual ? "Couldn't check for updates right now. Try again later." : '';
  }
}

function wireAppUpdate() {
  $('#banner-update-icon').innerHTML = icon('download');
  window.api.appInfo().then((i) => { $('#about-version').textContent = `Atomic Helper ${i.version}`; }).catch(() => {});

  $('#btn-check-app-update').addEventListener('click', () => checkAppUpdate(true));
  $('#btn-update-later').addEventListener('click', () => {
    appUpdate.dismissed = true;
    $('#banner-update').classList.add('hidden');
  });
  $('#btn-update-app').addEventListener('click', async () => {
    const btn = $('#btn-update-app');
    const sub = $('#banner-update-sub');
    btn.disabled = true;
    $('#btn-update-later').disabled = true;
    sub.textContent = 'Downloading…';
    const off = window.api.onUpdateProgress((pct) => { if (pct != null) sub.textContent = `Downloading… ${pct}%`; });
    let r;
    try { r = await window.api.appUpdateInstall(); } catch (e) { r = { ok: false, message: String(e && e.message ? e.message : e) }; }
    off();
    if (r.ok && r.restarting) { sub.textContent = 'Installed. Restarting…'; return; }
    btn.disabled = false;
    $('#btn-update-later').disabled = false;
    sub.textContent = r.ok ? 'The download page was opened in your browser.' : `Update failed: ${r.message}`;
  });

  setTimeout(() => checkAppUpdate(false), 2500);
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */

function showView(name) {
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.view === name);
  for (const v of $$('.view')) v.classList.toggle('active', v.id === `view-${name}`);
  if (name === 'packages') renderPackages();
  if (name === 'setup' || name === 'security') refreshSetup();
  $('main').scrollTop = 0;
}

function init() {
  $('#brand-logo').innerHTML = icon('atom');
  buildTiles();
  $('#btn-update-all').innerHTML = `${icon('refresh')}<span>Update everything</span>`;
  $('#btn-check').innerHTML = `${icon('info')}<span>Check for updates</span>`;
  $('#btn-pkg-add').innerHTML = `${icon('plus')}<span>Add</span>`;

  for (const t of $$('.tab')) t.addEventListener('click', () => showView(t.dataset.view));
  $('#btn-update-all').addEventListener('click', () => perform('update-all'));
  $('#btn-check').addEventListener('click', () => perform('check'));
  $('#btn-banner-restart').addEventListener('click', () => perform('reboot'));
  $('#btn-sheet-restart').addEventListener('click', () => { $('#sheet').classList.add('hidden'); perform('reboot'); });

  $('#btn-cancel').addEventListener('click', () => { $('#btn-cancel').disabled = true; window.api.cancel(); });
  $('#btn-close').addEventListener('click', () => {
    $('#sheet').classList.add('hidden');
    const fw = $('#btn-fw-install');
    if (fw) fw.remove();
  });
  $('#btn-toggle-log').addEventListener('click', () => {
    const hidden = $('#log').classList.toggle('hidden');
    $('#btn-toggle-log').textContent = hidden ? 'Show details' : 'Hide details';
  });

  $('#pkg-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#pkg-input');
    const name = input.value.trim();
    const err = $('#pkg-error');
    if (!PKG_RE.test(name)) {
      err.textContent = 'Enter a single package name using letters, numbers and . _ + -';
      err.classList.remove('hidden');
      return;
    }
    err.classList.add('hidden');
    input.value = '';
    perform('install-pkg', name);
  });

  wireSetup();
  wireAppUpdate();

  window.api.onStart(({ title }) => { if (sheetLive) $('#sheet-title').textContent = title; });
  window.api.onStep(({ index, total, label }) => {
    if (!sheetLive) return;
    $('#sheet-sub').textContent = total > 1 ? `Step ${index + 1} of ${total}: ${label}` : label;
    const bar = $('#sheet-bar');
    bar.classList.add('indeterminate');
    bar.style.width = '';
  });
  window.api.onLog((t) => { if (sheetLive) appendLog(t); });

  refreshStatus();
}

init();
