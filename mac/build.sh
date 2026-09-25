#!/bin/zsh
# Builds Speechform.app into this folder: a native window around the local Speechform page.
set -eu
cd "${0:A:h}"
A="Speechform.app"
rm -rf "$A"; mkdir -p "$A/Contents/MacOS" "$A/Contents/Resources"
xcrun swiftc -O -o "$A/Contents/MacOS/Speechform" Speechform.swift
cp icon.icns "$A/Contents/Resources/speechform.icns" 2>/dev/null || true
cat > "$A/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Speechform</string>
<key>CFBundleDisplayName</key><string>Speechform</string>
<key>CFBundleIdentifier</key><string>org.speechform.app</string>
<key>CFBundleExecutable</key><string>Speechform</string>
<key>CFBundleIconFile</key><string>speechform</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign --force --deep -s - "$A" >/dev/null 2>&1 || true
echo "Built mac/$A"
