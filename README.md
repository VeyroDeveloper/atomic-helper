# Atomic Helper

<p align="center">
  <img src="icon.png" alt="Atomic Helper icon" width="128" />
</p>

<p align="center"><strong>Friendly maintenance, setup, and security for Fedora Atomic desktops.</strong></p>

Atomic Helper is a desktop utility for Fedora Silverblue, Kinoite, and other rpm-ostree-based systems. It presents common maintenance tasks in a guided interface, with clear status and command output.

## Features

- **System maintenance:** check for and stage system updates, update Flatpaks, clean up unused data, and roll back to the previous deployment.
- **Firmware:** check for and install available firmware updates.
- **Post-install setup:** enable Flathub, install Flatseal, configure RPM Fusion and codecs, and enable automatic system updates.
- **Security:** manage the firewall, inspect SELinux status, and choose DNS providers or custom DNS addresses.
- **Apps and packages:** list and remove Flatpaks; add and remove layered system packages.
- **App updates:** check GitHub Releases for a newer AppImage and install it in-app when running from an AppImage.
- **Firejail sandboxing:** analyze an executable, review access options and a command preview, then launch it in a per-app sandbox. The Rust implementation details and requirements are in [FIREJAIL.md](FIREJAIL.md).

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

The Firejail sandbox feature requires Firejail installed on the host. On Fedora Atomic, install it with `rpm-ostree install firejail` and restart.

## Requirements

- Fedora Silverblue, Kinoite, or another rpm-ostree-based desktop
- `rpm-ostree` and `flatpak` for system and app maintenance
- NetworkManager for DNS management
- A desktop session with a policy authorization prompt for privileged actions
- Firejail for app sandboxing

## Build from source

The AppImage build requires Linux, Rust/Cargo, `curl`, and either `unzip` or Python 3. It downloads Electron and `appimagetool` as needed.

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

The tag must match the version in `package.json` (for example, `v0.3.2` and `0.3.2`). The GitHub Actions workflow builds and attaches the x86_64 AppImage. Follow the run in Actions to confirm that the build and release completed.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Rust migration

Rust is being introduced incrementally: the Firejail app analysis, argument construction, validation, and launch backend are implemented in Rust, while Electron continues to provide the current UI and existing system-maintenance features. Further migration should preserve this split until parity and tests justify moving more behavior.

## Safety

- The UI requests named actions rather than arbitrary shell commands.
- User-supplied package names, Flatpak IDs, DNS addresses, and sandbox options are validated.
- Privileged system changes use the desktop's authorization mechanism.
- Update downloads are obtained from the project's GitHub Releases.
- Sandboxed apps are launched with a structured argument list, not a shell command string; the preview is informational only.

## License

MIT. See [LICENSE](LICENSE).
