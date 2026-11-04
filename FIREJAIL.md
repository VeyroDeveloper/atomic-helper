# Firejail sandbox integration

Atomic Helper includes a Firejail-based app sandbox panel on the Home screen. Select an executable ELF program or AppImage, review the access options, preview the exact invocation, and launch it through the Rust backend. The backend validates the selected file and builds Firejail arguments without passing shell command strings.

## Build

The AppImage build now requires Rust/Cargo in addition to the existing Linux build requirements. From the repository root, run:

```bash
./build.sh
```

The build compiles `rust/firejail` and packages the resulting sidecar binary with the Electron app. To run the Electron app from source during development, first run `cargo build --release --manifest-path rust/firejail/Cargo.toml`; the packaged Home-screen sandbox panel is injected by `build.sh`.

Firejail itself is a system dependency and is not bundled. On Fedora Atomic, install it with `rpm-ostree install firejail` and restart. The UI displays a reminder when it is unavailable.

The sandbox starts with a separate per-app home, no-new-privileges, dropped capabilities, seccomp, private temporary storage, and network/video restrictions according to the selected options. Explicitly enabled common folders are exposed using Firejail whitelist rules. Review the command preview and permissions before launching. This feature does not claim that Firejail replaces Flatpak's application sandbox or makes untrusted software risk-free.
