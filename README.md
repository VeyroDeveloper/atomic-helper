<p align="center">
  <img src="icon.png" alt="Atomic Helper icon" width="128">
</p>

<h1 align="center">Atomic Helper</h1>

<p align="center">
  Friendly one-click maintenance, setup and security for Fedora Atomic desktops.
</p>

---

Atomic Helper is a small desktop app for Fedora Atomic (Silverblue, Kinoite and friends) and other
rpm-ostree based distros. It saves you from digging through websites to find out what to do after
installing, and turns the usual maintenance tasks into simple buttons.

## Features

**Home**
- Update the system and all Flatpak apps with one click
- Check for updates, check and install firmware updates
- Clean up caches and unused runtimes
- Roll back to the previous system version
- Restart banner whenever a restart is needed

**Post-install**
- One click sets up the usual first steps: Flathub, Flatseal, RPM Fusion, multimedia codecs and automatic updates
- Every step shows its state (done, needs restart, not available yet) and can also be run on its own

**Security**
- Turn on the firewall with one click
- Switch to the stricter `public` firewall zone
- Automatic update status and SELinux status at a glance
- Change the DNS server: Cloudflare, Google, Quad9, AdGuard, custom IPs, or back to automatic

**Apps & packages**
- Add or remove layered system packages
- List and remove Flatpak apps

## Install

Atomic Helper is distributed as an AppImage, a single file that runs without installing anything into
your system. That fits Atomic distros well, because the base system stays untouched.

### 1. Get the AppImage

Download `AtomicHelper-x86_64.AppImage` from the
[latest release](https://github.com/VeyroDeveloper/atomic-helper/releases/latest).
If you prefer, you can also build it yourself, see [Build](#build) below.

### 2. Make it executable

```bash
chmod +x AtomicHelper-x86_64.AppImage
```

Or in the file manager: right-click the file, open Properties, and enable "Allow executing file as program".

### 3. Run it

```bash
./AtomicHelper-x86_64.AppImage
```

Or just double-click it. If it complains about FUSE, use:

```bash
./AtomicHelper-x86_64.AppImage --appimage-extract-and-run
```

### 4. Optional: add it to your app menu

Put the AppImage somewhere permanent, for example `~/Applications`, then create a launcher:

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

After that, Atomic Helper shows up in your app launcher. Log out and in again if it does not appear right away.

### Requirements

- Fedora Silverblue, Kinoite, or another rpm-ostree based system
- `flatpak` and `rpm-ostree` (both are included by default)
- `NetworkManager` for the DNS feature (included by default on Fedora desktops)
- A desktop session with a polkit password prompt, which is the default

### Updating and uninstalling

Atomic Helper checks GitHub for a newer release when it starts. If there is one, a banner appears on
the Home tab. Click **Update app** and it downloads the new AppImage, replaces the old one and restarts
itself. You can also check by hand under Help, About. In-app updating only works when the app runs as an
AppImage; otherwise the button opens the download page.

To uninstall, delete the AppImage and, if you made one, the launcher and icon:

```bash
rm ~/Applications/AtomicHelper-x86_64.AppImage
rm ~/.local/share/applications/atomic-helper.desktop
rm ~/.local/share/icons/atomic-helper.png
```

Atomic Helper keeps no settings outside its own app data, and changes it made to your system
(like added packages or DNS) can be undone from within the app.

## Build

You need `curl` and `python3` (or `unzip`). No Node.js is required.

```bash
git clone https://github.com/VeyroDeveloper/atomic-helper.git
cd atomic-helper
./build.sh
```

The script downloads Electron and `appimagetool` once and produces `AtomicHelper-x86_64.AppImage`
(or the `aarch64` variant) in the project folder. If the AppImage complains about FUSE, run it with:

```bash
./AtomicHelper-x86_64.AppImage --appimage-extract-and-run
```

## Releasing a new version

Pushing code alone does not update the app. Users get an update when you publish a release:

1. Raise `"version"` in `package.json`, for example to `0.3.1`.
2. Commit and push.
3. Create and push a tag that matches it:
   ```bash
   git tag v0.3.1
   git push origin v0.3.1
   ```

The workflow in `.github/workflows/release.yml` then builds the AppImage and attaches it to a new
GitHub release. Installed copies detect it on their next start. The repository must be public for
the update check to work without a login.

## How it works

- The UI never sends raw commands. It only sends action names from a fixed whitelist in `main.js`.
- Package names, Flatpak IDs and DNS addresses are validated before use.
- Privileged steps go through the normal desktop password prompt (polkit). Atomic Helper never sees your password.
- Command output is shown in a details view so you can always see what happened.

## Project layout

| File | Purpose |
| --- | --- |
| `main.js` | Electron main process: actions, status checks, command execution |
| `preload.js` | Safe bridge between UI and main process |
| `renderer.js` | UI logic |
| `index.html`, `style.css` | Layout and styling |
| `build.sh` | Builds the AppImage |

## Status

Early version (0.2.0). The post-install and security features have not been tested on every
Fedora release yet, so please open an issue if a step fails. The full command output is in the
details view of the activity window and helps a lot.

## License

MIT, see [LICENSE](LICENSE).
