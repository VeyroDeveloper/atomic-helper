#!/usr/bin/env bash
# Builds Atomic Helper into a single AppImage.
# Needs: curl and python3 (or unzip). Run it from any folder: ./build.sh
set -euo pipefail

ELECTRON_VERSION="42.0.0"

cd "$(dirname "$(readlink -f "$0")")"
SRC="$PWD"
WORK="$SRC/.build"

case "$(uname -m)" in
  x86_64)  ARCH=x86_64;  EL_ARCH=x64 ;;
  aarch64) ARCH=aarch64; EL_ARCH=arm64 ;;
  *) echo "Unsupported CPU: $(uname -m)"; exit 1 ;;
esac

command -v curl >/dev/null || { echo "curl is required"; exit 1; }
mkdir -p "$WORK"

echo "==> Downloading Electron $ELECTRON_VERSION (about 115 MB, once)"
EL_ZIP="$WORK/electron-$ELECTRON_VERSION-$EL_ARCH.zip"
[ -s "$EL_ZIP" ] || curl -fL --retry 3 -o "$EL_ZIP" \
  "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-linux-$EL_ARCH.zip"

echo "==> Downloading appimagetool (once)"
TOOL="$WORK/appimagetool-$ARCH.AppImage"
[ -s "$TOOL" ] || curl -fL --retry 3 -o "$TOOL" \
  "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-$ARCH.AppImage"
chmod +x "$TOOL"

echo "==> Assembling the app"
APPDIR="$WORK/AtomicHelper.AppDir"
LIB="$APPDIR/usr/lib/atomic-helper"
rm -rf "$APPDIR"
mkdir -p "$LIB"
if command -v unzip >/dev/null; then
  unzip -q "$EL_ZIP" -d "$LIB"
else
  python3 -m zipfile -e "$EL_ZIP" "$LIB"
fi
chmod +x "$LIB/electron" "$LIB/chrome_crashpad_handler" 2>/dev/null || true
mv "$LIB/electron" "$LIB/atomic-helper"
rm -f "$LIB/chrome-sandbox" "$LIB/resources/default_app.asar"
find "$LIB/locales" -name '*.pak' ! -name 'en-US.pak' ! -name 'de.pak' -delete

mkdir -p "$LIB/resources/app"
cp "$SRC"/{package.json,main.js,preload.js,index.html,style.css,renderer.js,icon.png,icon.svg} "$LIB/resources/app/"

cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/lib/atomic-helper/atomic-helper" --no-sandbox "$@"
EOF
chmod +x "$APPDIR/AppRun"

cat > "$APPDIR/atomic-helper.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Atomic Helper
GenericName=System Maintenance
Comment=Friendly one-click updates and upkeep for Fedora Atomic
Exec=AppRun
Icon=atomic-helper
Terminal=false
Categories=System;Settings;
Keywords=update;upgrade;rpm-ostree;flatpak;atomic;silverblue;kinoite;
StartupWMClass=atomic-helper
EOF
cp "$SRC/icon.png" "$APPDIR/atomic-helper.png"
ln -sf atomic-helper.png "$APPDIR/.DirIcon"

echo "==> Packing the AppImage"
# Extracting the tool first means this works even without FUSE.
rm -rf "$WORK/tool" "$WORK/squashfs-root"
(cd "$WORK" && "$TOOL" --appimage-extract >/dev/null && mv squashfs-root tool)
OUT="$SRC/AtomicHelper-$ARCH.AppImage"
ARCH="$ARCH" "$WORK/tool/AppRun" "$APPDIR" "$OUT" >/dev/null
chmod +x "$OUT"

echo
echo "Done: $OUT"
echo "Run it with:  $OUT"
echo "(If it complains about FUSE, run:  $OUT --appimage-extract-and-run)"
