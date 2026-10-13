#!/bin/bash
#
# Builds the TypePal runtime as a universal (arm64 + x86_64) .app.
#
#   ./build-app.sh                      → build/TypePal.app  (template, no pet)
#   ./build-app.sh --pet <dir> [--name N] → build/<N>.app     (pet embedded;
#                                           N defaults to the manifest's name)
#
# The template is what the Maker copies when it generates a pet. Embedding a
# pet here does the same thing by hand, for testing.
#
set -euo pipefail
cd "$(dirname "$0")"

PET_DIR=""
NAME=""
while [ $# -gt 0 ]; do
    case "$1" in
        --pet) PET_DIR="$2"; shift 2 ;;
        --name) NAME="$2"; shift 2 ;;
        *) echo "unknown argument: $1" >&2; exit 1 ;;
    esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if [ -z "$NAME" ]; then
    if [ -n "$PET_DIR" ]; then
        NAME=$(/usr/bin/plutil -extract name raw -o - "$PET_DIR/manifest.json")
    else
        NAME="TypePal"
    fi
fi

say "1/3  swift build (arm64 + x86_64, release)"
swift build -c release --arch arm64 --arch x86_64 2>&1 | grep -E "error|warning: .*TypePal|Compiling|Build complete" || true
BIN=".build/apple/Products/Release/TypePal"
[ -x "$BIN" ] || { echo "build failed: $BIN not found" >&2; exit 1; }

say "2/3  assemble $NAME.app"
APP="build/$NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/TypePal"

BUNDLE_ID="io.typepal.template"
ICON_KEY=""
if [ -n "$PET_DIR" ]; then
    cp -R "$PET_DIR" "$APP/Contents/Resources/Pet"
    PET_ID=$(/usr/bin/plutil -extract id raw -o - "$PET_DIR/manifest.json")
    BUNDLE_ID="io.typepal.pet.$PET_ID"

    # icon.png → AppIcon.icns, with every size the Dock and Finder ask for.
    if [ -f "$PET_DIR/icon.png" ]; then
        ICONSET=$(mktemp -d)/AppIcon.iconset
        mkdir -p "$ICONSET"
        for size in 16 32 128 256 512; do
            sips -z $size $size "$PET_DIR/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
            sips -z $((size * 2)) $((size * 2)) "$PET_DIR/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
        done
        iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
        rm -rf "$(dirname "$ICONSET")"
        rm -f "$APP/Contents/Resources/Pet/icon.png"
        ICON_KEY="<key>CFBundleIconFile</key><string>AppIcon</string>"
    fi
fi

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>TypePal</string>
    <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
    <key>CFBundleName</key><string>$NAME</string>
    <key>CFBundleDisplayName</key><string>$NAME</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>0.1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    $ICON_KEY
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF

say "3/3  ad-hoc sign"
codesign --force --sign - "$APP"
codesign --verify --strict "$APP"

echo "$(lipo -archs "$APP/Contents/MacOS/TypePal") · $(du -sh "$APP" | cut -f1) · $APP"
