'use strict';
/*
 * Fokussierter Regressionstest für runOrphanSweep()/invalidateCachesForPrefix() (S16-Fix, siehe
 * PROJEKTSTAND.md/SHELLY_INTEGRATION_STATUS.md). Anders als test/catalog-replay.js braucht dieser
 * Test KEINEN externen Community-Catalog - der benötigte Zustand (deviceMap-Einträge,
 * vorbestehende ioBroker-Objekte) wird synthetisch direkt injiziert, weil runOrphanSweep() nur von
 * deviceMap/outputToInstance/dem Objekt-Store abhängt, nicht vom MQTT-Replay-Pfad selbst. Lädt wie
 * catalog-replay.js die ECHTE, kompilierte build/main.js (kein Reimplement der Sweep-Logik) über
 * denselben @iobroker/adapter-core-Mock-Trick.
 *
 * Manuelles Dev-Tool, NICHT Teil von `npm test` (braucht ein frisches `npm run build`, das lokale
 * `test`-Skript baut nicht selbst - siehe release.sh-Reihenfolge "npm test" VOR "npm run build").
 *
 * Aufruf: npm run build && node test/orphan-sweep-replay.js
 */
const path = require('path');
const EventEmitter = require('events');

const ADAPTER_DIR = path.join(__dirname, '..');
const ioPackage = require(path.join(ADAPTER_DIR, 'io-package.json'));

// ── Minimal-Mock für @iobroker/adapter-core (reduziertes Duplikat aus catalog-replay.js - siehe
// dort für die ausführliche Begründung der DB_LATENCY_MS-Race-Simulation, hier nicht relevant,
// weil dieser Test keine setState-vs-Objekt-Anlage-Races prüft) ────────────────────────────────
class MockAdapter extends EventEmitter {
    constructor(options = {}) {
        super();
        this.namespace = 'victron-gx.0';
        this.config = options.config || {};
        this.objects = new Map(options.seedObjects || []);
        this.states = new Map();
        this.logs = [];
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
        if (!this.objects.has(id)) {
            this.objects.set(id, obj);
        }
        return { id };
    }
    async extendObjectAsync(id, obj) {
        const existing = this.objects.get(id) || { type: obj.type, common: {}, native: {} };
        this.objects.set(id, {
            type: obj.type || existing.type,
            common: { ...existing.common, ...obj.common },
            native: { ...existing.native, ...obj.native },
        });
        return { id };
    }
    async getObjectAsync(id) {
        return this.objects.get(id) || null;
    }
    async getObjectListAsync(query = {}) {
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
    subscribeStates() {}
    sendTo() {}
    setTimeout(fn, ms, ...args) {
        const t = setTimeout(fn, ms, ...args);
        if (t.unref) {
            t.unref();
        }
        return t;
    }
    clearTimeout(t) {
        clearTimeout(t);
    }
    setInterval(fn, ms, ...args) {
        const t = setInterval(fn, ms, ...args);
        if (t.unref) {
            t.unref();
        }
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

const mainPath = path.join(ADAPTER_DIR, 'build', 'main.js');
const factory = require(mainPath);

function newAdapter(seedObjects) {
    const adapter = factory({ config: {}, seedObjects });
    adapter.emit('ready');
    return adapter;
}

// Minimaler DeviceInfo-Eintrag - runOrphanSweep()/getBaseId() lesen nur type/instance/serial/group,
// alle anderen DeviceInfo-Felder sind für diesen Test irrelevant (kein MQTT-Replay beteiligt).
function device(type, instance, serial, group) {
    return { type, instance, serial, group: group || '' };
}

const failures = [];
function check(label, condition) {
    console.log(`  ${condition ? 'OK' : 'FAIL'}: ${label}`);
    if (!condition) {
        failures.push(label);
    }
}

async function scenarioSplitSerialKept() {
    console.log(
        '\n########## Szenario 1: Serial mit zwei aktiven BaseIds (acload gruppenlos + switch gruppiert) ##########',
    );
    const serial = 'D885AC0B0280';
    const acloadFolder = 'devices.acload.D885AC0B0280';
    const switchFolder = 'devices.switch.WW_Heitzstab_Technikraum.D885AC0B0280';
    const adapter = newAdapter([
        [acloadFolder, { type: 'channel', common: { name: 'AC Load' }, native: {} }],
        [
            `${acloadFolder}.info.connected`,
            { type: 'state', common: { name: 'Connected', type: 'boolean' }, native: {} },
        ],
        [switchFolder, { type: 'channel', common: { name: 'Switch' }, native: {} }],
        [
            `${switchFolder}.info.connected`,
            { type: 'state', common: { name: 'Connected', type: 'boolean' }, native: {} },
        ],
    ]);
    // Zwei getrennte DeviceInfo-Einträge derselben Serial - genau der live bestätigte Fall
    // (D885AC0B0280, siehe PROJEKTSTAND.md S16-Fix).
    adapter.deviceMap.set('acload/55', device('acload', 55, serial, ''));
    adapter.deviceMap.set('switch/60', device('switch', 60, serial, 'WW_Heitzstab_Technikraum'));
    // Wichtig für die reale Vorbedingung des Bugs: die Serial muss in outputToInstance bekannt
    // sein (die switch-Instanz hat einen committeten Output), sonst greift der alte Pass-2-Bug gar
    // nicht erst (outputToInstance.has(serial) war das ursprüngliche Gate). Ohne diese Zeile würde
    // dieser Test auch den alten, fehlerhaften Code fälschlich als "bestanden" melden.
    adapter.outputToInstance.set(serial, new Map([['0', { instance: 60, mqttKey: 'output_0' }]]));

    await adapter.runOrphanSweep();

    check('acload-Ordner (gruppenlos) bleibt erhalten', adapter.objects.has(acloadFolder));
    check('switch-Ordner (gruppiert) bleibt erhalten', adapter.objects.has(switchFolder));
    const hasSplitLog = adapter.logs.some(
        ([lvl, m]) => lvl === 'info' && typeof m === 'string' && m.includes(serial) && m.includes('active base paths'),
    );
    check('Sweep loggt den Split (info, "active base paths")', hasSplitLog);
}

async function scenarioUnknownSerialKept() {
    console.log('\n########## Szenario 2: Serial ohne DeviceInfo im deviceMap (konservativ, nicht löschen) ##########');
    const folder = 'devices.acload.UNKNOWN_NOT_YET_SEEN';
    const adapter = newAdapter([
        [folder, { type: 'channel', common: { name: 'AC Load' }, native: {} }],
        [`${folder}.info.connected`, { type: 'state', common: { name: 'Connected', type: 'boolean' }, native: {} }],
    ]);
    // Bewusst KEIN deviceMap-Eintrag für diese Serial - simuliert ein Gerät, das diese Session
    // (noch) nichts gesendet hat, dessen alte Objekte aber noch im Store stehen.

    await adapter.runOrphanSweep();

    check('Ordner mit unbekannter Serial bleibt erhalten (konservativ)', adapter.objects.has(folder));
    check('Kind-State bleibt erhalten', adapter.objects.has(`${folder}.info.connected`));
}

async function scenarioGenuineOrphanRemoved() {
    console.log(
        '\n########## Szenario 3: Regressionswächter - echter Karteileichen-Ordner wird weiterhin entfernt + Caches invalidiert ##########',
    );
    const serial = 'LEGACY111';
    const staleFolder = 'devices.switch.LEGACY111'; // gruppenlos, Rest aus der Zeit vor der Group
    const activeFolder = 'devices.switch.SomeGroup.LEGACY111'; // aktuell aktiv
    const adapter = newAdapter([
        [staleFolder, { type: 'channel', common: { name: 'Switch' }, native: {} }],
        [
            `${staleFolder}.info.connected`,
            { type: 'state', common: { name: 'Connected', type: 'boolean' }, native: {} },
        ],
        [activeFolder, { type: 'channel', common: { name: 'Switch' }, native: {} }],
        [
            `${activeFolder}.info.connected`,
            { type: 'state', common: { name: 'Connected', type: 'boolean' }, native: {} },
        ],
    ]);
    // Nur EINE aktive BaseId für diese Serial - der gruppenlose Ordner ist eindeutig ein
    // Umzugs-Rest (kein Split-Fall wie in Szenario 1).
    adapter.deviceMap.set('switch/70', device('switch', 70, serial, 'SomeGroup'));
    // Cache-Vergiftung nachbilden: die alten, gruppenlosen IDs sind (wie im echten Betrieb, aus
    // einer früheren writeStateValue()/ensureChannel()-Anlage) bereits als "angelegt" gecacht.
    adapter.channelReady.add(staleFolder);
    adapter.createdStates.add(`${staleFolder}.info.connected`);

    await adapter.runOrphanSweep();

    check('aktiver, gruppierter Ordner bleibt erhalten', adapter.objects.has(activeFolder));
    check('gruppenloser Alt-Ordner wird entfernt', !adapter.objects.has(staleFolder));
    check('channelReady für den Alt-Ordner wird invalidiert', !adapter.channelReady.has(staleFolder));
    check(
        'createdStates für den Alt-State wird invalidiert',
        !adapter.createdStates.has(`${staleFolder}.info.connected`),
    );
}

async function main() {
    await scenarioSplitSerialKept();
    await scenarioUnknownSerialKept();
    await scenarioGenuineOrphanRemoved();

    console.log(`\n${'='.repeat(60)}`);
    if (failures.length > 0) {
        console.log(`\n❌ ${failures.length} Check(s) FAILED:`);
        for (const f of failures) {
            console.log(`  - ${f}`);
        }
        process.exitCode = 1;
    } else {
        console.log('\n✅ Alle Checks OK (Szenarien 1-3).');
    }
}

main().catch(err => {
    console.error('Unerwarteter Fehler im orphan-sweep-Test:', err);
    process.exitCode = 2;
});
