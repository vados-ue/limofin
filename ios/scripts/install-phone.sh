#!/usr/bin/env bash
# Rebuild + reinstall LimoFin on the physical iPhone.
# Free-tier signing expires every 7 days; run this to refresh.
# Usage: bash ios/scripts/install-phone.sh  (phone plugged in or on same Wi-Fi with pairing)
set -euo pipefail
cd "$(dirname "$0")/.."
DEVICE="${1:-69E96D08-34BB-5C38-8382-721DB08B02A7}"   # LimonPhone
TEAM="TB6828S29U"                                      # Andreas Limones (Personal Team)

xcodebuild -project LimoFin.xcodeproj -scheme LimoFin \
  -destination 'generic/platform=iOS' -configuration Debug build \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic | tail -3

APP=$(ls -d "$HOME"/Library/Developer/Xcode/DerivedData/LimoFin-*/Build/Products/Debug-iphoneos/LimoFin.app | head -1)
xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --device "$DEVICE" com.limones.limofin || true
echo "LimoFin refreshed on the phone."
