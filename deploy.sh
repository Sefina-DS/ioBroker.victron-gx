#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  deploy.sh — Victron GX Adapter Deploy Script (DEV)
#  Nutzung: ./deploy.sh [--no-build] [--no-restart]
# ═══════════════════════════════════════════════════════════
set -e
ADAPTER="victron-gx"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NO_BUILD=false
NO_RESTART=false

for arg in "$@"; do
    case $arg in
        --no-build)    NO_BUILD=true ;;
        --no-restart)  NO_RESTART=true ;;
    esac
done

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Victron GX Adapter Deploy              ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. TypeScript bauen ───────────────────────────────────
if [ "$NO_BUILD" = false ]; then
    echo "▶ Baue TypeScript..."
    cd "$SCRIPT_DIR"
    npm run build
    echo "✓ Build abgeschlossen"
    echo ""
else
    echo "⏭ Build übersprungen"
fi

# ── 2. Upload zu ioBroker DB ─────────────────────────────
echo "▶ Upload zu ioBroker..."
iobroker upload "$ADAPTER" --allow-root
echo "✓ Upload abgeschlossen"
echo ""

# ── 3. Adapter neu starten ────────────────────────────────
if [ "$NO_RESTART" = false ]; then
    echo "▶ Starte Adapter neu..."
    iobroker restart "$ADAPTER" --allow-root
    echo "✓ Adapter neugestartet"
    echo ""
else
    echo "⏭ Neustart übersprungen"
fi

echo "════════════════════════════════════════════"
echo "✅ Deploy abgeschlossen!"
echo "   → Admin UI: Instanzen → victron-gx.0"
echo "════════════════════════════════════════════"
echo ""