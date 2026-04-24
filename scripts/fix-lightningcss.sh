#!/bin/bash
# Fix lightningcss native binary for Linux (Vercel) deployments.
# npm workspaces hoists lightningcss to root but the platform binary
# doesn't always get placed inside the package directory.

TARGET="node_modules/lightningcss/lightningcss.linux-x64-gnu.node"
SOURCE="node_modules/lightningcss-linux-x64-gnu/lightningcss.linux-x64-gnu.node"

if [ -f "$TARGET" ]; then
  echo "[fix-lightningcss] Binary already exists"
  exit 0
fi

if [ -f "$SOURCE" ]; then
  cp "$SOURCE" "$TARGET"
  echo "[fix-lightningcss] Copied binary from platform package"
  exit 0
fi

echo "[fix-lightningcss] Platform package not found, installing..."
npm install lightningcss-linux-x64-gnu --no-save --no-package-lock 2>/dev/null

if [ -f "$SOURCE" ]; then
  cp "$SOURCE" "$TARGET"
  echo "[fix-lightningcss] Installed and copied binary"
else
  echo "[fix-lightningcss] WARNING: Could not resolve binary"
  exit 1
fi
