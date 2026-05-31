#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  deploy.sh — Victron GX Adapter Deploy Script (DEV)
#  Nutzung: ./deploy.sh [--no-build] [--no-restart] [--no-lint]
# ═══════════════════════════════════════════════════════════
set -e
ADAPTER="victron-gx"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NO_BUILD=false
NO_RESTART=false
NO_LINT=false

for arg in "$@"; do
    case $arg in
        --no-build)    NO_BUILD=true ;;
        --no-restart)  NO_RESTART=true ;;
        --no-lint)     NO_LINT=true ;;
    esac
done

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Victron GX Adapter Deploy              ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Sicherheitscheck ──────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/io-package.json" ]; then
    echo "❌ FEHLER: Falsches Verzeichnis!"
    echo "   Script muss aus dem Victron Adapter Ordner gestartet werden."
    exit 1
fi

ADAPTER_NAME=$(grep '"name"' "$SCRIPT_DIR/io-package.json" | head -1 | sed 's/.*"name": "\(.*\)".*/\1/')
if [ "$ADAPTER_NAME" != "victron-gx" ]; then
    echo "❌ FEHLER: Falscher Adapter! Gefunden: $ADAPTER_NAME"
    exit 1
fi

echo "✓ Verzeichnis: $SCRIPT_DIR"
echo ""

# ── 1. Lint + Auto-Fix ────────────────────────────────────
if [ "$NO_LINT" = false ]; then
    echo "▶ Prüfe Code (lint --fix)..."
    cd "$SCRIPT_DIR"
    npm run lint -- --fix 2>&1 || true
    # Nochmal ohne --fix prüfen ob noch Fehler übrig sind
    if ! npm run lint 2>&1; then
        echo ""
        echo "❌ Lint-Fehler gefunden – Deploy abgebrochen!"
        echo "   Bitte die obigen Fehler beheben."
        exit 1
    fi
    echo "✓ Lint OK"
    echo ""
else
    echo "⏭ Lint übersprungen"
fi

# ── 2. TypeScript bauen ───────────────────────────────────
if [ "$NO_BUILD" = false ]; then
    echo "▶ Baue TypeScript..."
    cd "$SCRIPT_DIR"
    npm run build
    echo "✓ Build abgeschlossen"
    echo ""
else
    echo "⏭ Build übersprungen"
fi

# ── 3. Upload zu ioBroker DB ─────────────────────────────
echo "▶ Upload zu ioBroker..."
iobroker upload "$ADAPTER" --allow-root
echo "✓ Upload abgeschlossen"
echo ""

# ── 4. Adapter neu starten ────────────────────────────────
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