#!/bin/bash
# Auto-Release Script für ioBroker.victron-gx
# Verwendung: ./release.sh [version] [changelog_en] [changelog_de]
# Beispiel: ./release.sh 0.5.8 "Fix: something" "Fix: etwas"
# Ohne Argumente: Version automatisch um 0.0.1 erhöhen
set -e
cd "$(dirname "$0")"

# Version ermitteln
VERSION_PATTERN='^[0-9]+\.[0-9]+\.[0-9]+$'
if [[ "$1" =~ $VERSION_PATTERN ]]; then
    NEW_VERSION="$1"
    EN_MSG="${2:-Release $NEW_VERSION}"
    DE_MSG="${3:-$EN_MSG}"
else
    CURRENT=$(python3 -c "import json; print(json.load(open('package.json'))['version'])")
    MAJOR=$(echo $CURRENT | cut -d. -f1)
    MINOR=$(echo $CURRENT | cut -d. -f2)
    PATCH=$(echo $CURRENT | cut -d. -f3)
    NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
    EN_MSG="${1:-Release $NEW_VERSION}"
    DE_MSG="${2:-$EN_MSG}"
fi

echo "🚀 Release: $NEW_VERSION"
echo "   EN: $EN_MSG"
echo "   DE: $DE_MSG"
echo ""

# package.json Version
CURRENT=$(python3 -c "import json; print(json.load(open('package.json'))['version'])")
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" package.json

# io-package.json: Version + news (max 7)
PACKAGE_NAME=$(python3 -c "import json; print(json.load(open('package.json'))['name'])")

python3 - << PYEOF
import json
import urllib.request
import urllib.error

PACKAGE_NAME = '$PACKAGE_NAME'
NEW_VERSION = '$NEW_VERSION'
EN_MSG = """$EN_MSG"""
DE_MSG = """$DE_MSG"""

try:
    url = f'https://registry.npmjs.org/{PACKAGE_NAME}'
    with urllib.request.urlopen(url, timeout=10) as resp:
        npm_data = json.loads(resp.read())
    npm_versions = set(npm_data.get('versions', {}).keys())
    print(f"  npm Versionen gefunden: {len(npm_versions)}")
except Exception as e:
    print(f"  ⚠ npm-Prüfung fehlgeschlagen: {e} - überspringe Prüfung")
    npm_versions = None

with open('io-package.json', 'r') as f:
    data = json.load(f)

data['common']['version'] = NEW_VERSION

if npm_versions is not None:
    news = data['common']['news']
    to_remove = [v for v in list(news.keys()) if v != NEW_VERSION and v not in npm_versions]
    for v in to_remove:
        print(f"  🗑 Entferne nicht existierende Version aus news: {v}")
        del news[v]

data['common']['news'][NEW_VERSION] = {
    "en": EN_MSG,
    "de": DE_MSG,
    "ru": EN_MSG, "pt": EN_MSG, "nl": EN_MSG,
    "fr": EN_MSG, "it": EN_MSG, "es": EN_MSG,
    "pl": EN_MSG, "uk": EN_MSG, "zh-cn": EN_MSG
}

news = data['common']['news']
keys = list(news.keys())
while len(keys) > 7:
    print(f"  Entferne alten news-Eintrag: {keys[0]}")
    del news[keys[0]]
    keys = list(news.keys())

print(f"  news Einträge: {list(news.keys())}")

with open('io-package.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
PYEOF

# README Changelog
python3 - << PYEOF
import re
from datetime import date

content = open('README.md', 'r').read()
new_entry = f"### $NEW_VERSION ({date.today()})\n- $EN_MSG\n\n"
content = content.replace("## Changelog\n\n", f"## Changelog\n\n{new_entry}")
open('README.md', 'w').write(content)
print("  README aktualisiert")
PYEOF

# Tests
echo ""
echo "🧪 Tests..."
npm test 2>&1 | tail -3

# Build
echo ""
echo "🔨 Build..."
sudo rm -rf build/
npm run build 2>&1 | tail -3

# Git Tag + Push
echo ""
echo "📦 Git Tag + Push..."
./github-push.sh "release: v$NEW_VERSION - $EN_MSG"
git tag "v$NEW_VERSION"
git push origin "v$NEW_VERSION"

echo ""
echo "✅ Release v$NEW_VERSION fertig!"
echo "   → https://github.com/Sefina-DS/ioBroker.victron-gx/releases/tag/v$NEW_VERSION"