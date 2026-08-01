'use strict';
/*
 * Catalog-Replay-Harness (Ersatz für Live-Test, siehe evcharger_temp_PLAN.md, erweitert für
 * CONTROL_MERGE_PLAN.md S7). Feuert JEDEN Topic aus einem Referenz-Catalog durch die ECHTE
 * handleMessage()-Methode des kompilierten Adapters (build/main.js) - kein Reimplement der
 * Gate-Logik, sondern der tatsächliche Code-Pfad. @iobroker/adapter-core wird per require.cache
 * durch einen minimalen In-Memory-Mock ersetzt (kein echter ioBroker-Host nötig).
 *
 * Manuelles Dev-Tool, NICHT Teil von `npm test` - braucht einen externen Catalog (reale
 * Community-Testdaten, nicht im Git-Repo, siehe _dev-tools/user-catalogs/).
 *
 * Aufruf: node test/catalog-replay.js [--catalog=/pfad/zum/catalog.json]
 *
 * Läuft immer ALLE Szenarien in einem Durchlauf (kein CLI-Toggle mehr für einzelne Config-Flags -
 * seit 0.10.0 müssen ohnehin beide Schalterzustände gegeneinander getestet werden, siehe
 * CONTROL_MERGE_PLAN.md S7):
 *   A) Voller Replay, modbusControlEnabled=true + mqttControlEnabled=true
 *   B) Voller Replay, modbusControlEnabled=false + mqttControlEnabled=false
 *   C) Migrations-Test: künstlich vorhandene control.*-Objekte + Version 0.10.0, zwei simulierte
 *      Restarts (zwei unabhängige Adapter-Instanzen) - control.* muss nach jedem Start weg sein,
 *      Warn-Log-Block muss bei JEDEM der beiden Starts erscheinen (nicht nur beim ersten).
 *   D) Config-Migrations-Test: native.controlEnabled=true, kein modbusControlEnabled gesetzt -
 *      nach dem Start muss modbusControlEnabled=true übernommen und controlEnabled entfernt sein.
 *
 * Bekannte Lücke: system.*-Modbus-Felder (GridSetpoint etc.) werden von initControlDatapoints()
 * nur angelegt, wenn this.modbusClient existiert - dieser Harness hat keinen Modbus-Mock (kein
 * host konfiguriert, siehe Szenario-Config unten) und kann sie daher nicht prüfen. Das ist bewusst
 * S8 (Live-Test mit scripts/fake-modbus-server.js) vorbehalten, nicht hier nachgebaut.
 */
const path = require('path');
const EventEmitter = require('events');

const ADAPTER_DIR = path.join(__dirname, '..');

const args = process.argv.slice(2);
const catalogArg = args.find(a => a.startsWith('--catalog='));
const CATALOG_FILE = catalogArg
    ? catalogArg.slice('--catalog='.length)
    : '/opt/iobroker/dev/_dev-tools/user-catalogs/1785153933178-victron-gx-catalog.json';

// io-package.json instanceObjects (z.B. info.connection) werden von js-controller VOR dem
// Adapter-Start angelegt, nicht vom Adapter-Code selbst - im Mock nachbilden, sonst wäre der
// Objekt-existiert-Check für diese States ein Fehlalarm, den es in der Praxis nie gibt.
const ioPackage = require(path.join(ADAPTER_DIR, 'io-package.json'));

// ── Catalog laden (einmalig, wird pro Szenario frisch durchlaufen) ────────────
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
const sortedTopics = [...topics].sort((a, b) => priority(a) - priority(b));

// ── Minimal-Mock für @iobroker/adapter-core ──────────────────────────────────
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

class MockAdapter extends EventEmitter {
    constructor(options = {}) {
        super();
        this.namespace = 'victron-gx.0';
        this.config = options.config || {};
        this.version = options.version;
        this.pack = options.pack;
        // Instanz-Zustand statt Modul-Singletons (S7) - jedes Szenario bekommt eine frische
        // MockAdapter-Instanz und darf nicht versehentlich Zustand mit einem vorherigen Szenario
        // teilen (z.B. der Migrations-Test mit zwei simulierten Restarts braucht zwei komplett
        // unabhängige Läufe).
        this.objects = new Map(options.seedObjects || []); // id -> object definition
        this.states = new Map(); // id -> {val, ack}
        this.logs = [];
        this.subscribedPatterns = [];
        this.missingObjectViolations = []; // setState()-Aufrufe, deren Objekt zu dem Zeitpunkt noch fehlte
        for (const obj of ioPackage.instanceObjects || []) {
            if (!this.objects.has(obj._id)) {
                this.objects.set(obj._id, { type: obj.type, common: obj.common || {}, native: obj.native || {} });
            }
        }
        this.log = {
            info: m => this.logs.push(['info', m]),
            warn: m => this.logs.push(['warn', m]),
            error: m => this.logs.push(['error', m]),
            debug: m => this.logs.push(['debug', m]),
            silly: m => this.logs.push(['silly', m]),
        };
    }
    async setObjectNotExistsAsync(id, obj) {
        await dbDelay();
        if (!this.objects.has(id)) {
            this.objects.set(id, obj);
        }
        return { id };
    }
    async extendObjectAsync(id, obj) {
        await dbDelay();
        const existing = this.objects.get(id) || { type: obj.type, common: {}, native: {} };
        this.objects.set(id, {
            type: obj.type || existing.type,
            common: { ...existing.common, ...obj.common },
            native: { ...existing.native, ...obj.native },
        });
        return { id };
    }
    // Foreign Objects laufen in der echten Objects-DB durch denselben flachen Namensraum wie
    // eigene Objekte (nur mit voll qualifizierter ID statt Namespace-Kurzform) - für den Mock reicht
    // dieselbe Merge-Logik wie extendObjectAsync auf derselben Map.
    async extendForeignObjectAsync(id, obj) {
        return this.extendObjectAsync(id, obj);
    }
    async getObjectAsync(id) {
        await dbDelay();
        return this.objects.get(id) || null;
    }
    async getObjectListAsync(query = {}) {
        await dbDelay();
        const { startkey, endkey } = query;
        const rows = [];
        for (const [shortId, value] of this.objects) {
            const fullId = `${this.namespace}.${shortId}`;
            if ((startkey === undefined || fullId >= startkey) && (endkey === undefined || fullId <= endkey)) {
                rows.push({ id: fullId, value });
            }
        }
        return { rows };
    }
    async delObjectAsync(id, options) {
        await dbDelay();
        this.objects.delete(id);
        if (options && options.recursive) {
            const prefix = `${id}.`;
            for (const key of [...this.objects.keys()]) {
                if (key.startsWith(prefix)) {
                    this.objects.delete(key);
                }
            }
        }
    }
    setState(id, val, ack) {
        // Reale ioBroker-Semantik: setState() auf ein nicht existierendes Objekt wirft NICHT -
        // es schreibt den Wert trotzdem und loggt nur die "has no existing object"-Warnung. Deshalb
        // hier hart mitzählen statt auf eine Exception zu hoffen.
        if (!this.objects.has(id)) {
            this.missingObjectViolations.push(id);
        }
        if (val && typeof val === 'object' && 'val' in val) {
            this.states.set(id, val);
        } else {
            this.states.set(id, { val, ack });
        }
        return Promise.resolve();
    }
    async getStateAsync(id) {
        return this.states.get(id);
    }
    // Muss das reale Subscribe-Pattern aufzeichnen - der ursprüngliche No-Op-Stub war exakt die
    // Lücke, die den v0.9.2-Bug (subscribeStates deckte control.evcharger.* nicht ab) durchrutschen
    // ließ: ein Test, der onStateChange() direkt aufruft, umgeht subscribeStates() komplett.
    subscribeStates(pattern) {
        this.subscribedPatterns.push(pattern);
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

const acCorePath = require.resolve('@iobroker/adapter-core', { paths: [ADAPTER_DIR] });
require.cache[acCorePath] = {
    id: acCorePath,
    filename: acCorePath,
    loaded: true,
    exports: { Adapter: MockAdapter, EXIT_CODES: {} },
};

// ── VictronGx laden (kompiliert, einmalig - jede factory({...})-Instanz hat unabhängigen
// Instanz-Zustand, siehe MockAdapter-Konstruktor oben) ────────────────────────────────────────
const mainPath = path.join(ADAPTER_DIR, 'build', 'main.js');
const factory = require(mainPath);

function replayCatalog(adapter) {
    for (const shortTopic of sortedTopics) {
        const topic = `N/${VRM_ID}/${shortTopic}`;
        const payload = Buffer.from(JSON.stringify(catalog[shortTopic]));
        adapter.handleMessage(topic, payload);
    }
    for (const shortTopic of sortedTopics) {
        const topic = `N/${VRM_ID}/${shortTopic}`;
        const payload = Buffer.from(JSON.stringify(catalog[shortTopic]));
        adapter.handleMessage(topic, payload);
    }
}

// Startet ein Szenario: neue Adapter-Instanz, optional Catalog-Replay, wartet auf die
// asynchrone Objekt-Anlage (fire-and-forget im echten Code - deutlich über DB_LATENCY_MS, damit
// auch der letzte von tausenden künstlich verzögerten Calls durch ist, bevor ausgewertet wird)
// UND über PENDING_QUIET_MS (2000ms, S13-Fallback-Commit für switch/acload/system-Output-Kanäle
// ohne Group-Wert im Catalog - ohne diese Marge blieben devices.<type>.<serial>.outputs.*
// unsichtbar, weil bufferPendingOutput() erst nach Ablauf dieses Timers committet, siehe S7-Fund),
// löst dann mit der Adapter-Instanz auf.
function runScenario({ config, version, pack, seedObjects, replay = true }) {
    const adapter = factory({ config, version, pack, seedObjects });
    adapter.emit('ready');
    if (replay) {
        replayCatalog(adapter);
    }
    return new Promise(resolve => setTimeout(() => resolve(adapter), 2500));
}

const failures = [];
function fail(msg) {
    failures.push(msg);
    console.log(`  FAIL: ${msg}`);
}

function globToRegExp(glob) {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}

// Prüft für ein Feld-Set (Regex über die volle stateId) ob common.write == expectedWritable gilt -
// Kern-Invariante seit 0.10.0 (CONTROL_MERGE_PLAN.md S3/S7): Objekte existieren nach dem ersten
// MQTT-Wert IMMER, nur common.write wechselt mit dem jeweiligen Config-Schalter. Das ersetzt die
// alte "Objekt existiert nur wenn Schalter an"-Invariante aus der control.*-Ära.
function checkWritableFields(adapter, label, pattern, expectedWritable) {
    const matches = [...adapter.objects.entries()].filter(([id]) => pattern.test(id));
    if (matches.length === 0) {
        // Nicht als Failure werten: ein einzelner Community-Catalog deckt nicht zwangsläufig jedes
        // Feld ab (z.B. hardwareabhängige Topic-Varianten wie Ac/In/1/CurrentLimit vs.
        // Ac/In1/CurrentLimit je nach Firmware-Generation, S7-Fund) - hier fehlt Testdaten-Abdeckung,
        // nicht zwangsläufig Adapter-Funktionalität. Nur als Hinweis loggen.
        console.log(`  ${label}: keine passenden Objekte in diesem Catalog gefunden (übersprungen, keine Testdaten-Abdeckung)`);
        return;
    }
    for (const [id, obj] of matches) {
        const write = obj.common && obj.common.write;
        const ok = write === expectedWritable;
        console.log(`  ${id}: write=${write} (erwartet ${expectedWritable}) ${ok ? 'OK' : 'FAIL'}`);
        if (!ok) {
            fail(`${label} ${id}: common.write=${write}, erwartet ${expectedWritable}`);
        }
    }
}

function checkNoMissingObjectViolations(adapter, label) {
    console.log(`\n=== [${label}] Check: Objekt existiert VOR jedem setState() ===`);
    if (adapter.missingObjectViolations.length === 0) {
        console.log('  (keine Verstöße - jedes setState() traf auf ein bereits existierendes Objekt)');
        return;
    }
    const byPrefix = new Map();
    for (const id of adapter.missingObjectViolations) {
        const prefix = id.split('.').slice(0, 2).join('.');
        byPrefix.set(prefix, (byPrefix.get(prefix) || 0) + 1);
    }
    console.log(`  ${adapter.missingObjectViolations.length} Verstöße, gruppiert nach Präfix:`);
    for (const [prefix, count] of [...byPrefix.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${prefix}.*: ${count}`);
    }
    const sample = [...new Set(adapter.missingObjectViolations)].slice(0, 15);
    console.log(`  Beispiel-IDs: ${JSON.stringify(sample)}`);
    fail(
        `[${label}] ${adapter.missingObjectViolations.length} setState()-Aufrufe trafen auf ein noch nicht existierendes Objekt (${byPrefix.size} betroffene Präfixe)`,
    );
}

function printLogs(adapter, label) {
    console.log(`\n=== [${label}] Fehler-/Warn-Logs ===`);
    const errs = adapter.logs.filter(([lvl]) => lvl === 'error' || lvl === 'warn');
    if (errs.length === 0) {
        console.log('  (keine)');
    } else {
        for (const [lvl, m] of errs) console.log(`  [${lvl}] ${m}`);
    }
}

async function main() {
    // ── Szenario A: voller Replay, beide Control-Schalter AN ────────────────────────────────
    console.log('\n########## Szenario A: modbusControlEnabled=true, mqttControlEnabled=true ##########');
    const adapterA = await runScenario({
        config: { modbusControlEnabled: true, mqttControlEnabled: true },
    });
    console.log('\n=== [A] Schreibbare Merge-Felder: common.write MUSS true sein ===');
    checkWritableFields(adapterA, 'vebus.Mode', /^devices\.vebus\..*\.Mode$/, true);
    checkWritableFields(adapterA, 'vebus.Hub4.L1.AcPowerSetpoint', /^devices\.vebus\..*\.Hub4\.L1\.AcPowerSetpoint$/, true);
    checkWritableFields(adapterA, 'vebus.Ac.In1.CurrentLimit', /^devices\.vebus\..*\.Ac\.In1\.CurrentLimit$/, true);
    checkWritableFields(adapterA, 'vebus.Hub4.DisableCharge', /^devices\.vebus\..*\.Hub4\.DisableCharge$/, true);
    checkWritableFields(adapterA, 'vebus.Hub4.DisableFeedIn', /^devices\.vebus\..*\.Hub4\.DisableFeedIn$/, true);
    checkWritableFields(adapterA, 'evcharger.SetCurrent', /^devices\.evcharger\..*\.SetCurrent$/, true);
    checkWritableFields(adapterA, 'evcharger.StartStop', /^devices\.evcharger\..*\.StartStop$/, true);
    checkWritableFields(adapterA, 'evcharger.Mode', /^devices\.evcharger\..*\.Mode$/, true);
    checkWritableFields(adapterA, 'temperature.Offset', /^devices\.temperature\..*\.Offset$/, true);
    checkWritableFields(adapterA, 'temperature.Scale', /^devices\.temperature\..*\.Scale$/, true);
    checkWritableFields(adapterA, 'temperature.FilterLength', /^devices\.temperature\..*\.FilterLength$/, true);
    console.log('\n=== [A] control.* darf nirgends mehr existieren ===');
    const leftoverA = [...adapterA.objects.keys()].filter(id => id === 'control' || id.startsWith('control.'));
    if (leftoverA.length > 0) {
        fail(`[A] ${leftoverA.length} control.*-Objekt(e) im Store trotz 0.10.0: ${JSON.stringify(leftoverA)}`);
    } else {
        console.log('  OK (keine control.*-Objekte)');
    }
    console.log('\n=== [A] subscribeStates deckt alle WRITABLE_DEVICE_FIELDS-Typen ab ===');
    for (const p of ['devices.vebus.*', 'devices.evcharger.*', 'devices.temperature.*', 'devices.switch.*']) {
        const covered = adapterA.subscribedPatterns.includes(p);
        console.log(`  ${p}: ${covered ? 'OK' : 'FAIL'}`);
        if (!covered) fail(`[A] subscribeStates() deckt ${p} nicht ab (registriert: ${JSON.stringify(adapterA.subscribedPatterns)})`);
    }
    checkNoMissingObjectViolations(adapterA, 'A');
    printLogs(adapterA, 'A');

    // ── Szenario B: voller Replay, beide Control-Schalter AUS ───────────────────────────────
    // Kern-Regressionscheck für die 0.10.0-Semantik: Objekte existieren weiterhin (anders als die
    // alte control.*-Ära, wo sie bei deaktiviertem Schalter komplett fehlten), aber common.write
    // muss auf false kippen.
    console.log('\n########## Szenario B: modbusControlEnabled=false, mqttControlEnabled=false ##########');
    const adapterB = await runScenario({
        config: { modbusControlEnabled: false, mqttControlEnabled: false },
    });
    console.log('\n=== [B] Merge-Felder existieren weiterhin, aber common.write MUSS false sein ===');
    checkWritableFields(adapterB, 'vebus.Mode', /^devices\.vebus\..*\.Mode$/, false);
    checkWritableFields(adapterB, 'evcharger.SetCurrent', /^devices\.evcharger\..*\.SetCurrent$/, false);
    checkWritableFields(adapterB, 'temperature.Offset', /^devices\.temperature\..*\.Offset$/, false);
    console.log('\n=== [B] Switch-Outputs: common.write MUSS false sein (vorher unconditional true) ===');
    checkWritableFields(adapterB, 'switch.outputs.*.State', /^devices\.(switch|acload|system)\..*\.outputs\.[^.]+\.State$/, false);
    checkNoMissingObjectViolations(adapterB, 'B');
    printLogs(adapterB, 'B');

    // ── Szenario C: Migrations-Test - control.*-Altlast + zwei simulierte Restarts ──────────
    console.log('\n########## Szenario C: Migrations-Sweep + Warn-Log über zwei simulierte Restarts ##########');
    const legacyControlObjects = [
        ['control', { type: 'channel', common: { name: 'Control' }, native: {} }],
        ['control.evcharger', { type: 'channel', common: { name: 'EV Charger' }, native: {} }],
        ['control.evcharger.46', { type: 'channel', common: {}, native: {} }],
        [
            'control.evcharger.46.SetCurrent',
            { type: 'state', common: { name: 'SetCurrent', type: 'number', write: true }, native: {} },
        ],
        ['control.system', { type: 'channel', common: {}, native: {} }],
        [
            'control.system.GridSetpoint',
            { type: 'state', common: { name: 'GridSetpoint', type: 'number', write: true }, native: {} },
        ],
    ];
    for (const restart of [1, 2]) {
        const adapterC = await runScenario({
            config: { modbusControlEnabled: true, mqttControlEnabled: true },
            version: '0.10.0',
            seedObjects: legacyControlObjects,
            replay: false, // reiner Migrations-/Warn-Log-Check, kein voller Catalog-Durchlauf nötig
        });
        console.log(`\n=== [C, Restart ${restart}] control.* muss nach dem Start weg sein ===`);
        const leftover = [...adapterC.objects.keys()].filter(id => id === 'control' || id.startsWith('control.'));
        if (leftover.length > 0) {
            fail(`[C, Restart ${restart}] control.*-Reste nach Migration: ${JSON.stringify(leftover)}`);
        } else {
            console.log('  OK (control.* vollständig entfernt)');
        }
        console.log(`\n=== [C, Restart ${restart}] Warn-Log-Block muss erscheinen (Version 0.10.0) ===`);
        const hasWarnBlock = adapterC.logs.some(
            ([lvl, m]) => lvl === 'warn' && m === '[MIGRATION 0.10.x] Structural changes since 0.10.0:',
        );
        if (hasWarnBlock) {
            console.log('  OK (Warn-Log-Block vorhanden)');
        } else {
            fail(`[C, Restart ${restart}] Warn-Log-Block fehlt (nur bei jedem Start erwartet, nicht nur beim ersten)`);
        }
    }

    // ── Szenario D: Config-Migrations-Test - controlEnabled ohne modbusControlEnabled ───────
    console.log('\n########## Szenario D: Config-Migration controlEnabled → modbusControlEnabled ##########');
    const adapterD = await runScenario({
        // modbusControlEnabled bewusst NICHT gesetzt (simuliert eine pre-0.10.0 native.json ohne
        // den neuen Key) - mqttControlEnabled ist unabhängig davon und bleibt unverändert.
        config: { controlEnabled: true, mqttControlEnabled: false },
        replay: false,
    });
    console.log('\n=== [D] this.config.modbusControlEnabled muss true sein (Wert übernommen) ===');
    if (adapterD.config.modbusControlEnabled === true) {
        console.log('  OK');
    } else {
        fail(`[D] this.config.modbusControlEnabled=${adapterD.config.modbusControlEnabled}, erwartet true`);
    }
    console.log('\n=== [D] native.controlEnabled muss im persistierten Instance-Object entfernt (null) sein ===');
    const instanceObj = adapterD.objects.get(`system.adapter.${adapterD.namespace}`);
    const persistedControlEnabled = instanceObj && instanceObj.native && instanceObj.native.controlEnabled;
    const persistedModbusControlEnabled = instanceObj && instanceObj.native && instanceObj.native.modbusControlEnabled;
    if (persistedControlEnabled === null && persistedModbusControlEnabled === true) {
        console.log('  OK (native.controlEnabled=null, native.modbusControlEnabled=true)');
    } else {
        fail(
            `[D] native nach Migration: controlEnabled=${JSON.stringify(persistedControlEnabled)} (erwartet null), modbusControlEnabled=${JSON.stringify(persistedModbusControlEnabled)} (erwartet true)`,
        );
    }
    console.log('\n=== [D] Migrations-Log-Eintrag muss erscheinen ===');
    const hasMigrationLog = adapterD.logs.some(
        ([lvl, m]) => lvl === 'info' && typeof m === 'string' && m.includes('Config key controlEnabled renamed to modbusControlEnabled'),
    );
    console.log(hasMigrationLog ? '  OK' : '  FAIL: Migrations-Log-Eintrag fehlt');
    if (!hasMigrationLog) fail('[D] Migrations-Log-Eintrag fehlt');
    printLogs(adapterD, 'D');

    // ── Gesamtergebnis ────────────────────────────────────────────────────────────────────
    console.log(`\n${'='.repeat(60)}`);
    if (failures.length > 0) {
        console.log(`\n❌ ${failures.length} Check(s) FAILED:`);
        for (const f of failures) console.log(`  - ${f}`);
        process.exitCode = 1;
    } else {
        console.log('\n✅ Alle Checks OK (Szenarien A/B/C/D).');
    }
}

main().catch(err => {
    console.error('Unerwarteter Fehler im Replay-Harness:', err);
    process.exitCode = 2;
});
