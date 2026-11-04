# Atomic Helper

<p align="center">
  <img src="icon.png" alt="Atomic Helper icon" width="128" />
</p>

<p align="center">
  <strong>Friendly one-click maintenance, setup, and security for Fedora Atomic desktops.</strong>
</p>

Atomic Helper is a lightweight desktop app for Fedora Silverblue, Kinoite, and other rpm-ostree-based systems. It brings the most common maintenance tasks into a clean, guided interface so you can keep your system healthy without digging through documentation or terminal commands.

## Why Atomic Helper?

Fedora Atomic systems are excellent, but they come with a few recurring tasks:

- checking for system updates
- installing Flatpak apps and system package updates
- enabling the usual post-install steps
- managing security settings such as DNS and firewall
- restarting at the right time

Atomic Helper makes those tasks approachable and transparent, with clear status indicators and detailed command output when needed.

## Highlights

### Home
- Update the system and Flatpak apps with one click
- Check for system updates or firmware updates
- Clean up caches and unused runtimes
- Roll back to the previous system version if needed
- Restart banner when a reboot is pending

### Post-install
- One-click setup for common Fedora Atomic tasks
- Flathub, Flatseal, RPM Fusion, codecs, and automatic updates
- Clear status for each step: done, waiting for restart, blocked, or recommended

### Security
- Turn the firewall on or tighten it to the stricter public zone
- View SELinux status and automatic update status
- Change DNS to Cloudflare, Google, Quad9, AdGuard, or custom servers

### Apps & packages
- Add or remove layered system packages
- Review and remove installed Flatpak apps

## Install

Atomic Helper ships as a single AppImage, which fits Fedora Atomic well because it avoids modifying the base system.

### 1. Download the AppImage

Download the latest release from the GitHub releases page:

https://github.com/VeyroDeveloper/atomic-helper/releases/latest

### 2. Make it executable

Linux shell:

```bash
chmod +x AtomicHelper-x86_64.AppImage
```

Or via the file manager: right-click the file, open Properties, and enable "Allow executing file as program".

### 3. Run it

```bash
./AtomicHelper-x86_64.AppImage
```

If you see a FUSE-related error, use:

```bash
./AtomicHelper-x86_64.AppImage --appimage-extract-and-run
```

### 4. Optional: add it to your applications menu

```bash
mkdir -p ~/Applications ~/.local/share/applications ~/.local/share/icons
mv AtomicHelper-x86_64.AppImage ~/Applications/
cp icon.png ~/.local/share/icons/atomic-helper.png

cat > ~/.local/share/applications/atomic-helper.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Atomic Helper
Comment=Friendly one-click updates and upkeep for Fedora Atomic
Exec=$HOME/Applications/AtomicHelper-x86_64.AppImage
Icon=$HOME/.local/share/icons/atomic-helper.png
Terminal=false
Categories=System;Settings;
EOF
```

After that, log out and back in if the app does not appear immediately.

## Requirements

- Fedora Silverblue, Kinoite, or another rpm-ostree-based Fedora Atomic desktop
- `flatpak` and `rpm-ostree` installed (included by default)
- `NetworkManager` for DNS changes (included by default on Fedora desktops)
- A desktop session with a policy prompt for privileged actions

## How updates work

Atomic Helper can check GitHub for a newer release and present an in-app update banner when one is available.

If the app is running as an AppImage, the app can download the new AppImage, replace the old one, and restart itself. If it is not running as an AppImage, the app opens the download page instead.

## Build from source

You only need `curl` and `python3` (or `unzip`). No Node.js installation is required.

```bash
git clone https://github.com/VeyroDeveloper/atomic-helper.git
cd atomic-helper
./build.sh
```

The build script downloads Electron and `appimagetool`, packages the app, and creates an AppImage such as:

```text
AtomicHelper-x86_64.AppImage
```

## Releasing a new version

To publish a new release:

1. Increase the version in `package.json`
2. Commit and push your changes
3. Create and push a matching tag

```bash
git tag v0.3.1
git push origin v0.3.1
```

The GitHub Actions workflow in `.github/workflows/release.yml` will build the AppImage and attach it to a GitHub release automatically. Installed copies will detect the new version on their next start.

## Project structure

```text
.
├── build.sh             # Builds the AppImage package
├── main.js              # Electron main process and privileged actions
├── preload.js           # Safe IPC bridge
├── renderer.js          # UI logic and interactions
├── index.html           # App layout
├── style.css            # Styling
├── icon.png, icon.svg   # App branding
├── package.json         # Version and metadata
├── README.md            # Project documentation
├── LICENSE              # MIT license
└── .github/workflows    # Release automation
```

## Safety and design

Atomic Helper is designed to be careful and transparent:

- The UI sends only a fixed list of known actions
- Package names, Flatpak IDs, and DNS values are validated before use
- Privileged actions use the normal desktop password prompt
- Detailed command output is visible in the activity view when something goes wrong

## Status

This project is in active early development, but the core maintenance workflow is already in place. If a step fails on your system, check the detailed log in the activity sheet and open an issue with the output so it can be improved.

## License

MIT. See [LICENSE](LICENSE) for full details.

---

Built with care for Fedora Atomic desktops.
