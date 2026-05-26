/*
 * ioBroker Victron GX Adapter
 * Verbindet sich lokal mit Victron GX Geräten via MQTT
 * Verwendet Seriennummern als stabile Geräte-IDs
 */
import * as utils from '@iobroker/adapter-core';
import * as mqtt from 'mqtt';

// ── Gerätetypen die wir kennen und verarbeiten ──────────────────────────────
const KNOWN_DEVICE_TYPES: Record<string, string> = {
    battery:       'Batterie',
    vebus:         'Wechselrichter',
    solarcharger:  'Solarladeregler (MPPT)',
    acload:        'AC Last',
    grid:          'Netzanschluss',
    pvinverter:    'PV Wechselrichter',
    system:        'System',
    platform:      'GX Gerät',
    temperature:   'Temperatursensor',
    tank:          'Tanksensor',
};

// ── Nur diese Datenpunkte pro Gerät sind relevant ───────────────────────────
const RELEVANT_PATHS: Record<string, string[]> = {
    battery: [
        'Soc', 'Voltage', 'Current', 'Power', 'Temperature',
        'ConsumedAmphours', 'TimeToGo', 'Alarms.LowVoltage',
        'Alarms.HighVoltage', 'Alarms.LowSoc', 'Serial', 'ProductName',
        'Info.ChargeMode', 'Info.ChargeRequest',
    ],
    vebus: [
        'Soc', 'State', 'Mode', 'VebusError', 'VebusChargeState',
        'Ac.ActiveIn.L1.P', 'Ac.ActiveIn.L2.P', 'Ac.ActiveIn.L3.P',
        'Ac.Out.L1.P', 'Ac.Out.L2.P', 'Ac.Out.L3.P',
        'Ac.Out.L1.V', 'Ac.Out.L2.V', 'Ac.Out.L3.V',
        'Dc.0.Voltage', 'Dc.0.Current', 'Dc.0.Power',
        'Serial', 'ProductName',
    ],
    solarcharger: [
        'Pv.V', 'Pv.P', 'Dc.0.Voltage', 'Dc.0.Current',
        'State', 'Yield.Power', 'Yield.Today', 'Yield.Total',
        'History.Overall.DaysAvailable',
        'Serial', 'ProductName',
    ],
    grid: [
        'Ac.L1.Power', 'Ac.L2.Power', 'Ac.L3.Power',
        'Ac.L1.Voltage', 'Ac.L2.Voltage', 'Ac.L3.Voltage',
        'Ac.L1.Current', 'Ac.L2.Current', 'Ac.L3.Current',
        'Ac.Energy.Forward', 'Ac.Energy.Reverse',
    ],
    acload: [
        'Ac.L1.Power', 'Ac.L2.Power', 'Ac.L3.Power',
        'Ac.L1.Voltage', 'Ac.L2.Voltage', 'Ac.L3.Voltage',
        'Ac.Energy.Forward',
    ],
    pvinverter: [
        'Ac.Power', 'Ac.L1.Power', 'Ac.L2.Power', 'Ac.L3.Power',
        'Ac.L1.Voltage', 'Ac.Energy.Forward',
        'Serial', 'ProductName',
    ],
    system: [
        'Soc', 'Dc.Battery.Voltage', 'Dc.Battery.Current', 'Dc.Battery.Power',
        'Dc.Pv.Power', 'Dc.Pv.Current',
        'Ac.ConsumptionOnOutput.L1.Power', 'Ac.ConsumptionOnOutput.L2.Power', 'Ac.ConsumptionOnOutput.L3.Power',
        'Ac.Grid.L1.Power', 'Ac.Grid.L2.Power', 'Ac.Grid.L3.Power',
        'Ac.ActiveIn.Source', 'TimeToGo', 'SystemState.State',
        'Serial',
    ],
    temperature: [
        'Temperature', 'Humidity', 'Pressure', 'ProductName',
    ],
    tank: [
        'Level', 'Remaining', 'Status', 'ProductName',
    ],
};

// ── Einheiten für bekannte Datenpunkte ──────────────────────────────────────
const UNITS: Record<string, string> = {
    Soc: '%', Voltage: 'V', Current: 'A', Power: 'W',
    Temperature: '°C', Humidity: '%', Pressure: 'hPa',
    'Yield.Today': 'kWh', 'Yield.Total': 'kWh', 'Yield.Power': 'W',
    Level: '%', Remaining: 'm³',
};

interface DeviceInfo {
    type: string;
    instance: number;
    serial: string;
    productName: string;
}

class VictronGx extends utils.Adapter {
    private mqttClient: mqtt.MqttClient | null = null;
    private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    private vrmId: string = '';
    // Mapping: "type/instance" → DeviceInfo
    private deviceMap: Map<string, DeviceInfo> = new Map();
    // Mapping: "type/instance" → serial (für schnellen Lookup)
    private serialMap: Map<string, string> = new Map();

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'victron-gx',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        this.setState('info.connection', false, true);

        const host = this.config.host as string;
        const port = (this.config.port as number) || 1883;
        const username = this.config.mqttUsername as string;
        const password = this.config.mqttPassword as string;

        if (!host) {
            this.log.error('Keine IP-Adresse konfiguriert! Bitte in den Adapter-Einstellungen eintragen.');
            return;
        }

        this.log.info(`Verbinde mit Victron GX unter ${host}:${port}...`);
        this.connectMqtt(host, port, username, password);
    }

    private connectMqtt(host: string, port: number, username: string, password: string): void {
        const options: mqtt.IClientOptions = {
            port,
            clientId: `iobroker_victron_${Math.random().toString(16).slice(2)}`,
            clean: true,
            reconnectPeriod: 5000,
        };

        if (username) options.username = username;
        if (password) options.password = password;

        this.mqttClient = mqtt.connect(`mqtt://${host}`, options);

        this.mqttClient.on('connect', () => {
            this.log.info('MQTT verbunden mit Victron GX!');
            this.setState('info.connection', true, true);

            // Erstmal nur # subscriben um VRM ID und Geräteliste zu holen
            this.mqttClient!.subscribe('N/#', (err) => {
                if (err) {
                    this.log.error(`Subscribe Fehler: ${err.message}`);
                }
            });
        });

        this.mqttClient.on('message', (topic: string, payload: Buffer) => {
            this.handleMessage(topic, payload);
        });

        this.mqttClient.on('error', (err) => {
            this.log.error(`MQTT Fehler: ${err.message}`);
            this.setState('info.connection', false, true);
        });

        this.mqttClient.on('offline', () => {
            this.log.warn('MQTT Verbindung getrennt');
            this.setState('info.connection', false, true);
        });

        this.mqttClient.on('reconnect', () => {
            this.log.info('MQTT verbindet neu...');
            // Keepalive neu starten nach Reconnect
            if (this.vrmId) {
                this.startKeepAlive();
            }
        });
    }

    private startKeepAlive(): void {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
        }
        // Victron GX benötigt alle 50s einen Keepalive sonst stoppt der Datenstrom
        this.keepAliveInterval = setInterval(() => {
            if (this.mqttClient && this.vrmId) {
                this.mqttClient.publish(`R/${this.vrmId}/keepalive`, '');
                this.log.debug('Keepalive gesendet');
            }
        }, 50000);
        // Sofort einmal senden
        if (this.vrmId) {
            this.mqttClient!.publish(`R/${this.vrmId}/keepalive`, '');
        }
    }

    private async handleMessage(topic: string, payload: Buffer): Promise<void> {
        try {
            const raw = payload.toString();
            if (!raw) return;

            let parsed: any;
            try {
                parsed = JSON.parse(raw);
            } catch {
                return; // Kein JSON → ignorieren
            }

            const parts = topic.split('/');
            // Erwartetes Format: N/<VRMID>/<type>/<instance>/<path>
            if (parts[0] !== 'N' || parts.length < 4) return;

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

            if (!path) return;

            // ── Serial auslesen und Gerät registrieren ──────────────────
            if (path === 'Serial' || path === 'ProductName') {
                const value = parsed?.value ?? parsed;
                if (typeof value === 'string' && value) {
                    await this.registerDevice(deviceType, instance, path, value);
                }
                return;
            }

            // ── Nur bekannte Gerätetypen verarbeiten ────────────────────
            if (!RELEVANT_PATHS[deviceType]) return;

            // ── Nur relevante Pfade verarbeiten ─────────────────────────
            const relevantPaths = RELEVANT_PATHS[deviceType];
            const normalizedPath = path.replace(/\//g, '.');
            const isRelevant = relevantPaths.some(rp => normalizedPath === rp.replace(/\//g, '.'));
            if (!isRelevant) return;

            // ── Gerät muss bekannt sein (Serial gelesen) ─────────────────
            const deviceKey = `${deviceType}/${instance}`;
            const serial = this.serialMap.get(deviceKey);

            // Wenn noch keine Serial → trotzdem speichern unter deviceType.instance
            const baseId = serial
                ? `devices.${deviceType}.${serial}`
                : `devices.${deviceType}.${instanceStr}`;

            const stateId = `${baseId}.${normalizedPath}`;
            const value = parsed?.value ?? parsed;

            if (value === null || value === undefined) return;

            // ── Datenpunkt anlegen und Wert setzen ──────────────────────
            const unit = this.getUnit(normalizedPath);
            await this.setObjectNotExistsAsync(stateId, {
                type: 'state',
                common: {
                    name: normalizedPath,
                    type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
                    role: this.getRole(normalizedPath),
                    unit: unit,
                    read: true,
                    write: false,
                },
                native: {},
            });
            await this.setState(stateId, { val: value, ack: true });

        } catch (err) {
            this.log.debug(`Fehler bei Topic ${topic}: ${(err as Error).message}`);
        }
    }

    private async registerDevice(type: string, instance: number, field: string, value: string): Promise<void> {
        const deviceKey = `${type}/${instance}`;

        if (!this.deviceMap.has(deviceKey)) {
            this.deviceMap.set(deviceKey, {
                type,
                instance,
                serial: '',
                productName: '',
            });
        }

        const device = this.deviceMap.get(deviceKey)!;

        if (field === 'Serial') {
            device.serial = value;
            this.serialMap.set(deviceKey, value);
            this.log.info(`Gerät erkannt: ${KNOWN_DEVICE_TYPES[type] || type} → Serial: ${value}`);

            // Geräte-Channel anlegen
            const channelId = `devices.${type}.${value}`;
            await this.setObjectNotExistsAsync(channelId, {
                type: 'channel',
                common: {
                    name: `${KNOWN_DEVICE_TYPES[type] || type} (${value})`,
                },
                native: {
                    type,
                    instance,
                    serial: value,
                },
            });

            // Info Datenpunkte anlegen
            await this.setObjectNotExistsAsync(`${channelId}.info.serial`, {
                type: 'state',
                common: { name: 'Seriennummer', type: 'string', role: 'info.serial', read: true, write: false },
                native: {},
            });
            await this.setState(`${channelId}.info.serial`, { val: value, ack: true });

        } else if (field === 'ProductName') {
            device.productName = value;
            const serial = device.serial || instance.toString();
            const channelId = `devices.${type}.${serial}`;

            await this.setObjectNotExistsAsync(`${channelId}.info.productName`, {
                type: 'state',
                common: { name: 'Produktname', type: 'string', role: 'info.name', read: true, write: false },
                native: {},
            });
            await this.setState(`${channelId}.info.productName`, { val: value, ack: true });
        }
    }

    private getUnit(path: string): string {
        for (const [key, unit] of Object.entries(UNITS)) {
            if (path.endsWith(key.replace(/\./g, '.'))) return unit;
        }
        if (path.includes('Power')) return 'W';
        if (path.includes('Voltage') || path.endsWith('.V')) return 'V';
        if (path.includes('Current')) return 'A';
        if (path.includes('Energy')) return 'kWh';
        if (path.includes('Soc')) return '%';
        if (path.includes('Temperature')) return '°C';
        return '';
    }

    private getRole(path: string): string {
        if (path.includes('Power')) return 'value.power';
        if (path.includes('Voltage') || path.endsWith('.V')) return 'value.voltage';
        if (path.includes('Current')) return 'value.current';
        if (path.includes('Energy')) return 'value.energy.consumed';
        if (path.includes('Soc')) return 'value.battery';
        if (path.includes('Temperature')) return 'value.temperature';
        if (path.includes('State') || path.includes('Mode')) return 'value';
        return 'value';
    }

    private onUnload(callback: () => void): void {
        try {
            if (this.keepAliveInterval) {
                clearInterval(this.keepAliveInterval);
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

    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (state && state.ack === false) {
            this.log.info(`Steuerbefehl empfangen: ${id} = ${state.val}`);
            // TODO: Modbus Steuerung kommt hier rein
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new VictronGx(options);
} else {
    (() => new VictronGx())();
}