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
    overview: 'Übersicht',
    platform: 'GX Gerät',
    temperature: 'Temperatursensor',
    tank: 'Tanksensor',
};

// ── Relevante MQTT-Pfade pro Gerätetyp ──────────────────────────────────────
//
// Phasen-Regel:
//   virtual=false → alle Phasen immer anlegen (Spannung liegt an)
//   virtual=true  → Phase nur wenn Voltage > 0
//
const RELEVANT_PATHS: Record<string, string[]> = {
    battery: [
        // Hauptwerte
        'Soc',
        'Dc.0.Voltage',
        'Dc.0.Current',
        'Dc.0.Power',
        'Dc.0.Temperature', // Haupt-Temperatur vom BMS
        'ConsumedAmphours',
        'TimeToGo',
        'Capacity',
        'CurrentAvg',
        // Temperaturen (via System.*)
        'System.Temperature1',
        'System.Temperature2',
        'System.Temperature3',
        'System.Temperature4',
        'System.MinCellTemperature',
        'System.MaxCellTemperature',
        // Zell-Aggregatwerte von Victron (kein eigenes Berechnen nötig)
        'System.MinCellVoltage',
        'System.MaxCellVoltage',
        'System.MinVoltageCellId',
        'System.MaxVoltageCellId',
        // Alarme
        'Alarms.LowVoltage',
        'Alarms.HighVoltage',
        'Alarms.LowSoc',
        // Zellenspannungen (dynamisch bis Cell32)
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
        'Voltages.Cell17',
        'Voltages.Cell18',
        'Voltages.Cell19',
        'Voltages.Cell20',
        'Voltages.Cell21',
        'Voltages.Cell22',
        'Voltages.Cell23',
        'Voltages.Cell24',
        'Voltages.Cell25',
        'Voltages.Cell26',
        'Voltages.Cell27',
        'Voltages.Cell28',
        'Voltages.Cell29',
        'Voltages.Cell30',
        'Voltages.Cell31',
        'Voltages.Cell32',
        'Voltages.Diff',
        'Serial',
        'ProductName',
        'CustomName',
    ],
    vebus: [
        // Status (kommen nur bei Änderung)
        'Soc',
        'State',
        'Mode',
        'VebusError',
        'VebusChargeState',
        // AC Eingang (L1 = aktiv, L2/L3 bei 3-Phasen-MP)
        'Ac.ActiveIn.L1.P',
        'Ac.ActiveIn.L1.S',
        'Ac.ActiveIn.L1.I',
        'Ac.ActiveIn.L1.V',
        'Ac.ActiveIn.L2.P',
        'Ac.ActiveIn.L3.P',
        'Ac.ActiveIn.P',
        'Ac.ActiveIn.S',
        'Ac.In1.CurrentLimit', // schreibbar: Eingangsstrombegrenzung
        // AC Ausgang
        'Ac.Out.L1.P',
        'Ac.Out.L1.S',
        'Ac.Out.L1.I',
        'Ac.Out.L1.V',
        'Ac.Out.L1.F',
        'Ac.Out.L2.P',
        'Ac.Out.L3.P',
        'Ac.Out.P',
        'Ac.Out.S',
        // DC
        'Dc.0.Voltage',
        'Dc.0.Current',
        'Dc.0.Power',
        'BatterySense.Voltage', // MP-seitige Batteriespannung
        // ESS Steuerung (schreibbar!)
        'Hub4.L1.AcPowerSetpoint', // ESS Sollwert W (negativ = einspeisen)
        // Registrierung
        'Serial',
        'ProductName',
        'CustomName',
        'Devices.0.SerialNumber', // echte Serial des MultiPlus
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
        'Ac.Energy.Reverse',
        'Serial',
        'ProductName',
        'CustomName',
        'Connected',
        'Position',
    ],
    acload: [
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
        'Ac.L1.Energy.Forward',
        'Ac.L2.Energy.Forward',
        'Ac.L3.Energy.Forward',
        'Ac.Energy.Forward',
        'Serial',
        'ProductName',
        'CustomName',
        'Mgmt.Connection',
        'Mgmt.ProcessName',
        'Connected',
        'Position',
        'NrOfPhases',
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
        'Ac.L1.Energy.Forward',
        'Ac.L2.Energy.Forward',
        'Ac.L3.Energy.Forward',
        'Ac.Energy.Forward',
        'Ac.Energy.Reverse',
        'Ac.Frequency',
        'Ac.MaxPower',
        'Ac.PowerLimit',
        'StatusCode',
        'ErrorCode',
        'Serial',
        'ProductName',
        'CustomName',
        'Mgmt.Connection',
        'Mgmt.ProcessName',
        'Connected',
        'Position',
        'NrOfPhases',
    ],
    switch: [
        'SwitchableOutput.output_1.State',
        'SwitchableOutput.output_1.Status',
        'Connected',
        'Serial',
        'ProductName',
        'CustomName',
        'Mgmt.Connection',
        'Mgmt.ProcessName',
        'SwitchableOutput.output_1.Settings.CustomName',
        'SwitchableOutput.output_1.Settings.Group',
    ],
    // system/0 wird als "overview" Channel angelegt
    system: [
        // Batterie
        'Dc.Battery.Soc',
        'Dc.Battery.Voltage',
        'Dc.Battery.Current',
        'Dc.Battery.Power',
        'Dc.Battery.ConsumedAmphours',
        // DC System
        'Dc.System.Power',
        'Dc.System.Current',
        'Dc.Vebus.Power',
        'Dc.Vebus.Current',
        'Dc.InverterCharger.Power',
        'Dc.InverterCharger.Current',
        // AC Verbrauch gesamt
        'Ac.Consumption.L1.Power',
        'Ac.Consumption.L2.Power',
        'Ac.Consumption.L3.Power',
        'Ac.Consumption.L1.Current',
        'Ac.Consumption.L2.Current',
        'Ac.Consumption.L3.Current',
        // AC Verbrauch aufgeteilt
        'Ac.ConsumptionOnOutput.L1.Power',
        'Ac.ConsumptionOnOutput.L2.Power',
        'Ac.ConsumptionOnOutput.L3.Power',
        'Ac.ConsumptionOnOutput.L1.Current',
        'Ac.ConsumptionOnOutput.L2.Current',
        'Ac.ConsumptionOnOutput.L3.Current',
        'Ac.ConsumptionOnInput.L1.Power',
        'Ac.ConsumptionOnInput.L2.Power',
        'Ac.ConsumptionOnInput.L3.Power',
        'Ac.ConsumptionOnInput.L1.Current',
        'Ac.ConsumptionOnInput.L2.Current',
        'Ac.ConsumptionOnInput.L3.Current',
        // Netz
        'Ac.Grid.L1.Power',
        'Ac.Grid.L2.Power',
        'Ac.Grid.L3.Power',
        'Ac.Grid.L1.Current',
        'Ac.Grid.L2.Current',
        'Ac.Grid.L3.Current',
        // PV am Netz
        'Ac.PvOnGrid.L1.Power',
        'Ac.PvOnGrid.L2.Power',
        'Ac.PvOnGrid.L3.Power',
        'Ac.PvOnGrid.L1.Current',
        'Ac.PvOnGrid.L2.Current',
        'Ac.PvOnGrid.L3.Current',
        // AC Eingang
        'Ac.ActiveIn.L1.Power',
        'Ac.ActiveIn.L2.Power',
        'Ac.ActiveIn.L3.Power',
        'Ac.ActiveIn.L1.Current',
        'Ac.ActiveIn.L2.Current',
        'Ac.ActiveIn.L3.Current',
        'Ac.ActiveIn.Source',
        // System
        'TimeToGo',
        'SystemState.State',
        'Serial',
    ],
    temperature: ['Temperature', 'Humidity', 'Pressure', 'ProductName', 'CustomName'],
    tank: ['Level', 'Remaining', 'Status', 'ProductName', 'CustomName'],
};

// ── Pfade die nur Metadaten liefern ─────────────────────────────────────────
const REGISTRATION_PATHS = new Set([
    'Serial',
    'ProductName',
    'CustomName',
    'Devices.0.SerialNumber',
    'Connected',
    'Position',
    'NrOfPhases',
    'Mgmt.Connection',
    'Mgmt.ProcessName',
    'SwitchableOutput.output_1.Settings.CustomName',
    'SwitchableOutput.output_1.Settings.Group',
]);

// ── Victron-Pfade → ioBroker-Pfade ──────────────────────────────────────────
const PATH_REMAP: Record<string, Record<string, string>> = {
    switch: {
        'SwitchableOutput.output_1.State': 'State',
        'SwitchableOutput.output_1.Status': 'Status',
    },
    battery: {
        // Temperaturen
        'Dc.0.Temperature': 'temperatures.main',
        'System.Temperature1': 'temperatures.temp1',
        'System.Temperature2': 'temperatures.temp2',
        'System.Temperature3': 'temperatures.temp3',
        'System.Temperature4': 'temperatures.temp4',
        'System.MinCellTemperature': 'temperatures.min',
        'System.MaxCellTemperature': 'temperatures.max',
        // Zell-Aggregate (direkt von Victron)
        'System.MinCellVoltage': 'cells.min',
        'System.MaxCellVoltage': 'cells.max',
        'System.MinVoltageCellId': 'cells.minId',
        'System.MaxVoltageCellId': 'cells.maxId',
        // Zellspannungen
        'Voltages.Cell1': 'cells.cell01',
        'Voltages.Cell2': 'cells.cell02',
        'Voltages.Cell3': 'cells.cell03',
        'Voltages.Cell4': 'cells.cell04',
        'Voltages.Cell5': 'cells.cell05',
        'Voltages.Cell6': 'cells.cell06',
        'Voltages.Cell7': 'cells.cell07',
        'Voltages.Cell8': 'cells.cell08',
        'Voltages.Cell9': 'cells.cell09',
        'Voltages.Cell10': 'cells.cell10',
        'Voltages.Cell11': 'cells.cell11',
        'Voltages.Cell12': 'cells.cell12',
        'Voltages.Cell13': 'cells.cell13',
        'Voltages.Cell14': 'cells.cell14',
        'Voltages.Cell15': 'cells.cell15',
        'Voltages.Cell16': 'cells.cell16',
        'Voltages.Cell17': 'cells.cell17',
        'Voltages.Cell18': 'cells.cell18',
        'Voltages.Cell19': 'cells.cell19',
        'Voltages.Cell20': 'cells.cell20',
        'Voltages.Cell21': 'cells.cell21',
        'Voltages.Cell22': 'cells.cell22',
        'Voltages.Cell23': 'cells.cell23',
        'Voltages.Cell24': 'cells.cell24',
        'Voltages.Cell25': 'cells.cell25',
        'Voltages.Cell26': 'cells.cell26',
        'Voltages.Cell27': 'cells.cell27',
        'Voltages.Cell28': 'cells.cell28',
        'Voltages.Cell29': 'cells.cell29',
        'Voltages.Cell30': 'cells.cell30',
        'Voltages.Cell31': 'cells.cell31',
        'Voltages.Cell32': 'cells.cell32',
        'Voltages.Diff': 'cells.diff',
        Temperature: 'temperatures.temp1',
        Temperature2: 'temperatures.temp2',
        Temperature3: 'temperatures.temp3',
        Temperature4: 'temperatures.temp4',
        'Alarms.LowVoltage': 'alarms.lowVoltage',
        'Alarms.HighVoltage': 'alarms.highVoltage',
        'Alarms.LowSoc': 'alarms.lowSoc',
    },
};

// ── ioBroker Write → MQTT Topic Pfad ────────────────────────────────────────
const WRITE_PATH_REMAP: Record<string, Record<string, string>> = {
    switch: {
        State: 'SwitchableOutput/output_1/State',
    },
};

// ── Schreibbare Datenpunkte ──────────────────────────────────────────────────
const WRITABLE_PATHS: Record<string, string[]> = {
    switch: ['State'],
    vebus: ['Mode', 'Ac.In1.CurrentLimit', 'Hub4.L1.AcPowerSetpoint'],
};

// ── StatusCode Bedeutungen (pvinverter) ──────────────────────────────────────
const PVINVERTER_STATUS: Record<number, string> = {
    0: 'Aus',
    1: 'Keine Verbindung',
    2: 'Fehler',
    3: 'Aus (Nacht)',
    7: 'In Betrieb',
    8: 'Normalbetrieb',
    9: 'Temporäre Last-Reduzierung',
    10: 'Maximale Ausgangsleistung',
};

// ── Stale-Timeout ────────────────────────────────────────────────────────────
const STALE_TIMEOUT_MS = 5 * 60 * 1000;

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

// ── Zellpfade für min/max Berechnung ────────────────────────────────────────
const CELL_PATH_RE = /^cells\.cell\d+$/;

// ── DeviceInfo ───────────────────────────────────────────────────────────────
interface DeviceInfo {
    type: string;
    instance: number;
    serial: string;
    productName: string;
    customName: string;
    virtual: boolean;
    source: string;
    group: string;
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
            const normPath = path.replace(/\//g, '.');

            if (!path || !RELEVANT_PATHS[deviceType]) {
                return;
            }

            const rawValue = 'value' in parsed ? parsed.value : parsed;
            if (rawValue === null || rawValue === undefined) {
                return;
            }

            // ── Registrierungspfade → Metadaten ──────────────────────────
            if (REGISTRATION_PATHS.has(normPath)) {
                if (typeof rawValue === 'string' || typeof rawValue === 'number') {
                    this.updateDeviceMeta(deviceType, instance, normPath, String(rawValue));
                }
                return;
            }

            // ── Pfad remappen ─────────────────────────────────────────────
            const remappedPath = PATH_REMAP[deviceType]?.[normPath] ?? normPath;

            // ── Relevanzprüfung ───────────────────────────────────────────
            const isRelevant = RELEVANT_PATHS[deviceType].some(rp => normPath === rp.replace(/\//g, '.'));
            if (!isRelevant) {
                return;
            }

            // ── Serial oder Instanz-Fallback ──────────────────────────
            const deviceKey = `${deviceType}/${instance}`;
            const device = this.deviceMap.get(deviceKey);
            const serial = this.serialMap.get(deviceKey);

            // Geräte ohne Serial → Instanznummer als stabile ID verwenden
            // vebus und grid liefern Serial nicht im MQTT-Stream
            const NO_SERIAL_TYPES = new Set(['grid', 'system', 'platform']);
            if (!serial && !NO_SERIAL_TYPES.has(deviceType)) {
                return;
            }

            // ── baseId berechnen ──────────────────────────────────────────
            const baseId = this.getBaseId(deviceType, instance, serial, device);
            if (!baseId) {
                return;
            }

            // ── Phasen-Filterung für virtuelle Geräte ─────────────────────
            if (device?.virtual && PHASE_VOLTAGE_PATHS[deviceType]) {
                const vMatch = normPath.match(/^Ac\.(L[123])\.Voltage$/);
                if (vMatch) {
                    device.phaseVoltage[vMatch[1]] = typeof rawValue === 'number' ? rawValue : 0;
                }
                const pMatch = normPath.match(/^Ac\.(L[123])\./);
                if (pMatch && (device.phaseVoltage[pMatch[1]] ?? 0) === 0) {
                    return;
                }
            }

            // ── Stale-Timer ───────────────────────────────────────────────
            if (device) {
                this.touchDevice(device, baseId);
            }

            // ── Wert konvertieren ─────────────────────────────────────────
            const isSwitchBool = deviceType === 'switch' && (remappedPath === 'State' || remappedPath === 'Status');
            const storeValue = isSwitchBool ? rawValue !== 0 : rawValue;
            const storeType = isSwitchBool
                ? 'boolean'
                : typeof rawValue === 'number'
                  ? 'number'
                  : typeof rawValue === 'boolean'
                    ? 'boolean'
                    : 'string';

            // ── Datenpunkt anlegen ────────────────────────────────────────
            const isWritable = (WRITABLE_PATHS[deviceType] || []).some(wp => remappedPath === wp);
            const stateId = `${baseId}.${remappedPath}`;

            const commonBase: ioBroker.StateCommon = {
                name: this.getFriendlyName(remappedPath),
                type: storeType,
                role: this.getRole(remappedPath),
                unit: this.getUnit(remappedPath),
                read: true,
                write: isWritable,
            };

            // StatusCode → states Map
            if (deviceType === 'pvinverter' && remappedPath === 'StatusCode') {
                (commonBase as any).states = PVINVERTER_STATUS;
            }

            await this.setObjectNotExistsAsync(stateId, {
                type: 'state',
                common: commonBase,
                native: {},
            });
            await this.setState(stateId, { val: storeValue, ack: true });

            // ── Batterie: cells min/max nach jedem Zellwert neu berechnen ─
            if (deviceType === 'battery' && CELL_PATH_RE.test(remappedPath)) {
                void this.updateBatteryCellMinMax(baseId);
            }

            // ── activePhase ───────────────────────────────────────────────
            if (PHASE_POWER_PATHS[deviceType]?.includes(normPath) && this.channelReady.has(baseId)) {
                void this.updateActivePhase(deviceType, baseId);
            }
        } catch (err) {
            this.log.debug(`Fehler bei Topic ${topic}: ${(err as Error).message}`);
        }
    }

    // ── baseId berechnen ─────────────────────────────────────────────────────
    // system/0 → overview.system (einzelner Channel, keine Geräte-Instanz)
    // switch   → devices.switch.<gruppe>.<serial>
    // andere   → devices.<type>.<serial>
    private getBaseId(
        type: string,
        instance: number,
        serial: string | undefined,
        device: DeviceInfo | undefined,
    ): string | null {
        if (type === 'system') {
            return 'overview';
        }
        if (type === 'switch') {
            if (!serial || !device?.group) {
                return null;
            }
            const groupKey = device.group.replace(/[^a-zA-Z0-9_]/g, '_');
            return `devices.switch.${groupKey}.${serial}`;
        }
        if (serial) {
            return `devices.${type}.${serial}`;
        }
        // Fallback für Geräte ohne Serial (vebus, grid, platform)
        return `devices.${type}.${instance}`;
    }

    // ── Metadaten sammeln ────────────────────────────────────────────────────
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
            case 'Serial':
            case 'Devices.0.SerialNumber': {
                const wasUnknown = !device.serial;
                device.serial = value;
                this.serialMap.set(deviceKey, value);
                const k = `serial:${deviceKey}`;
                if (!this.loggedDevices.has(k)) {
                    this.loggedDevices.add(k);
                    this.log.info(`Gerät erkannt: ${KNOWN_DEVICE_TYPES[type] || type} → Serial: ${value}`);
                }
                // Alten Instanz-Channel löschen falls als Leiche vorhanden
                if (wasUnknown) {
                    const oldId = `devices.${type}.${instance}`;
                    const newId = `devices.${type}.${value}`;
                    if (oldId !== newId) {
                        this.delObjectAsync(oldId, { recursive: true })
                            .then(() => this.log.debug(`Alten Channel gelöscht: ${oldId}`))
                            .catch(() => {
                                /* existierte nicht */
                            });
                    }
                }
                break;
            }
            case 'ProductName': {
                device.productName = value;
                device.virtual = value.toLowerCase().includes('virtual');
                if (device.virtual) {
                    const k = `virtual:${deviceKey}`;
                    if (!this.loggedDevices.has(k)) {
                        this.loggedDevices.add(k);
                        this.log.info(`Virtuelles Gerät: ${type}/${instance} → "${value}"`);
                    }
                }
                break;
            }
            case 'CustomName':
                if (!device.customName) {
                    device.customName = value;
                }
                break;

            case 'Connected': {
                // Verbindungsstatus → info.connected boolean
                const baseId = this.getBaseId(type, instance, device.serial || undefined, device);
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
            case 'Mgmt.Connection':
                if (value === 'Node-RED') {
                    device.source = 'node-red';
                    const k = `nodered:${deviceKey}`;
                    if (!this.loggedDevices.has(k)) {
                        this.loggedDevices.add(k);
                        this.log.info(`Node-RED Gerät: ${type}/${instance}`);
                    }
                }
                break;

            case 'Mgmt.ProcessName':
                if (value === 'dbus-victron-virtual') {
                    device.virtual = true;
                }
                break;

            case 'Position': {
                // Position des Geräts: 0=AC Ausgang, 1=AC Eingang, 2=AC Eingang 2
                const posNames: Record<string, string> = {
                    0: 'AC Ausgang (hinter MultiPlus)',
                    1: 'AC Eingang (Netz)',
                    2: 'AC Eingang 2',
                };
                const baseId = this.getBaseId(type, instance, device.serial || undefined, device);
                if (baseId) {
                    void this.setObjectNotExistsAsync(`${baseId}.info.position`, {
                        type: 'state',
                        common: {
                            name: 'Position',
                            type: 'number',
                            role: 'value',
                            states: { 0: 'AC Ausgang (hinter MultiPlus)', 1: 'AC Eingang (Netz)', 2: 'AC Eingang 2' },
                            read: true,
                            write: false,
                        },
                        native: {},
                    }).then(() => {
                        void this.setState(`${baseId}.info.position`, { val: parseInt(value, 10), ack: true });
                        const k = `position:${deviceKey}`;
                        if (!this.loggedDevices.has(k)) {
                            this.loggedDevices.add(k);
                            this.log.info(`${type}/${instance}: Position = ${posNames[value] || value}`);
                        }
                    });
                }
                break;
            }

            case 'NrOfPhases': {
                const baseId = this.getBaseId(type, instance, device.serial || undefined, device);
                if (baseId) {
                    void this.setObjectNotExistsAsync(`${baseId}.info.nrOfPhases`, {
                        type: 'state',
                        common: { name: 'Anzahl Phasen', type: 'number', role: 'value', read: true, write: false },
                        native: {},
                    }).then(() => {
                        void this.setState(`${baseId}.info.nrOfPhases`, { val: parseInt(value, 10), ack: true });
                    });
                }
                break;
            }

            case 'SwitchableOutput.output_1.Settings.Group': {
                device.group = value;
                const groupKey = value.replace(/[^a-zA-Z0-9_]/g, '_');
                void this.setObjectNotExistsAsync(`devices.switch.${groupKey}`, {
                    type: 'folder',
                    common: { name: value },
                    native: {},
                });
                break;
            }
            case 'SwitchableOutput.output_1.Settings.CustomName': {
                device.customName = value;
                if (device.serial && device.group) {
                    const groupKey = device.group.replace(/[^a-zA-Z0-9_]/g, '_');
                    const channelId = `devices.switch.${groupKey}.${device.serial}`;
                    const suffix = device.source === 'node-red' ? ' [Node-RED]' : device.virtual ? ' [Virtual]' : '';
                    void this.extendObjectAsync(channelId, { common: { name: `${value}${suffix}` } });
                }
                break;
            }
        }

        void this.ensureDeviceChannel(device);
    }

    // ── Channel anlegen ──────────────────────────────────────────────────────
    private async ensureDeviceChannel(device: DeviceInfo): Promise<void> {
        // Typen die eine Serial liefern: erst anlegen wenn Serial bekannt
        // Sonst entstehen Duplikate (Instanznummer + Serial)
        const NEEDS_SERIAL = new Set([
            'battery',
            'acload',
            'pvinverter',
            'vebus',
            'solarcharger',
            'temperature',
            'tank',
        ]);
        if (NEEDS_SERIAL.has(device.type) && !device.serial) {
            return;
        }

        const serial = device.serial || undefined;
        const baseId = this.getBaseId(device.type, device.instance, serial, device);
        if (!baseId) {
            return;
        }
        if (this.channelReady.has(baseId)) {
            return;
        }

        const displayName = device.customName || device.productName || KNOWN_DEVICE_TYPES[device.type] || device.type;
        const suffix = device.virtual ? (device.source === 'node-red' ? ' [Node-RED]' : ' [Virtual]') : '';

        // overview ist ein eigener Channel ohne Geräte-Typ-Prefix
        const objType = baseId === 'overview' ? 'channel' : 'channel';

        await this.setObjectNotExistsAsync(baseId, {
            type: objType,
            common: { name: baseId === 'overview' ? 'Übersicht' : `${displayName}${suffix}` },
            native: {
                type: device.type,
                instance: device.instance,
                serial: device.serial,
                virtual: device.virtual,
                source: device.source,
                group: device.group,
            },
        });

        // ── info.* Datenpunkte ────────────────────────────────────────────
        if (baseId !== 'overview') {
            // deviceId = der ioBroker Pfad-Schlüssel (Serial oder Gruppe.Serial)
            const deviceId =
                device.type === 'switch'
                    ? `${device.group.replace(/[^a-zA-Z0-9_]/g, '_')}.${device.serial}`
                    : device.serial || device.instance.toString();

            const infoDps: Array<{ id: string; name: string; val: string | boolean }> = [
                { id: 'info.deviceId', name: 'Geräte-ID', val: deviceId },
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
                        role:
                            dp.id === 'info.serial'
                                ? 'info.serial'
                                : dp.id === 'info.deviceId'
                                  ? 'info.address'
                                  : 'info.name',
                        read: true,
                        write: false,
                    },
                    native: {},
                });
                if (dp.val !== '' && dp.val !== false) {
                    await this.setState(`${baseId}.${dp.id}`, { val: dp.val, ack: true });
                }
            }

            // Stale
            await this.setObjectNotExistsAsync(`${baseId}.info.lastUpdate`, {
                type: 'state',
                common: { name: 'Letztes Update', type: 'number', role: 'value.time', read: true, write: false },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${baseId}.info.stale`, {
                type: 'state',
                common: {
                    name: 'Keine Daten',
                    type: 'boolean',
                    role: 'indicator.maintenance',
                    read: true,
                    write: false,
                },
                native: {},
            });
        }

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

        // Switch State
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

        // Batterie: cells + temperatures Ordner anlegen
        if (device.type === 'battery') {
            await this.setObjectNotExistsAsync(`${baseId}.cells`, {
                type: 'folder',
                common: { name: 'Zellspannungen' },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${baseId}.cells.min`, {
                type: 'state',
                common: {
                    name: 'Zelle Min',
                    type: 'number',
                    role: 'value.voltage',
                    unit: 'V',
                    read: true,
                    write: false,
                },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${baseId}.cells.max`, {
                type: 'state',
                common: {
                    name: 'Zelle Max',
                    type: 'number',
                    role: 'value.voltage',
                    unit: 'V',
                    read: true,
                    write: false,
                },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${baseId}.cells.diff`, {
                type: 'state',
                common: {
                    name: 'Zelle Differenz',
                    type: 'number',
                    role: 'value.voltage',
                    unit: 'V',
                    read: true,
                    write: false,
                },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${baseId}.temperatures`, {
                type: 'folder',
                common: { name: 'Temperaturen' },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${baseId}.alarms`, {
                type: 'folder',
                common: { name: 'Alarme' },
                native: {},
            });
        }

        this.channelReady.add(baseId);
        this.log.debug(`Channel angelegt: ${baseId}`);
    }

    // ── Batterie Zell-Min/Max berechnen ─────────────────────────────────────
    private async updateBatteryCellMinMax(baseId: string): Promise<void> {
        const vals: number[] = [];
        for (let i = 1; i <= 32; i++) {
            const id = `${baseId}.cells.cell${String(i).padStart(2, '0')}`;
            try {
                const s = await this.getStateAsync(id);
                if (s && typeof s.val === 'number' && s.val > 0) {
                    vals.push(s.val);
                }
            } catch {
                /* noch nicht angelegt */
            }
        }
        if (vals.length === 0) {
            return;
        }
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        await this.setState(`${baseId}.cells.min`, { val: Math.round(min * 1000) / 1000, ack: true });
        await this.setState(`${baseId}.cells.max`, { val: Math.round(max * 1000) / 1000, ack: true });
    }

    // ── Stale-Erkennung ──────────────────────────────────────────────────────
    private touchDevice(device: DeviceInfo, baseId: string): void {
        device.lastUpdate = Date.now();
        if (device.staleTimer) {
            clearTimeout(device.staleTimer);
        }
        if (!this.channelReady.has(baseId) || baseId === 'overview') {
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
    private async updateActivePhase(_deviceType: string, baseId: string): Promise<void> {
        const active: string[] = [];
        for (const phase of ['L1', 'L2', 'L3']) {
            try {
                const s = await this.getStateAsync(`${baseId}.Ac.${phase}.Power`);
                if (s && typeof s.val === 'number' && s.val !== 0) {
                    active.push(phase);
                }
            } catch {
                /* noch nicht angelegt */
            }
        }
        const activePhase = active.length === 1 ? active[0] : active.length > 1 ? 'multi' : '';
        await this.setState(`${baseId}.info.activePhase`, { val: activePhase, ack: true });
    }

    // ── MQTT Write: ioBroker → GX ────────────────────────────────────────────
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack) {
            return;
        }
        if (!this.mqttClient || !this.vrmId) {
            return;
        }

        // victron-gx.0.devices.<type>...  oder  victron-gx.0.overview.*
        const parts = id.split('.');
        if (parts.length < 5) {
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

        // boolean → 0/1 für Victron
        const writeVal = deviceType === 'switch' ? (state.val ? 1 : 0) : state.val;

        const mqttTopic = `W/${this.vrmId}/${deviceType}/${instance}/${dpPath}`;
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
            'Dc.Battery.Voltage': 'Batterie Spannung',
            'Dc.Battery.Current': 'Batterie Strom',
            'Dc.Battery.Power': 'Batterie Leistung',
            'Dc.Pv.Power': 'PV Leistung gesamt',
            'Dc.Pv.Current': 'PV Strom gesamt',
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
            'Ac.Grid.L1.Power': 'Netz L1 Leistung',
            'Ac.Grid.L2.Power': 'Netz L2 Leistung',
            'Ac.Grid.L3.Power': 'Netz L3 Leistung',
            'Ac.ActiveIn.Source': 'Aktive Eingangsquelle',
            State: 'Schaltzustand',
            Status: 'Hardware-Status',
            Connected: 'Verbunden',
            StatusCode: 'Status',
            Mode: 'Betriebsart',
            'SystemState.State': 'Systemzustand',
            TimeToGo: 'Restlaufzeit',
            'Yield.Power': 'PV Leistung',
            'Yield.Today': 'Ertrag heute',
            'Yield.Total': 'Ertrag gesamt',
            'cells.min': 'Zelle Min',
            'cells.max': 'Zelle Max',
            'cells.diff': 'Zelle Differenz',
            'cells.minId': 'Zelle Min ID',
            'cells.maxId': 'Zelle Max ID',
            'temperatures.main': 'Temperatur (BMS)',
            'temperatures.temp1': 'Temperatur 1',
            'temperatures.temp2': 'Temperatur 2',
            'temperatures.temp3': 'Temperatur 3',
            'temperatures.temp4': 'Temperatur 4',
            'temperatures.min': 'Temperatur Min',
            'temperatures.max': 'Temperatur Max',
            'alarms.lowVoltage': 'Alarm: Unterspannung',
            'alarms.highVoltage': 'Alarm: Überspannung',
            'alarms.lowSoc': 'Alarm: SOC niedrig',
            // Overview/System
            'Dc.Battery.Soc': 'Batterie Ladezustand',
            'Dc.Battery.ConsumedAmphours': 'Batterie Verbrauch',
            'Dc.System.Power': 'DC System Leistung',
            'Dc.System.Current': 'DC System Strom',
            'Dc.Vebus.Power': 'MultiPlus DC Leistung',
            'Dc.Vebus.Current': 'MultiPlus DC Strom',
            'Dc.InverterCharger.Power': 'Wechselrichter DC Leistung',
            'Dc.InverterCharger.Current': 'Wechselrichter DC Strom',
            'Ac.Consumption.L1.Power': 'Verbrauch L1',
            'Ac.Consumption.L2.Power': 'Verbrauch L2',
            'Ac.Consumption.L3.Power': 'Verbrauch L3',
            'Ac.ConsumptionOnOutput.L1.Power': 'Verbrauch Ausgang L1',
            'Ac.ConsumptionOnOutput.L2.Power': 'Verbrauch Ausgang L2',
            'Ac.ConsumptionOnOutput.L3.Power': 'Verbrauch Ausgang L3',
            'Ac.ConsumptionOnInput.L1.Power': 'Verbrauch Eingang L1',
            'Ac.ConsumptionOnInput.L2.Power': 'Verbrauch Eingang L2',
            'Ac.ConsumptionOnInput.L3.Power': 'Verbrauch Eingang L3',
            'Ac.PvOnGrid.L1.Power': 'PV Netz L1',
            'Ac.PvOnGrid.L2.Power': 'PV Netz L2',
            'Ac.PvOnGrid.L3.Power': 'PV Netz L3',
            // PVInverter/ACLoad extras
            'Ac.L1.Energy.Forward': 'L1 Energie Bezug',
            'Ac.L2.Energy.Forward': 'L2 Energie Bezug',
            'Ac.L3.Energy.Forward': 'L3 Energie Bezug',
            'Ac.Frequency': 'Frequenz',
            'Ac.MaxPower': 'Max. Leistung',
            'Ac.PowerLimit': 'Leistungsbegrenzung',
            ErrorCode: 'Fehlercode',
            NrOfPhases: 'Anzahl Phasen',
            Position: 'Position',
            'BatterySense.Voltage': 'Batterie Spannung (MP)',
            'Hub4.L1.AcPowerSetpoint': 'ESS Sollwert L1',
            'Ac.ActiveIn.L1.I': 'L1 Eingangsstrom',
            'Ac.ActiveIn.L1.V': 'L1 Eingangsspannung',
            'Ac.ActiveIn.L1.S': 'L1 Eingang Scheinleistung',
            'Ac.ActiveIn.P': 'Eingang Gesamtleistung',
            'Ac.ActiveIn.S': 'Eingang Scheinleistung',
            'Ac.Out.L1.F': 'L1 Ausgangsfrequenz',
            'Ac.Out.L1.I': 'L1 Ausgangsstrom',
            'Ac.Out.L1.S': 'L1 Ausgang Scheinleistung',
            'Ac.Out.P': 'Ausgang Gesamtleistung',
            'Ac.Out.S': 'Ausgang Scheinleistung',
            Capacity: 'Kapazität',
            CurrentAvg: 'Durchschnittsstrom',
        };
        if (names[path]) {
            return names[path];
        }
        if (path.startsWith('cells.cell')) {
            return `Zelle ${parseInt(path.replace('cells.cell', ''), 10)}`;
        }
        return path;
    }

    private getUnit(path: string): string {
        if (
            path.startsWith('cells.cell') ||
            path === 'cells.min' ||
            path === 'cells.max' ||
            path === 'cells.diff' ||
            path.includes('Voltage') ||
            path.endsWith('.V')
        ) {
            return 'V';
        }
        if (path.includes('Power') || path === 'Hub4.L1.AcPowerSetpoint') {
            return 'W';
        }
        if (path.includes('Current') || path.endsWith('.I')) {
            return 'A';
        }
        if (path.includes('Energy')) {
            return 'kWh';
        }
        if (path.includes('Soc')) {
            return '%';
        }
        if (path.startsWith('temperatures.')) {
            return '°C';
        }
        if (path.endsWith('.S')) {
            return 'VA';
        }
        if (path.endsWith('.F')) {
            return 'Hz';
        }
        if (path === 'Yield.Today' || path === 'Yield.Total') {
            return 'kWh';
        }
        if (path === 'Yield.Power') {
            return 'W';
        }
        if (path === 'Level') {
            return '%';
        }
        if (path === 'Remaining') {
            return 'm³';
        }
        if (path === 'Humidity') {
            return '%';
        }
        if (path === 'Pressure') {
            return 'hPa';
        }
        if (path === 'Capacity' || path.includes('ConsumedAmphours')) {
            return 'Ah';
        }
        if (path === 'Ac.Frequency') {
            return 'Hz';
        }
        if (path === 'Ac.MaxPower' || path === 'Ac.PowerLimit') {
            return 'W';
        }
        return '';
    }

    private getRole(path: string): string {
        if (path === 'State') {
            return 'switch';
        }
        if (
            path.startsWith('cells.cell') ||
            path === 'cells.min' ||
            path === 'cells.max' ||
            path === 'cells.diff' ||
            path.includes('Voltage') ||
            path.endsWith('.V')
        ) {
            return 'value.voltage';
        }
        if (path.includes('Power') || path === 'Hub4.L1.AcPowerSetpoint') {
            return 'value.power';
        }
        if (path.includes('Current') || path.endsWith('.I')) {
            return 'value.current';
        }
        if (path.endsWith('.S')) {
            return 'value.power';
        }
        if (path.endsWith('.F')) {
            return 'value.frequency';
        }
        if (path.includes('Energy')) {
            return 'value.energy.consumed';
        }
        if (path.includes('Soc')) {
            return 'value.battery';
        }
        if (path.startsWith('temperatures.')) {
            return 'value.temperature';
        }
        if (path.startsWith('alarms.')) {
            return 'indicator.alarm';
        }
        if (path === 'cells.minId' || path === 'cells.maxId') {
            return 'text';
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
