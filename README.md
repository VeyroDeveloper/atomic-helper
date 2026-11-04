# Atomic Helper

<p align="center">
  <img src="icon.png" alt="Atomic Helper icon" width="128" />
</p>

<p align="center">
  <strong>Friendly maintenance, setup, and security for Fedora Atomic desktops.</strong>
</p>

Atomic Helper is a desktop utility for Fedora Silverblue, Kinoite, and other rpm-ostree-based systems. It presents common maintenance tasks in a guided interface, with clear status and command output when you need it.

> **Project status:** The current released application uses Electron and JavaScript. A Rust migration has not yet been implemented. See [Rust migration](#rust-migration) for the proposed direction.

## Features

- **System maintenance:** check for and stage system updates, update Flatpaks, clean up unused data, and roll back to the previous deployment.
- **Firmware:** check for and install available firmware updates.
- **Post-install setup:** enable Flathub, install Flatseal, configure RPM Fusion and codecs, and enable automatic system updates.
- **Security:** manage the firewall, inspect SELinux status, and choose DNS providers or custom DNS addresses.
- **Apps and packages:** list and remove Flatpaks; add and remove layered system packages.
- **App updates:** check GitHub Releases for a newer AppImage and install it in-app when running from an AppImage.

System updates are staged and generally require a restart to take effect. Privileged actions use the desktop's normal authorization prompt.

## Install

Download the latest AppImage from [GitHub Releases](https://github.com/VeyroDeveloper/atomic-helper/releases/latest).

```bash
chmod +x AtomicHelper-x86_64.AppImage
./AtomicHelper-x86_64.AppImage
```

If FUSE is unavailable, run it with:

```bash
./AtomicHelper-x86_64.AppImage --appimage-extract-and-run
```

The published release workflow currently attaches an x86_64 AppImage. The app updater can replace the running app only when Atomic Helper itself is launched as an AppImage; otherwise it opens the release page.

## Requirements

- Fedora Silverblue, Kinoite, or another rpm-ostree-based desktop
- `rpm-ostree` and `flatpak` for system and app maintenance
- NetworkManager for DNS management
- A desktop session with a policy authorization prompt for privileged actions

## Build from source

The existing Electron build script requires Linux, `curl`, and either `unzip` or Python 3. It downloads Electron and `appimagetool` as needed.

```bash
git clone https://github.com/VeyroDeveloper/atomic-helper.git
cd atomic-helper
bash ./build.sh
```

The output is `AtomicHelper-x86_64.AppImage` on x86_64 or `AtomicHelper-aarch64.AppImage` on aarch64.

## Publish a release

Update the version in `package.json`, commit and push the change, then push a matching version tag. For example:

```bash
git tag v0.3.2
git push origin main
git push origin v0.3.2
```

The tag must match the version in `package.json` (for example, `v0.3.2` and `0.3.2`). The GitHub Actions workflow builds and attaches the x86_64 AppImage. Follow the run in [Actions](https://github.com/VeyroDeveloper/atomic-helper/actions) and check [Releases](https://github.com/VeyroDeveloper/atomic-helper/releases) for the published asset.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Rust migration

Rust is a longer-term architecture change, not a feature of the current release. The existing Electron main process owns privileged command execution, system status, and AppImage updating; replacing it requires preserving those safety boundaries and the release/update behavior.

A sensible migration should be incremental:

1. Define and test the Rust backend's command and data interfaces while keeping the current UI working.
2. Port system discovery and report generation, then maintenance actions, with input validation and explicit command allowlists.
3. Evaluate a Rust desktop shell such as Tauri only after the backend behavior has parity tests.
4. Benchmark startup time, memory use, and package size against the current Electron build before claiming efficiency gains.
5. Update AppImage packaging, release automation, and the in-app updater together, then publish a test release.

Rust can improve memory safety and may reduce runtime overhead, but the current app spends much of its work waiting on system tools and network operations. Performance benefits should be measured rather than assumed. No Rust rewrite or Rust build target is included yet.

## Safety

- The UI requests named actions rather than arbitrary shell commands.
- User-supplied package names, Flatpak IDs, and DNS addresses are validated.
- Privileged system changes use the desktop's authorization mechanism.
- Update downloads are obtained from the project's GitHub Releases.

## License

MIT. See [LICENSE](LICENSE).
