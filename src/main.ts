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
// Phasen-Regel:
//   virtual=false → alle Phasen immer anlegen (echte Messung, Spannung liegt an)
//   virtual=true  → Phase nur anlegen wenn Voltage > 0 (virtuelle Geräte
//                   setzen Voltage=0 für nicht genutzte Phasen)
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
        // Zellenspannungen (LiFePO4 BMS)
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
    // Virtuelle Schalter via Node-RED
    // Struktur: devices.switch.<Gruppe>.<Serial>.*
    // State ist schreibbar → ioBroker → MQTT W/ → GX → Node-RED → Relais
    switch: [
        'State', // schreibbarer Schaltzustand (0=Aus, 1=Ein)
        'Status', // Rückmeldung Hardware-Status
        'Connected',
        'Serial',
        'ProductName',
        'CustomName',
        'Mgmt.Connection',
        'Mgmt.ProcessName',
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

// ── Pfade die Metadaten liefern, keine Datenpunkte ───────────────────────────
const REGISTRATION_PATHS = new Set([
    'Serial',
    'ProductName',
    'CustomName',
    'Connected',
    'Mgmt.Connection',
    'Mgmt.ProcessName',
    'SwitchableOutput.output_1.Settings.CustomName',
    'SwitchableOutput.output_1.Settings.Group',
]);

// ── Victron-interne Pfade die wir umbenennen ─────────────────────────────────
// Switches liefern SwitchableOutput/output_1/State → wir speichern als "State"
const PATH_REMAP: Record<string, Record<string, string>> = {
    switch: {
        'SwitchableOutput.output_1.State': 'State',
        'SwitchableOutput.output_1.Status': 'Status',
    },
};

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

// ── Schreibbare Datenpunkte ──────────────────────────────────────────────────
const WRITABLE_PATHS: Record<string, string[]> = {
    switch: ['State'],
    vebus: ['Mode', 'Ac.In1.CurrentLimit'],
};

// ── MQTT-Pfad für Schreiben (remappt zurück) ─────────────────────────────────
// State im ioBroker → SwitchableOutput/output_1/State im MQTT
const WRITE_PATH_REMAP: Record<string, Record<string, string>> = {
    switch: {
        State: 'SwitchableOutput/output_1/State',
    },
};

// ── Stale-Timeout ────────────────────────────────────────────────────────────
const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 Minuten

// ── Phasenpfade ──────────────────────────────────────────────────────────────
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

// ── DeviceInfo ───────────────────────────────────────────────────────────────
interface DeviceInfo {
    type: string;
    instance: number;
    serial: string;
    productName: string;
    customName: string;
    virtual: boolean;
    source: string;
    group: string; // Settings.Group → Ordner-Ebene bei switches
    phaseVoltage: Record<string, number>;
    lastUpdate: number;
    staleTimer: ReturnType<typeof setTimeout> | null;
}

class VictronGx extends utils.Adapter {
    private mqttClient: mqtt.MqttClient | null = null;
    private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    private vrmId: string = '';
    private deviceMap: Map<string, DeviceInfo> = new Map();
    private serialMap: Map<string, string> = new Map();
    private loggedDevices: Set<string> = new Set();
    private channelReady: Set<string> = new Set();

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'victron-gx' });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    // ── Adapter-Start ────────────────────────────────────────────────────────
    private onReady(): void {
        void this.setState('info.connection', false, true);
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

    // ── MQTT ─────────────────────────────────────────────────────────────────
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
            void this.setState('info.connection', false, true);
        });
        this.mqttClient.on('offline', () => {
            this.log.warn('MQTT Verbindung getrennt');
            void this.setState('info.connection', false, true);
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

            if (!path || !RELEVANT_PATHS[deviceType]) {
                return;
            }

            const rawValue = 'value' in parsed ? parsed.value : parsed;
            if (rawValue === null || rawValue === undefined) {
                return;
            }
            const value = rawValue;

            // ── Registrierungspfade → Metadaten ──────────────────────────
            if (REGISTRATION_PATHS.has(normalizedPath)) {
                if (typeof value === 'string' || typeof value === 'number') {
                    this.updateDeviceMeta(deviceType, instance, normalizedPath, String(value));
                }
                return;
            }

            // ── Pfad remappen (z.B. SwitchableOutput.output_1.State → State)
            const remappedPath = PATH_REMAP[deviceType]?.[normalizedPath] ?? normalizedPath;

            // ── Relevanzprüfung mit remapptem Pfad ───────────────────────
            const relevantPaths = RELEVANT_PATHS[deviceType];
            const isRelevant = relevantPaths.some(rp => remappedPath === rp.replace(/\//g, '.'));
            if (!isRelevant) {
                return;
            }

            // ── Gerät muss Serial haben (kein temporäres Instanz-Objekt) ──
            const deviceKey = `${deviceType}/${instance}`;
            const device = this.deviceMap.get(deviceKey);
            const serial = this.serialMap.get(deviceKey);

            // Ohne Serial noch nicht speichern → verhindert doppelte Objekte
            if (!serial && deviceType !== 'grid') {
                return;
            }

            // ── baseId berechnen ──────────────────────────────────────────
            // Switch:  devices.switch.<gruppe>.<serial>
            // Andere:  devices.<type>.<serial|instanz>
            const baseId = this.getBaseId(deviceType, instance, serial, device);
            if (!baseId) {
                return;
            }

            // ── Phasen-Filterung für virtuelle Geräte ─────────────────────
            if (device?.virtual && PHASE_VOLTAGE_PATHS[deviceType]) {
                const voltageMatch = normalizedPath.match(/^Ac\.(L[123])\.Voltage$/);
                if (voltageMatch) {
                    device.phaseVoltage[voltageMatch[1]] = typeof value === 'number' ? value : 0;
                }
                const phaseMatch = normalizedPath.match(/^Ac\.(L[123])\./);
                if (phaseMatch) {
                    if ((device.phaseVoltage[phaseMatch[1]] ?? 0) === 0) {
                        return;
                    }
                }
            }

            // ── Stale-Timer ───────────────────────────────────────────────
            if (device) {
                this.touchDevice(device, baseId);
            }

            // ── Datenpunkt anlegen ────────────────────────────────────────
            const isWritable = (WRITABLE_PATHS[deviceType] || []).some(wp => remappedPath === wp);
            const stateId = `${baseId}.${remappedPath}`;

            // Switch State + Status: Victron liefert 0/1 → ioBroker speichert boolean
            const isSwitchBool = deviceType === 'switch' && (remappedPath === 'State' || remappedPath === 'Status');
            const storeValue = isSwitchBool ? value !== 0 : value;
            const storeType = isSwitchBool
                ? 'boolean'
                : typeof value === 'number'
                  ? 'number'
                  : typeof value === 'boolean'
                    ? 'boolean'
                    : 'string';

            await this.setObjectNotExistsAsync(stateId, {
                type: 'state',
                common: {
                    name: this.getFriendlyName(remappedPath),
                    type: storeType,
                    role: this.getRole(remappedPath),
                    unit: this.getUnit(remappedPath),
                    read: true,
                    write: isWritable,
                },
                native: {},
            });
            await this.setState(stateId, { val: storeValue, ack: true });

            // ── activePhase ───────────────────────────────────────────────
            if (PHASE_POWER_PATHS[deviceType]?.includes(remappedPath) && this.channelReady.has(baseId)) {
                void this.updateActivePhase(deviceType, baseId);
            }
        } catch (err) {
            this.log.debug(`Fehler bei Topic ${topic}: ${(err as Error).message}`);
        }
    }

    // ── baseId berechnen ─────────────────────────────────────────────────────
    // Switch:  devices.switch.<gruppe>.<serial>
    //          Gruppe darf nicht leer sein (Victron-Pflicht)
    // Andere:  devices.<type>.<serial>  (grid: <instanz>)
    private getBaseId(
        type: string,
        instance: number,
        serial: string | undefined,
        device: DeviceInfo | undefined,
    ): string | null {
        if (type === 'switch') {
            if (!serial || !device?.group) {
                return null; // Noch nicht alle Metadaten bekannt
            }
            const groupKey = device.group.replace(/[^a-zA-Z0-9_]/g, '_');
            return `devices.switch.${groupKey}.${serial}`;
        }
        if (serial) {
            return `devices.${type}.${serial}`;
        }
        if (type === 'grid') {
            return `devices.${type}.${instance}`;
        }
        return null;
    }

    // ── Metadaten sammeln und Channel anlegen ────────────────────────────────
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
                const key = `serial:${deviceKey}`;
                if (!this.loggedDevices.has(key)) {
                    this.loggedDevices.add(key);
                    this.log.info(`Gerät erkannt: ${KNOWN_DEVICE_TYPES[type] || type} → Serial: ${value}`);
                }
                break;
            }
            case 'ProductName': {
                device.productName = value;
                device.virtual = value.toLowerCase().includes('virtual');
                if (device.virtual) {
                    const key = `virtual:${deviceKey}`;
                    if (!this.loggedDevices.has(key)) {
                        this.loggedDevices.add(key);
                        this.log.info(`Virtuelles Gerät: ${type}/${instance} → "${value}"`);
                    }
                }
                break;
            }
            case 'CustomName':
                // Nur setzen wenn noch kein spezifischerer Name vorhanden
                if (!device.customName) {
                    device.customName = value;
                }
                break;

            case 'Mgmt.Connection':
                if (value === 'Node-RED') {
                    device.source = 'node-red';
                    const key = `nodered:${deviceKey}`;
                    if (!this.loggedDevices.has(key)) {
                        this.loggedDevices.add(key);
                        this.log.info(`Node-RED Gerät: ${type}/${instance}`);
                    }
                }
                break;

            case 'Mgmt.ProcessName':
                if (value === 'dbus-victron-virtual') {
                    device.virtual = true;
                }
                break;

            case 'Connected': {
                // Connected = Node-RED Flow aktiv → info.connected als boolean
                const baseId = this.getBaseId(device.type, device.instance, device.serial || undefined, device);
                if (baseId) {
                    const connected = value === '1' || value === 'true';
                    void this.setObjectNotExistsAsync(`${baseId}.info.connected`, {
                        type: 'state',
                        common: {
                            name: 'Verbunden',
                            type: 'boolean',
                            role: 'indicator.connected',
                            read: true,
                            write: false,
                        },
                        native: {},
                    }).then(() => {
                        void this.setState(`${baseId}.info.connected`, { val: connected, ack: true });
                    });
                }
                break;
            }

            case 'SwitchableOutput.output_1.Settings.Group':
                device.group = value;
                // Gruppenordner anlegen
                {
                    const groupKey = value.replace(/[^a-zA-Z0-9_]/g, '_');
                    const groupId = `devices.switch.${groupKey}`;
                    void this.setObjectNotExistsAsync(groupId, {
                        type: 'folder',
                        common: { name: value },
                        native: {},
                    });
                }
                break;

            case 'SwitchableOutput.output_1.Settings.CustomName':
                // Spezifischer Name hat immer Priorität → überschreibt generischen
                device.customName = value;
                // Channel-Name nachträglich aktualisieren
                if (device.serial && device.group) {
                    const groupKey = device.group.replace(/[^a-zA-Z0-9_]/g, '_');
                    const channelId = `devices.switch.${groupKey}.${device.serial}`;
                    const suffix = device.source === 'node-red' ? ' [Node-RED]' : device.virtual ? ' [Virtual]' : '';
                    void this.extendObjectAsync(channelId, {
                        common: { name: `${value}${suffix}` },
                    });
                }
                break;
        }

        // Channel anlegen sobald alle nötigen Metadaten vorhanden
        void this.ensureDeviceChannel(device);
    }

    // ── Channel anlegen ──────────────────────────────────────────────────────
    private async ensureDeviceChannel(device: DeviceInfo): Promise<void> {
        // baseId berechnen — gibt null zurück wenn noch nicht alle Metadaten da
        const baseId = this.getBaseId(device.type, device.instance, device.serial || undefined, device);
        if (!baseId) {
            return;
        }
        // Bereits vollständig angelegt
        if (this.channelReady.has(baseId)) {
            return;
        }

        const displayName = device.customName || device.productName || KNOWN_DEVICE_TYPES[device.type] || device.type;
        const suffix = device.virtual ? (device.source === 'node-red' ? ' [Node-RED]' : ' [Virtual]') : '';

        await this.setObjectNotExistsAsync(baseId, {
            type: 'channel',
            common: { name: `${displayName}${suffix}` },
            native: {
                type: device.type,
                instance: device.instance,
                serial: device.serial,
                virtual: device.virtual,
                source: device.source,
                group: device.group,
            },
        });

        // Info-Datenpunkte
        const infoDps: Array<{ id: string; name: string; val: string | boolean }> = [
            { id: 'info.serial', name: 'Seriennummer', val: device.serial },
            { id: 'info.productName', name: 'Produktname', val: device.productName },
            { id: 'info.customName', name: 'Anzeigename', val: device.customName },
            { id: 'info.virtual', name: 'Virtuell', val: device.virtual },
            { id: 'info.source', name: 'Quelle', val: device.source },
        ];
        for (const dp of infoDps) {
            await this.setObjectNotExistsAsync(`${baseId}.${dp.id}`, {
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
                await this.setState(`${baseId}.${dp.id}`, { val: dp.val, ack: true });
            }
        }

        // Stale-Datenpunkte
        await this.setObjectNotExistsAsync(`${baseId}.info.lastUpdate`, {
            type: 'state',
            common: { name: 'Letztes Update', type: 'number', role: 'value.time', read: true, write: false },
            native: {},
        });
        await this.setObjectNotExistsAsync(`${baseId}.info.stale`, {
            type: 'state',
            common: { name: 'Keine Daten', type: 'boolean', role: 'indicator.maintenance', read: true, write: false },
            native: {},
        });

        // activePhase für AC-Geräte
        if (PHASE_POWER_PATHS[device.type]) {
            await this.setObjectNotExistsAsync(`${baseId}.info.activePhase`, {
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

        // Switch: schreibbaren State-Datenpunkt anlegen
        if (device.type === 'switch') {
            await this.setObjectNotExistsAsync(`${baseId}.State`, {
                type: 'state',
                common: {
                    name: device.customName || 'Schalter',
                    type: 'boolean',
                    role: 'switch',
                    read: true,
                    write: true,
                },
                native: {},
            });
        }

        this.channelReady.add(baseId);
        this.log.debug(`Channel angelegt: ${baseId}`);
    }

    // ── Stale-Erkennung ──────────────────────────────────────────────────────
    private touchDevice(device: DeviceInfo, baseId: string): void {
        device.lastUpdate = Date.now();
        if (device.staleTimer) {
            clearTimeout(device.staleTimer);
        }
        if (!this.channelReady.has(baseId)) {
            return;
        }
        void this.setState(`${baseId}.info.lastUpdate`, { val: device.lastUpdate, ack: true });
        void this.setState(`${baseId}.info.stale`, { val: false, ack: true });
        device.staleTimer = setTimeout(() => {
            this.log.warn(`Gerät ${device.type}/${device.instance} antwortet nicht mehr (stale)`);
            void this.setState(`${baseId}.info.stale`, { val: true, ack: true });
        }, STALE_TIMEOUT_MS);
    }

    // ── activePhase berechnen ────────────────────────────────────────────────
    private async updateActivePhase(deviceType: string, baseId: string): Promise<void> {
        const active: string[] = [];
        for (const phase of ['L1', 'L2', 'L3']) {
            try {
                const state = await this.getStateAsync(`${baseId}.Ac.${phase}.Power`);
                if (state && typeof state.val === 'number' && state.val !== 0) {
                    active.push(phase);
                }
            } catch {
                /* noch nicht angelegt */
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
    // ID-Format switch:  victron-gx.0.devices.switch.<gruppe>.<serial>.State
    // ID-Format andere:  victron-gx.0.devices.<type>.<serial>.<path>
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack) {
            return;
        }
        if (!this.mqttClient || !this.vrmId) {
            return;
        }

        const parts = id.split('.');
        // victron-gx.0.devices.<type>...
        if (parts[2] !== 'devices' || parts.length < 6) {
            return;
        }

        const deviceType = parts[3];
        let serial: string;
        let dpPath: string;

        if (deviceType === 'switch') {
            // victron-gx.0.devices.switch.<gruppe>.<serial>.<dp>
            if (parts.length < 7) {
                return;
            }
            serial = parts[5];
            const remapped = parts.slice(6).join('.');
            dpPath = WRITE_PATH_REMAP[deviceType]?.[remapped] ?? remapped.replace(/\./g, '/');
        } else {
            serial = parts[4];
            dpPath = parts.slice(5).join('/');
        }

        // Instance aus serialMap ermitteln
        let instance: number | null = null;
        for (const [key, ser] of this.serialMap.entries()) {
            if (ser === serial) {
                instance = parseInt(key.split('/')[1], 10);
                break;
            }
        }
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
        // Switch State: boolean → 0/1 für Victron MQTT
        const writeVal =
            deviceType === 'switch' && (dpPath.endsWith('State') || dpPath.endsWith('Status'))
                ? state.val
                    ? 1
                    : 0
                : state.val;
        const payload = JSON.stringify({ value: writeVal });
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
            State: 'Schaltzustand',
            Status: 'Hardware-Status',
            Connected: 'Verbunden',
            Mode: 'Betriebsart',
            Temperature: 'Temperatur',
            'Voltages.Sum': 'Zellspannung gesamt',
            'Voltages.Diff': 'Zellspannung Differenz',
            TimeToGo: 'Restlaufzeit',
            'Yield.Power': 'PV Leistung',
            'Yield.Today': 'Ertrag heute',
            'Yield.Total': 'Ertrag gesamt',
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
        if (path === 'State' || path === 'switch') {
            return 'switch';
        }
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
