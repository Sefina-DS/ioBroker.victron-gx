/*
 * ioBroker Victron GX Adapter
 * Verbindet sich lokal mit Victron GX Geräten via MQTT
 * Verwendet Seriennummern als stabile Geräte-IDs
 */
import * as utils from '@iobroker/adapter-core';
import * as mqtt from 'mqtt';

// ── Gerätetypen ─────────────────────────────────────────────────────────────
const KNOWN_DEVICE_TYPES: Record<string, string> = {
    battery: 'Batterie',
    vebus: 'Wechselrichter',
    solarcharger: 'Solarladeregler (MPPT)',
    acload: 'AC Last',
    grid: 'Netzanschluss',
    pvinverter: 'PV Wechselrichter',
    switch: 'Virtueller Schalter',
    system: 'System',
    platform: 'GX Gerät',
    temperature: 'Temperatursensor',
    tank: 'Tanksensor',
};

// ── Relevante MQTT-Pfade pro Gerätetyp ──────────────────────────────────────
//
// Hinweis Phasen (L1/L2/L3):
//   Echte Geräte (grid, solarcharger, vebus): immer alle Phasen anlegen,
//   da Spannung vorhanden auch wenn keine Last (z.B. nachts).
//   Virtuelle Geräte (virtual=true): Phasen nur anlegen wenn Voltage > 0,
//   da der virtuelle Bus nur die genutzte Phase simuliert.
//
const RELEVANT_PATHS: Record<string, string[]> = {
    battery: [
        'Soc',
        'Dc.0.Voltage',
        'Dc.0.Current',
        'Dc.0.Power',
        'Temperature',
        'ConsumedAmphours',
        'TimeToGo',
        'Alarms.LowVoltage',
        'Alarms.HighVoltage',
        'Alarms.LowSoc',
        'Info.ChargeMode',
        'Info.ChargeRequest',
        // Zellenspannungen
        'Voltages.Cell1',
        'Voltages.Cell2',
        'Voltages.Cell3',
        'Voltages.Cell4',
        'Voltages.Cell5',
        'Voltages.Cell6',
        'Voltages.Cell7',
        'Voltages.Cell8',
        'Voltages.Cell9',
        'Voltages.Cell10',
        'Voltages.Cell11',
        'Voltages.Cell12',
        'Voltages.Cell13',
        'Voltages.Cell14',
        'Voltages.Cell15',
        'Voltages.Cell16',
        'Voltages.Sum',
        'Voltages.Diff',
        // Registrierung
        'Serial',
        'ProductName',
        'CustomName',
    ],
    vebus: [
        'Soc',
        'State',
        'Mode',
        'VebusError',
        'VebusChargeState',
        'Ac.ActiveIn.L1.P',
        'Ac.ActiveIn.L2.P',
        'Ac.ActiveIn.L3.P',
        'Ac.Out.L1.P',
        'Ac.Out.L2.P',
        'Ac.Out.L3.P',
        'Ac.Out.L1.V',
        'Ac.Out.L2.V',
        'Ac.Out.L3.V',
        'Ac.In1.CurrentLimit',
        'Dc.0.Voltage',
        'Dc.0.Current',
        'Dc.0.Power',
        'Serial',
        'ProductName',
        'CustomName',
    ],
    solarcharger: [
        'Pv.V',
        'Pv.P',
        'Dc.0.Voltage',
        'Dc.0.Current',
        'State',
        'Yield.Power',
        'Yield.Today',
        'Yield.Total',
        'Serial',
        'ProductName',
        'CustomName',
    ],
    grid: [
        'Ac.L1.Power',
        'Ac.L2.Power',
        'Ac.L3.Power',
        'Ac.L1.Voltage',
        'Ac.L2.Voltage',
        'Ac.L3.Voltage',
        'Ac.L1.Current',
        'Ac.L2.Current',
        'Ac.L3.Current',
        'Ac.Energy.Forward',
        'Ac.Energy.Reverse',
        // grid hat keine Serial → ProductName für Erkennung
        'ProductName',
        'CustomName',
    ],
    acload: [
        'Ac.L1.Power',
        'Ac.L2.Power',
        'Ac.L3.Power',
        'Ac.L1.Voltage',
        'Ac.L2.Voltage',
        'Ac.L3.Voltage',
        'Ac.Energy.Forward',
        'Serial',
        'ProductName',
        'CustomName',
        'Mgmt.Connection',
        'Mgmt.ProcessName',
    ],
    pvinverter: [
        'Ac.Power',
        'Ac.L1.Power',
        'Ac.L2.Power',
        'Ac.L3.Power',
        'Ac.L1.Voltage',
        'Ac.L2.Voltage',
        'Ac.L3.Voltage',
        'Ac.L1.Current',
        'Ac.L2.Current',
        'Ac.L3.Current',
        'Ac.Energy.Forward',
        'StatusCode',
        'Serial',
        'ProductName',
        'CustomName',
        'Mgmt.Connection',
        'Mgmt.ProcessName',
    ],
    // Virtuelle Schalter: über Node-RED auf dem GX angelegt
    // State ist schreibbar → ioBroker → MQTT Write → GX → Node-RED → Relais
    switch: [
        'SwitchableOutput.output_1.State',
        'SwitchableOutput.output_1.Status',
        'Connected',
        'Serial',
        'ProductName',
        'CustomName',
        'Mgmt.Connection',
        'Mgmt.ProcessName',
        // Einstellungen für Channel-Name und Gruppierung
        'SwitchableOutput.output_1.Settings.CustomName',
        'SwitchableOutput.output_1.Settings.Group',
    ],
    system: [
        'Soc',
        'Dc.Battery.Voltage',
        'Dc.Battery.Current',
        'Dc.Battery.Power',
        'Dc.Pv.Power',
        'Dc.Pv.Current',
        'Ac.ConsumptionOnOutput.L1.Power',
        'Ac.ConsumptionOnOutput.L2.Power',
        'Ac.ConsumptionOnOutput.L3.Power',
        'Ac.Grid.L1.Power',
        'Ac.Grid.L2.Power',
        'Ac.Grid.L3.Power',
        'Ac.ActiveIn.Source',
        'TimeToGo',
        'SystemState.State',
        'Serial',
    ],
    temperature: ['Temperature', 'Humidity', 'Pressure', 'ProductName', 'CustomName'],
    tank: ['Level', 'Remaining', 'Status', 'ProductName', 'CustomName'],
};

// ── Pfade die NICHT als reguläre Datenpunkte gespeichert werden ─────────────
// Sie werden in registerDevice() ausgewertet und beeinflussen Metadaten
const REGISTRATION_PATHS = new Set([
    'Serial',
    'ProductName',
    'CustomName',
    'Mgmt.Connection',
    'Mgmt.ProcessName',
    'SwitchableOutput.output_1.Settings.CustomName',
    'SwitchableOutput.output_1.Settings.Group',
]);

// ── Einheiten ────────────────────────────────────────────────────────────────
const UNITS: Record<string, string> = {
    Soc: '%',
    Voltage: 'V',
    Current: 'A',
    Power: 'W',
    Temperature: '°C',
    Humidity: '%',
    Pressure: 'hPa',
    'Yield.Today': 'kWh',
    'Yield.Total': 'kWh',
    'Yield.Power': 'W',
    Level: '%',
    Remaining: 'm³',
    'Voltages.Sum': 'V',
    'Voltages.Diff': 'V',
};

// ── Schreibbare Datenpunkte (MQTT Write zurück zum GX) ───────────────────────
const WRITABLE_PATHS: Record<string, string[]> = {
    switch: ['SwitchableOutput.output_1.State'],
    vebus: ['Mode', 'Ac.In1.CurrentLimit'],
};

// ── Stale-Timeout: nach dieser Zeit ohne Update gilt Gerät als inaktiv ───────
const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 Minuten

// ── Phasenpfade für activePhase-Berechnung ───────────────────────────────────
const PHASE_POWER_PATHS: Record<string, string[]> = {
    pvinverter: ['Ac.L1.Power', 'Ac.L2.Power', 'Ac.L3.Power'],
    acload: ['Ac.L1.Power', 'Ac.L2.Power', 'Ac.L3.Power'],
    grid: ['Ac.L1.Power', 'Ac.L2.Power', 'Ac.L3.Power'],
};

const PHASE_VOLTAGE_PATHS: Record<string, string[]> = {
    pvinverter: ['Ac.L1.Voltage', 'Ac.L2.Voltage', 'Ac.L3.Voltage'],
    acload: ['Ac.L1.Voltage', 'Ac.L2.Voltage', 'Ac.L3.Voltage'],
    grid: ['Ac.L1.Voltage', 'Ac.L2.Voltage', 'Ac.L3.Voltage'],
};

// ── DeviceInfo Interface ─────────────────────────────────────────────────────
interface DeviceInfo {
    type: string;
    instance: number;
    serial: string;
    productName: string;
    customName: string; // CustomName vom GX (z.B. "Spieleturm (800W)")
    virtual: boolean; // true wenn ProductName enthält "Virtual"
    source: string; // "node-red" | "victron" | ""
    group: string; // Settings.Group für switch-Geräte
    // Phasen-Tracking für virtuelle Geräte
    phaseVoltage: Record<string, number>; // { 'L1': 230, 'L2': 0, 'L3': 0 }
    // Stale-Erkennung
    lastUpdate: number; // Unix-Timestamp ms letztes MQTT-Update
    staleTimer: ReturnType<typeof setTimeout> | null;
}

class VictronGx extends utils.Adapter {
    private mqttClient: mqtt.MqttClient | null = null;
    private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    private vrmId: string = '';
    private deviceMap: Map<string, DeviceInfo> = new Map();
    private serialMap: Map<string, string> = new Map();
    // Bereits geloggte Geräte → verhindert Log-Spam beim Keepalive-Refresh
    private loggedDevices: Set<string> = new Set();
    // Channels die vollständig angelegt wurden → touchDevice schreibt erst danach
    private channelReady: Set<string> = new Set();

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'victron-gx' });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    // ── Adapter-Start ────────────────────────────────────────────────────────
    private onReady(): void {
        void void this.setState('info.connection', false, true);

        const host = this.config.host;
        const port = this.config.port || 1883;
        const username = this.config.mqttUsername;
        const password = this.config.mqttPassword;

        if (!host) {
            this.log.error('Keine IP-Adresse konfiguriert!');
            return;
        }

        this.log.info(`Verbinde mit Victron GX unter ${host}:${port}...`);
        this.connectMqtt(host, port, username, password);
    }

    // ── MQTT Verbindung ──────────────────────────────────────────────────────
    private connectMqtt(host: string, port: number, username: string, password: string): void {
        const options: mqtt.IClientOptions = {
            port,
            clientId: `iobroker_victron_${Math.random().toString(16).slice(2)}`,
            clean: true,
            reconnectPeriod: 5000,
        };
        if (username) {
            options.username = username;
        }
        if (password) {
            options.password = password;
        }

        this.mqttClient = mqtt.connect(`mqtt://${host}`, options);

        this.mqttClient.on('connect', () => {
            this.log.info('MQTT verbunden mit Victron GX!');
            void this.setState('info.connection', true, true);
            this.mqttClient!.subscribe('N/#', err => {
                if (err) {
                    this.log.error(`Subscribe Fehler: ${err.message}`);
                }
            });
        });

        this.mqttClient.on('message', (topic: string, payload: Buffer) => {
            void this.handleMessage(topic, payload);
        });

        this.mqttClient.on('error', err => {
            this.log.error(`MQTT Fehler: ${err.message}`);
            void void this.setState('info.connection', false, true);
        });

        this.mqttClient.on('offline', () => {
            this.log.warn('MQTT Verbindung getrennt');
            void void this.setState('info.connection', false, true);
        });

        this.mqttClient.on('reconnect', () => {
            this.log.info('MQTT verbindet neu...');
            if (this.vrmId) {
                this.startKeepAlive();
            }
        });
    }

    private startKeepAlive(): void {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
        }
        this.keepAliveInterval = setInterval(() => {
            if (this.mqttClient && this.vrmId) {
                this.mqttClient.publish(`R/${this.vrmId}/keepalive`, '');
                this.log.debug('Keepalive gesendet');
            }
        }, 50000);
        if (this.vrmId) {
            this.mqttClient!.publish(`R/${this.vrmId}/keepalive`, '');
        }
    }

    // ── Haupt-Message-Handler ────────────────────────────────────────────────
    private async handleMessage(topic: string, payload: Buffer): Promise<void> {
        try {
            const raw = payload.toString();
            if (!raw) {
                return;
            }

            let parsed: any;
            try {
                parsed = JSON.parse(raw);
            } catch {
                return;
            }

            // Format: N/<VRMID>/<type>/<instance>/<path>
            const parts = topic.split('/');
            if (parts[0] !== 'N' || parts.length < 4) {
                return;
            }

            // VRM ID beim ersten Topic ermitteln
            if (!this.vrmId && parts[1]) {
                this.vrmId = parts[1];
                this.log.info(`VRM ID gefunden: ${this.vrmId}`);
                this.startKeepAlive();
            }

            const deviceType = parts[2];
            const instanceStr = parts[3];
            const instance = parseInt(instanceStr, 10);
            const path = parts.slice(4).join('/');
            const normalizedPath = path.replace(/\//g, '.');

            if (!path) {
                return;
            }
            if (!RELEVANT_PATHS[deviceType]) {
                return;
            }

            // 'value' aus dem Victron-MQTT-Payload extrahieren
            // Wichtig: ?? greift nicht bei null → explizit auf null prüfen
            const rawValue = 'value' in parsed ? parsed.value : parsed;
            if (rawValue === null || rawValue === undefined) {
                return;
            }
            const value = rawValue;

            // ── Registrierungspfade → Metadaten sammeln ──────────────────
            if (REGISTRATION_PATHS.has(normalizedPath)) {
                if (typeof value === 'string' || typeof value === 'number') {
                    this.updateDeviceMeta(deviceType, instance, normalizedPath, String(value));
                }
                return;
            }

            // ── Datenpunkt nur speichern wenn Gerät bekannt ───────────────
            const deviceKey = `${deviceType}/${instance}`;
            const device = this.deviceMap.get(deviceKey);
            const serial = this.serialMap.get(deviceKey);

            // Basis-ID: Serial bevorzugt, sonst Instanznummer
            const baseId = serial ? `devices.${deviceType}.${serial}` : `devices.${deviceType}.${instanceStr}`;

            // ── Phasen-Filterung für virtuelle Geräte ────────────────────
            if (device?.virtual && PHASE_VOLTAGE_PATHS[deviceType]) {
                // Spannungs-Tracking aktualisieren
                const voltageMatch = normalizedPath.match(/^Ac\.(L[123])\.Voltage$/);
                if (voltageMatch) {
                    const phase = voltageMatch[1];
                    device.phaseVoltage[phase] = typeof value === 'number' ? value : 0;
                }

                // Phase unterdrücken wenn Voltage == 0 (Phase nicht simuliert)
                const phaseMatch = normalizedPath.match(/^Ac\.(L[123])\./);
                if (phaseMatch) {
                    const phase = phaseMatch[1];
                    const voltage = device.phaseVoltage[phase] ?? 0;
                    if (voltage === 0) {
                        return;
                    } // Phase nicht vorhanden → ignorieren
                }
            }

            if (value === null || value === undefined) {
                return;
            }

            // ── Relevanzprüfung ───────────────────────────────────────────
            const relevantPaths = RELEVANT_PATHS[deviceType];
            const isRelevant = relevantPaths.some(rp => normalizedPath === rp.replace(/\//g, '.'));
            if (!isRelevant) {
                return;
            }

            // ── Stale-Timer aktualisieren ─────────────────────────────────
            if (device) {
                this.touchDevice(device, baseId);
            }

            // ── Schreibbar? ───────────────────────────────────────────────
            const isWritable = (WRITABLE_PATHS[deviceType] || []).some(wp => normalizedPath === wp.replace(/\//g, '.'));

            // ── Datenpunkt anlegen und Wert setzen ────────────────────────
            const stateId = `${baseId}.${normalizedPath}`;
            await this.setObjectNotExistsAsync(stateId, {
                type: 'state',
                common: {
                    name: this.getFriendlyName(normalizedPath),
                    type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
                    role: this.getRole(normalizedPath),
                    unit: this.getUnit(normalizedPath),
                    read: true,
                    write: isWritable,
                },
                native: {},
            });
            await this.setState(stateId, { val: value, ack: true });

            // ── activePhase aktualisieren ─────────────────────────────────
            if (PHASE_POWER_PATHS[deviceType]?.includes(normalizedPath)) {
                // Nur wenn Channel bereits vollständig angelegt
                if (this.channelReady.has(baseId)) {
                    void this.updateActivePhase(deviceType, baseId, deviceKey);
                }
            }
        } catch (err) {
            this.log.debug(`Fehler bei Topic ${topic}: ${(err as Error).message}`);
        }
    }

    // ── Geräte-Metadaten sammeln und Channel anlegen ─────────────────────────
    //
    // Reihenfolge der MQTT-Nachrichten ist nicht garantiert:
    // ProductName kann vor oder nach Serial kommen, CustomName ebenso.
    // Wir sammeln alles in DeviceInfo und legen den Channel erst an
    // wenn wir Serial ODER bei Geräten ohne Serial (grid) ProductName haben.
    //
    private updateDeviceMeta(type: string, instance: number, field: string, value: string): void {
        const deviceKey = `${type}/${instance}`;

        if (!this.deviceMap.has(deviceKey)) {
            this.deviceMap.set(deviceKey, {
                type,
                instance,
                serial: '',
                productName: '',
                customName: '',
                virtual: false,
                source: '',
                group: '',
                phaseVoltage: { L1: 0, L2: 0, L3: 0 },
                lastUpdate: Date.now(),
                staleTimer: null,
            });
        }

        const device = this.deviceMap.get(deviceKey)!;

        switch (field) {
            case 'Serial': {
                device.serial = value;
                this.serialMap.set(deviceKey, value);
                const serialLogKey = `serial:${deviceKey}`;
                if (!this.loggedDevices.has(serialLogKey)) {
                    this.loggedDevices.add(serialLogKey);
                    this.log.info(`Gerät erkannt: ${KNOWN_DEVICE_TYPES[type] || type} → Serial: ${value}`);
                } else {
                    this.log.debug(`Gerät bekannt: ${KNOWN_DEVICE_TYPES[type] || type} → Serial: ${value}`);
                }
                break;
            }

            case 'ProductName': {
                device.productName = value;
                // Virtual-Flag: Victron kennzeichnet virtuelle Geräte im ProductName
                device.virtual = value.toLowerCase().includes('virtual');
                if (device.virtual) {
                    const virtualLogKey = `virtual:${deviceKey}`;
                    if (!this.loggedDevices.has(virtualLogKey)) {
                        this.loggedDevices.add(virtualLogKey);
                        this.log.info(`Virtuelles Gerät: ${type}/${instance} → "${value}"`);
                    } else {
                        this.log.debug(`Virtuelles Gerät (bekannt): ${type}/${instance} → "${value}"`);
                    }
                }
                break;
            }

            case 'CustomName':
                if (!device.customName) {
                    device.customName = value;
                }
                break;

            case 'Mgmt.Connection':
                if (value === 'Node-RED') {
                    device.source = 'node-red';
                    const nodeRedLogKey = `nodered:${deviceKey}`;
                    if (!this.loggedDevices.has(nodeRedLogKey)) {
                        this.loggedDevices.add(nodeRedLogKey);
                        this.log.info(`Node-RED Gerät: ${type}/${instance}`);
                    } else {
                        this.log.debug(`Node-RED Gerät (bekannt): ${type}/${instance}`);
                    }
                }
                break;

            case 'Mgmt.ProcessName':
                // Zusätzliche Bestätigung für virtuelle Geräte
                if (value === 'dbus-victron-virtual') {
                    device.virtual = true;
                }
                break;

            case 'SwitchableOutput.output_1.Settings.Group':
                device.group = value;
                break;

            case 'SwitchableOutput.output_1.Settings.CustomName':
                device.customName = value; // immer überschreiben
                {
                    const channelKey = device.serial || device.instance.toString();
                    const channelId = `devices.${device.type}.${channelKey}`;
                    const suffix = device.source === 'node-red' ? ' [Node-RED]' : device.virtual ? ' [Virtual]' : '';
                    void this.extendObjectAsync(channelId, {
                        common: { name: `${value}${suffix}` },
                    });
                }
                break;
        }

        // Channel anlegen sobald wir genug Infos haben
        void this.ensureDeviceChannel(device);
    }

    // ── Channel in ioBroker anlegen / aktualisieren ──────────────────────────
    private async ensureDeviceChannel(device: DeviceInfo): Promise<void> {
        // Wir brauchen mindestens ProductName oder Serial
        const hasSerial = !!device.serial;
        const hasProduct = !!device.productName;
        if (!hasSerial && !hasProduct) {
            return;
        }

        // switch-Geräte bekommen ihre Serial immer via MQTT → ohne Serial
        // würde der Channel mit der Instanznummer angelegt (switch.100 etc.)
        // und bleibt dann als Leiche. Daher: warten bis Serial bekannt ist.
        if (device.type === 'switch' && !hasSerial) {
            return;
        }

        // Stabile ID: Serial bevorzugt
        const channelKey = device.serial || device.instance.toString();
        const channelId = `devices.${device.type}.${channelKey}`;

        // Anzeigename: CustomName bevorzugt, dann ProductName, dann Typ
        const displayName = device.customName || device.productName || KNOWN_DEVICE_TYPES[device.type] || device.type;

        // Channel-Name mit Herkunfts-Suffix für Klarheit
        const suffix = device.virtual ? (device.source === 'node-red' ? ' [Node-RED]' : ' [Virtual]') : '';

        await this.setObjectNotExistsAsync(channelId, {
            type: 'channel',
            common: {
                name: `${displayName}${suffix}`,
            },
            native: {
                type: device.type,
                instance: device.instance,
                serial: device.serial,
                virtual: device.virtual,
                source: device.source,
                group: device.group,
            },
        });

        // ── Info-Datenpunkte ──────────────────────────────────────────────
        const infoDps: Array<{ id: string; name: string; val: string | boolean }> = [
            { id: 'info.serial', name: 'Seriennummer', val: device.serial },
            { id: 'info.productName', name: 'Produktname', val: device.productName },
            { id: 'info.customName', name: 'Anzeigename', val: device.customName },
            { id: 'info.virtual', name: 'Virtuell', val: device.virtual },
            { id: 'info.source', name: 'Quelle', val: device.source },
        ];

        for (const dp of infoDps) {
            await this.setObjectNotExistsAsync(`${channelId}.${dp.id}`, {
                type: 'state',
                common: {
                    name: dp.name,
                    type: typeof dp.val === 'boolean' ? 'boolean' : 'string',
                    role: dp.id === 'info.serial' ? 'info.serial' : 'info.name',
                    read: true,
                    write: false,
                },
                native: {},
            });
            if (dp.val !== '' && dp.val !== false) {
                await this.setState(`${channelId}.${dp.id}`, { val: dp.val, ack: true });
            }
        }

        // ── Stale-Datenpunkte ─────────────────────────────────────────────
        await this.setObjectNotExistsAsync(`${channelId}.info.lastUpdate`, {
            type: 'state',
            common: { name: 'Letztes Update', type: 'number', role: 'value.time', read: true, write: false },
            native: {},
        });
        await this.setObjectNotExistsAsync(`${channelId}.info.stale`, {
            type: 'state',
            common: { name: 'Keine Daten', type: 'boolean', role: 'indicator.maintenance', read: true, write: false },
            native: {},
        });

        // ── activePhase für AC-Geräte ─────────────────────────────────────
        if (PHASE_POWER_PATHS[device.type]) {
            await this.setObjectNotExistsAsync(`${channelId}.info.activePhase`, {
                type: 'state',
                common: {
                    name: 'Aktive Phase(n)',
                    type: 'string',
                    role: 'info',
                    states: { L1: 'L1', L2: 'L2', L3: 'L3', multi: 'Mehrphasig', '': 'Unbekannt' },
                    read: true,
                    write: false,
                },
                native: {},
            });
        }

        // ── Schaltfläche für switch-Typ ───────────────────────────────────
        if (device.type === 'switch') {
            const stateId = `${channelId}.SwitchableOutput.output_1.State`;
            await this.setObjectNotExistsAsync(stateId, {
                type: 'state',
                common: {
                    name: device.customName || 'Schalter',
                    type: 'number',
                    role: 'switch',
                    states: { 0: 'Aus', 1: 'Ein' },
                    read: true,
                    write: true, // ← schreibbar!
                },
                native: {},
            });
        }

        // Gruppenobjekt für Switch anlegen (falls vorhanden)
        if (device.type === 'switch' && device.group) {
            const groupId = `devices.switch._groups.${device.group.replace(/[^a-zA-Z0-9_]/g, '_')}`;
            await this.setObjectNotExistsAsync(groupId, {
                type: 'folder',
                common: { name: device.group },
                native: {},
            });
        }

        // Channel ist jetzt vollständig angelegt
        this.channelReady.add(channelId);
    }

    // ── Stale-Erkennung ──────────────────────────────────────────────────────
    private touchDevice(device: DeviceInfo, baseId: string): void {
        device.lastUpdate = Date.now();

        // Stale-Timer zurücksetzen
        if (device.staleTimer) {
            clearTimeout(device.staleTimer);
        }

        // Nur schreiben wenn Channel bereits vollständig angelegt wurde
        const channelId = baseId;
        if (!this.channelReady.has(channelId)) {
            return;
        }

        // lastUpdate und stale=false sofort schreiben
        void this.setState(`${baseId}.info.lastUpdate`, { val: device.lastUpdate, ack: true });
        void this.setState(`${baseId}.info.stale`, { val: false, ack: true });

        // Neuen Timer setzen
        device.staleTimer = setTimeout(() => {
            this.log.warn(`Gerät ${device.type}/${device.instance} antwortet nicht mehr (stale)`);
            void this.setState(`${baseId}.info.stale`, { val: true, ack: true });
        }, STALE_TIMEOUT_MS);
    }

    // ── activePhase berechnen und schreiben ──────────────────────────────────
    private async updateActivePhase(deviceType: string, baseId: string, _deviceKey: string): Promise<void> {
        const phases = ['L1', 'L2', 'L3'];
        const active: string[] = [];

        for (const phase of phases) {
            const stateId = `${baseId}.Ac.${phase}.Power`;
            try {
                const state = await this.getStateAsync(stateId);
                if (state && typeof state.val === 'number' && state.val !== 0) {
                    active.push(phase);
                }
            } catch {
                /* Datenpunkt existiert noch nicht */
            }
        }

        let activePhase = '';
        if (active.length === 1) {
            activePhase = active[0];
        } else if (active.length > 1) {
            activePhase = 'multi';
        }

        await this.setState(`${baseId}.info.activePhase`, { val: activePhase, ack: true });
    }

    // ── MQTT Write: ioBroker → GX ────────────────────────────────────────────
    //
    // Steuerfluss: ioBroker State (ack=false) → MQTT W/-Topic → GX
    // GX bestätigt → MQTT N/-Topic kommt zurück → ack=true
    //
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack) {
            return;
        } // Nur eigene Schreibbefehle
        if (!this.mqttClient || !this.vrmId) {
            return;
        }

        // ID-Format: victron-gx.0.devices.<type>.<serial>.<path>
        const parts = id.split('.');
        // parts: [0]='victron-gx', [1]='0', [2]='devices', [3]=type, [4]=serial, [5..]=path
        if (parts[2] !== 'devices' || parts.length < 6) {
            return;
        }

        const deviceType = parts[3];
        const serial = parts[4];
        const dpPath = parts.slice(5).join('/'); // z.B. SwitchableOutput/output_1/State

        // Instance aus serialMap rückwärts ermitteln
        let instance: number | null = null;
        for (const [key, ser] of this.serialMap.entries()) {
            if (ser === serial) {
                instance = parseInt(key.split('/')[1], 10);
                break;
            }
        }
        // Fallback: serial ist vielleicht die Instanznummer (grid)
        if (instance === null) {
            const num = parseInt(serial, 10);
            if (!isNaN(num)) {
                instance = num;
            }
        }
        if (instance === null) {
            this.log.warn(`Konnte Instanz für ${id} nicht ermitteln`);
            return;
        }

        const mqttTopic = `W/${this.vrmId}/${deviceType}/${instance}/${dpPath}`;
        const payload = JSON.stringify({ value: state.val });

        this.log.info(`Schreibe: ${mqttTopic} = ${payload}`);
        this.mqttClient.publish(mqttTopic, payload);
    }

    // ── Hilfsfunktionen ──────────────────────────────────────────────────────
    private getFriendlyName(path: string): string {
        const names: Record<string, string> = {
            Soc: 'Ladezustand',
            'Dc.0.Voltage': 'DC Spannung',
            'Dc.0.Current': 'DC Strom',
            'Dc.0.Power': 'DC Leistung',
            'Ac.Power': 'AC Gesamtleistung',
            'Ac.L1.Power': 'L1 Leistung',
            'Ac.L2.Power': 'L2 Leistung',
            'Ac.L3.Power': 'L3 Leistung',
            'Ac.L1.Voltage': 'L1 Spannung',
            'Ac.L2.Voltage': 'L2 Spannung',
            'Ac.L3.Voltage': 'L3 Spannung',
            'Ac.L1.Current': 'L1 Strom',
            'Ac.L2.Current': 'L2 Strom',
            'Ac.L3.Current': 'L3 Strom',
            'Ac.Energy.Forward': 'Bezug gesamt',
            'Ac.Energy.Reverse': 'Einspeisung gesamt',
            State: 'Status',
            Mode: 'Betriebsart',
            Temperature: 'Temperatur',
            'Voltages.Sum': 'Zellspannung gesamt',
            'Voltages.Diff': 'Zellspannung Differenz',
            TimeToGo: 'Restlaufzeit',
            'Yield.Power': 'PV Leistung',
            'Yield.Today': 'Ertrag heute',
            'Yield.Total': 'Ertrag gesamt',
            'SwitchableOutput.output_1.State': 'Schaltzustand',
            'SwitchableOutput.output_1.Status': 'Schaltstatus',
            Connected: 'Verbunden',
        };
        return names[path] || path;
    }

    private getUnit(path: string): string {
        for (const [key, unit] of Object.entries(UNITS)) {
            if (path === key || path.endsWith(`.${key}`)) {
                return unit;
            }
        }
        if (path.includes('Power')) {
            return 'W';
        }
        if (path.includes('Voltage') || path.endsWith('.V')) {
            return 'V';
        }
        if (path.includes('Current')) {
            return 'A';
        }
        if (path.includes('Energy')) {
            return 'kWh';
        }
        if (path.includes('Soc')) {
            return '%';
        }
        if (path.includes('Temperature')) {
            return '°C';
        }
        if (path.startsWith('Voltages.Cell')) {
            return 'V';
        }
        return '';
    }

    private getRole(path: string): string {
        if (path.includes('Power')) {
            return 'value.power';
        }
        if (path.includes('Voltage') || path.endsWith('.V')) {
            return 'value.voltage';
        }
        if (path.includes('Current')) {
            return 'value.current';
        }
        if (path.includes('Energy')) {
            return 'value.energy.consumed';
        }
        if (path.includes('Soc')) {
            return 'value.battery';
        }
        if (path.includes('Temperature')) {
            return 'value.temperature';
        }
        if (path === 'SwitchableOutput.output_1.State') {
            return 'switch';
        }
        if (path.includes('State') || path.includes('Mode')) {
            return 'value';
        }
        return 'value';
    }

    // ── Adapter-Stop ─────────────────────────────────────────────────────────
    private onUnload(callback: () => void): void {
        try {
            if (this.keepAliveInterval) {
                clearInterval(this.keepAliveInterval);
            }
            // Alle Stale-Timer aufräumen
            for (const device of this.deviceMap.values()) {
                if (device.staleTimer) {
                    clearTimeout(device.staleTimer);
                }
            }
            if (this.mqttClient) {
                this.mqttClient.end();
            }
            callback();
        } catch (error) {
            this.log.error(`Fehler beim Beenden: ${(error as Error).message}`);
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new VictronGx(options);
} else {
    (() => new VictronGx())();
}