'use strict';
/*
 * S6 Catalog-Replay-Harness (Ersatz für Live-Test, siehe evcharger_temp_PLAN.md).
 * Feuert JEDEN Topic aus einem Referenz-Catalog durch die ECHTE handleMessage()-Methode des
 * kompilierten Adapters (build/main.js) - kein Reimplement der Gate-Logik, sondern der
 * tatsächliche Code-Pfad. @iobroker/adapter-core wird per require.cache durch einen minimalen
 * In-Memory-Mock ersetzt (kein echter ioBroker-Host nötig).
 *
 * Manuelles Dev-Tool, NICHT Teil von `npm test` - braucht einen externen Catalog (reale
 * Community-Testdaten, nicht im Git-Repo, siehe _dev-tools/user-catalogs/).
 *
 * Aufruf: node test/catalog-replay.js [--catalog=/pfad/zum/catalog.json]
 *         [--controlEnabled] [--mqttControlEnabled]
 * Default: mqttControlEnabled=true, controlEnabled=false (der Bug-Report-Fall: MQTT-Control
 * ohne Modbus-Control aktiviert - siehe Bugfix v0.9.2, subscribeStates('control.*') war nur an
 * controlEnabled gekoppelt, nicht an mqttControlEnabled).
 */
const path = require('path');
const EventEmitter = require('events');

const ADAPTER_DIR = path.join(__dirname, '..');

const args = process.argv.slice(2);
function flag(name, def) {
    if (args.includes(`--${name}`)) return true;
    if (args.includes(`--no-${name}`)) return false;
    return def;
}
const catalogArg = args.find(a => a.startsWith('--catalog='));
const CATALOG_FILE = catalogArg
    ? catalogArg.slice('--catalog='.length)
    : '/opt/iobroker/dev/_dev-tools/user-catalogs/1785153933178-victron-gx-catalog.json';

const config = {
    controlEnabled: flag('controlEnabled', false),
    mqttControlEnabled: flag('mqttControlEnabled', true),
};

// ── Minimal-Mock für @iobroker/adapter-core ──────────────────────────────────
const objects = new Map(); // id -> object definition
const states = new Map(); // id -> {val, ack}
const logs = [];
const subscribedPatterns = [];
// v0.9.3-Regression (Problem A): setState() gewann wiederholt gegen die Objekt-Anlage, weil
// extendObjectAsync()/setObjectNotExistsAsync() im echten Adapter fire-and-forget (ohne await)
// vor dem setState() für denselben State standen. Ein Mock, dessen Objekt-Anlage synchron
// resolved, kann diese Race NIE sehen (async-Funktionen ohne eigenes await laufen bis zum ersten
// return synchron durch, das Objekt steht dann schon, bevor der Aufrufer überhaupt zum nächsten
// void-Call kommt). Der künstliche Makrotask-Delay hier stellt die reale Objects-DB-Latenz nach
// (Datei-/IPC-Roundtrip zum js-controller) und macht die Race für unawaited Aufrufer sichtbar -
// genau wie in der Praxis.
const DB_LATENCY_MS = 2;
function dbDelay() {
    return new Promise(resolve => setTimeout(resolve, DB_LATENCY_MS));
}
const missingObjectViolations = []; // setState()-Aufrufe, deren Objekt zu dem Zeitpunkt noch fehlte

class MockAdapter extends EventEmitter {
    constructor(options = {}) {
        super();
        this.namespace = 'victron-gx.0';
        this.config = options.config || {};
        this.log = {
            info: m => logs.push(['info', m]),
            warn: m => logs.push(['warn', m]),
            error: m => logs.push(['error', m]),
            debug: m => logs.push(['debug', m]),
            silly: m => logs.push(['silly', m]),
        };
    }
    async setObjectNotExistsAsync(id, obj) {
        await dbDelay();
        if (!objects.has(id)) {
            objects.set(id, obj);
        }
        return { id };
    }
    async extendObjectAsync(id, obj) {
        await dbDelay();
        const existing = objects.get(id) || { type: obj.type, common: {}, native: {} };
        objects.set(id, {
            type: obj.type || existing.type,
            common: { ...existing.common, ...obj.common },
            native: { ...existing.native, ...obj.native },
        });
        return { id };
    }
    async delObjectAsync(id) {
        objects.delete(id);
    }
    setState(id, val, ack) {
        // Reale ioBroker-Semantik: setState() auf ein nicht existierendes Objekt wirft NICHT -
        // es schreibt den Wert trotzdem und loggt nur die "has no existing object"-Warnung. Deshalb
        // hier hart mitzählen statt auf eine Exception zu hoffen.
        if (!objects.has(id)) {
            missingObjectViolations.push(id);
        }
        if (val && typeof val === 'object' && 'val' in val) {
            states.set(id, val);
        } else {
            states.set(id, { val, ack });
        }
        return Promise.resolve();
    }
    async getStateAsync(id) {
        return states.get(id);
    }
    // Muss das reale Subscribe-Pattern aufzeichnen - der ursprüngliche No-Op-Stub war exakt die
    // Lücke, die den v0.9.2-Bug (subscribeStates deckte control.evcharger.* nicht ab) durchrutschen
    // ließ: ein Test, der onStateChange() direkt aufruft, umgeht subscribeStates() komplett.
    subscribeStates(pattern) {
        subscribedPatterns.push(pattern);
    }
    sendTo() {}
    setTimeout(fn, ms, ...args) {
        const t = setTimeout(fn, ms, ...args);
        if (t.unref) t.unref();
        return t;
    }
    clearTimeout(t) {
        clearTimeout(t);
    }
    setInterval(fn, ms, ...args) {
        const t = setInterval(fn, ms, ...args);
        if (t.unref) t.unref();
        return t;
    }
    clearInterval(t) {
        clearInterval(t);
    }
}

// io-package.json instanceObjects (z.B. info.connection) werden von js-controller VOR dem
// Adapter-Start angelegt, nicht vom Adapter-Code selbst - im Mock nachbilden, sonst wäre der
// Objekt-existiert-Check für diese States ein Fehlalarm, den es in der Praxis nie gibt.
const ioPackage = require(path.join(ADAPTER_DIR, 'io-package.json'));
for (const obj of ioPackage.instanceObjects || []) {
    objects.set(obj._id, { type: obj.type, common: obj.common || {}, native: obj.native || {} });
}

const acCorePath = require.resolve('@iobroker/adapter-core', { paths: [ADAPTER_DIR] });
require.cache[acCorePath] = {
    id: acCorePath,
    filename: acCorePath,
    loaded: true,
    exports: { Adapter: MockAdapter, EXIT_CODES: {} },
};

// ── VictronGx laden (kompiliert) ──────────────────────────────────────────────
const mainPath = path.join(ADAPTER_DIR, 'build', 'main.js');
const factory = require(mainPath);
const adapter = factory({ config });

// onReady() feuert async setupt subscribeStates() etc. - im echten Adapter über adapter-core
// Lifecycle getriggert, hier per direktem Aufruf simuliert, falls die Factory es nicht selbst tut.
if (typeof adapter.onReady === 'function' && adapter.listenerCount === undefined) {
    // no-op: reale onReady läuft bereits über EventEmitter 'ready' oder Constructor, siehe unten
}
adapter.emit('ready');

// ── Catalog laden ─────────────────────────────────────────────────────────────
let catalog;
try {
    catalog = require(CATALOG_FILE);
} catch (err) {
    console.error(`\nFEHLER: Catalog-Datei nicht lesbar: ${CATALOG_FILE}`);
    console.error(`  (${err.message})`);
    console.error('  Manuelles Dev-Tool - braucht einen echten Community-Catalog außerhalb des Repos.');
    console.error('  Pfad mit --catalog=/pfad/zur/datei.json überschreiben.');
    process.exit(2);
}
// Kompletter Catalog, nicht nur temperature/evcharger: Problem A (v0.9.3) betraf praktisch jeden
// Gerätetyp gleichzeitig (writeStateValue() wird typübergreifend genutzt) - ein Teilausschnitt
// hätte das nicht zuverlässig gezeigt. settings/* ist für den handleSettingsMqttUpdate()-Check
// (control.system.*) ausdrücklich mit drin.
//
// Synthetische Zellspannungs-Topics (battery/<instance>/Voltages/CellN): Samson71s Catalog hat
// KEINE einzelnen Zellspannungen (0 "Voltages/Cell*"-Topics), obwohl updateBatteryCellMinMax()
// genau darüber getriggert wird - dieser Pfad blieb dadurch komplett ungetestet und genau dort
// zeigte der reale Deploy-Regressionscheck auf Davids Hardware noch 24 Verstöße (cells.min), die
// dieser Test bis dahin nicht sah (v0.9.3-Nachfix). Für jede battery/<instance> im Catalog 8
// Zellen synthetisch injizieren, damit updateBatteryCellMinMax() im Burst mehrfach re-entrant
// aufgerufen wird, wie es ein reales Batteriepack tut.
const batteryInstances = new Set(
    Object.keys(catalog)
        .filter(k => k.startsWith('battery/'))
        .map(k => k.split('/')[1]),
);
for (const instance of batteryInstances) {
    for (let cell = 1; cell <= 8; cell++) {
        catalog[`battery/${instance}/Voltages/Cell${cell}`] = { value: 3.3 + cell * 0.001 };
    }
}

const topics = Object.keys(catalog);

const VRM_ID = 'abc123replay';

function priority(shortTopic) {
    if (shortTopic.endsWith('/Serial')) return 0;
    if (shortTopic.endsWith('/Mgmt/ProcessName')) return 1;
    if (shortTopic.endsWith('/ProductName')) return 2;
    return 3;
}
topics.sort((a, b) => priority(a) - priority(b));

for (const shortTopic of topics) {
    const topic = `N/${VRM_ID}/${shortTopic}`;
    const payload = Buffer.from(JSON.stringify(catalog[shortTopic]));
    adapter.handleMessage(topic, payload);
}
for (const shortTopic of topics) {
    const topic = `N/${VRM_ID}/${shortTopic}`;
    const payload = Buffer.from(JSON.stringify(catalog[shortTopic]));
    adapter.handleMessage(topic, payload);
}

// Async setObjectNotExistsAsync/extendObjectAsync-Aufrufe abwarten (fire-and-forget im echten Code).
// Deutlich über DB_LATENCY_MS, damit auch der letzte von tausenden künstlich verzögerten Calls
// durch ist, bevor ausgewertet wird.
setTimeout(() => {
    const createdStates = adapter.createdStates || new Set();
    const failures = [];

    console.log(`\nConfig: controlEnabled=${config.controlEnabled} mqttControlEnabled=${config.mqttControlEnabled}`);

    console.log('\n=== Erzeugte control.evcharger.* States ===');
    const ctrlStates = [...createdStates].filter(id => id.startsWith('control.evcharger.')).sort();
    for (const id of ctrlStates) console.log(`  ${id}`);

    // ── Check 1: common.write muss mqttControlEnabled widerspiegeln ──────────
    console.log('\n=== Check: common.write auf control.evcharger.* ===');
    for (const id of ctrlStates) {
        const obj = objects.get(id);
        const write = obj && obj.common && obj.common.write;
        const expected = config.mqttControlEnabled === true;
        const ok = write === expected;
        console.log(`  ${id}: write=${write} (erwartet ${expected}) ${ok ? 'OK' : 'FAIL'}`);
        if (!ok) {
            failures.push(`common.write für ${id} ist ${write}, erwartet ${expected} (mqttControlEnabled=${config.mqttControlEnabled})`);
        }
    }

    // ── Check 2: subscribeStates muss control.evcharger.* abdecken, wenn irgendein
    // Control-Flag aktiv ist (Bug v0.9.2: war exklusiv an controlEnabled gekoppelt) ──
    console.log('\n=== Check: subscribeStates deckt control.evcharger.* ab ===');
    console.log(`  Registrierte Patterns: ${JSON.stringify(subscribedPatterns)}`);
    const shouldBeSubscribed = config.controlEnabled || config.mqttControlEnabled;
    function globToRegExp(glob) {
        const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp(`^${escaped}$`);
    }
    for (const id of ctrlStates) {
        const covered = subscribedPatterns.some(p => globToRegExp(p).test(id));
        const ok = shouldBeSubscribed ? covered : true;
        console.log(`  ${id}: covered=${covered} (sollte abgedeckt sein: ${shouldBeSubscribed}) ${ok ? 'OK' : 'FAIL'}`);
        if (!ok) {
            failures.push(`${id} wird von keinem subscribeStates()-Pattern abgedeckt, obwohl controlEnabled=${config.controlEnabled} mqttControlEnabled=${config.mqttControlEnabled}`);
        }
    }
    if (shouldBeSubscribed && ctrlStates.length === 0) {
        failures.push('Keine control.evcharger.* States erzeugt - Catalog/Fixture prüfen (Check 2 kann nichts verifizieren)');
    }

    // ── Check 3: setState() darf NIE vor der Objekt-Anlage feuern (Problem A, v0.9.3) ──────
    console.log('\n=== Check: Objekt existiert VOR jedem setState() ===');
    if (missingObjectViolations.length === 0) {
        console.log('  (keine Verstöße - jedes setState() traf auf ein bereits existierendes Objekt)');
    } else {
        const byPrefix = new Map();
        for (const id of missingObjectViolations) {
            const prefix = id.split('.').slice(0, 2).join('.');
            byPrefix.set(prefix, (byPrefix.get(prefix) || 0) + 1);
        }
        console.log(`  ${missingObjectViolations.length} Verstöße, gruppiert nach Präfix:`);
        for (const [prefix, count] of [...byPrefix.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`    ${prefix}.*: ${count}`);
        }
        const sample = [...new Set(missingObjectViolations)].slice(0, 15);
        console.log(`  Beispiel-IDs: ${JSON.stringify(sample)}`);
        failures.push(
            `${missingObjectViolations.length} setState()-Aufrufe trafen auf ein noch nicht existierendes Objekt (${byPrefix.size} betroffene Präfixe) - siehe Liste oben`,
        );
    }

    console.log('\n=== Fehler-/Warn-Logs während Replay ===');
    const errs = logs.filter(([lvl]) => lvl === 'error' || lvl === 'warn');
    if (errs.length === 0) {
        console.log('  (keine)');
    } else {
        for (const [lvl, m] of errs) console.log(`  [${lvl}] ${m}`);
    }

    console.log(`\nGesamt erzeugte Objekte: ${objects.size}, Gesamt States geschrieben: ${states.size}`);

    if (failures.length > 0) {
        console.log(`\n❌ ${failures.length} Check(s) FAILED:`);
        for (const f of failures) console.log(`  - ${f}`);
        process.exitCode = 1;
    } else {
        console.log('\n✅ Alle Checks OK.');
    }
}, 800);
