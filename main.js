'use strict';

const { app, BrowserWindow, ipcMain, Menu, dialog, nativeTheme, shell } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

// AppImages cannot ship a SUID chrome-sandbox helper, and this app only ever
// loads its own local files, so the Chromium sandbox is switched off.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let busy = false;
let cancelled = false;
let current = null;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

// Child processes (rpm-ostree, flatpak, ...) must not inherit the AppImage's
// private library paths, and their output must be English so we can read it.
function childEnv() {
  const env = { ...process.env };
  const appdir = process.env.APPDIR;
  for (const k of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'LD_PRELOAD', 'ELECTRON_RUN_AS_NODE']) delete env[k];
  if (appdir) {
    for (const k of ['LD_LIBRARY_PATH', 'PATH', 'XDG_DATA_DIRS']) {
      if (env[k]) env[k] = env[k].split(':').filter((p) => p && !p.startsWith(appdir)).join(':');
    }
  }
  env.LANG = 'C.UTF-8';
  env.LC_ALL = 'C.UTF-8';
  env.LANGUAGE = 'C';
  env.TERM = 'dumb';
  return env;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]|\x1b[=>]/g;
const stripAnsi = (s) => s.replace(ANSI, '');

function lastLines(text, n = 4) {
  return text.split(/\r?\n|\r/).map((s) => s.trim()).filter(Boolean).slice(-n).join('\n');
}

function readOsRelease() {
  const out = {};
  try {
    for (const line of fs.readFileSync('/etc/os-release', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  } catch (_) { /* ignore */ }
  return out;
}

function execJson(cmd, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: childEnv(), timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({ error: err, stdout: stdout || '' });
      resolve({ stdout });
    });
  });
}

/* ------------------------------------------------------------------ */
/* actions (a fixed whitelist - the UI never sends raw commands)       */
/* ------------------------------------------------------------------ */

const PKG_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,100}$/;
const APPID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,200}$/;


/* ---- DNS presets (the UI only ever sends a preset id or validated IPs) ---- */
const DNS_PRESETS = {
  cloudflare: { name: 'Cloudflare', v4: ['1.1.1.1', '1.0.0.1'], v6: ['2606:4700:4700::1111', '2606:4700:4700::1001'] },
  google: { name: 'Google', v4: ['8.8.8.8', '8.8.4.4'], v6: ['2001:4860:4860::8888', '2001:4860:4860::8844'] },
  quad9: { name: 'Quad9', v4: ['9.9.9.9', '149.112.112.112'], v6: ['2620:fe::fe', '2620:fe::9'] },
  adguard: { name: 'AdGuard', v4: ['94.140.14.14', '94.140.15.15'], v6: ['2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff'] },
};

function parseDnsArg(arg) {
  if (typeof arg !== 'string') return null;
  if (DNS_PRESETS[arg]) return DNS_PRESETS[arg];
  if (!arg.startsWith('custom:')) return null;
  const list = arg.slice(7).split(',').map((x) => x.trim()).filter(Boolean);
  if (!list.length || list.length > 4 || !list.every((x) => net.isIP(x))) return null;
  return { name: 'custom DNS', v4: list.filter((x) => net.isIPv4(x)), v6: list.filter((x) => net.isIPv6(x)) };
}

// nmcli -t escapes ":" and "\" inside fields
function splitTerse(line) {
  return line.split(/(?<!\\):/).map((f) => f.replace(/\\(.)/g, '$1'));
}

async function activeConnections() {
  const r = await execJson('nmcli', ['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show', '--active']);
  if (r.error) return [];
  return r.stdout.split('\n').filter(Boolean).map(splitTerse)
    .filter((f) => f.length >= 3 && /ethernet|wireless|wifi/i.test(f[1]))
    .map((f) => ({ name: f[0], device: f[2] }));
}

// Applies (preset) or clears (null) custom DNS on every active Wi-Fi/Ethernet connection.
async function dnsApply(preset, onData) {
  let out = '';
  let error;
  const say = (t) => { out += t; onData(t); };
  const run = async (cmd) => {
    say(`$ ${cmd.join(' ')}\n`);
    const r = await runStep(cmd, say);
    if (r.error) { error = r.error; say(`${r.error}\n`); }
    return r;
  };
  const conns = await activeConnections();
  if (!conns.length) {
    say('No active Wi-Fi or Ethernet connection found.\n');
    return { code: 1, out, error, fnLogged: true };
  }
  let code = 0;
  for (const c of conns) {
    if (cancelled) break;
    const on = preset ? 'yes' : 'no';
    const m4 = await run(['nmcli', 'connection', 'modify', 'id', c.name, 'ipv4.dns', preset ? preset.v4.join(' ') : '', 'ipv4.ignore-auto-dns', on]);
    if (m4.code !== 0) { code = m4.code || 1; continue; }
    // IPv6 is best-effort: some connections have IPv6 switched off.
    await run(['nmcli', 'connection', 'modify', 'id', c.name, 'ipv6.dns', preset ? preset.v6.join(' ') : '', 'ipv6.ignore-auto-dns', on]);
    let applied = { code: 1 };
    if (c.device) applied = await run(['nmcli', 'device', 'reapply', c.device]);
    if (applied.code !== 0) applied = await run(['nmcli', 'connection', 'up', 'id', c.name]);
    if (applied.code !== 0) code = applied.code || 1;
  }
  return { code, out, error, fnLogged: true };
}

const AUTOUPDATE_SCRIPT = [
  'set -e',
  'f=/etc/rpm-ostreed.conf',
  'if grep -qE "^#?AutomaticUpdatePolicy=" "$f" 2>/dev/null; then sed -i -E "s/^#?AutomaticUpdatePolicy=.*/AutomaticUpdatePolicy=stage/" "$f"; else printf "\\n[Daemon]\\nAutomaticUpdatePolicy=stage\\n" >> "$f"; fi',
  'systemctl enable --now rpm-ostreed-automatic.timer',
].join('\n');

const FFMPEG_SWAP = ['rpm-ostree', 'override', 'remove', 'libavcodec-free', 'libavfilter-free', 'libavformat-free', 'libavutil-free', 'libpostproc-free', 'libswresample-free', 'libswscale-free', '--install', 'ffmpeg'];

function rpmFusionCmd() {
  const v = readOsRelease().VERSION_ID;
  if (!/^\d+$/.test(v || '')) return null;
  return ['rpm-ostree', 'install', '--idempotent',
    `https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-${v}.noarch.rpm`,
    `https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-${v}.noarch.rpm`];
}

const STEP_FLATHUB = { label: 'Adding the Flathub source', cmd: ['flatpak', 'remote-add', '--if-not-exists', 'flathub', 'https://dl.flathub.org/repo/flathub.flatpakrepo'] };
const STEP_FLATSEAL = { label: 'Installing Flatseal', cmd: ['flatpak', 'install', '-y', '--noninteractive', 'flathub', 'com.github.tchx84.Flatseal'] };
const STEP_RPMFUSION = { label: 'Adding RPM Fusion', get cmd() { return rpmFusionCmd() || ['false']; } };
const STEP_CODECS = { label: 'Installing full multimedia codecs', cmd: FFMPEG_SWAP };
const STEP_AUTOUPDATE = { label: 'Turning on automatic system updates', cmd: ['pkexec', 'sh', '-c', AUTOUPDATE_SCRIPT] };

const FLATPAK_UPDATE = { label: 'Updating apps', cmd: ['flatpak', 'update', '-y', '--noninteractive'] };

async function buildAction(action, arg) {
  switch (action) {
    case 'check':
      return { title: 'Checking for updates', steps: [{ label: 'Looking for a newer system version', cmd: ['rpm-ostree', 'upgrade', '--check'] }] };
    case 'update-system':
      return { title: 'Updating your system', steps: [{ label: 'Downloading the new system version', cmd: ['rpm-ostree', 'upgrade'] }] };
    case 'update-apps':
      return { title: 'Updating your apps', steps: [FLATPAK_UPDATE] };
    case 'update-all':
      return {
        title: 'Updating everything',
        steps: [{ label: 'Downloading the new system version', cmd: ['rpm-ostree', 'upgrade'] }, FLATPAK_UPDATE],
      };
    case 'firmware-check':
      return {
        title: 'Checking firmware',
        steps: [
          { label: 'Refreshing the firmware list', cmd: ['fwupdmgr', 'refresh', '--force'], okCodes: [0, 2] },
          { label: 'Looking for firmware updates', cmd: ['fwupdmgr', 'get-updates'], okCodes: [0, 2] },
        ],
      };
    case 'firmware-install':
      return { title: 'Installing firmware updates', steps: [{ label: 'Installing firmware', cmd: ['fwupdmgr', 'update', '-y', '--no-reboot-check'], okCodes: [0, 2] }] };
    case 'rollback':
      return { title: 'Rolling back', steps: [{ label: 'Selecting the previous system version', cmd: ['rpm-ostree', 'rollback'] }] };
    case 'cleanup':
      return {
        title: 'Cleaning up',
        steps: [
          { label: 'Clearing cached system data', cmd: ['rpm-ostree', 'cleanup', '--base', '--repomd'] },
          { label: 'Removing unused app runtimes', cmd: ['flatpak', 'uninstall', '--unused', '-y', '--noninteractive'] },
        ],
      };
    case 'add-flathub':
      return {
        title: 'Enabling Flathub',
        steps: [{ label: 'Adding the Flathub source', cmd: ['flatpak', 'remote-add', '--if-not-exists', 'flathub', 'https://dl.flathub.org/repo/flathub.flatpakrepo'] }],
      };
    case 'install-pkg':
      if (typeof arg !== 'string' || !PKG_RE.test(arg)) return null;
      return { title: `Adding ${arg}`, steps: [{ label: `Layering ${arg} onto your system`, cmd: ['rpm-ostree', 'install', '--idempotent', arg] }] };
    case 'remove-pkg':
      if (typeof arg !== 'string' || !PKG_RE.test(arg)) return null;
      return { title: `Removing ${arg}`, steps: [{ label: `Removing ${arg} from your system layer`, cmd: ['rpm-ostree', 'uninstall', arg] }] };
    case 'remove-flatpak':
      if (typeof arg !== 'string' || !APPID_RE.test(arg)) return null;
      return { title: 'Removing app', steps: [{ label: `Removing ${arg}`, cmd: ['flatpak', 'uninstall', '-y', '--noninteractive', arg] }] };
    case 'install-flatseal':
      return { title: 'Installing Flatseal', steps: [STEP_FLATSEAL] };
    case 'setup-rpmfusion':
      if (!rpmFusionCmd()) return null;
      return { title: 'Adding RPM Fusion', steps: [STEP_RPMFUSION] };
    case 'setup-codecs':
      return { title: 'Installing multimedia codecs', steps: [STEP_CODECS] };
    case 'setup-autoupdate':
      return { title: 'Turning on automatic updates', steps: [STEP_AUTOUPDATE] };
    case 'postinstall-all': {
      const st = await setupStatus();
      const steps = [];
      const later = [];
      if (!st.flathub) steps.push(STEP_FLATHUB);
      if (!st.flatseal) steps.push(STEP_FLATSEAL);
      if (!st.autoupdate) steps.push(STEP_AUTOUPDATE);
      if (st.rpmfusion === 'todo' && rpmFusionCmd()) steps.push(STEP_RPMFUSION);
      if (st.codecs === 'todo') steps.push(STEP_CODECS);
      if (st.codecs === 'blocked' && st.rpmfusion === 'todo') later.push('codecs');
      return { title: 'Setting up your system', steps, later, emptyMessage: 'Everything recommended is already set up.' };
    }
    case 'firewall-on':
      return { title: 'Turning on the firewall', steps: [{ label: 'Starting the firewall', cmd: ['systemctl', 'enable', '--now', 'firewalld'] }] };
    case 'firewall-strict':
      return { title: 'Tightening the firewall', steps: [{ label: 'Switching to the stricter zone', cmd: ['firewall-cmd', '--set-default-zone=public'] }] };
    case 'dns-set': {
      const preset = parseDnsArg(arg);
      if (!preset) return null;
      return { title: `Switching DNS to ${preset.name}`, steps: [{ label: 'Updating your network connection', fn: (onData) => dnsApply(preset, onData) }] };
    }
    case 'dns-reset':
      return { title: 'Resetting DNS', steps: [{ label: 'Using the DNS from your network again', fn: (onData) => dnsApply(null, onData) }] };
    case 'reboot':
      return { title: 'Restarting', steps: [{ label: 'Restarting your computer', cmd: ['systemctl', 'reboot'] }] };
    default:
      return null;
  }
}

function runStep(cmd, onData) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    let done = false;
    const finish = (r) => { if (!done) { done = true; current = null; resolve({ ...r, out }); } };
    try {
      child = spawn(cmd[0], cmd.slice(1), { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return finish({ code: -1, error: e.message });
    }
    current = child;
    const feed = (b) => { const s = stripAnsi(b.toString('utf8')); out += s; onData(s); };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => finish({ code: -1, error: e.code === 'ENOENT' ? `"${cmd[0]}" is not installed on this system` : e.message }));
    child.on('close', (code, signal) => finish({ code, signal }));
  });
}

/* ------------------------------------------------------------------ */
/* turning raw output into friendly messages                           */
/* ------------------------------------------------------------------ */

const RX_AUTH = /not authorized|authorization|authentication|polkit|permission denied|access denied/i;
const RX_NET = /could not resolve|temporary failure|network is unreachable|failed to (download|fetch)|timed out|timeout was reached|unable to connect|no route to host|cannot (download|fetch)|connection (refused|reset)/i;
const RX_SYS_NONE = /no upgrade available|no updates available/i;

function summarize(action, steps, wasCancelled, def = {}) {
  if (wasCancelled) {
    return { ok: false, tone: 'info', headline: 'Task stopped', detail: 'Your running system was not changed. You can run this again any time.' };
  }

  const failed = steps.filter((s) => !s.ok);
  if (failed.length) {
    const missing = failed.find((s) => s.error);
    const failedOut = failed.map((s) => s.out).join('\n');
    const partial = failed.length < steps.length;
    let headline = partial ? 'Finished, but something failed' : 'Something went wrong';
    let detail = lastLines(failedOut) || (missing && missing.error) || 'The command did not finish successfully.';
    if (missing) {
      headline = 'A required tool is missing';
      detail = `${missing.error}. Atomic Helper needs it for this action.`;
    } else if (RX_AUTH.test(failedOut)) {
      headline = 'Permission needed';
      detail = 'The password prompt was cancelled or did not succeed. Try again and enter your password when asked.';
    } else if (RX_NET.test(failedOut)) {
      headline = "Couldn't reach the internet";
      detail = 'Check your connection and try again.';
    }
    return { ok: false, tone: 'error', headline, detail };
  }

  const out = steps.map((s) => s.out).join('\n');
  const done = (headline, detail, extra = {}) => ({ ok: true, tone: 'success', headline, detail, ...extra });

  switch (action) {
    case 'check': {
      if (RX_SYS_NONE.test(out)) return done("You're up to date", 'No new system version is available right now.', { updates: 'none' });
      const v = (out.match(/Version:\s*(\S+)/) || [])[1];
      return done('An update is available', `${v ? `Version ${v} is ready to download. ` : ''}Choose "Update everything" to get it. You only restart once, when it suits you.`, { updates: 'available' });
    }
    case 'update-system': {
      if (RX_SYS_NONE.test(out)) return done('Already up to date', 'You already have the newest system version.', { updates: 'none' });
      return done('Update ready: restart to finish', 'The new version is downloaded and waiting. Nothing changes until you restart, so you can keep working.', { updates: 'none' });
    }
    case 'update-apps':
      return /nothing to do/i.test(out)
        ? done('Apps are up to date', 'Every Flatpak app is already on its newest version.')
        : done('Apps updated', 'Your Flatpak apps are now on their newest versions.');
    case 'update-all': {
      const sysNone = RX_SYS_NONE.test(steps[0].out);
      const appsNone = /nothing to do/i.test(steps[1].out);
      if (sysNone && appsNone) return done('Everything is up to date', 'Your system and all your apps are on their newest versions.', { updates: 'none' });
      const parts = [];
      if (!sysNone) parts.push('The new system version is ready and starts after a restart.');
      if (!appsNone) parts.push('Your apps were updated.');
      return done(sysNone ? 'Apps updated' : 'Update ready: restart to finish', parts.join(' '), { updates: 'none' });
    }
    case 'firmware-check': {
      const last = steps[steps.length - 1];
      if (last.code === 2 || /no updat|nothing to do|no upgrades/i.test(last.out)) return done('Firmware is up to date', 'No firmware updates were found for your devices.');
      return done('Firmware updates found', 'Choose "Install firmware updates" to apply them. Some finish after a restart.', { firmware: 'available' });
    }
    case 'firmware-install':
      return done('Firmware step finished', 'Some firmware updates complete during the next restart.');
    case 'rollback':
      return done('Rollback ready: restart to go back', 'Your previous system version will start after you restart.');
    case 'cleanup':
      return done('All cleaned up', 'Old caches and unused app runtimes were removed.');
    case 'add-flathub':
      return done('Flathub is enabled', 'You can now install apps from Flathub in your software center.');
    case 'install-pkg':
      return /no change|already (requested|installed|provided)/i.test(out)
        ? done('Already added', 'That package is already part of your system.')
        : done('Package added: restart to use it', 'It becomes part of your system after the next restart.');
    case 'remove-pkg':
      return done('Package removed: restart to finish', 'It disappears from your system after the next restart.');
    case 'remove-flatpak':
      return done('App removed', 'The app was uninstalled.');
    case 'install-flatseal':
      return done('Flatseal installed', 'Use it to review and change what each Flatpak app is allowed to access.');
    case 'setup-rpmfusion':
      return done('RPM Fusion added: restart to use it', 'After the restart you can install the multimedia codecs from the Post-install tab.');
    case 'setup-codecs':
      return done('Codecs installed: restart to finish', 'Video and audio formats like H.264 and AAC work after the next restart.');
    case 'setup-autoupdate':
      return done('Automatic updates are on', 'New system versions are downloaded in the background. They start after your next restart.');
    case 'postinstall-all': {
      const bits = ['The recommended setup is done.'];
      if (def.later && def.later.includes('codecs')) bits.push('Restart, then come back to install the multimedia codecs.');
      else bits.push('Restart to finish the system changes.');
      return done('Setup finished', bits.join(' '));
    }
    case 'firewall-on':
      return done('Firewall is on', 'Your computer now blocks unwanted incoming connections.');
    case 'firewall-strict':
      return done('Stricter firewall is active', 'Only the services you allow can be reached from the network.');
    case 'dns-set':
      return done('DNS changed', 'Your connection now uses the new DNS server.');
    case 'dns-reset':
      return done('DNS is automatic again', 'Your connection uses the DNS from your network.');
    default:
      return done('Done', '');
  }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* setup / security status                                             */
/* ------------------------------------------------------------------ */

async function setupStatus() {
  const st = {
    flathub: false, flatseal: false, rpmfusion: 'todo', codecs: 'todo', autoupdate: false,
    firewall: { active: false, zone: null }, selinux: 'unknown',
    dns: { connections: [], current: 'none' },
  };

  const remotes = await execJson('flatpak', ['remotes', '--columns=name,options']);
  if (!remotes.error) {
    st.flathub = remotes.stdout.split('\n').some((l) => {
      const p = l.split('\t');
      return p[0].trim() === 'flathub' && !/disabled/.test(p[1] || '');
    });
  }
  const apps = await execJson('flatpak', ['list', '--app', '--columns=application']);
  if (!apps.error) st.flatseal = apps.stdout.split('\n').some((l) => l.trim() === 'com.github.tchx84.Flatseal');

  const rpm = await execJson('rpm', ['-q', '--qf', '%{NAME}\\n', 'rpmfusion-free-release', 'ffmpeg']);
  const have = new Set(rpm.stdout.split('\n').map((l) => l.trim()).filter((l) => l && !/not installed/.test(l)));
  let requested = [];
  const rs = await execJson('rpm-ostree', ['status', '--json']);
  if (!rs.error) {
    try {
      const first = (JSON.parse(rs.stdout).deployments || [])[0] || {};
      requested = [...(first['requested-packages'] || []), ...(first['requested-local-packages'] || [])];
    } catch (_) { /* ignore */ }
  }
  const wants = (prefix) => requested.some((p) => String(p).startsWith(prefix));
  if (have.has('rpmfusion-free-release')) st.rpmfusion = 'done';
  else if (wants('rpmfusion-free-release')) st.rpmfusion = 'restart';
  if (have.has('ffmpeg')) st.codecs = 'done';
  else if (wants('ffmpeg')) st.codecs = 'restart';
  else if (st.rpmfusion !== 'done') st.codecs = 'blocked';

  try {
    const m = fs.readFileSync('/etc/rpm-ostreed.conf', 'utf8').match(/^AutomaticUpdatePolicy=(\w+)/m);
    const timer = await execJson('systemctl', ['is-enabled', 'rpm-ostreed-automatic.timer']);
    st.autoupdate = !!m && ['stage', 'apply'].includes(m[1]) && timer.stdout.trim() === 'enabled';
  } catch (_) { /* config missing: automatic updates are off */ }

  const fw = await execJson('systemctl', ['is-active', 'firewalld']);
  st.firewall.active = fw.stdout.trim() === 'active';
  if (st.firewall.active) {
    const z = await execJson('firewall-cmd', ['--get-default-zone']);
    if (!z.error) st.firewall.zone = z.stdout.trim();
  }

  try {
    const e = fs.readFileSync('/sys/fs/selinux/enforce', 'utf8').trim();
    st.selinux = e === '1' ? 'enforcing' : 'permissive';
  } catch (_) { st.selinux = 'disabled'; }

  const conns = await activeConnections();
  const modes = new Set();
  for (const c of conns) {
    const r = await execJson('nmcli', ['-t', '-g', 'ipv4.dns,ipv4.ignore-auto-dns', 'connection', 'show', 'id', c.name]);
    if (r.error) continue;
    const [dnsLine = '', ignore = ''] = r.stdout.split('\n');
    const servers = dnsLine.split(',').map((x) => x.trim()).filter(Boolean);
    let mode = 'auto';
    if (servers.length && ignore.trim() === 'yes') {
      mode = 'custom';
      for (const [id, p] of Object.entries(DNS_PRESETS)) {
        if (servers.length === p.v4.length && servers.every((x) => p.v4.includes(x))) mode = id;
      }
    }
    st.dns.connections.push({ name: c.name, device: c.device, servers, mode });
    modes.add(mode);
  }
  if (modes.size === 1) st.dns.current = [...modes][0];
  else if (modes.size > 1) st.dns.current = 'mixed';
  return st;
}

ipcMain.handle('setup-status', () => setupStatus());

ipcMain.handle('status', async () => {
  const rel = readOsRelease();
  const info = {
    atomic: fs.existsSync('/run/ostree-booted'),
    pretty: rel.PRETTY_NAME || 'Linux',
    kernel: os.release(),
    rpmOstree: false,
    booted: null,
    pendingReboot: false,
    pendingVersion: null,
    rollbackAvailable: false,
    layered: [],
    origin: null,
    freeBytes: null,
    totalBytes: null,
  };

  const r = await execJson('rpm-ostree', ['status', '--json']);
  if (!r.error) {
    try {
      const deps = JSON.parse(r.stdout).deployments || [];
      const booted = deps.find((d) => d.booted);
      const first = deps[0];
      info.rpmOstree = true;
      if (booted) info.booted = { version: booted.version || null, timestamp: booted.timestamp || null };
      info.origin = (booted && booted.origin) || null;
      info.pendingReboot = !!(first && !first.booted);
      info.pendingVersion = info.pendingReboot ? first.version || null : null;
      info.rollbackAvailable = deps.length > 1;
      info.layered = [...((first && first['requested-packages']) || [])].sort((a, b) => a.localeCompare(b));
    } catch (_) { /* leave defaults */ }
  }

  await new Promise((resolve) => {
    fs.statfs(os.homedir(), (err, s) => {
      if (!err && s) { info.totalBytes = s.blocks * s.bsize; info.freeBytes = s.bavail * s.bsize; }
      resolve();
    });
  });
  return info;
});

ipcMain.handle('flatpaks', async () => {
  const r = await execJson('flatpak', ['list', '--app', '--columns=name,application']);
  if (r.error) return { installed: false, apps: [] };
  const apps = r.stdout.split('\n').map((l) => l.split('\t')).filter((p) => p.length >= 2 && p[1].trim())
    .map((p) => ({ name: p[0].trim(), id: p[1].trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { installed: true, apps };
});

ipcMain.handle('run', async (event, action, arg) => {
  if (busy) return { ok: false, tone: 'error', headline: 'Another task is still running', detail: 'Wait for it to finish first.' };
  const def = await buildAction(action, arg);
  if (!def) return { ok: false, tone: 'error', headline: 'Unknown action', detail: 'That request was not understood.' };

  busy = true;
  cancelled = false;
  const send = (ch, payload) => { if (!event.sender.isDestroyed()) event.sender.send(ch, payload); };
  try {
    send('start', { title: def.title, total: def.steps.length });
    if (!def.steps.length) {
      return { ok: true, tone: 'success', headline: 'Nothing to do', detail: def.emptyMessage || '', log: '' };
    }
    const results = [];
    for (let i = 0; i < def.steps.length; i += 1) {
      const step = def.steps[i];
      send('step', { index: i, total: def.steps.length, label: step.label });
      let r;
      let header = '';
      if (step.fn) {
        r = await step.fn((t) => send('log', t));
      } else {
        const cmd = step.cmd;
        header = `$ ${cmd.join(' ')}\n`;
        send('log', header);
        r = await runStep(cmd, (t) => send('log', t));
      }
      results.push({ ...r, header, ok: !r.error && !r.signal && (step.okCodes || [0]).includes(r.code) });
      if (cancelled) break;
      send('log', '\n');
    }
    const summary = summarize(action, results, cancelled, def);
    // Full transcript, so the details view is complete even for very fast commands.
    summary.log = results.map((r) => `${r.header}${r.out}${r.error && !r.fnLogged ? `${r.error}\n` : ''}`).join('\n');
    return summary;
  } finally {
    busy = false;
    current = null;
  }
});

ipcMain.handle('cancel', () => {
  cancelled = true;
  if (current) {
    const c = current;
    c.kill('SIGINT');
    setTimeout(() => { if (current === c) c.kill('SIGTERM'); }, 4000);
  }
});


/* ------------------------------------------------------------------ */
/* app self-update (GitHub Releases)                                   */
/* ------------------------------------------------------------------ */

const REPO = 'VeyroDeveloper/atomic-helper';
const RELEASE_PREFIX = `https://github.com/${REPO}/releases/`;
let pendingUpdate = null; // { url, size, digest, page }

function cmpVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function checkAppUpdate() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const current = app.getVersion();
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'atomic-helper' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { status: 'unavailable', current };
    const rel = await res.json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    if (!/^\d+(\.\d+){0,3}$/.test(latest)) return { status: 'unavailable', current };
    if (cmpVersions(latest, current) <= 0) return { status: 'current', current, latest };
    const asset = (rel.assets || []).find((a) => a.name === `AtomicHelper-${arch}.AppImage`);
    const page = String(rel.html_url || '').startsWith(RELEASE_PREFIX) ? rel.html_url : `${RELEASE_PREFIX}latest`;
    pendingUpdate = {
      page,
      url: asset ? asset.browser_download_url : null,
      size: asset ? asset.size : 0,
      digest: asset && asset.digest ? asset.digest : null,
    };
    return { status: 'available', current, latest, canInstall: !!(asset && process.env.APPIMAGE) };
  } catch (_) {
    return { status: 'unavailable', current };
  }
}

async function installAppUpdate(send) {
  const u = pendingUpdate;
  if (!u) return { ok: false, message: 'Check for updates first.' };
  const target = process.env.APPIMAGE;
  if (!target || !u.url) {
    shell.openExternal(u.page);
    return { ok: true, opened: true };
  }
  if (busy) return { ok: false, message: 'Wait for the running task to finish first.' };
  if (!u.url.startsWith(`${RELEASE_PREFIX}download/`)) return { ok: false, message: 'The download address looks wrong, so it was not used.' };

  const tmp = `${target}.update-${process.pid}`;
  try {
    const res = await fetch(u.url, { redirect: 'follow', headers: { 'User-Agent': 'atomic-helper' } });
    if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`);
    const total = Number(res.headers.get('content-length')) || u.size || 0;
    const hash = crypto.createHash('sha256');
    let got = 0;
    await pipeline(
      Readable.fromWeb(res.body),
      new Transform({
        transform(chunk, _enc, cb) {
          hash.update(chunk);
          got += chunk.length;
          send(total ? Math.min(100, Math.round((got / total) * 100)) : null);
          cb(null, chunk);
        },
      }),
      fs.createWriteStream(tmp, { mode: 0o755 }),
    );
    if (u.size && got !== u.size) throw new Error('The downloaded file is incomplete.');
    if (u.digest && u.digest.startsWith('sha256:') && hash.digest('hex') !== u.digest.slice(7)) {
      throw new Error('The downloaded file did not match its checksum, so it was not installed.');
    }
    fs.chmodSync(tmp, 0o755);
    // Replacing the file while it runs is safe on Linux: the running copy keeps its old data.
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    return { ok: false, message: e && e.message ? e.message : String(e) };
  }

  const env = { ...process.env };
  for (const k of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete env[k];
  // Wait a moment so the single-instance lock is released before the new copy starts.
  spawn('sh', ['-c', 'sleep 1; exec "$0"', target], { detached: true, stdio: 'ignore', env }).unref();
  setTimeout(() => app.exit(0), 150);
  return { ok: true, restarting: true };
}

ipcMain.handle('app-info', () => ({ version: app.getVersion(), appImage: !!process.env.APPIMAGE }));
ipcMain.handle('app-update-check', () => checkAppUpdate());
ipcMain.handle('app-update-install', (event) => installAppUpdate((pct) => {
  if (!event.sender.isDestroyed()) event.sender.send('app-update-progress', pct);
}));

/* ------------------------------------------------------------------ */
/* window                                                              */
/* ------------------------------------------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 740,
    minWidth: 760,
    minHeight: 560,
    title: 'Atomic Helper',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12151a' : '#f3f5f9',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (!busy) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep waiting', 'Quit anyway'],
      defaultId: 0,
      cancelId: 0,
      message: 'A task is still running',
      detail: 'Quitting now will stop it.',
    });
    if (choice === 0) e.preventDefault();
    else if (current) current.kill('SIGINT');
  });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
