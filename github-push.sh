#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  github-push.sh — GitHub Push Script
#  Nutzung: bash github-push.sh "Commit Nachricht"
#  Beispiel: bash github-push.sh "v0.0.1 - MQTT Verbindung"
# ═══════════════════════════════════════════════════════════
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   GitHub Push                            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Commit Nachricht ──────────────────────────────────────
if [ -z "$1" ]; then
    VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
    COMMIT_MSG="v$VERSION - Update"
    echo "⚠ Keine Commit-Nachricht angegeben, nutze: '$COMMIT_MSG'"
else
    COMMIT_MSG="$1"
fi
echo ""

# ── Status anzeigen ───────────────────────────────────────
echo "▶ Geänderte Dateien:"
git status --short
echo ""

# ── Staging ───────────────────────────────────────────────
echo "▶ Staging..."
git add .
echo "✓ Alle Dateien gestaged"
echo ""

# ── Commit ────────────────────────────────────────────────
echo "▶ Commit: '$COMMIT_MSG'"
git commit -m "$COMMIT_MSG" || echo "⚠ Nichts zu committen"
echo ""

# ── Push ──────────────────────────────────────────────────
echo "▶ Push zu GitHub..."
git push origin main
echo "✓ Push abgeschlossen"
echo ""

echo "════════════════════════════════════════════"
echo "✅ GitHub Push abgeschlossen!"
HASH=$(git rev-parse --short HEAD)
echo "   → Commit: $HASH"
echo "   → https://github.com/Sefina-DS/ioBroker.victron-gx"
echo "════════════════════════════════════════════"
echo ""