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
