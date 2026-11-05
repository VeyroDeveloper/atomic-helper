'use strict';

const { app, BrowserWindow, ipcMain, Menu, dialog, nativeTheme, shell } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let busy = false;
let cancelled = false;
let current = null;

function childEnv() {
  const env = { ...process.env };
  const appdir = process.env.APPDIR;
  for (const key of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'LD_PRELOAD', 'ELECTRON_RUN_AS_NODE']) delete env[key];
  if (appdir) {
    for (const key of ['LD_LIBRARY_PATH', 'PATH', 'XDG_DATA_DIRS']) {
      if (env[key]) env[key] = env[key].split(':').filter((p) => p && !p.startsWith(appdir)).join(':');
    }
  }
  env.LANG = 'C.UTF-8';
  env.LC_ALL = 'C.UTF-8';
  env.LANGUAGE = 'C';
  env.TERM = 'dumb';
  return env;
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]|\x1b[=>]/g;
const stripAnsi = (s) => s.replace(ANSI, '');
function lastLines(text, n = 4) {
  return text.split(/\r?\n|\r/).map((s) => s.trim()).filter(Boolean).slice(-n).join('\n');
}
function readOsRelease() {
  const out = {};
  try {
    for (const line of fs.readFileSync('/etc/os-release', 'utf8').split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) out[match[1]] = match[2].replace(/^"|"$/g, '');
    }
  } catch (_) {}
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

const PKG_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,100}$/;
const APPID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,200}$/;
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

function runStep(cmd, onData = () => {}) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    let done = false;
    function finish(r) {
      if (!done) {
        done = true;
        current = null;
        resolve({ ...r, out });
      }
    }
    try {
      child = spawn(cmd[0], cmd.slice(1), { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return finish({ code: -1, error: e.message });
    }
    current = child;
    const feed = (chunk) => {
      const s = stripAnsi(chunk.toString('utf8'));
      out += s;
      onData(s);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => finish({ code: -1, error: e.code === 'ENOENT' ? `"${cmd[0]}" is not installed on this system` : e.message }));
    child.on('close', (code, signal) => finish({ code, signal }));
  });
}

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
    say('No active Wi‑Fi or Ethernet connection found.\n');
    return { code: 1, out, error, fnLogged: true };
  }
  let code = 0;
  for (const c of conns) {
    if (cancelled) break;
    const on = preset ? 'yes' : 'no';
    const m4 = await run(['nmcli', 'connection', 'modify', 'id', c.name, 'ipv4.dns', preset ? preset.v4.join(' ') : '', 'ipv4.ignore-auto-dns', on]);
    if (m4.code !== 0) { code = m4.code || 1; continue; }
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
const FFMPEG_SWAP = ['rpm-ostree', 'override', 'remove', 'libavcodec-free', 'libavdevice-free', 'libavfilter-free', 'libavformat-free', 'libavutil-free', 'libpostproc-free', 'libswresample-free', 'libswscale-free', '--install', 'ffmpeg'];

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

async function openBrowser(url) {
  const parsed = (() => {
    try { return new URL(url); } catch (_) { return null; }
  })();
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) return { code: 1, error: 'Only http/https links are allowed.' };
  shell.openExternal(parsed.href);
  return { code: 0, out: `Opened ${parsed.href}\n` };
}

async function setupStatus() {
  const st = {
    flathub: false,
    flatseal: false,
    rpmfusion: 'todo',
    codecs: 'todo',
    autoupdate: false,
    firewall: { active: false, zone: null },
    selinux: 'unknown',
    dns: { connections: [], current: 'none' },
  };

  const remotes = await execJson('flatpak', ['remotes', '--columns=name,options']);
  if (!remotes.error) {
    st.flathub = remotes.stdout.split('\n').some((line) => {
      const p = line.split('\t');
      return p[0].trim() === 'flathub' && !/disabled/.test(p[1] || '');
    });
  }

  const apps = await execJson('flatpak', ['list', '--app', '--columns=application']);
  if (!apps.error) st.flatseal = apps.stdout.split('\n').some((line) => line.trim() === 'com.github.tchx84.Flatseal');

  const rpm = await execJson('rpm', ['-q', '--qf', '%{NAME}\\n', 'rpmfusion-free-release', 'rpmfusion-nonfree-release', 'ffmpeg']);
  const have = new Set(String(rpm.stdout || '').split('\n').map((x) => x.trim()).filter(Boolean));
  const rs = await execJson('rpm-ostree', ['status', '--json']);
  let requested = [];
  if (!rs.error) {
    try {
      const first = (JSON.parse(rs.stdout).deployments || [])[0] || {};
      requested = [...(first['requested-packages'] || []), ...(first['requested-local-packages'] || [])];
    } catch (_) {}
  }
  const wants = (prefix) => requested.some((p) => String(p).startsWith(prefix));
  if (have.has('rpmfusion-free-release') || have.has('rpmfusion-nonfree-release')) st.rpmfusion = 'done';
  else if (wants('rpmfusion-free-release') || wants('rpmfusion-nonfree-release')) st.rpmfusion = 'restart';
  if (have.has('ffmpeg')) st.codecs = 'done';
  else if (wants('ffmpeg')) st.codecs = 'restart';
  else if (st.rpmfusion !== 'done') st.codecs = 'blocked';

  try {
    const conf = fs.readFileSync('/etc/rpm-ostreed.conf', 'utf8');
    const match = conf.match(/^AutomaticUpdatePolicy=(\w+)/m);
    const timer = await execJson('systemctl', ['is-enabled', 'rpm-ostreed-automatic.timer']);
    st.autoupdate = !!match && ['stage', 'apply'].includes(match[1]) && timer.stdout.trim() === 'enabled';
  } catch (_) {}

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
      for (const [, preset] of Object.entries(DNS_PRESETS)) {
        if (servers.length === preset.v4.length && servers.every((x) => preset.v4.includes(x))) mode = 'preset';
      }
    }
    st.dns.connections.push({ name: c.name, device: c.device, servers, mode });
    modes.add(mode);
  }
  if (modes.size === 1) st.dns.current = [...modes][0];
  else if (modes.size > 1) st.dns.current = 'mixed';

  return st;
}

async function buildAction(action, arg) {
  switch (action) {
    case 'check':
      return { title: 'Checking for updates', steps: [{ label: 'Looking for a newer system version', cmd: ['rpm-ostree', 'upgrade', '--check'] }] };
    case 'update-system':
      return { title: 'Updating your system', steps: [{ label: 'Downloading the new system version', cmd: ['rpm-ostree', 'upgrade'] }] };
    case 'update-apps':
      return { title: 'Updating your apps', steps: [FLATPAK_UPDATE] };
    case 'update-all':
      return { title: 'Updating everything', steps: [{ label: 'Downloading the new system version', cmd: ['rpm-ostree', 'upgrade'] }, FLATPAK_UPDATE] };
    case 'firmware-check':
      return { title: 'Checking firmware', steps: [{ label: 'Refreshing the firmware list', cmd: ['fwupdmgr', 'refresh', '--force'], okCodes: [0, 2] }, { label: 'Looking for firmware updates', cmd: ['fwupdmgr', 'get-updates'], okCodes: [0, 2] }] };
    case 'firmware-install':
      return { title: 'Installing firmware updates', steps: [{ label: 'Installing firmware', cmd: ['fwupdmgr', 'update', '-y', '--no-reboot-check'], okCodes: [0, 2] }] };
    case 'rollback':
      return { title: 'Rolling back', steps: [{ label: 'Selecting the previous system version', cmd: ['rpm-ostree', 'rollback'] }] };
    case 'cleanup':
      return { title: 'Cleaning up', steps: [{ label: 'Clearing cached system data', cmd: ['rpm-ostree', 'cleanup', '--base', '--repomd'] }, { label: 'Removing unused app runtimes', cmd: ['flatpak', 'uninstall', '--unused', '-y', '--noninteractive'] }] };
    case 'add-flathub':
      return { title: 'Enabling Flathub', steps: [{ label: 'Adding the Flathub source', cmd: ['flatpak', 'remote-add', '--if-not-exists', 'flathub', 'https://dl.flathub.org/repo/flathub.flatpakrepo'] }] };
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
      if (!st.flathub) steps.push(STEP_FLATHUB);
      if (!st.flatseal) steps.push(STEP_FLATSEAL);
      if (!st.autoupdate) steps.push(STEP_AUTOUPDATE);
      if (st.rpmfusion === 'todo' && rpmFusionCmd()) steps.push(STEP_RPMFUSION);
      if (st.codecs === 'todo') steps.push(STEP_CODECS);
      return { title: 'Setting up your system', steps, emptyMessage: 'Everything recommended is already set up.' };
    }
    case 'open-fedora-docs':
      return { title: 'Opening Fedora docs', steps: [{ label: 'Opening Fedora Silverblue docs', fn: async (onData) => { onData('Opening Fedora docs…\n'); return openBrowser('https://docs.fedoraproject.org/en-US/fedora-silverblue/'); } }] };
    case 'open-flathub':
      return { title: 'Opening Flathub', steps: [{ label: 'Opening Flathub', fn: async (onData) => { onData('Opening Flathub…\n'); return openBrowser('https://flathub.org/'); } }] };
    case 'open-rpmfusion':
      return { title: 'Opening RPM Fusion', steps: [{ label: 'Opening RPM Fusion', fn: async (onData) => { onData('Opening RPM Fusion…\n'); return openBrowser('https://rpmfusion.org/'); } }] };
    case 'system-diagnostics':
      return { title: 'Running system diagnostics', steps: [{ label: 'Collecting status information', fn: async (onData) => {
        const rel = readOsRelease();
        const lines = [];
        lines.push(`OS: ${rel.PRETTY_NAME || 'Unknown'}`);
        lines.push(`Kernel: ${os.release()}`);
        const status = await execJson('rpm-ostree', ['status', '--json']);
        if (!status.error) {
          try { lines.push(`rpm-ostree: ${JSON.parse(status.stdout).deployments?.length || 0} deployment(s)`); } catch (_) { lines.push('rpm-ostree: status available'); }
        }
        const flatpak = await execJson('flatpak', ['remotes', '--columns=name,options']);
        if (!flatpak.error) lines.push(`Flatpak remotes: ${flatpak.stdout.trim().split('\n').filter(Boolean).length}`);
        const fw = await execJson('systemctl', ['is-active', 'firewalld']);
        lines.push(`Firewall: ${fw.stdout.trim() || 'unknown'}`);
        const conf = await execJson('systemctl', ['is-enabled', 'rpm-ostreed-automatic.timer']);
        lines.push(`Auto-updates timer: ${conf.stdout.trim() || 'unknown'}`);
        onData(lines.join('\n') + '\n');
        return { code: 0, out: lines.join('\n') + '\n' };
      } }] };
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

function summarize(action, steps, wasCancelled) {
  if (wasCancelled) {
    return { ok: false, tone: 'info', headline: 'Task stopped', detail: 'Your running system was not changed. You can run this again any time.' };
  }
  const failed = steps.filter((s) => !s.ok);
  if (failed.length) {
    const failedOut = failed.map((s) => s.out).join('\n');
    const message = lastLines(failedOut) || 'The command did not finish successfully.';
    return { ok: false, tone: 'error', headline: 'Something went wrong', detail: message };
  }
  const out = steps.map((s) => s.out).join('\n');
  const done = (headline, detail, extra = {}) => ({ ok: true, tone: 'success', headline, detail, ...extra });
  switch (action) {
    case 'check':
      return /no upgrade available|no updates available/i.test(out) ? done("You're up to date", 'No new system version is available right now.', { updates: 'none' }) : done('An update is available', 'A new system version is ready to download.', { updates: 'available' });
    case 'update-system':
      return done('Update ready: restart to finish', 'The new version is downloaded and waiting. Nothing changes until you restart.', { updates: 'none' });
    case 'update-apps':
      return done('Apps updated', 'Your Flatpak apps are up to date.');
    case 'update-all':
      return done('Update ready: restart to finish', 'System updates are prepared and your apps were refreshed.', { updates: 'none' });
    case 'firmware-check':
      return done('Firmware status checked', 'The firmware status has been checked.');
    case 'firmware-install':
      return done('Firmware step finished', 'Some firmware updates complete after the next restart.');
    case 'rollback':
      return done('Rollback ready: restart to go back', 'Your previous system version will start after you restart.');
    case 'cleanup':
      return done('All cleaned up', 'Old caches and unused app runtimes were removed.');
    case 'add-flathub':
      return done('Flathub is enabled', 'You can now install apps from Flathub.');
    case 'install-pkg':
      return done('Package added', 'It becomes part of your system after the next restart.');
    case 'remove-pkg':
      return done('Package removed', 'It disappears after the next restart.');
    case 'remove-flatpak':
      return done('App removed', 'The app was uninstalled.');
    case 'install-flatseal':
      return done('Flatseal installed', 'Use it to review and change app access.');
    case 'setup-rpmfusion':
      return done('RPM Fusion added', 'Restart to finish the setup.');
    case 'setup-codecs':
      return done('Codecs installed', 'Restart to finish the system changes.');
    case 'setup-autoupdate':
      return done('Automatic updates are on', 'New system versions are downloaded in the background.');
    case 'open-fedora-docs':
      return done('Fedora docs opened', 'The Fedora Silverblue documentation is open in your browser.');
    case 'open-flathub':
      return done('Flathub opened', 'The Flathub app store is open in your browser.');
    case 'open-rpmfusion':
      return done('RPM Fusion opened', 'The RPM Fusion site is open in your browser.');
    case 'system-diagnostics':
      return done('Diagnostics ready', 'Your system report was collected successfully.');
    case 'firewall-on':
      return done('Firewall is on', 'Your computer now blocks unwanted incoming connections.');
    case 'firewall-strict':
      return done('Stricter firewall is active', 'Only the services you allow can be reached from the network.');
    case 'dns-set':
      return done('DNS changed', 'Your connection now uses the new DNS server.');
    case 'dns-reset':
      return done('DNS is automatic again', 'Your connection uses the DNS from your network.');
    case 'postinstall-all':
      return done('Setup finished', 'The recommended setup is complete. Restart to finish the remaining changes.');
    default:
      return done('Done', '');
  }
}

ipcMain.handle('setup-status', () => setupStatus());
ipcMain.handle('status', async () => {
  const rel = readOsRelease();
  const info = {
    atomic: fs.existsSync('/run/ostree-booted'),
    pretty: rel.PRETTY_NAME || 'Linux',
    kernel: os.release(),
    booted: null,
    pendingReboot: false,
    pendingVersion: null,
    rollbackAvailable: false,
    layered: [],
    freeBytes: null,
    totalBytes: null,
  };
  const r = await execJson('rpm-ostree', ['status', '--json']);
  if (!r.error) {
    try {
      const deps = JSON.parse(r.stdout).deployments || [];
      const booted = deps.find((d) => d.booted) || deps[0];
      if (booted) info.booted = { version: booted.version || null, timestamp: booted.timestamp || null };
      info.pendingReboot = !!(deps[0] && !deps[0].booted);
      info.pendingVersion = info.pendingReboot ? deps[0].version || null : null;
      info.rollbackAvailable = deps.length > 1;
      info.layered = [...((deps[0] && deps[0]['requested-packages']) || [])].sort((a, b) => a.localeCompare(b));
    } catch (_) {}
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
  const apps = r.stdout.split('\n').map((line) => line.split('\t')).filter((p) => p.length >= 2 && p[1].trim())
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
  const send = (channel, payload) => { if (!event.sender.isDestroyed()) event.sender.send(channel, payload); };
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
        header = `$ ${step.cmd.join(' ')}\n`;
        send('log', header);
        r = await runStep(step.cmd, (t) => send('log', t));
      }
      results.push({ ...r, header, ok: !r.error && !r.signal && (step.okCodes || [0]).includes(r.code) });
      if (cancelled) break;
      send('log', '\n');
    }
    const summary = summarize(action, results, cancelled);
    summary.log = results.map((r) => `${r.header}${r.out}${r.error ? `${r.error}\n` : ''}`).join('\n');
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

ipcMain.handle('open-url', (_event, rawUrl) => {
  const value = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!value) return { ok: false, message: 'No URL supplied.' };
  return openBrowser(value).then((r) => ({ ok: r.code === 0, message: r.error || 'Opened in browser.' }));
});

ipcMain.handle('app-info', () => ({ version: app.getVersion(), appImage: !!process.env.APPIMAGE }));
ipcMain.handle('app-update-check', async () => ({ status: 'unavailable', current: app.getVersion() }));
ipcMain.handle('app-update-install', () => ({ ok: false, message: 'App update checks are unavailable in this build.' }));

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
  win.webContents.on('will-navigate', (event) => event.preventDefault());
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
