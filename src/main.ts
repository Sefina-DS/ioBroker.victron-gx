/*
 * ioBroker Victron GX Adapter
 * Verbindet sich lokal mit Victron GX Geräten via MQTT
 * Verwendet Seriennummern als stabile Geräte-IDs
 *
 * Struktur:
 *   devices.*          → alle Gerätedaten (nur lesen, außer switch)
 *   control.inverter.* → MP2/vebus Steuerregister (Modbus Unit 238)
 *   control.system.*   → ESS/GX Systemeinstellungen (Modbus Unit 100)
 *   overview.*         → aggregierte Systemwerte
 */
import * as utils from '@iobroker/adapter-core';
import * as mqtt from 'mqtt';
import ModbusRTU from 'modbus-serial';

// ── Topic Map Typen ───────────────────────────────────────────────────────────
interface TopicMapPath {
    stateId: string; // vollständige ioBroker State ID (ohne Namespace)
    active: boolean; // true = State wird angelegt/aktualisiert
}
interface TopicMapDevice {
    serial: string;
    productName: string;
    customName: string;
    virtual: boolean;
    paths: Record<string, TopicMapPath>; // normPath → TopicMapPath
}
// topicMap: deviceKey ("battery/2") → TopicMapDevice
type TopicMap = Record<string, TopicMapDevice>;

// ── Gerätetypen ──────────────────────────────────────────────────────────────
const KNOWN_DEVICE_TYPES: Record<string, string> = {
    battery: 'Battery',
    vebus: 'Inverter/Charger',
    solarcharger: 'Solar Charger (MPPT)',
    acload: 'AC Load',
    grid: 'Grid Meter',
    pvinverter: 'PV Inverter',
    switch: 'Virtual Switch',
    overview: 'Overview',
    platform: 'GX Device',
    temperature: 'Temperature Sensor',
    tank: 'Tank Sensor',
    meteo: 'Weather Station',
    evcharger: 'EV Charger',
};

// ── Namen für dynamisch erzeugte Registration-States (ensureRegistrationState) ──────────────
// S2 (temperature/dbus-adc): mgmt.connection, mgmt.processName, info.deviceInstance.
const MGMT_CONNECTION_NAME: ioBroker.StringOrTranslated = {
    en: 'Connection',
    de: 'Verbindung',
    ru: 'Соединение',
    pt: 'Conexão',
    nl: 'Verbinding',
    fr: 'Connexion',
    it: 'Connessione',
    es: 'Conexión',
    pl: 'Połączenie',
    uk: "З'єднання",
    'zh-cn': '连接',
};
const MGMT_PROCESSNAME_NAME: ioBroker.StringOrTranslated = {
    en: 'Driver process',
    de: 'Treiber-Prozess',
    ru: 'Процесс драйвера',
    pt: 'Processo do driver',
    nl: 'Driverproces',
    fr: 'Processus du pilote',
    it: 'Processo del driver',
    es: 'Proceso del controlador',
    pl: 'Proces sterownika',
    uk: 'Процес драйвера',
    'zh-cn': '驱动进程',
};
// Typen, für die Mgmt.Connection/Mgmt.ProcessName zusätzlich sichtbare mgmt.*-States erzeugen
// (siehe updateDeviceMeta()). Bewusst als Allowlist statt global, um bestehende Typen
// (battery/vebus/...) nicht mit neuen, nie angefragten Objekten zu erweitern.
const MGMT_STATE_TYPES = new Set(['temperature', 'evcharger']);

// ── Whitelist schreibbarer devices.*-Felder (0.10.0 control-merge) ──────────────────────────
// Ersetzt die vormalige control.<type>.<instance>.*-Struktur (bis 0.9.4, MQTT-Direktschreibung)
// sowie CONTROL_REGISTERS' separate Modbus-Anlage unter control.inverter.*/control.system.* -
// beide Zweige laufen jetzt direkt in devices.*, common.write wird abhängig vom passenden
// Config-Schalter gesetzt ('mqtt' → mqttControlEnabled, 'modbus' → modbusControlEnabled, bis
// 0.9.4 hieß der zweite Schalter controlEnabled, siehe Migration in onReady()). Feld-Key = exakter
// devices.<type>.<serial>.<Feld>-Pfad
// (Punkt-Notation wie überall im Adapter, '/' im MQTT-Topic wird '.'), NICHT umbenannt gegenüber
// dem bestehenden MQTT-Feldnamen (S1-Sign-off: kein zusätzlicher Breaking Change für bereits
// vorhandene Read-Mirrors wie z.B. vebus.Hub4.L1.AcPowerSetpoint). Konsumiert von
// writeStateValue() (common.write bei Objekt-Anlage) und onStateChange() (Schreib-Dispatch).
const WRITABLE_DEVICE_FIELDS: Record<string, Record<string, 'mqtt' | 'modbus'>> = {
    vebus: {
        Mode: 'modbus',
        'Ac.In1.CurrentLimit': 'modbus',
        'Hub4.L1.AcPowerSetpoint': 'modbus',
        'Hub4.DisableCharge': 'modbus',
        'Hub4.DisableFeedIn': 'modbus',
    },
    system: {
        GridSetpoint: 'modbus',
        MinimumSoc: 'modbus',
        EssMode: 'modbus',
        AcFeedInEnabled: 'modbus',
        DcFeedInEnabled: 'modbus',
        MaxFeedInPower: 'modbus',
        BatteryLifeState: 'modbus',
        MaxDischargePower: 'modbus',
        DvccMaxChargeCurrent: 'modbus',
        // BatteryLifeSocLimit (Reg 2903) / FeedInLimitActive (Reg 2709) bewusst NICHT enthalten -
        // bleiben read-only (write:false in CONTROL_REGISTERS), S1-Sign-off: keine Hardware-
        // Verifikation für 0.10.0 verfügbar.
    },
    evcharger: {
        SetCurrent: 'mqtt',
        StartStop: 'mqtt',
        Mode: 'mqtt',
    },
    temperature: {
        Offset: 'mqtt',
        Scale: 'mqtt',
        FilterLength: 'mqtt',
    },
};
// ── Relevante MQTT-Pfade pro Gerätetyp ──────────────────────────────────────
const RELEVANT_PATHS: Record<string, string[]> = {
    battery: [
        'Soc',
        'Dc.0.Voltage',
        'Dc.0.Current',
        'Dc.0.Power',
        'Dc.0.Temperature',
        'ConsumedAmphours',
        'TimeToGo',
        'Capacity',
        'CurrentAvg',
        'System.Temperature1',
        'System.Temperature2',
        'System.Temperature3',
        'System.Temperature4',
        'System.MinCellTemperature',
        'System.MaxCellTemperature',
        'System.MinCellVoltage',
        'System.MaxCellVoltage',
        'System.MinVoltageCellId',
        'System.MaxVoltageCellId',
        'Alarms.LowVoltage',
        'Alarms.HighVoltage',
        'Alarms.LowSoc',
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
        'Soc',
        'State',
        'Mode',
        'VebusError',
        'VebusChargeState',
        'Ac.ActiveIn.L1.P',
        'Ac.ActiveIn.L1.S',
        'Ac.ActiveIn.L1.I',
        'Ac.ActiveIn.L1.V',
        'Ac.ActiveIn.L2.P',
        'Ac.ActiveIn.L3.P',
        'Ac.ActiveIn.P',
        'Ac.ActiveIn.S',
        'Ac.In1.CurrentLimit',
        'Ac.Out.L1.P',
        'Ac.Out.L1.S',
        'Ac.Out.L1.I',
        'Ac.Out.L1.V',
        'Ac.Out.L1.F',
        'Ac.Out.L2.P',
        'Ac.Out.L3.P',
        'Ac.Out.P',
        'Ac.Out.S',
        'Dc.0.Voltage',
        'Dc.0.Current',
        'Dc.0.Power',
        'BatterySense.Voltage',
        'Hub4.L1.AcPowerSetpoint',
        'Hub4.DisableFeedIn',
        'Hub4.DisableCharge',
        'Serial',
        'ProductName',
        'CustomName',
        'Devices.0.SerialNumber',
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
        'Ac.L1.Energy.Reverse',
        'Ac.L2.Energy.Reverse',
        'Ac.L3.Energy.Reverse',
        'Ac.L1.PowerFactor',
        'Ac.L2.PowerFactor',
        'Ac.L3.PowerFactor',
        'Ac.Energy.Forward',
        'Ac.Energy.Reverse',
        'Serial',
        'ProductName',
        'ProductId',
        'CustomName',
        'Mgmt.Connection',
        'Mgmt.ProcessName',
        'Connected',
        'Position',
        'NrOfPhases',
        'Role',
        'IsGenericEnergyMeter',
        'PhaseSetting',
        // SwitchableOutput.*.* wird dynamisch akzeptiert (siehe SUPPORTS_OUTPUTS / isRelevantPath, Schritt S4a)
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
        // Statische Metadaten (Device-Level). SwitchableOutput.*.* wird dynamisch akzeptiert
        // (siehe SUPPORTS_OUTPUTS / isRelevantPath, Schritt S4a).
        'Connected',
        'Serial',
        'ProductName',
        'ProductId',
        'CustomName',
        'Mgmt.Connection',
        'Mgmt.ProcessName',
    ],
    system: [
        'Dc.Battery.Soc',
        'Dc.Battery.Voltage',
        'Dc.Battery.Current',
        'Dc.Battery.Power',
        'Dc.Battery.ConsumedAmphours',
        'Dc.System.Power',
        'Dc.System.Current',
        'Dc.Vebus.Power',
        'Dc.Vebus.Current',
        'Dc.InverterCharger.Power',
        'Dc.InverterCharger.Current',
        'Ac.Consumption.L1.Power',
        'Ac.Consumption.L2.Power',
        'Ac.Consumption.L3.Power',
        'Ac.Consumption.L1.Current',
        'Ac.Consumption.L2.Current',
        'Ac.Consumption.L3.Current',
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
        'Ac.Grid.L1.Power',
        'Ac.Grid.L2.Power',
        'Ac.Grid.L3.Power',
        'Ac.Grid.L1.Current',
        'Ac.Grid.L2.Current',
        'Ac.Grid.L3.Current',
        'Ac.PvOnGrid.L1.Power',
        'Ac.PvOnGrid.L2.Power',
        'Ac.PvOnGrid.L3.Power',
        'Ac.PvOnGrid.L1.Current',
        'Ac.PvOnGrid.L2.Current',
        'Ac.PvOnGrid.L3.Current',
        'Ac.ActiveIn.L1.Power',
        'Ac.ActiveIn.L2.Power',
        'Ac.ActiveIn.L3.Power',
        'Ac.ActiveIn.L1.Current',
        'Ac.ActiveIn.L2.Current',
        'Ac.ActiveIn.L3.Current',
        'Ac.ActiveIn.Source',
        'TimeToGo',
        'SystemState.State',
        'Serial',
    ],
    temperature: [
        'Temperature',
        // Generic Temperature Input (dbus-adc, GX-ADC-Eingänge) - siehe derivePseudoSerial().
        // Kein Serial-Topic, daher eigener Satz an Feldern zusätzlich zum BME280/Ruuvi-Pfad
        // unten (Humidity/Pressure), der weiterhin über eine echte Serial läuft.
        'TemperatureType',
        'Status',
        'Offset',
        'Scale',
        'RawValue',
        'RawUnit',
        'FilterLength',
        'Mgmt/ProcessVersion',
        'ProductId',
        'Humidity',
        'Pressure',
        'ProductName',
        'CustomName',
    ],
    tank: ['Level', 'Remaining', 'Capacity', 'FluidType', 'Status', 'ProductName', 'CustomName'],
    meteo: ['Irradiance', 'WindSpeed', 'WindDirection', 'ExternalTemperature', 'ProductName', 'CustomName'],
    // EV Charger (com.victronenergy.evcharger) - deckt alle 27 im Catalog beobachteten Topics ab
    // (Anhang EVCHARGER_AND_TEMP_PLAN.md). Serial/Connected/DeviceInstance/Mgmt.Connection/
    // Mgmt.ProcessName laufen wie bei allen anderen Typen über REGISTRATION_PATHS, nicht über
    // diese Liste. SetCurrent/StartStop bleiben hier als reine read-only Datentopic-Spiegel -
    // die schreibbaren control.evcharger.*-Aliase kommen in S4.
    evcharger: [
        'Ac/Energy/Forward',
        'Ac/L1/Power',
        'Ac/L2/Power',
        'Ac/L3/Power',
        'Ac/Power',
        'Ac/Voltage',
        'ChargingTime',
        'Current',
        'FirmwareVersion',
        'HardwareVersion',
        'MCU/Temperature',
        'MaxCurrent',
        'Mode',
        'ProductId',
        'SetCurrent',
        'StartStop',
        'Status',
        'UpdateIndex',
        'Mgmt/ProcessVersion',
        'ProductName',
        'CustomName',
    ],
};

// ── Pfade die nur Metadaten liefern ─────────────────────────────────────────
// Vorberechnete Sets für O(1) Lookup statt O(n) .some() bei jeder MQTT-Nachricht
const RELEVANT_PATHS_SET: Record<string, Set<string>> = Object.fromEntries(
    Object.entries(RELEVANT_PATHS).map(([k, v]) => [k, new Set(v.map(p => p.replace(/\//g, '.')))]),
);

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
    // Output-Metadaten (CustomName/Group) laufen seit S4b/S4c dynamisch über remapOutputPath()
    // im Message-Handler, nicht mehr über hartcodierte output_1-Einträge hier (S7-Cleanup).
]);

// Konstanten für Hot-Path Checks (verhindert Memory Allocation bei jeder MQTT-Message)
const NO_SERIAL_TYPES_HANDLE = new Set(['system', 'platform']);
// 'switch' stand hier bis S7 mit drin (Fake-ready ohne Serial), weil getBaseId früher ohne
// Serial keinen Pfad bauen konnte. Seit S3/S7 braucht switch wie alle anderen Typen eine
// echte Serial für die BaseId - kein Sonderfall mehr nötig.
const NO_SERIAL_TYPES_REGISTER = new Set(['system', 'platform']);
const MODBUS_NEEDED_TYPES = new Set(['vebus', 'battery', 'grid', 'pvinverter', 'solarcharger']);

// ── Pseudo-Serial für Geräte ohne echte Victron-Serial ──────────────────────
// dbus-adc (Generic Temperature Input an den GX-ADC-Eingängen) sendet nie ein Serial-Topic -
// anders als externe Temperatursensoren (BME280/Ruuvi über dbus-victron-virtual o.ä.), die eine
// echte Serial liefern und unverändert über den Standard-Serial-Pfad (case 'Serial' in
// updateDeviceMeta()) laufen. Ohne Ersatz-ID bliebe device.ready für dbus-adc-Instanzen für immer
// false (siehe getOrCreateDeviceEntry()/NO_SERIAL_TYPES_REGISTER) und die Kanäle unsichtbar.
// Format "adc-<DeviceInstance>": erkennbar synthetisch, kollidiert nicht mit echten Victron-
// Serials, ioBroker-Objekt-ID-sicher (nur [a-zA-Z0-9_-]).
function derivePseudoSerial(type: string, mgmtProcessName: string, instance: number): string | null {
    if (type === 'temperature' && mgmtProcessName === 'dbus-adc') {
        return `adc-${instance}`;
    }
    return null;
}

// ── Victron-Pfade → ioBroker-Pfade ──────────────────────────────────────────
// switch/acload.SwitchableOutput.* laufen seit S4a/S4c über remapOutputPath() (dynamisch),
// das alte statische output_1-Mapping ist damit unerreichbar geworden und entfernt (S7).
const PATH_REMAP: Record<string, Record<string, string>> = {
    battery: {
        'Dc.0.Temperature': 'temperatures.main',
        'System.Temperature1': 'temperatures.temp1',
        'System.Temperature2': 'temperatures.temp2',
        'System.Temperature3': 'temperatures.temp3',
        'System.Temperature4': 'temperatures.temp4',
        'System.MinCellTemperature': 'temperatures.min',
        'System.MaxCellTemperature': 'temperatures.max',
        'System.MinCellVoltage': 'cells.min',
        'System.MaxCellVoltage': 'cells.max',
        'System.MinVoltageCellId': 'cells.minId',
        'System.MaxVoltageCellId': 'cells.maxId',
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

// ── Shelly/Output-Multi-Channel-Support ─────────────────────────────────────
// Additiv angelegt für die Shelly-Integration (SHELLY_INTEGRATION_PLAN.md, Schritt S1),
// remapOutputPath()/SUPPORTS_OUTPUTS ab S4a, WRITABLE_TYPES/WRITABLE_OUTPUT_REGEX/OutputRoute
// ab S5 im Message-Handler bzw. in onStateChange verdrahtet. Der alte switch-spezifische
// Write-Pfad (WRITE_PATH_REMAP mit hartcodiertem "output_1") ist damit hinfällig und entfernt
// worden - ersetzt durch die outputToInstance-Map (siehe unten). Verbleibender Alt-Code
// (RELEVANT_PATHS_SET, PATH_REMAP.switch) bleibt bis Schritt S7 parallel aktiv.
const OUTPUT_PATH_REGEX = /^SwitchableOutput\.([^.]+)\.(.+)$/;
const OUTPUT_KEY_NORMALIZE = /^output_(\d+)$/;

/**
 * Wandelt Victron MQTT-Pfad SwitchableOutput.<key>.<rest> in den ioBroker-Sub-Pfad
 * outputs.<normKey>.<rest> um. Node-RED "output_1" wird zu "1" normiert; Shelly-Ziffern
 * bleiben unverändert.
 *
 * @param normPath Normierter MQTT-Pfad (Slashes durch Punkte ersetzt)
 * @returns Key/Sub/ioPath-Aufschlüsselung, oder null wenn kein Output-Pfad
 */
function remapOutputPath(normPath: string): { key: string; mqttKey: string; sub: string; ioPath: string } | null {
    const m = OUTPUT_PATH_REGEX.exec(normPath);
    if (!m) {
        return null;
    }
    const rawKey = m[1];
    const norm = OUTPUT_KEY_NORMALIZE.exec(rawKey);
    const key = norm ? norm[1] : rawKey; // "output_1" → "1", "0" → "0"
    const sub = m[2].replace(/^Settings\./, ''); // Settings.CustomName → CustomName
    // mqttKey ist der Original-Segmentname (z.B. "output_1"), wird für die Write-Route (S5)
    // gebraucht, weil der MQTT-Topic beim Zurückschreiben den unnormierten Key erwartet.
    return { key, mqttKey: rawKey, sub, ioPath: `outputs.${key}.${sub}` };
}

// Gerätetypen, die SwitchableOutput-Kanäle tragen dürfen (switch/acload/GX-internes Relais).
const SUPPORTS_OUTPUTS = new Set(['switch', 'acload', 'system']);
// Gerätetypen, deren outputs.<key>.State per MQTT schreibbar ist.
const WRITABLE_TYPES = new Set(['switch', 'acload', 'system']);

// S14: Teilmenge von SUPPORTS_OUTPUTS, deren NICHT-Output-Pfade (z.B. Ac.L1.Voltage) ebenfalls
// device.group in der BaseId berücksichtigen (siehe getBaseId) - 'system' fällt bei
// isOutputPath=false immer fest auf 'overview', ist also vom Group-Race nicht betroffen.
const DEVICE_GROUP_RACE_TYPES = new Set(['switch', 'acload']);

// Erkennt schreibbare Output-Pfade im ioBroker-Namensraum (nach BaseId, vor dem Segment "State").
const WRITABLE_OUTPUT_REGEX = /^outputs\.([^.]+)\.State$/;

// Merkt sich pro Serial+OutputKey die MQTT-DeviceInstance sowie den originalen MQTT-Segmentnamen
// (Node-RED "output_1" bleibt als mqttKey erhalten, auch wenn der ioBroker-Pfad "1" normiert).
interface OutputRoute {
    instance: number;
    mqttKey: string;
}

// S13: Timing-Race-Fix (siehe SHELLY_INTEGRATION_STATUS.md). Ein neuer Output-Kanal wird beim
// ersten MQTT-Wert noch nicht committed (BaseId + outputToInstance-Eintrag + State-Schreiben),
// weil device.group zu diesem Zeitpunkt oft noch undefined ist (Race gegen Settings/Group).
// Stattdessen werden Rohwerte pro subPath gepuffert, bis entweder Group eintrifft (sofortiger
// Commit) oder PENDING_QUIET_MS ohne Group verstrichen ist (Fallback-Commit ohne Group).
interface PendingOutput {
    serial: string;
    outputKey: string;
    mqttKey: string;
    deviceType: string;
    instance: number;
    device: DeviceInfo | undefined;
    values: Map<string, unknown>;
    timer: ioBroker.Timeout | null | undefined;
}

// dpId-Suffix (nach "inverter.") → tatsächlicher devices.vebus.<serial>-Feldname. Die 5 Inverter-
// Register bilden bereits vorhandene MQTT-Read-Mirror-Felder ab, deren Namen historisch von den
// CONTROL_REGISTERS-Keys abweichen (S1-Sign-off: bestehende MQTT-Feldnamen NICHT umbenennen).
// system.*-Felder brauchen keine Übersetzung - deren dpId-Suffix ist bereits der Zielfeldname
// (kein vorheriges MQTT-Pendant vorhanden, siehe initControlDatapoints()/controlRegisterTarget()).
const INVERTER_FIELD_NAMES: Record<string, string> = {
    Mode: 'Mode',
    AcIn1CurrentLimit: 'Ac.In1.CurrentLimit',
    AcPowerSetpoint: 'Hub4.L1.AcPowerSetpoint',
    DisableCharge: 'Hub4.DisableCharge',
    DisableFeedIn: 'Hub4.DisableFeedIn',
};

// ── Modbus Register-Mapping ──────────────────────────────────────────────────
// vebus: Unit ID 238 (com.victronenergy.vebus)
// system: Unit ID 100 (com.victronenergy.settings / ESS)
//
// Skalierung LESEN:  physWert = raw * scaleRead
// Skalierung SCHREIBEN: raw = physWert * scaleWrite
const CONTROL_REGISTERS: Record<
    string,
    {
        register: number;
        scaleRead: number;
        scaleWrite: number;
        signed: boolean;
        unit: string;
        name: ioBroker.StringOrTranslated;
        states?: Record<number, string>;
        write: boolean;
    }
> = {
    // ── Inverter (vebus, Unit 238) ───────────────────────────────────────────
    'inverter.Mode': {
        register: 33,
        scaleRead: 1,
        scaleWrite: 1,
        signed: false,
        unit: '',
        name: {
            en: 'Operating mode',
            de: 'Betriebsmodus',
            ru: 'Operating mode',
            pt: 'Operating mode',
            nl: 'Operating mode',
            fr: 'Operating mode',
            it: 'Operating mode',
            es: 'Operating mode',
            pl: 'Operating mode',
            uk: 'Operating mode',
            'zh-cn': 'Operating mode',
        },
        write: true,
        states: { 1: 'Charger Only', 2: 'Inverter Only', 3: 'On', 4: 'Off' },
    },
    'inverter.AcIn1CurrentLimit': {
        register: 22,
        scaleRead: 0.1,
        scaleWrite: 10,
        signed: false,
        unit: 'A',
        name: {
            en: 'AC input current limit',
            de: 'Eingangsstrombegrenzung',
            ru: 'AC input current limit',
            pt: 'AC input current limit',
            nl: 'AC input current limit',
            fr: 'AC input current limit',
            it: 'AC input current limit',
            es: 'AC input current limit',
            pl: 'AC input current limit',
            uk: 'AC input current limit',
            'zh-cn': 'AC input current limit',
        },
        write: true,
    },
    'inverter.AcPowerSetpoint': {
        register: 37,
        scaleRead: 1,
        scaleWrite: 1,
        signed: true,
        unit: 'W',
        name: {
            en: 'ESS setpoint (Reg 37)',
            de: 'ESS Sollwert (Reg 37)',
            ru: 'ESS setpoint (Reg 37)',
            pt: 'ESS setpoint (Reg 37)',
            nl: 'ESS setpoint (Reg 37)',
            fr: 'ESS setpoint (Reg 37)',
            it: 'ESS setpoint (Reg 37)',
            es: 'ESS setpoint (Reg 37)',
            pl: 'ESS setpoint (Reg 37)',
            uk: 'ESS setpoint (Reg 37)',
            'zh-cn': 'ESS setpoint (Reg 37)',
        },
        write: true,
        // Positiv = Netz → Akku laden, Negativ = Akku → Netz einspeisen
        // Keepalive nötig! Wird alle 800ms wiederholt wenn ≠ 0
    },
    'inverter.DisableCharge': {
        register: 38,
        scaleRead: 1,
        scaleWrite: 1,
        signed: false,
        unit: '',
        name: {
            en: 'Disable charge',
            de: 'Laden sperren',
            ru: 'Disable charge',
            pt: 'Disable charge',
            nl: 'Disable charge',
            fr: 'Disable charge',
            it: 'Disable charge',
            es: 'Disable charge',
            pl: 'Disable charge',
            uk: 'Disable charge',
            'zh-cn': 'Disable charge',
        },
        write: true,
        states: { 0: 'Charging Allowed', 1: 'Charging Disabled' },
    },
    'inverter.DisableFeedIn': {
        register: 39,
        scaleRead: 1,
        scaleWrite: 1,
        signed: false,
        unit: '',
        name: {
            en: 'Disable AC feed-in',
            de: 'AC-Einspeisung sperren',
            ru: 'Disable AC feed-in',
            pt: 'Disable AC feed-in',
            nl: 'Disable AC feed-in',
            fr: 'Disable AC feed-in',
            it: 'Disable AC feed-in',
            es: 'Disable AC feed-in',
            pl: 'Disable AC feed-in',
            uk: 'Disable AC feed-in',
            'zh-cn': 'Disable AC feed-in',
        },
        write: true,
        states: { 0: 'Feed-In Allowed', 1: 'Feed-In Disabled' },
    },

    // ── System / ESS-Einstellungen (Unit 100) ────────────────────────────────
    'system.GridSetpoint': {
        register: 2700,
        scaleRead: 1,
        scaleWrite: 1,
        signed: true,
        unit: 'W',
        name: {
            en: 'Grid setpoint',
            de: 'Grid-Sollwert',
            ru: 'Grid setpoint',
            pt: 'Grid setpoint',
            nl: 'Grid setpoint',
            fr: 'Grid setpoint',
            it: 'Grid setpoint',
            es: 'Grid setpoint',
            pl: 'Grid setpoint',
            uk: 'Grid setpoint',
            'zh-cn': 'Grid setpoint',
        },
        write: true,
        // 0=Nulleinspeisung, +W=Grid-Bezug, -W=Einspeisung
        // Victron ESS-Algorithmus regelt Reg 37 automatisch auf diesen Wert
    },
    'system.EssMode': {
        register: 2902,
        scaleRead: 1,
        scaleWrite: 1,
        signed: false,
        unit: '',
        name: {
            en: 'ESS phase mode',
            de: 'ESS Phasenmodus',
            ru: 'ESS phase mode',
            pt: 'ESS phase mode',
            nl: 'ESS phase mode',
            fr: 'ESS phase mode',
            it: 'ESS phase mode',
            es: 'ESS phase mode',
            pl: 'ESS phase mode',
            uk: 'ESS phase mode',
            'zh-cn': 'ESS phase mode',
        },
        write: true,
        states: { 1: 'With Phase Compensation', 2: 'Without Phase Compensation', 3: 'External Control' },
    },
    'system.BatteryLifeState': {
        register: 2900,
        scaleRead: 1,
        scaleWrite: 1,
        signed: false,
        unit: '',
        name: {
            en: 'BatteryLife mode',
            de: 'BatteryLife Modus',
            ru: 'BatteryLife mode',
            pt: 'BatteryLife mode',
            nl: 'BatteryLife mode',
            fr: 'BatteryLife mode',
            it: 'BatteryLife mode',
            es: 'BatteryLife mode',
            pl: 'BatteryLife mode',
            uk: 'BatteryLife mode',
            'zh-cn': 'BatteryLife mode',
        },
        write: true,
        states: {
            0: 'Disabled',
            2: 'Self-consumption',
            3: 'Self-consumption',
            4: 'Self-consumption (with BatteryLife)',
            5: 'Discharge Disabled',
            6: 'Forced Charge',
            7: 'Sustain',
            8: 'Low SoC Recharge',
            9: 'Keep Battery Charged',
            10: 'Without BatteryLife',
            11: 'Without BatteryLife (Low SoC)',
            12: 'Without BatteryLife (Low SoC Recharge)',
        },
    },
    'system.MinimumSoc': {
        register: 2901,
        scaleRead: 0.1,
        scaleWrite: 10,
        signed: false,
        unit: '%',
        name: {
            en: 'Minimum SoC (except grid failure)',
            de: 'Minimum SoC (außer Netzausfall)',
            ru: 'Minimum SoC (except grid failure)',
            pt: 'Minimum SoC (except grid failure)',
            nl: 'Minimum SoC (except grid failure)',
            fr: 'Minimum SoC (except grid failure)',
            it: 'Minimum SoC (except grid failure)',
            es: 'Minimum SoC (except grid failure)',
            pl: 'Minimum SoC (except grid failure)',
            uk: 'Minimum SoC (except grid failure)',
            'zh-cn': 'Minimum SoC (except grid failure)',
        },
        write: true,
    },
    'system.BatteryLifeSocLimit': {
        register: 2903,
        scaleRead: 0.1,
        scaleWrite: 10,
        signed: false,
        unit: '%',
        name: {
            en: 'BatteryLife SoC limit',
            de: 'BatteryLife SoC Limit',
            ru: 'BatteryLife SoC limit',
            pt: 'BatteryLife SoC limit',
            nl: 'BatteryLife SoC limit',
            fr: 'BatteryLife SoC limit',
            it: 'BatteryLife SoC limit',
            es: 'BatteryLife SoC limit',
            pl: 'BatteryLife SoC limit',
            uk: 'BatteryLife SoC limit',
            'zh-cn': 'BatteryLife SoC limit',
        },
        write: false,
    },
    'system.MaxFeedInPower': {
        register: 2706,
        scaleRead: 0.01,
        scaleWrite: 100,
        signed: true,
        unit: 'W',
        name: {
            en: 'Max. feed-in power',
            de: 'Max. Einspeisung',
            ru: 'Max. feed-in power',
            pt: 'Max. feed-in power',
            nl: 'Max. feed-in power',
            fr: 'Max. feed-in power',
            it: 'Max. feed-in power',
            es: 'Max. feed-in power',
            pl: 'Max. feed-in power',
            uk: 'Max. feed-in power',
            'zh-cn': 'Max. feed-in power',
        },
        write: true,
        // -1 = kein Limit, 0 = gesperrt, >0 = Limit in W
    },
    'system.AcFeedInEnabled': {
        register: 2708,
        scaleRead: 1,
        scaleWrite: 1,
        signed: false,
        unit: '',
        name: {
            en: 'AC feed-in to grid',
            de: 'AC-Einspeisung ins Netz',
            ru: 'AC feed-in to grid',
            pt: 'AC feed-in to grid',
            nl: 'AC feed-in to grid',
            fr: 'AC feed-in to grid',
            it: 'AC feed-in to grid',
            es: 'AC feed-in to grid',
            pl: 'AC feed-in to grid',
            uk: 'AC feed-in to grid',
            'zh-cn': 'AC feed-in to grid',
        },
        write: true,
        states: { 0: 'Feed-In Allowed', 1: 'Feed-In Disabled' },
    },
    'system.DcFeedInEnabled': {
        register: 2707,
        scaleRead: 1,
        scaleWrite: 1,
        signed: false,
        unit: '',
        name: {
            en: 'DC surplus to grid (overvoltage feed-in)',
            de: 'DC-Überschuss ins Netz (Overvoltage Feed-in)',
            ru: 'DC surplus to grid (overvoltage feed-in)',
            pt: 'DC surplus to grid (overvoltage feed-in)',
            nl: 'DC surplus to grid (overvoltage feed-in)',
            fr: 'DC surplus to grid (overvoltage feed-in)',
            it: 'DC surplus to grid (overvoltage feed-in)',
            es: 'DC surplus to grid (overvoltage feed-in)',
            pl: 'DC surplus to grid (overvoltage feed-in)',
            uk: 'DC surplus to grid (overvoltage feed-in)',
            'zh-cn': 'DC surplus to grid (overvoltage feed-in)',
        },
        write: true,
        states: { 0: 'Disabled', 1: 'Enabled' },
    },
    'system.FeedInLimitActive': {
        register: 2709,
        scaleRead: 1,
        scaleWrite: 1,
        signed: false,
        unit: '',
        name: {
            en: 'Feed-in limit active',
            de: 'Einspeisebegrenzung aktiv',
            ru: 'Feed-in limit active',
            pt: 'Feed-in limit active',
            nl: 'Feed-in limit active',
            fr: 'Feed-in limit active',
            it: 'Feed-in limit active',
            es: 'Feed-in limit active',
            pl: 'Feed-in limit active',
            uk: 'Feed-in limit active',
            'zh-cn': 'Feed-in limit active',
        },
        write: false,
        states: { 0: 'No', 1: 'Yes' },
    },
    'system.DvccMaxChargeCurrent': {
        register: 2705,
        scaleRead: 1,
        scaleWrite: 1,
        signed: true,
        unit: 'A',
        name: {
            en: 'DVCC max. charge current',
            de: 'DVCC Max. Ladestrom',
            ru: 'DVCC max. charge current',
            pt: 'DVCC max. charge current',
            nl: 'DVCC max. charge current',
            fr: 'DVCC max. charge current',
            it: 'DVCC max. charge current',
            es: 'DVCC max. charge current',
            pl: 'DVCC max. charge current',
            uk: 'DVCC max. charge current',
            'zh-cn': 'DVCC max. charge current',
        },
        write: true,
        // -1 = kein Limit (DVCC deaktiviert für Ladestrom)
    },
    'system.MaxDischargePower': {
        register: 2704,
        scaleRead: 0.1,
        scaleWrite: 10,
        signed: true,
        unit: 'W',
        name: {
            en: 'Max. discharge power',
            de: 'Max. Entladeleistung',
            ru: 'Max. discharge power',
            pt: 'Max. discharge power',
            nl: 'Max. discharge power',
            fr: 'Max. discharge power',
            it: 'Max. discharge power',
            es: 'Max. discharge power',
            pl: 'Max. discharge power',
            uk: 'Max. discharge power',
            'zh-cn': 'Max. discharge power',
        },
        write: true,
        // Victron Scalefactor 0.1 → raw * 0.1 = W
        // Nur aktiv wenn DVCC aktiviert
    },
};

// ── StatusCode Bedeutungen (pvinverter) ──────────────────────────────────────
const PVINVERTER_STATUS: Record<number, string> = {
    0: 'Off',
    1: 'No Connection',
    2: 'Error',
    3: 'Off (Night)',
    7: 'Running',
    8: 'Running (MPPT)',
    9: 'Temporary Derating',
    10: 'Maximum Output Power',
};

// ── States-Definitionen für MQTT-Datenpunkte ─────────────────────────────────
const STATES_MAP: Record<string, Record<string, Record<number, string>>> = {
    vebus: {
        Mode: { 1: 'Charger Only', 2: 'Inverter Only', 3: 'On', 4: 'Off' },
        State: {
            0: 'Off',
            1: 'Low Power',
            2: 'Fault',
            3: 'Bulk',
            4: 'Absorption',
            5: 'Float',
            6: 'Storage',
            7: 'Equalize',
            8: 'Passthru',
            9: 'Inverting',
            10: 'Power Assist',
            11: 'Power Supply',
            244: 'Sustain',
            252: 'External Control',
        },
        'Hub4.DisableFeedIn': { 0: 'Feed-In Allowed', 1: 'Feed-In Disabled' },
        'Hub4.DisableCharge': { 0: 'Charging Allowed', 1: 'Charging Disabled' },
        VebusChargeState: {
            0: 'Initializing',
            1: 'Bulk',
            2: 'Absorption',
            3: 'Float',
            4: 'Storage',
            5: 'Equalize',
            6: 'Recovery',
        },
    },
    battery: {
        'alarms.lowVoltage': { 0: 'OK', 1: 'Warning', 2: 'Alarm' },
        'alarms.highVoltage': { 0: 'OK', 1: 'Warning', 2: 'Alarm' },
        'alarms.lowSoc': { 0: 'OK', 1: 'Warning', 2: 'Alarm' },
    },
    evcharger: {
        // Verifiziert gegen github.com/victronenergy/dbus-modbus-client/blob/master/ev_charger.py
        // (EVC_MODE/EVC_STATUS) - der Plan-Anhang hatte 12-15 falsch zugeordnet (Overvoltage/
        // Overtemperature vertauscht, "15=Error" nicht belegt). 21-24 sind Übergangszustände beim
        // Phasenumschalten, die go-eCharger laut dbus-goecharger.py nicht sendet (nur 0/2/3/6),
        // aber andere Victron-kompatible EVSE-Hardware kann sie liefern.
        Mode: { 0: 'Manual', 1: 'Auto', 2: 'Scheduled' },
        Status: {
            0: 'Disconnected',
            1: 'Connected',
            2: 'Charging',
            3: 'Charged',
            4: 'Waiting for sun',
            5: 'Waiting for RFID',
            6: 'Waiting for start',
            7: 'Low SoC',
            8: 'Ground error',
            9: 'Welded contactor',
            10: 'CP shorted',
            11: 'Earth leakage',
            12: 'Undervoltage',
            13: 'Overvoltage',
            14: 'Overtemperature',
            21: 'Start charging',
            22: 'Switch to 3-phase',
            23: 'Switch to 1-phase',
            24: 'Stop charging',
        },
        StartStop: { 0: 'Stop', 1: 'Start' },
    },
    temperature: {
        // Verifiziert gegen github.com/victronenergy/dbus-adc (README) - TemperatureType 3-6
        // sind dort nicht explizit dokumentiert, aber durchgängig in Victron-GUI-Quellen belegt.
        TemperatureType: {
            0: 'Battery',
            1: 'Fridge',
            2: 'Generic',
            3: 'Room',
            4: 'Outdoor',
            5: 'Water Heater',
            6: 'Freezer',
        },
        // Identisch zum tank.Status-Enum unten - beide laufen über denselben Analog-Input-Treiber.
        Status: {
            0: 'OK',
            1: 'Disconnected',
            2: 'Short circuit',
            3: 'Reverse polarity',
            4: 'Unknown',
        },
    },
    tank: {
        FluidType: {
            0: 'Fuel',
            1: 'Fresh water',
            2: 'Waste water',
            3: 'Live well',
            4: 'Oil',
            5: 'Black water',
            6: 'Gasoline',
            7: 'Diesel',
            8: 'LPG',
            9: 'LNG',
            10: 'Hydraulic oil',
            11: 'Raw water',
        },
        Status: {
            0: 'OK',
            1: 'Disconnected',
            2: 'Short circuit',
            3: 'Reverse polarity',
            4: 'Unknown',
        },
    },
};

// overview: diese Pfade lösen eine Gesamtleistungs-Berechnung aus
// Format: MQTT-Pfad → Ziel-Datenpunkt in overview
const OVERVIEW_TOTAL_POWER: Record<string, { sources: string[]; target: string }> = {
    'Ac.Consumption.L1.Power': {
        sources: ['Ac.Consumption.L1.Power', 'Ac.Consumption.L2.Power', 'Ac.Consumption.L3.Power'],
        target: 'Ac.Consumption.Power',
    },
    'Ac.Consumption.L2.Power': {
        sources: ['Ac.Consumption.L1.Power', 'Ac.Consumption.L2.Power', 'Ac.Consumption.L3.Power'],
        target: 'Ac.Consumption.Power',
    },
    'Ac.Consumption.L3.Power': {
        sources: ['Ac.Consumption.L1.Power', 'Ac.Consumption.L2.Power', 'Ac.Consumption.L3.Power'],
        target: 'Ac.Consumption.Power',
    },
    'Ac.Grid.L1.Power': {
        sources: ['Ac.Grid.L1.Power', 'Ac.Grid.L2.Power', 'Ac.Grid.L3.Power'],
        target: 'Ac.Grid.Power',
    },
    'Ac.Grid.L2.Power': {
        sources: ['Ac.Grid.L1.Power', 'Ac.Grid.L2.Power', 'Ac.Grid.L3.Power'],
        target: 'Ac.Grid.Power',
    },
    'Ac.Grid.L3.Power': {
        sources: ['Ac.Grid.L1.Power', 'Ac.Grid.L2.Power', 'Ac.Grid.L3.Power'],
        target: 'Ac.Grid.Power',
    },
    'Ac.PvOnGrid.L1.Power': {
        sources: ['Ac.PvOnGrid.L1.Power', 'Ac.PvOnGrid.L2.Power', 'Ac.PvOnGrid.L3.Power'],
        target: 'Ac.PvOnGrid.Power',
    },
    'Ac.PvOnGrid.L2.Power': {
        sources: ['Ac.PvOnGrid.L1.Power', 'Ac.PvOnGrid.L2.Power', 'Ac.PvOnGrid.L3.Power'],
        target: 'Ac.PvOnGrid.Power',
    },
    'Ac.PvOnGrid.L3.Power': {
        sources: ['Ac.PvOnGrid.L1.Power', 'Ac.PvOnGrid.L2.Power', 'Ac.PvOnGrid.L3.Power'],
        target: 'Ac.PvOnGrid.Power',
    },
};

// ── Phasenpfade für activePhase ──────────────────────────────────────────────
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

// ── Stale-Timeout ────────────────────────────────────────────────────────────
const STALE_TIMEOUT_MS = 20 * 60 * 1000; // 20 Minuten (meteo sendet alle 15 min)

// ── ESS MQTT → control.system.* Mapping ─────────────────────────────────────
// GX sendet Settings-Werte via MQTT zurück → in control.system.* aktualisieren
const ESS_MQTT_MAP: Record<string, string> = {
    'Settings.CGwacs.Hub4Mode': 'system.EssMode',
    'Settings.CGwacs.BatteryLife.MinimumSocLimit': 'system.MinimumSoc',
    'Settings.CGwacs.BatteryLife.State': 'system.BatteryLifeState',
    'Settings.CGwacs.BatteryLife.SocLimit': 'system.BatteryLifeSocLimit',
    'Settings.CGwacs.AcPowerSetPoint': 'system.GridSetpoint',
    'Settings.CGwacs.MaxFeedInPower': 'system.MaxFeedInPower',
    'Settings.CGwacs.PreventFeedback': 'system.AcFeedInEnabled',
    'Settings.CGwacs.OvervoltageFeedIn': 'system.DcFeedInEnabled',
    'Settings.CGwacs.PvPowerLimiterActive': 'system.FeedInLimitActive',
    // DvccMaxChargeCurrent und MaxDischargePower kommen nicht per MQTT → nur Modbus
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
    group: string;
    phaseVoltage: Record<string, number>;
    lastUpdate: number;
    lastUpdateWritten?: number;
    isStale?: boolean;
    staleTimer: ioBroker.Timeout | null | undefined;
    ready: boolean;
    // S14: siehe bufferDeviceMessage()/commitDevice() - schließt die in S13 offen gelassene Lücke
    // für Nicht-Output-Pfade (device.group-Race), nur für DEVICE_GROUP_RACE_TYPES relevant.
    baseIdCommitted: boolean;
    pendingDeviceMessages: { topic: string; payload: Buffer }[];
    deviceCommitTimer: ioBroker.Timeout | null | undefined;
    // S15-Fix: true, wenn commitDevice() geloggt hat, bevor die Serial bekannt war (Group-Message
    // traf vor der Serial-Message ein, siehe updateDeviceMeta()/commitDevice()). Der nachgeholte
    // Log-Eintrag wird dann geschrieben, sobald die Serial tatsächlich eintrifft.
    pendingCommitLog?: boolean;
}

class VictronGx extends utils.Adapter {
    private mqttClient: mqtt.MqttClient | null = null;
    private keepAliveInterval: ioBroker.Interval | null | undefined = null;
    private acPowerSetpointInterval: ioBroker.Interval | null | undefined = null;
    private vrmId: string = '';
    private deviceMap: Map<string, DeviceInfo> = new Map();
    private serialMap: Map<string, string> = new Map();
    private loggedDevices: Set<string> = new Set();
    private channelReady: Set<string> = new Set();
    private modbusClient: ModbusRTU | null = null;
    private modbusUnitMap: Map<string, number> = new Map();
    private modbusBusy: boolean = false;
    private createdStates: Set<string> = new Set();
    private cellValueCache: Map<string, number> = new Map();
    private powerValueCache: Map<string, number> = new Map();
    private lastValueCache: Map<string, ioBroker.StateValue> = new Map();
    // Läuft eine Objekt-Anlage für stateId noch (extendObjectAsync/setObjectNotExistsAsync
    // unresolved)? Ein zweiter setState()-Kandidat für dieselbe stateId, der eintrifft während die
    // ERSTE Anlage noch läuft (z.B. Burst-Bursts, in denen mehrere MQTT-Messages im selben Tick
    // verarbeitet werden), muss auf DASSELBE Promise warten statt sofort zu schreiben - sonst bleibt
    // die "has no existing object"-Race für den zweiten Aufruf bestehen, obwohl der erste bereits
    // korrekt wartet (v0.9.3-Fix, siehe writeStateValue()/updateOverviewTotalPower()).
    private pendingObjectCreation: Map<string, Promise<void>> = new Map();
    private mqttMsgCount: number = 0;
    private topicMap: TopicMap = {};
    private topicCatalog: Record<string, { value: unknown }> = {};
    // Serial → OutputKey → { instance, mqttKey } - additiv für Shelly-Multi-Channel (Schritt S1),
    // wird erst ab Schritt S4b befüllt und ab S5 für die Write-Route gelesen.
    private outputToInstance: Map<string, Map<string, OutputRoute>> = new Map();
    // Auto-Cleanup verwaister outputs.*-Kanäle beim Start, Config-Toggle (Default aus, §10.1/10.2).
    private cleanupEnabled = false;
    private cleanupTimer: ioBroker.Timeout | null | undefined = null;
    private cleanupDoneOnce = false;
    // Ruhezeit: Sweep läuft erst, wenn seit dem letzten neu erkannten Kanal in outputToInstance
    // mindestens so lange nichts mehr reinkam - schützt Multi-Instance-Devices (Shelly Pro3),
    // deren Instances zeitlich gestaffelt reinkommen (§10.1).
    private readonly CLEANUP_QUIET_MS = 30_000;
    // S13: Key "<serial>|<outputKey>" -> noch nicht committeter Kanal (siehe PendingOutput).
    private pendingOutputs: Map<string, PendingOutput> = new Map();
    // Max. Wartezeit auf Settings/Group nach dem ersten Wert eines neuen Kanals, bevor ohne
    // Group committed wird (Fallback). Kein Sliding-Window - der Timer startet einmalig beim
    // ersten gepufferten Wert und wird durch weitere Werte nicht zurückgesetzt.
    private readonly PENDING_QUIET_MS = 2_000;
    // S14: Max. Wartezeit auf Settings/Group für Nicht-Output-Pfade (device-weit statt pro Output-
    // Kanal, siehe bufferDeviceMessage()/commitDevice()). Bewusst deutlich länger als
    // PENDING_QUIET_MS, weil hier auch Geräte ohne jede SwitchableOutput-Aktivität warten müssen,
    // bis feststeht, ob überhaupt eine Group-Message kommt (kein Fast-Path über den Output-Key).
    private readonly DEVICE_QUIET_MS = 30_000;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'victron-gx' });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    // ── Adapter-Start ────────────────────────────────────────────────────────
    private onReady(): void {
        // ── Config-Migration 0.10.0: controlEnabled → modbusControlEnabled ──────────────────────
        // In-Memory-Zuweisung MUSS synchron hier (vor allem anderen) passieren, da der Rest von
        // onReady() sofort this.config.modbusControlEnabled liest (z.B. für connectModbus() weiter
        // unten). Das Zurückschreiben nach native.* ist reine Persistenz für künftige Restarts und
        // muss dafür nicht abgewartet werden. Idempotent: native.controlEnabled wird auf null
        // gesetzt (nicht gelöscht) - der !== undefined-Check bleibt beim nächsten Start dennoch
        // korrekt, weil dann bereits modbusControlEnabled gesetzt ist und die äußere Bedingung nicht
        // mehr zutrifft.
        if (this.config.controlEnabled !== undefined && this.config.modbusControlEnabled === undefined) {
            this.config.modbusControlEnabled = this.config.controlEnabled;
            // try/catch statt nur .catch() auf dem Promise - ein synchroner Wurf beim Aufruf selbst
            // (z.B. falls extendForeignObjectAsync aus irgendeinem Grund nicht verfügbar ist) darf
            // onReady() nicht komplett abbrechen, die In-Memory-Korrektur oben ist bereits sicher.
            try {
                void this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
                    native: { modbusControlEnabled: this.config.controlEnabled, controlEnabled: null },
                }).catch(err => this.log.warn(`Config migration persist failed: ${(err as Error).message}`));
            } catch (err) {
                this.log.warn(`Config migration persist failed: ${(err as Error).message}`);
            }
            this.log.info(
                '[MIGRATION 0.10.0] Config key controlEnabled renamed to modbusControlEnabled - value preserved.',
            );
        }

        this.cleanupEnabled = this.config.cleanupOrphanedOutputs === true;

        void this.setState('info.connection', false, true);

        // setState erst NACH Objekt-Anlage (Promise.all().then()) - siehe writeStateValue()-Fix,
        // gleiche Race-Klasse (v0.9.3). modbusInfoObjectsReady wird unten auch verwendet, um
        // connectModbus() erst NACH dieser Anlage zu starten - dessen eigene setState()-Aufrufe
        // (bei Erfolg sofort nach dem TCP-Connect, der auf einem lokalen Netz oft <50ms dauert)
        // konnten sonst schneller sein als diese Objekt-Anlage auf einer echten (langsameren)
        // Objects-DB.
        const modbusInfoObjectsReady = Promise.all([
            this.setObjectNotExistsAsync('info.modbusConnected', {
                type: 'state',
                common: {
                    name: {
                        en: 'Modbus TCP connected',
                        de: 'Modbus TCP verbunden',
                        ru: 'Modbus TCP connected',
                        pt: 'Modbus TCP connected',
                        nl: 'Modbus TCP connected',
                        fr: 'Modbus TCP connected',
                        it: 'Modbus TCP connected',
                        es: 'Modbus TCP connected',
                        pl: 'Modbus TCP connected',
                        uk: 'Modbus TCP connected',
                        'zh-cn': 'Modbus TCP connected',
                    },
                    type: 'boolean',
                    role: 'indicator.connected',
                    read: true,
                    write: false,
                    def: false,
                },
                native: {},
            }),
            this.setObjectNotExistsAsync('info.modbusWritable', {
                type: 'state',
                common: {
                    name: {
                        en: 'Modbus write access',
                        de: 'Modbus Schreibzugriff',
                        ru: 'Modbus write access',
                        pt: 'Modbus write access',
                        nl: 'Modbus write access',
                        fr: 'Modbus write access',
                        it: 'Modbus write access',
                        es: 'Modbus write access',
                        pl: 'Modbus write access',
                        uk: 'Modbus write access',
                        'zh-cn': 'Modbus write access',
                    },
                    type: 'boolean',
                    role: 'indicator',
                    read: true,
                    write: false,
                    def: false,
                },
                native: {},
            }),
        ]).then(() => {
            void this.setState('info.modbusConnected', false, true);
            void this.setState('info.modbusWritable', false, true);
        });

        // acload (Shelly 1PM) und system (GX-internes Relais) können ebenfalls schreibbare
        // outputs.<key>.State-Kanäle tragen (siehe SUPPORTS_OUTPUTS/WRITABLE_TYPES) - onStateChange
        // filtert selbst auf ack=false + WRITABLE_TYPES, der breitere Subscribe ist unkritisch (§4.13).
        this.subscribeStates('devices.switch.*');
        this.subscribeStates('devices.acload.*');
        this.subscribeStates('devices.system.*');
        // WRITABLE_DEVICE_FIELDS-Typen (0.10.0 control-merge) - onStateChange filtert selbst auf
        // ack=false + Whitelist-Treffer, der breitere Subscribe ist unkritisch (§4.13, gleiches
        // Muster wie oben).
        this.subscribeStates('devices.vebus.*');
        this.subscribeStates('devices.evcharger.*');
        this.subscribeStates('devices.temperature.*');

        // Auto-Cleanup initial armen, damit auch bei leerem outputToInstance (Edge-Case: keine
        // Output-Kanäle empfangen) irgendwann gesweept wird - No-Op wenn cleanupEnabled=false (§10.4).
        this.armCleanupTimer();

        void this.cleanupNumericChannels();
        // Alte ess.* Struktur bereinigen
        void this.cleanupLegacyChannels();

        // Zwischenobjekte für Checker anlegen
        void this.setObjectNotExistsAsync('devices', {
            type: 'folder',
            common: {
                name: {
                    en: 'Devices',
                    de: 'Geräte',
                    ru: 'Devices',
                    pt: 'Devices',
                    nl: 'Devices',
                    fr: 'Devices',
                    it: 'Devices',
                    es: 'Devices',
                    pl: 'Devices',
                    uk: 'Devices',
                    'zh-cn': 'Devices',
                },
            },
            native: {},
        });
        void this.setObjectNotExistsAsync('overview', {
            type: 'channel',
            common: {
                name: {
                    en: 'System overview',
                    de: 'Systemübersicht',
                    ru: 'System overview',
                    pt: 'System overview',
                    nl: 'System overview',
                    fr: 'System overview',
                    it: 'System overview',
                    es: 'System overview',
                    pl: 'System overview',
                    uk: 'System overview',
                    'zh-cn': 'System overview',
                },
            },
            native: {},
        });

        const host = this.config.host;
        const port = this.config.port || 1883;
        if (!host) {
            this.log.error('No IP address configured!');
            return;
        }
        this.log.info(`Connecting to Victron GX at ${host}:${port}...`);
        this.connectMqtt(host, port, this.config.mqttUsername, this.config.mqttPassword);
        if (this.config.modbusControlEnabled) {
            const modbusPort = this.config.modbusPort || 502;
            this.log.info(`Control enabled – connecting Modbus TCP ${host}:${modbusPort}...`);
            void modbusInfoObjectsReady.then(() => this.connectModbus(host, modbusPort));
        }
    }

    // ── Bereinigung alte Struktur ─────────────────────────────────────────────
    private async cleanupLegacyChannels(): Promise<void> {
        // ess.* und ess.control.* aus alten Versionen löschen
        try {
            await this.delObjectAsync('ess', { recursive: true });
            this.log.info('Legacy ess.* structure cleaned up');
        } catch {
            /* existierte nicht */
        }
    }

    private async cleanupNumericChannels(): Promise<void> {
        try {
            const allObjects = await this.getObjectListAsync({
                startkey: `${this.namespace}.devices.`,
                endkey: `${this.namespace}.devices.\u9999`,
            });
            for (const obj of allObjects.rows) {
                const id = obj.id.replace(`${this.namespace}.`, '');
                const parts = id.split('.');
                if (parts.length !== 3) {
                    continue;
                }
                if (/^\d{1,3}$/.test(parts[2])) {
                    this.log.debug(`Cleaning up numeric channel: ${id}`);
                    await this.delObjectAsync(id, { recursive: true }).catch(() => {});
                }
            }
        } catch {
            /* ignorieren */
        }
    }

    // \u2500\u2500 Auto-Cleanup verwaister Output-Kan\u00e4le (\u00a710.4) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Sucht das DeviceInfo, das f\u00fcr eine gegebene (Serial, MQTT-Instance)-Kombination die
    // Output-Metadaten (Type, Group) tr\u00e4gt. Genauer als eine reine Serial-Suche: bei
    // Multi-Instance-Merging (Shelly Pro3) teilen sich mehrere DeviceInfos dieselbe Serial,
    // aber nur eine davon passt zur konkreten Instance des gesuchten Outputs.
    private findDeviceForOutput(serial: string, instance: number): DeviceInfo | undefined {
        for (const device of this.deviceMap.values()) {
            if (device.serial === serial && device.instance === instance) {
                return device;
            }
        }
        return undefined;
    }

    /**
     * Wird bei jedem neu erkannten Output-Kanal aufgerufen (Message-Handler) sowie initial nach
     * dem Subscribe. Setzt den Ruhezeit-Timer zur\u00fcck; erst wenn CLEANUP_QUIET_MS ohne neuen Kanal
     * verstrichen sind, l\u00e4uft der Sweep - aber nur einmal pro Adapter-Start.
     */
    private armCleanupTimer(): void {
        if (!this.cleanupEnabled || this.cleanupDoneOnce) {
            return;
        }
        if (this.cleanupTimer) {
            this.clearTimeout(this.cleanupTimer);
        }
        this.cleanupTimer = this.setTimeout(() => {
            this.cleanupTimer = null;
            void this.runOrphanSweep();
        }, this.CLEANUP_QUIET_MS);
    }

    /**
     * L\u00f6scht alle outputs.<key>-Kan\u00e4le, deren (BaseId, OutputKey)-Kombination nicht mehr mit dem
     * aktuellen outputToInstance-Zustand \u00fcbereinstimmt (Kanal umgruppiert, Ger\u00e4t entfernt/offline
     * deaktiviert). Betrifft ausschlie\u00dflich outputs.*-Objekte - Device-Level-Metadaten, Ac.*-
     * Messwerte, overview.* und alles au\u00dferhalb devices.<type>.**.outputs.<key> bleiben unber\u00fchrt
     * (Pass 1). Pass 2 r\u00e4umt zus\u00e4tzlich alte devices.<type>.<Serial>- UND devices.<type>.<Group>.
     * <Serial>-Ordner ab, deren Serial inzwischen unter einer ANDEREN BaseId aktiv ist - sowohl
     * gruppenlos\u2192Group- als auch Group\u2192Group-Umz\u00fcge (z.B. GX-seitiges Umh\u00e4ngen in eine andere
     * Group), siehe unten S10-Fix "groupless leftovers" + Group-migration-Erweiterung.
     */
    private async runOrphanSweep(): Promise<void> {
        this.cleanupDoneOnce = true;
        this.log.info('Starting cleanup of orphaned output channels...');

        // Aktive (BaseId, OutputKey)-Kombinationen aus dem laufenden outputToInstance-Zustand, plus
        // (fuer Pass 2) die aktuelle BaseId je Serial - ein Serial hat h\u00f6chstens eine BaseId, alle
        // seine OutputKeys teilen sich dieselbe Group/kein-Group-Entscheidung.
        const activeKeys = new Set<string>();
        const activeBaseIdBySerial = new Map<string, string>();
        for (const [serial, keyMap] of this.outputToInstance.entries()) {
            for (const [outputKey, route] of keyMap.entries()) {
                const device = this.findDeviceForOutput(serial, route.instance);
                if (!device) {
                    continue;
                }
                const baseId = this.getBaseId(device.type, device.instance, serial, device, true);
                if (baseId) {
                    activeKeys.add(`${baseId}|${outputKey}`);
                    activeBaseIdBySerial.set(serial, baseId);
                }
            }
        }

        let deletedOutputs = 0;
        let deletedFolders = 0;
        try {
            const allObjects = await this.getObjectListAsync({
                startkey: `${this.namespace}.devices.`,
                endkey: `${this.namespace}.devices.\u9999`,
            });

            // Pass 1: outputs.<key>-Kan\u00e4le, die nicht mehr in activeKeys stehen.
            // Kein Type-Filter (mehr) auf 'channel': ein outputs.<key>-Pfad ist in unserem Schema
            // IMMER ein von uns angelegter Kanal - nie ein State. Vor S10-Fix wurde hier zus\u00e4tzlich
            // obj.value?.type !== 'channel' gepr\u00fcft; das lie\u00df genau die Kan\u00e4le durchrutschen, die
            // durch den Race in commitPendingOutput() (siehe dortiger Kommentar) mit type:'folder'
            // oder ganz ohne type angelegt wurden - der eigentliche Grund, warum "alte" Karteileichen
            // trotz aktivem Toggle nie verschwanden. Der Race ist jetzt behoben, aber bereits so
            // besch\u00e4digte Altobjekte aus fr\u00fcheren L\u00e4ufen bleiben ohne diese Lockerung weiterhin
            // unsichtbar f\u00fcr den Sweep.
            const outputChannelRegex = /^(.+)\.outputs\.([^.]+)$/;
            for (const obj of allObjects.rows) {
                const id = obj.id.replace(`${this.namespace}.`, '');
                const m = outputChannelRegex.exec(id);
                if (!m) {
                    continue;
                }
                if (activeKeys.has(`${m[1]}|${m[2]}`)) {
                    continue;
                }
                await this.delObjectAsync(id, { recursive: true }).catch(() => {});
                deletedOutputs++;
            }

            // Pass 2: devices.<type>.<Serial>-Ordner (gruppenlos) UND devices.<type>.<Group>.<Serial>-
            // Ordner (gruppiert), deren Serial mittlerweile unter einer ANDEREN BaseId aktiv ist -
            // Karteileichen sowohl aus der Zeit vor S14 (gruppenlos \u2192 Group) als auch aus echten
            // Group-zu-Group-Umz\u00fcgen am GX (z.B. Shelly von "Shelly_Test" nach "Shelly_Test_2"
            // verschoben). Ein Serial hat laut activeBaseIdBySerial genau eine aktuell aktive BaseId
            // (getBaseId liefert genau einen Pfad je Serial) - jeder andere gefundene Device-Folder
            // mit derselben Serial im letzten Pfadsegment ist per Definition ein Umzugs-Rest. Bewusst
            // auf SUPPORTS_OUTPUTS beschr\u00e4nkt (nur diese Typen kennen \u00fcberhaupt Group/BaseId-
            // Migration \u00fcber outputToInstance) und auf Serials, die outputToInstance kennt - Ger\u00e4te
            // ohne jede SwitchableOutput-Aktivit\u00e4t (z.B. reine Ac.*-Messger\u00e4te ohne Output) bleiben
            // au\u00dferhalb dieses Sweeps (bekannte Grenze \u00a710.6, siehe README).
            for (const obj of allObjects.rows) {
                const id = obj.id.replace(`${this.namespace}.`, '');
                const parts = id.split('.');
                if (
                    (parts.length !== 3 && parts.length !== 4) ||
                    parts[0] !== 'devices' ||
                    !SUPPORTS_OUTPUTS.has(parts[1])
                ) {
                    continue;
                }
                const serial = parts[parts.length - 1];
                if (!this.outputToInstance.has(serial)) {
                    continue;
                }
                const activeBaseId = activeBaseIdBySerial.get(serial);
                // Ohne aufl\u00f6sbare aktive BaseId (z.B. findDeviceForOutput schl\u00e4gt fehl) lieber nichts
                // anfassen (konservativ) - und der Sonderfall "Serial hatte nie eine Group" ist \u00fcber
                // den Gleichheitsvergleich automatisch gesch\u00fctzt (siehe Funktionskommentar oben).
                if (!activeBaseId || activeBaseId === id) {
                    continue;
                }
                await this.delObjectAsync(id, { recursive: true }).catch(() => {});
                deletedFolders++;
            }
        } catch (e) {
            this.log.warn(`Orphan cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Pass 3: devices.<type>.<Group>-Container, die durch Pass 1+2 gerade erst leer geworden
        // sind ("orphaned group containers" - S10-Fix Teil D). Ein Group-Container entsteht, wenn
        // Kanäle einmal unter dieser Group liefen; zieht die letzte Serial per Group-Umzug weg
        // (Pass 2 entfernt dann den <Serial>-Unterordner), bleibt die leere Group-Hülle selbst
        // stehen, weil weder Pass 1 (matcht nur .outputs.<key>) noch Pass 2 (matcht nur Ordner mit
        // Serial als letztem Segment) sie je anfassen. Deshalb erst NACH Pass 1+2 lesbar - ein
        // frischer getObjectListAsync()-Aufruf statt Wiederverwendung von allObjects, weil der
        // Container erst durch deren (bereits awaitete) Löschungen leer wird.
        // Ein Group-Container (devices.<type>.<GroupName>) und ein gruppenloser Serial-Ordner
        // (devices.<type>.<Serial>) sehen syntaktisch identisch aus - beide genau 3 Segmente. Die
        // beiden werden über denselben BaseId-Vergleich wie in Pass 2 unterschieden: <GroupName>
        // bzw. <Serial> ist genau dann ein gruppenloser, aktiver Serial-Ordner, wenn die ID selbst
        // in activeBaseIdBySerial auftaucht - der bleibt unangetastet, unabhängig von seiner
        // Kinderzahl. Alles andere mit 0 verbleibenden Kindern ist ein Group-Container, der leer
        // geworden ist.
        let deletedGroups = 0;
        try {
            const activeBaseIds = new Set(activeBaseIdBySerial.values());
            const remaining = await this.getObjectListAsync({
                startkey: `${this.namespace}.devices.`,
                endkey: `${this.namespace}.devices.香`,
            });
            const remainingIds = remaining.rows.map(obj => obj.id.replace(`${this.namespace}.`, ''));
            for (const id of remainingIds) {
                const parts = id.split('.');
                if (parts.length !== 3 || parts[0] !== 'devices' || !SUPPORTS_OUTPUTS.has(parts[1])) {
                    continue;
                }
                if (activeBaseIds.has(id)) {
                    continue;
                }
                const prefix = `${id}.`;
                const hasChildren = remainingIds.some(otherId => otherId.startsWith(prefix));
                if (hasChildren) {
                    continue;
                }
                await this.delObjectAsync(id, { recursive: true }).catch(() => {});
                deletedGroups++;
            }
        } catch (e) {
            this.log.warn(`Orphan group container cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
        }

        this.log.info(
            `Cleanup finished: removed ${deletedOutputs} orphaned output channel(s), ${deletedFolders} orphaned device folder(s), ${deletedGroups} orphaned group container(s).`,
        );
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
            this.log.info('MQTT connected to Victron GX!');
            void this.setState('info.connection', true, true);
            this.mqttClient!.subscribe('N/#', err => {
                if (err) {
                    this.log.error(`Subscribe error: ${err.message}`);
                }
            });
        });
        this.mqttClient.on('message', (topic, payload) => {
            void this.handleMessage(topic, payload);
        });
        this.mqttClient.on('error', err => {
            this.log.error(`MQTT error: ${err.message}`);
            void this.setState('info.connection', false, true);
        });
        this.mqttClient.on('offline', () => {
            this.log.warn('MQTT connection lost');
            void this.setState('info.connection', false, true);
        });
        this.mqttClient.on('reconnect', () => {
            this.log.info('MQTT reconnecting...');
            if (this.vrmId) {
                this.startKeepAlive();
            }
        });
    }

    // Neuen Pfad in Topic Map eintragen
    private updateTopicMap(deviceKey: string, normPath: string, stateId: string, device: DeviceInfo): void {
        if (!this.topicMap[deviceKey]) {
            this.topicMap[deviceKey] = {
                serial: device.serial,
                productName: device.productName,
                customName: device.customName,
                virtual: device.virtual,
                paths: {},
            };
        }
        const dev = this.topicMap[deviceKey];
        dev.serial = device.serial;
        dev.productName = device.productName;
        dev.customName = device.customName;
        if (!dev.paths[normPath]) {
            dev.paths[normPath] = { stateId, active: true };
        }
    }

    // ── Modbus TCP ───────────────────────────────────────────────────────────
    private async connectModbus(host: string, port: number): Promise<void> {
        try {
            this.modbusClient = new ModbusRTU();
            await this.modbusClient.connectTCP(host, { port });
            this.modbusClient.setTimeout(3000);
            this.log.info('Modbus TCP connected!');
            void this.setState('info.modbusConnected', true, true);
            void this.testModbusWrite();
            this.setTimeout(() => void this.discoverModbusUnits(), 20000);
        } catch (err) {
            this.log.error(`Modbus connection error: ${(err as Error).message}`);
            void this.setState('info.modbusConnected', false, true);
            void this.setState('info.modbusWritable', false, true);
            this.setTimeout(() => void this.connectModbus(host, port), 30000);
        }
    }

    private async testModbusWrite(): Promise<void> {
        if (!this.modbusClient) {
            return;
        }
        let vebusEntry: [string, number] | undefined;
        for (let i = 0; i < 60; i++) {
            vebusEntry = Array.from(this.modbusUnitMap.entries()).find(([k]) => k.startsWith('vebus/'));
            if (vebusEntry) {
                break;
            }
            await new Promise<void>(resolve => {
                this.setTimeout(() => resolve(), 1000);
            });
        }
        if (!vebusEntry) {
            this.log.warn('Modbus write test: vebus unit ID not known');
            return;
        }
        const [, vebusUnitId] = vebusEntry;
        try {
            if (this.modbusBusy) {
                await this.waitModbus();
            }
            this.modbusBusy = true;
            this.modbusClient.setID(vebusUnitId);
            const result = await this.modbusClient.readHoldingRegisters(37, 1);
            await this.modbusClient.writeRegister(37, result.data[0]);
            this.modbusBusy = false;
            this.log.info(`Modbus write access confirmed! (vebus unit ID ${vebusUnitId})`);
            void this.setState('info.modbusWritable', true, true);
        } catch (err) {
            this.modbusBusy = false;
            this.log.warn(`Modbus write access not possible: ${(err as Error).message}`);
            void this.setState('info.modbusWritable', false, true);
        }
    }

    private async discoverModbusUnits(): Promise<void> {
        if (!this.modbusClient) {
            return;
        }
        this.log.info(`Starting Modbus unit ID discovery... (deviceMap: ${this.deviceMap.size} devices)`);
        const TYPE_TEST_REGISTER: Record<string, number> = {
            vebus: 3,
            battery: 259,
            grid: 2616,
            pvinverter: 1026,
            solarcharger: 771,
        };
        const neededTypes = new Set(MODBUS_NEEDED_TYPES); // lokale Kopie da delete() verwendet wird
        for (let unitId = 1; unitId <= 247; unitId++) {
            if (neededTypes.size === 0) {
                break;
            }
            for (const type of Array.from(neededTypes)) {
                try {
                    if (this.modbusBusy) {
                        await this.waitModbus();
                    }
                    this.modbusBusy = true;
                    this.modbusClient.setID(unitId);
                    await this.modbusClient.readHoldingRegisters(TYPE_TEST_REGISTER[type], 1);
                    this.modbusBusy = false;
                    const matchingEntry = Array.from(this.deviceMap.entries()).find(([, d]) => d.type === type);
                    if (matchingEntry) {
                        const [deviceKey, device] = matchingEntry;
                        this.modbusUnitMap.set(deviceKey, unitId);
                        neededTypes.delete(type);
                        this.log.info(`Modbus discovery: ${type} → unit ID ${unitId}`);
                        const serial = this.serialMap.get(deviceKey);
                        const baseId = this.getBaseId(device.type, device.instance, serial, device);
                        if (baseId) {
                            await this.extendObjectAsync(`${baseId}.info.modbusId`, {
                                type: 'state',
                                common: {
                                    name: {
                                        en: 'Modbus Unit ID',
                                        de: 'Modbus Unit ID',
                                        ru: 'Modbus Unit ID',
                                        pt: 'Modbus Unit ID',
                                        nl: 'Modbus Unit ID',
                                        fr: 'Modbus Unit ID',
                                        it: 'Modbus Unit ID',
                                        es: 'Modbus Unit ID',
                                        pl: 'Modbus Unit ID',
                                        uk: 'Modbus Unit ID',
                                        'zh-cn': 'Modbus Unit ID',
                                    },
                                    type: 'number',
                                    role: 'value',
                                    read: true,
                                    write: false,
                                },
                                native: {},
                            });
                            await this.setState(`${baseId}.info.modbusId`, { val: unitId, ack: true });
                        }
                    }
                    break;
                } catch {
                    this.modbusBusy = false;
                }
            }
            await new Promise<void>(resolve => {
                this.setTimeout(() => resolve(), 50);
            });
        }
        this.log.info(`Modbus discovery completed. ${this.modbusUnitMap.size} devices found.`);

        // ESS/settings ist immer Unit 100
        if (this.config.modbusControlEnabled) {
            try {
                if (this.modbusBusy) {
                    await this.waitModbus();
                }
                this.modbusBusy = true;
                this.modbusClient.setID(100);
                await this.modbusClient.readHoldingRegisters(2902, 1);
                this.modbusBusy = false;
                this.modbusUnitMap.set('ess/0', 100);
                this.log.info('Modbus discovery: ess/settings → unit ID 100');
                await this.initControlDatapoints();
            } catch (err) {
                this.modbusBusy = false;
                this.log.warn(`ESS unit 100 not reachable: ${(err as Error).message}`);
            }
        }
    }

    // ── CONTROL_REGISTERS-dpId → devices.<type>.<serial>-Zielfeld auflösen ───
    private controlRegisterTarget(dpId: string): { type: 'vebus' | 'system'; field: string } {
        const isInverter = dpId.startsWith('inverter.');
        const suffix = dpId.slice(dpId.indexOf('.') + 1);
        if (isInverter) {
            return { type: 'vebus', field: INVERTER_FIELD_NAMES[suffix] ?? suffix };
        }
        return { type: 'system', field: suffix };
    }

    // Serial für einen (annahmegemäß singulären) Gerätetyp - vebus/system kommen pro Anlage genau
    // einmal vor, eine lineare deviceMap-Suche (wie findDeviceForOutput()) ist daher ausreichend.
    private findSerialForType(type: string): string | undefined {
        for (const device of this.deviceMap.values()) {
            if (device.type === type && device.serial) {
                return device.serial;
            }
        }
        return undefined;
    }

    private controlRegisterStateId(dpId: string): string | undefined {
        const target = this.controlRegisterTarget(dpId);
        const serial = this.findSerialForType(target.type);
        if (!serial) {
            return undefined;
        }
        return `devices.${target.type}.${serial}.${target.field}`;
    }

    // Rückrichtung zu controlRegisterTarget() - für den Schreib-Dispatch in onStateChange() (S4),
    // der vom aufgelösten devices.<type>.<field>-Pfad zurück auf den CONTROL_REGISTERS-dpId muss.
    private controlRegisterDpId(type: string, field: string): string | undefined {
        for (const dpId of Object.keys(CONTROL_REGISTERS)) {
            const target = this.controlRegisterTarget(dpId);
            if (target.type === type && target.field === field) {
                return dpId;
            }
        }
        return undefined;
    }

    // MQTT-Instance für eine (Type, Serial)-Kombination - Gegenstück zu findSerialForType(), für
    // den MQTT-Schreib-Dispatch (W/<vrmId>/<type>/<instance>/...) benötigt, der über Instance statt
    // Serial adressiert wird.
    private findInstanceForSerial(type: string, serial: string): number | undefined {
        for (const device of this.deviceMap.values()) {
            if (device.type === type && device.serial === serial) {
                return device.instance;
            }
        }
        return undefined;
    }

    // ── Modbus-Steuerregister anlegen und initial lesen ──────────────────────
    // vebus-Felder (inverter.*) sind bereits vorhandene MQTT-Read-Mirrors - writeStateValue() legt
    // deren Objekt inkl. common.write (WRITABLE_DEVICE_FIELDS) an, hier wird NUR der initiale
    // Modbus-Lesewert nachgezogen (kein Objekt-Merge, um mit der MQTT-Seite nicht um Metadaten wie
    // name/role zu konkurrieren). system-Felder haben kein MQTT-Pendant und werden hier komplett
    // (inkl. Objekt-Anlage) verwaltet.
    //
    // Bekannte Race (bewusst in Kauf genommen, siehe S8-Live-Test-Auftrag): findSerialForType()
    // liefert nur etwas, wenn die jeweilige Serial (vebus: MQTT-Read-Mirror, system: system/0/Serial)
    // VOR Abschluss dieser sequentiellen, mehrere Sekunden dauernden Modbus-Discovery bereits bekannt
    // ist. MQTT liefert retained Werte i.d.R. binnen Millisekunden nach dem Connect, also deutlich
    // früher - ohne Garantie aber. Ist die Serial zu diesem Zeitpunkt unbekannt, wird der jeweilige
    // dpId übersprungen (Warn-Log) statt auf eine unsichere BaseId zu schreiben; für system-Felder
    // bedeutet das im Zweifel: State erscheint erst nach einem weiteren Adapter-Restart.
    private async initControlDatapoints(): Promise<void> {
        if (!this.modbusClient) {
            return;
        }

        // vebus Unit ID ermitteln
        const vebusEntry = Array.from(this.modbusUnitMap.entries()).find(([k]) => k.startsWith('vebus/'));
        const vebusUnitId = vebusEntry?.[1];

        for (const [dpId, reg] of Object.entries(CONTROL_REGISTERS)) {
            const isInverter = dpId.startsWith('inverter.');
            const unitId = isInverter ? vebusUnitId : 100;
            const target = this.controlRegisterTarget(dpId);
            const serial = this.findSerialForType(target.type);
            if (!serial) {
                this.log.warn(`${dpId}: no ${target.type} serial known yet, skipping Modbus init`);
                continue;
            }
            const stateId = `devices.${target.type}.${serial}.${target.field}`;

            if (isInverter) {
                if (!this.createdStates.has(stateId)) {
                    this.log.debug(`${stateId}: MQTT read-mirror not created yet, skipping Modbus init read`);
                    continue;
                }
            } else {
                const isWritable =
                    WRITABLE_DEVICE_FIELDS.system?.[target.field] === 'modbus' && this.config.modbusControlEnabled;
                const commonDef: ioBroker.StateCommon = {
                    name: reg.name,
                    type: 'number',
                    role: isWritable
                        ? 'level'
                        : reg.unit === 'W'
                          ? 'value.power'
                          : reg.unit === 'A'
                            ? 'value.current'
                            : 'value',
                    unit: reg.unit,
                    read: true,
                    write: isWritable,
                };
                if (reg.states) {
                    (commonDef as any).states = reg.states;
                }
                await this.extendObjectAsync(stateId, { type: 'state', common: commonDef, native: {} });
                // Erst JETZT (Objekt existiert nachweislich) für handleSettingsMqttUpdate() freigeben -
                // dessen MQTT-Settings-Echo lief bisher ungegatet und konnte den State per setState
                // erreichen, bevor die (sequentielle, mehrere Sekunden dauernde) Modbus-Discovery hier
                // überhaupt bei diesem dpId angekommen war ("has no existing object", v0.9.3-Fix).
                this.createdStates.add(stateId);
            }

            // Initial per Modbus lesen (kein Default schreiben!)
            if (unitId === undefined) {
                this.log.warn(`${stateId}: no unit ID known, skipping Modbus read`);
                continue;
            }
            try {
                if (this.modbusBusy) {
                    await this.waitModbus();
                }
                this.modbusBusy = true;
                this.modbusClient.setID(unitId);
                const result = await this.modbusClient.readHoldingRegisters(reg.register, 1);
                this.modbusBusy = false;
                let raw = result.data[0];
                if (reg.signed && raw > 32767) {
                    raw = raw - 65536;
                }
                const val = Math.round(raw * reg.scaleRead * 100) / 100;
                await this.setState(stateId, { val, ack: true });
                this.log.info(`${stateId} = ${val}${reg.unit} (Reg ${reg.register})`);
            } catch (err) {
                this.modbusBusy = false;
                this.log.warn(`${stateId} Modbus read error: ${(err as Error).message}`);
            }
        }
        this.log.info('Modbus control datapoints initialized');
    }

    // ── Modbus Write ─────────────────────────────────────────────────────────
    private async writeControlModbus(dpId: string, value: number): Promise<void> {
        if (!this.modbusClient) {
            return;
        }
        const reg = CONTROL_REGISTERS[dpId];
        if (!reg) {
            this.log.warn(`No register for ${dpId}`);
            return;
        }
        const stateId = this.controlRegisterStateId(dpId);
        if (!stateId) {
            this.log.warn(`${dpId}: no serial known, cannot resolve target state`);
            return;
        }

        const isInverter = dpId.startsWith('inverter.');
        let unitId: number | undefined;
        if (isInverter) {
            const vebusEntry = Array.from(this.modbusUnitMap.entries()).find(([k]) => k.startsWith('vebus/'));
            unitId = vebusEntry?.[1];
        } else {
            unitId = this.modbusUnitMap.get('ess/0');
        }
        if (unitId === undefined) {
            this.log.warn(`${stateId}: no Modbus unit ID known`);
            return;
        }

        // Skalierung: raw = physWert * scaleWrite
        const rawValue = Math.round(value * reg.scaleWrite);
        // 16-bit signed two's complement
        const writeValue = reg.signed && rawValue < 0 ? rawValue + 65536 : rawValue;

        try {
            if (this.modbusBusy) {
                await this.waitModbus();
            }
            this.modbusBusy = true;
            this.modbusClient.setID(unitId);
            await this.modbusClient.writeRegister(reg.register, writeValue);
            this.modbusBusy = false;
            this.log.info(
                `Modbus write: ${stateId} = ${value}${reg.unit} → reg ${reg.register} = ${writeValue} (unit ${unitId})`,
            );
            // Bestätigung zurückschreiben
            await this.setState(stateId, { val: value, ack: true });
        } catch (err) {
            this.modbusBusy = false;
            this.log.error(`Modbus write error ${stateId}: ${(err as Error).message}`);
        }
    }

    private waitModbus(): Promise<void> {
        return new Promise(r => this.setTimeout(r, 100));
    }

    // ── Generic MQTT Write (S2) ──────────────────────────────────────────────
    // Zentraler Gegenpart zu writeControlModbus() für die MQTT-Seite. mqttField ist der komplette
    // Pfad hinter der Instance (z.B. "SetCurrent" für evcharger, "SwitchableOutput/output_1/State"
    // für Switch-Outputs) - der Aufrufer löst deviceType/instance/mqttField auf, diese Funktion
    // konstruiert nur noch das Topic und published.
    private writeDeviceMqtt(deviceType: string, instance: number, mqttField: string, value: ioBroker.StateValue): void {
        if (!this.mqttClient || !this.vrmId) {
            return;
        }
        const mqttTopic = `W/${this.vrmId}/${deviceType}/${instance}/${mqttField}`;
        this.log.info(`MQTT write: ${mqttTopic} = ${String(value)}`);
        this.mqttClient.publish(mqttTopic, JSON.stringify({ value }));
    }

    // ── AcPowerSetpoint Keepalive ─────────────────────────────────────────────
    // Victron erwartet Reg 37 alle ~1s neu wenn externe Steuerung aktiv
    private startAcPowerSetpointKeepalive(value: number): void {
        if (this.acPowerSetpointInterval) {
            this.clearInterval(this.acPowerSetpointInterval);
        }
        if (value === 0) {
            this.acPowerSetpointInterval = null;
            this.log.info('AcPowerSetpoint keepalive stopped');
            return;
        }
        this.acPowerSetpointInterval = this.setInterval(() => {
            void (async () => {
                try {
                    const stateId = this.controlRegisterStateId('inverter.AcPowerSetpoint');
                    if (!stateId) {
                        return;
                    }
                    const s = await this.getStateAsync(stateId);
                    const v = typeof s?.val === 'number' ? s.val : 0;
                    if (v === 0) {
                        if (this.acPowerSetpointInterval) {
                            this.clearInterval(this.acPowerSetpointInterval);
                            this.acPowerSetpointInterval = null;
                        }
                        return;
                    }
                    const reg = CONTROL_REGISTERS['inverter.AcPowerSetpoint'];
                    const vebusEntry = Array.from(this.modbusUnitMap.entries()).find(([k]) => k.startsWith('vebus/'));
                    if (!vebusEntry || !this.modbusClient) {
                        return;
                    }
                    const [, unitId] = vebusEntry;
                    const rawValue = Math.round(v * reg.scaleWrite);
                    const writeValue = reg.signed && rawValue < 0 ? rawValue + 65536 : rawValue;
                    if (this.modbusBusy) {
                        return;
                    } // Tick überspringen wenn Modbus beschäftigt
                    if (!this.modbusClient) {
                        return;
                    }
                    this.modbusBusy = true;
                    this.modbusClient.setID(unitId);
                    await this.modbusClient.writeRegister(reg.register, writeValue);
                    this.modbusBusy = false;
                    this.log.debug(`AcPowerSetpoint keepalive: ${v}W → reg 37 = ${writeValue}`);
                } catch (err) {
                    this.modbusBusy = false;
                    this.log.warn(`AcPowerSetpoint keepalive error: ${(err as Error).message}`);
                }
            })();
        }, 800);
        this.log.info(`AcPowerSetpoint keepalive started: ${value}W`);
    }

    private startKeepAlive(): void {
        if (this.keepAliveInterval) {
            this.clearInterval(this.keepAliveInterval);
        }
        this.keepAliveInterval = this.setInterval(() => {
            if (this.mqttClient && this.vrmId) {
                this.mqttClient.publish(`R/${this.vrmId}/keepalive`, '');
                this.log.debug('MQTT keepalive sent');
            }
        }, 50000);
        if (this.vrmId) {
            this.mqttClient!.publish(`R/${this.vrmId}/keepalive`, '');
        }
    }

    // ── Haupt-Message-Handler ────────────────────────────────────────────────
    private handleMessage(topic: string, payload: Buffer): void {
        try {
            const raw = payload.toString();
            if (!raw) {
                return;
            }

            // Catalog: nur beim ersten Mal eintragen (kein Update bei bekannten Topics)
            if (this.vrmId && topic.startsWith(`N/${this.vrmId}/`)) {
                const shortTopic = topic.substring(`N/${this.vrmId}/`.length);
                if (!(shortTopic in this.topicCatalog)) {
                    try {
                        const parsed = JSON.parse(raw);
                        this.topicCatalog[shortTopic] = { value: 'value' in parsed ? parsed.value : parsed };
                    } catch {
                        // ignore
                    }
                }
            }

            // ── MESSAGE HANDLER ───────────────────────────────────────────────
            let parsed: any;
            try {
                parsed = JSON.parse(raw);
            } catch {
                return;
            }

            // N/<vrmId>/keepalive → VRM ID merken
            const topicParts = topic.split('/');
            if (topicParts[0] !== 'N' || topicParts.length < 3) {
                return;
            }

            const vrmId = topicParts[1];
            if (!this.vrmId && vrmId) {
                this.vrmId = vrmId;
                this.log.info(`VRM ID detected: ${vrmId}`);
                this.startKeepAlive();
            }

            const parts = topicParts;
            if (parts.length < 5) {
                return;
            }

            const deviceType = parts[2];
            const instanceStr = parts[3];
            const instance = parseInt(instanceStr, 10);
            const path = parts.slice(4).join('/');
            const normPath = path.replace(/\//g, '.');

            if (!path || !RELEVANT_PATHS[deviceType]) {
                // ESS/Settings MQTT-Rücklesung → control.system.* aktualisieren
                if (deviceType === 'settings') {
                    void this.handleSettingsMqttUpdate(normPath, parsed);
                }
                return;
            }

            const rawValue = 'value' in parsed ? parsed.value : parsed;
            if (rawValue === null || rawValue === undefined) {
                return;
            }

            // S14-Fix: Die Pufferung muss VOR der Registration-Path-Behandlung greifen, nicht erst
            // danach - updateDeviceMeta() legt bei Serial/ProductName/Connected/Position/NrOfPhases
            // synchron Objekte an und schreibt Logs, sobald device.ready=true ist. Ohne diese Gate
            // hier entsteht der gruppenlose Ordner bereits durch die allererste Message-Serie
            // (Serial → Connected im selben Sync-Block), lange bevor die SwitchableOutput.Group-
            // Message eintrifft. getOrCreateDeviceEntry() legt nur den In-Memory-Eintrag an (kein
            // ioBroker-Objekt, kein Log) - für DEVICE_GROUP_RACE_TYPES startet er mit
            // baseIdCommitted=false und wird erst durch commitDevice() "scharf geschaltet".
            if (DEVICE_GROUP_RACE_TYPES.has(deviceType)) {
                const raceDeviceKey = `${deviceType}/${instance}`;
                const raceDevice = this.getOrCreateDeviceEntry(raceDeviceKey, deviceType, instance);
                if (!raceDevice.baseIdCommitted) {
                    this.bufferDeviceMessage(raceDevice, topic, payload, remapOutputPath(normPath), rawValue);
                    return;
                }
            }

            if (REGISTRATION_PATHS.has(normPath)) {
                if (typeof rawValue === 'string' || typeof rawValue === 'number') {
                    this.updateDeviceMeta(deviceType, instance, normPath, String(rawValue));
                }
                return;
            }

            // Output-Pfad (SwitchableOutput.<key>.*)? Dann dynamisch remappen, sonst statische
            // RELEVANT_PATHS_SET-Liste + PATH_REMAP (nur noch battery, switch/acload laufen seit
            // S7 ausschließlich über remapOutputPath()).
            let remappedPath: string;
            const out = remapOutputPath(normPath);
            if (out && SUPPORTS_OUTPUTS.has(deviceType)) {
                remappedPath = out.ioPath;
            } else if (RELEVANT_PATHS_SET[deviceType]?.has(normPath)) {
                remappedPath = PATH_REMAP[deviceType]?.[normPath] ?? normPath;
            } else {
                return;
            }

            const deviceKey = `${deviceType}/${instance}`;
            const device = this.deviceMap.get(deviceKey);
            const serial = this.serialMap.get(deviceKey);

            if (!serial && !NO_SERIAL_TYPES_HANDLE.has(deviceType)) {
                return;
            }

            // S14-Fix: Die eigentliche Race-Pufferung sitzt jetzt VOR der Registration-Path-
            // Behandlung (siehe oben) und deckt damit auch diesen Pfad ab - für
            // DEVICE_GROUP_RACE_TYPES ist device.baseIdCommitted an dieser Stelle immer true
            // (sonst wären wir bereits oben zurückgekehrt), ein zweites Gate wäre hier toter Code.
            const isOutputPath = out !== null && SUPPORTS_OUTPUTS.has(deviceType);
            const baseId = this.getBaseId(deviceType, instance, serial, device, isOutputPath);
            if (!baseId) {
                return;
            }

            // Output-Sub-Channel + Metadaten-Handling (Multi-Channel-Merging, siehe §4.9/4.11).
            // isOutputPath === true garantiert hier serial !== undefined (siehe getBaseId/S3).
            if (isOutputPath && out && serial) {
                const keyMap = this.outputToInstance.get(serial);
                if (!keyMap?.has(out.key)) {
                    // S13: Kanal noch nicht committed - device.group kann hier noch undefined
                    // sein (Race gegen Settings/Group). Puffern statt BaseId-abhängige Objekte
                    // sofort anzulegen, siehe bufferPendingOutput()/commitPendingOutput().
                    this.bufferPendingOutput(serial, out, deviceType, instance, device, rawValue);
                    return;
                }
                if (out.sub === 'CustomName' && typeof rawValue === 'string' && rawValue && device) {
                    void this.extendObjectAsync(`${baseId}.outputs.${out.key}`, {
                        common: { name: `${device.productName} — ${rawValue}` },
                    });
                }
                if (out.sub === 'Group' && typeof rawValue === 'string' && rawValue && device && !device.group) {
                    // Erste Group "gewinnt" für die BaseId (siehe getBaseId) - Group-Änderungen
                    // zur Laufzeit erzeugen bewusst KEINEN neuen Ordner (Objekt-Umzug zu invasiv).
                    device.group = rawValue;
                }
            }

            // Phasen-Filterung für virtuelle Geräte
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

            // Channel beim ersten Wert anlegen
            if (!this.channelReady.has(baseId)) {
                if (device) {
                    void this.ensureChannel(baseId, device);
                } else if (baseId === 'overview') {
                    this.channelReady.add('overview');
                    void this.setObjectNotExistsAsync('overview', {
                        type: 'channel',
                        common: {
                            name: {
                                en: 'System overview',
                                de: 'Systemübersicht',
                                ru: 'System overview',
                                pt: 'System overview',
                                nl: 'System overview',
                                fr: 'System overview',
                                it: 'System overview',
                                es: 'System overview',
                                pl: 'System overview',
                                uk: 'System overview',
                                'zh-cn': 'System overview',
                            },
                        },
                        native: {},
                    });
                    void this.setObjectNotExistsAsync('overview.info', {
                        type: 'channel',
                        common: {
                            name: {
                                en: 'Info',
                                de: 'Info',
                                ru: 'Info',
                                pt: 'Info',
                                nl: 'Info',
                                fr: 'Info',
                                it: 'Info',
                                es: 'Info',
                                pl: 'Info',
                                uk: 'Info',
                                'zh-cn': 'Info',
                            },
                        },
                        native: {},
                    });
                }
            }
            if (device) {
                this.touchDevice(device, baseId);
            }

            // Wert konvertieren + State anlegen/schreiben (S13: ausgelagert, damit
            // commitPendingOutput() denselben Code für gepufferte Werte wiederverwenden kann).
            const storeValue = this.writeStateValue(
                baseId,
                device,
                deviceKey,
                deviceType,
                normPath,
                remappedPath,
                rawValue,
            );

            // Tank: zusätzliche Liter-States berechnen
            if (deviceType === 'tank' && typeof storeValue === 'number') {
                if (remappedPath === 'Capacity') {
                    const literId = `${baseId}.CapacityLiter`;
                    const writeLiter = (): void => {
                        void this.setState(literId, { val: Math.round(storeValue * 1000), ack: true });
                    };
                    if (!this.createdStates.has(literId)) {
                        this.createdStates.add(literId);
                        // setState erst NACH Objekt-Anlage (.then()) - siehe writeStateValue()-Fix
                        // oben, gleiche Race-Klasse.
                        void this.extendObjectAsync(literId, {
                            type: 'state',
                            common: {
                                name: {
                                    en: 'Capacity (liters)',
                                    de: 'Kapazität (Liter)',
                                    ru: 'Capacity (liters)',
                                    pt: 'Capacity (liters)',
                                    nl: 'Capacity (liters)',
                                    fr: 'Capacity (liters)',
                                    it: 'Capacity (liters)',
                                    es: 'Capacity (liters)',
                                    pl: 'Capacity (liters)',
                                    uk: 'Capacity (liters)',
                                    'zh-cn': 'Capacity (liters)',
                                },
                                type: 'number',
                                role: 'value',
                                unit: 'l',
                                read: true,
                                write: false,
                            },
                            native: {},
                        }).then(writeLiter);
                    } else {
                        writeLiter();
                    }
                }
                if (remappedPath === 'Remaining') {
                    const literId = `${baseId}.RemainingLiter`;
                    const writeLiter = (): void => {
                        void this.setState(literId, { val: Math.round(storeValue * 1000), ack: true });
                    };
                    if (!this.createdStates.has(literId)) {
                        this.createdStates.add(literId);
                        void this.extendObjectAsync(literId, {
                            type: 'state',
                            common: {
                                name: {
                                    en: 'Remaining (liters)',
                                    de: 'Verbleibend (Liter)',
                                    ru: 'Remaining (liters)',
                                    pt: 'Remaining (liters)',
                                    nl: 'Remaining (liters)',
                                    fr: 'Remaining (liters)',
                                    it: 'Remaining (liters)',
                                    es: 'Remaining (liters)',
                                    pl: 'Remaining (liters)',
                                    uk: 'Remaining (liters)',
                                    'zh-cn': 'Remaining (liters)',
                                },
                                type: 'number',
                                role: 'value',
                                unit: 'l',
                                read: true,
                                write: false,
                            },
                            native: {},
                        }).then(writeLiter);
                    } else {
                        writeLiter();
                    }
                }
            }

            // Batterie: cells min/max neu berechnen
            if (deviceType === 'battery' && CELL_PATH_RE.test(remappedPath)) {
                void this.updateBatteryCellMinMax(baseId);
            }

            // Gesamtleistung berechnen für overview
            if (deviceType === 'system' && OVERVIEW_TOTAL_POWER[normPath]) {
                void this.updateOverviewTotalPower(normPath);
            }

            // activePhase
            if (PHASE_POWER_PATHS[deviceType]?.includes(normPath) && this.channelReady.has(baseId)) {
                void this.updateActivePhase(deviceType, baseId);
            }
        } catch (err) {
            this.log.debug(`Error processing topic ${topic}: ${(err as Error).message}`);
        }
    }

    /**
     * Konvertiert einen Rohwert und legt/aktualisiert den zugehörigen State an. Ausgelagert aus
     * handleMessage() (S13), damit commitPendingOutput() denselben Anlage-/Schreibcode für
     * gepufferte Output-Werte wiederverwenden kann, ohne ihn zu duplizieren.
     *
     * @param baseId Objektbasis (z.B. devices.switch.<serial> oder .../<group>/<serial>)
     * @param device Geräte-Metadaten (für updateTopicMap, undefined nicht erwartet im Regelfall)
     * @param deviceKey Interner Schlüssel "<type>/<instance>" für topicMap
     * @param deviceType Victron-Gerätetyp (z.B. "switch", "acload", "system")
     * @param normPath Normierter MQTT-Pfad (für topicMap)
     * @param remappedPath ioBroker-Sub-Pfad relativ zu baseId (z.B. "outputs.1.State")
     * @param rawValue Roh-MQTT-Wert vor der Typkonvertierung
     * @returns Der konvertierte storeValue (wird von handleMessage() für die Tank-Liter-Berechnung weiterverwendet)
     */
    private writeStateValue(
        baseId: string,
        device: DeviceInfo | undefined,
        deviceKey: string,
        deviceType: string,
        normPath: string,
        remappedPath: string,
        rawValue: any,
    ): ioBroker.StateValue {
        // outputs.<key>.State/Status (switch/acload/system) sind boolean, genau wie das alte
        // switch-spezifische State/Status - jetzt gerätetyp-übergreifend über SUPPORTS_OUTPUTS.
        const outputBoolSub = remappedPath.match(/^outputs\.[^.]+\.(State|Status)$/);
        const isOutputBool = outputBoolSub !== null && SUPPORTS_OUTPUTS.has(deviceType);
        const storeValue = isOutputBool ? rawValue !== 0 : rawValue;
        const storeType = isOutputBool
            ? 'boolean'
            : typeof rawValue === 'number'
              ? 'number'
              : typeof rawValue === 'boolean'
                ? 'boolean'
                : 'string';

        // Schreibbarkeit: outputs.<key>.State für WRITABLE_TYPES per MQTT schreibbar - ab 0.10.0
        // zusätzlich an mqttControlEnabled gebunden (vorher unconditional writable, siehe Motivation
        // in CONTROL_MERGE_PLAN.md). WRITABLE_DEVICE_FIELDS deckt die 0.10.0-Merge-Felder ab
        // (vebus/system-Modbus-Register → modbusControlEnabled, evcharger/temperature-MQTT → mqttControlEnabled).
        const writableChannel = WRITABLE_DEVICE_FIELDS[deviceType]?.[remappedPath];
        const isWritable =
            (isOutputBool &&
                outputBoolSub[1] === 'State' &&
                WRITABLE_TYPES.has(deviceType) &&
                this.config.mqttControlEnabled) ||
            (writableChannel === 'modbus' && this.config.modbusControlEnabled) ||
            (writableChannel === 'mqtt' && this.config.mqttControlEnabled);

        const stateId = `${baseId}.${remappedPath}`;
        // Rolle: outputs.*.State → switch (schreibbar), outputs.*.Status → indicator, sonstige
        // WRITABLE_DEVICE_FIELDS-Felder → level (strukturell, unabhängig vom Toggle-Zustand -
        // konsistent zur alten CONTROL_REGISTERS-Konvention "write:true → role:level").
        let stateRole = this.getRole(remappedPath);
        if (isOutputBool) {
            stateRole = outputBoolSub[1] === 'State' ? 'switch' : 'indicator';
        } else if (writableChannel) {
            stateRole = 'level';
        }
        const commonBase: ioBroker.StateCommon = {
            name: this.getFriendlyName(remappedPath),
            type: storeType,
            role: stateRole,
            unit: this.getUnit(remappedPath),
            read: true,
            write: isWritable,
        };

        // States-Definitionen für Dropdowns
        if (deviceType === 'pvinverter' && remappedPath === 'StatusCode') {
            (commonBase as any).states = PVINVERTER_STATUS;
        }
        const statesForPath = STATES_MAP[deviceType]?.[remappedPath];
        if (statesForPath) {
            (commonBase as any).states = statesForPath;
        }

        // Tank: Capacity und Remaining in m³, nicht Ah
        if (deviceType === 'tank' && (remappedPath === 'Capacity' || remappedPath === 'Remaining')) {
            commonBase.unit = 'm³';
        }

        // Temperature (dbus-adc): Status als indicator.status statt generischem "value" - lokal
        // auf 'temperature' begrenzt, damit tank.Status (nutzt denselben Pfadnamen) unverändert
        // bleibt.
        if (deviceType === 'temperature' && remappedPath === 'Status') {
            commonBase.role = 'indicator.status';
        }
        // Offset/Scale/FilterLength sind laut dbus-adc Kalibrierungsparameter (siehe
        // github.com/victronenergy/dbus-adc) - Rolle "level", ab 0.10.0 schreibbar über
        // WRITABLE_DEVICE_FIELDS + writeDeviceMqtt() (Generic MQTT-Write-Path, siehe onStateChange()).
        if (
            deviceType === 'temperature' &&
            (remappedPath === 'Offset' || remappedPath === 'Scale' || remappedPath === 'FilterLength')
        ) {
            commonBase.role = 'level';
        }
        if (deviceType === 'temperature' && remappedPath === 'Offset') {
            commonBase.unit = '°C';
        }
        if (deviceType === 'temperature' && remappedPath === 'RawValue') {
            commonBase.role = 'value.voltage';
            commonBase.unit = 'V';
        }
        if (deviceType === 'temperature' && remappedPath === 'RawUnit') {
            commonBase.role = 'text';
        }
        if (remappedPath === 'Mgmt.ProcessVersion') {
            // Nur ein reiner String-State - Pfad ist projektweit einmalig (kein Kollisionsrisiko
            // mit anderen Typen), daher nicht type-gegated.
            commonBase.role = 'text';
        }

        // EV Charger (S3): Status als indicator.status, MaxCurrent als Grenzwert statt simpler
        // Momentanwert, FirmwareVersion als Text (String-Wert, kein "value").
        if (deviceType === 'evcharger' && remappedPath === 'Status') {
            commonBase.role = 'indicator.status';
        }
        if (deviceType === 'evcharger' && remappedPath === 'MaxCurrent') {
            commonBase.role = 'level.current';
        }
        if (deviceType === 'evcharger' && remappedPath === 'FirmwareVersion') {
            commonBase.role = 'text';
        }
        // SetCurrent-Grenzen (min=6A/step=1A laut Victron-EVCS-Spezifikation) - max wird dynamisch
        // aus dem MaxCurrent-Datenpunkt nachgezogen (siehe unten, "MaxCurrent ist das Hardware-Limit").
        if (deviceType === 'evcharger' && remappedPath === 'SetCurrent') {
            commonBase.role = 'level.current';
            (commonBase as any).min = 6;
            (commonBase as any).step = 1;
        }

        if (!this.createdStates.has(stateId)) {
            // Async Setup-Pfad: nur beim ersten Mal
            this.createdStates.add(stateId);
            this.lastValueCache.set(stateId, storeValue);
            // Topic Map aktualisieren
            if (device && deviceKey) {
                this.updateTopicMap(deviceKey, normPath, stateId, device);
            }
            void this.ensureIntermediates(stateId);
            // setState MUSS auf die Objekt-Anlage warten (.then() statt paralleles void/void) -
            // sonst kann setState() beim allerersten Wert eines States gewinnen, bevor
            // extendObjectAsync() das Objekt angelegt hat ("has no existing object"-Warnung,
            // v0.9.3-Regression-Fix). createdStates wird trotzdem synchron VOR dem await markiert,
            // damit ein zweiter, synchron nachfolgender Aufruf für denselben stateId (Burst) sofort
            // in den else-Zweig läuft statt das Objekt doppelt anzulegen - der wartet dann über
            // pendingObjectCreation auf GENAU diese Anlage statt selbst sofort zu schreiben.
            const creation = this.extendObjectAsync(stateId, { type: 'state', common: commonBase, native: {} }).then(
                () => {
                    this.pendingObjectCreation.delete(stateId);
                    void this.setState(stateId, { val: storeValue, ack: true });
                },
            );
            this.pendingObjectCreation.set(stateId, creation);
        } else {
            // Bekannter State: nur setState wenn Wert sich geändert hat
            const lastVal = this.lastValueCache.get(stateId);
            if (lastVal !== storeValue) {
                this.lastValueCache.set(stateId, storeValue);
                const pending = this.pendingObjectCreation.get(stateId);
                if (pending) {
                    void pending.then(() => void this.setState(stateId, { val: storeValue, ack: true }));
                } else {
                    void this.setState(stateId, { val: storeValue, ack: true });
                }
            }
        }
        // Zellwerte im RAM cachen für schnelle Min/Max-Berechnung
        if (deviceType === 'battery' && CELL_PATH_RE.test(remappedPath) && typeof storeValue === 'number') {
            this.cellValueCache.set(stateId, storeValue);
        }
        // Power-Werte cachen - nur overview.* und *.Power für Overview/ActivePhase
        if (typeof storeValue === 'number' && stateId.endsWith('.Power')) {
            this.powerValueCache.set(stateId, storeValue);
        }
        if (typeof storeValue === 'number' && stateId.startsWith('overview.')) {
            this.powerValueCache.set(stateId, storeValue);
        }

        // MaxCurrent ist das Hardware-Limit des Ladegeräts - devices.evcharger.<serial>.SetCurrent.max
        // wird dynamisch nachgezogen, sobald der Wert bekannt ist. Kein separater control.*-Alias
        // mehr nötig ab 0.10.0 (SetCurrent trägt sein eigenes common.write direkt, siehe oben) -
        // MaxCurrent und SetCurrent teilen sich dieselbe baseId (gleiche Serial), daher reicht ein
        // direkter extendObjectAsync auf `${baseId}.SetCurrent`.
        if (device && deviceType === 'evcharger' && remappedPath === 'MaxCurrent' && typeof storeValue === 'number') {
            const setCurrentStateId = `${baseId}.SetCurrent`;
            if (this.createdStates.has(setCurrentStateId)) {
                void this.extendObjectAsync(setCurrentStateId, { common: { max: storeValue } });
            }
        }

        return storeValue;
    }

    /**
     * S13: Puffert den Rohwert eines noch nicht committeten Output-Kanals (Key "serial|outputKey").
     * Wird aufgerufen, solange der Kanal noch nicht in outputToInstance registriert ist - siehe
     * handleMessage(). Group-Werte lösen einen sofortigen Commit aus (früher Ausstieg aus der
     * Ruhezeit, sobald device.group bekannt ist); alle anderen Subs starten - falls noch keiner
     * läuft - einen Fallback-Timer, der nach PENDING_QUIET_MS ohne Group committed.
     *
     * @param serial Geräte-Serial (Map-Key-Präfix)
     * @param out Ergebnis von remapOutputPath() für den aktuellen Wert
     * @param out.key Normierter Output-Key (z.B. "1")
     * @param out.mqttKey Original-MQTT-Segmentname (z.B. "output_1")
     * @param out.sub Sub-Pfad-Segment (z.B. "State", "CustomName", "Group")
     * @param deviceType Victron-Gerätetyp (z.B. "switch", "acload", "system")
     * @param instance MQTT-Device-Instance
     * @param device Geräte-Metadaten (für Group-/CustomName-Handling)
     * @param rawValue Roh-MQTT-Wert, wird unverändert gepuffert
     */
    private bufferPendingOutput(
        serial: string,
        out: { key: string; mqttKey: string; sub: string },
        deviceType: string,
        instance: number,
        device: DeviceInfo | undefined,
        rawValue: unknown,
    ): void {
        const pendingKey = `${serial}|${out.key}`;
        let pending = this.pendingOutputs.get(pendingKey);
        if (!pending) {
            pending = {
                serial,
                outputKey: out.key,
                mqttKey: out.mqttKey,
                deviceType,
                instance,
                device,
                values: new Map(),
                timer: null,
            };
            this.pendingOutputs.set(pendingKey, pending);
        }
        pending.values.set(out.sub, rawValue);

        if (out.sub === 'Group' && typeof rawValue === 'string' && rawValue && device && !device.group) {
            // Erste Group "gewinnt" (siehe getBaseId/§4.11) - sofortiger Commit, sobald die
            // BaseId feststeht, statt auf die Ruhezeit zu warten.
            device.group = rawValue;
            void this.commitPendingOutput(pending);
            return;
        }

        if (!pending.timer) {
            pending.timer = this.setTimeout(() => {
                pending.timer = null;
                void this.commitPendingOutput(pending);
            }, this.PENDING_QUIET_MS);
        }
    }

    /**
     * S13: Committed einen gepufferten Output-Kanal - BaseId wird JETZT berechnet, wenn
     * device.group entweder gesetzt (Group kam an) oder bewusst leer ist (Ruhezeit abgelaufen).
     * Registriert outputToInstance, legt den outputs.<key>-Kanal an und schreibt alle gepufferten
     * Werte über writeStateValue(). armCleanupTimer() läuft erst danach, sonst würde der Sweep
     * diesen gerade committeten Kanal fälschlich als verwaist einstufen.
     *
     * @param pending Der zu committende Eintrag aus pendingOutputs
     */
    private async commitPendingOutput(pending: PendingOutput): Promise<void> {
        const pendingKey = `${pending.serial}|${pending.outputKey}`;
        if (pending.timer) {
            this.clearTimeout(pending.timer);
            pending.timer = null;
        }
        this.pendingOutputs.delete(pendingKey);

        const device = pending.device;
        const baseId = this.getBaseId(pending.deviceType, pending.instance, pending.serial, device, true);
        if (!baseId) {
            return;
        }

        let keyMap = this.outputToInstance.get(pending.serial);
        if (!keyMap) {
            keyMap = new Map();
            this.outputToInstance.set(pending.serial, keyMap);
        }
        keyMap.set(pending.outputKey, { instance: pending.instance, mqttKey: pending.mqttKey });

        // Muss awaited werden, BEVOR writeStateValue()/ensureIntermediates() für die gepufferten
        // Werte laufen (siehe unten): ensureIntermediates() legt denselben outputs.<key>-Pfad als
        // generisches type:'folder'-Zwischensegment an, wenn es noch nicht existiert. Ohne Await
        // liefen beide setObjectNotExistsAsync-Aufrufe unkoordiniert gegeneinander (type:'channel'
        // hier vs. type:'folder' dort) - je nach I/O-Timing gewann mal der eine, mal der andere,
        // und in manchen Fällen blieb das Objekt mit undefined type zurück (js-controller-Warnung
        // "obj.type has to exist"). Ein type-loses oder falsch typisiertes outputs.<key>-Objekt
        // fiel dann durch den type==='channel'-Filter von runOrphanSweep() und wurde nie als
        // verwaist erkannt - das war der eigentliche "Sweep-Bug" (nicht die Pfad-Matching-Logik
        // selbst, siehe dortiger Kommentar).
        await this.setObjectNotExistsAsync(`${baseId}.outputs.${pending.outputKey}`, {
            type: 'channel',
            common: { name: `Output ${pending.outputKey}` },
            native: {},
        });

        const customName = pending.values.get('CustomName');
        if (typeof customName === 'string' && customName && device) {
            void this.extendObjectAsync(`${baseId}.outputs.${pending.outputKey}`, {
                common: { name: `${device.productName} — ${customName}` },
            });
        }

        if (device) {
            void this.ensureChannel(baseId, device);
            this.touchDevice(device, baseId);
        }

        const deviceKey = `${pending.deviceType}/${pending.instance}`;
        for (const [sub, rawValue] of pending.values.entries()) {
            const remappedPath = `outputs.${pending.outputKey}.${sub}`;
            const normPath = `SwitchableOutput.${pending.mqttKey}.${sub}`;
            this.writeStateValue(baseId, device, deviceKey, pending.deviceType, normPath, remappedPath, rawValue);
        }

        // Neuer Output-Kanal committed: Auto-Cleanup-Ruhezeit zurücksetzen (§10.4/10.5). No-Op,
        // solange cleanupEnabled=false oder der Sweep schon einmal lief.
        this.armCleanupTimer();
    }

    /**
     * S14: Puffert eine Rohmessage (topic+payload) für ein Gerät, dessen BaseId noch nicht
     * feststeht (device.group-Race, siehe DEVICE_GROUP_RACE_TYPES). Anders als bufferPendingOutput
     * (S13, pro Output-Kanal) puffert dies GESAMTE Messages auf Device-Ebene, damit auch
     * Nicht-Output-Pfade (z.B. Ac.L1.Voltage) nicht mit einer potenziell falschen (gruppenlosen)
     * BaseId verarbeitet werden. Eine Group-Message löst einen sofortigen Commit aus; alle anderen
     * Messages starten - falls noch keiner läuft - einen Fallback-Timer (DEVICE_QUIET_MS).
     *
     * @param device Geräte-Metadaten (Ziel für baseIdCommitted/group/pendingDeviceMessages)
     * @param topic Ursprünglicher MQTT-Topic (für den Replay in commitDevice())
     * @param payload Ursprüngliches MQTT-Payload (für den Replay in commitDevice())
     * @param out Ergebnis von remapOutputPath() für den aktuellen Wert, null falls kein Output-Pfad
     * @param rawValue Roh-MQTT-Wert der aktuellen Message (nur zur Group-Erkennung ausgewertet)
     */
    private bufferDeviceMessage(
        device: DeviceInfo,
        topic: string,
        payload: Buffer,
        out: { key: string; mqttKey: string; sub: string } | null,
        rawValue: unknown,
    ): void {
        device.pendingDeviceMessages.push({ topic, payload });

        if (out?.sub === 'Group' && typeof rawValue === 'string' && rawValue && !device.group) {
            // Erste Group "gewinnt" (siehe getBaseId/§4.11) - sofortiger Commit, sobald die
            // BaseId feststeht, statt auf die Ruhezeit zu warten.
            device.group = rawValue;
            this.commitDevice(device);
            return;
        }

        if (!device.deviceCommitTimer) {
            device.deviceCommitTimer = this.setTimeout(() => {
                device.deviceCommitTimer = null;
                this.commitDevice(device);
            }, this.DEVICE_QUIET_MS);
        }
    }

    /**
     * S14: Committed ein gepuffertes Gerät - device.group ist JETZT entweder gesetzt (Group kam
     * an) oder bewusst leer (Ruhezeit abgelaufen). Alle gepufferten Rohmessages werden in
     * ursprünglicher Reihenfolge erneut durch handleMessage() geschickt ("derselbe Handler-Code"),
     * diesmal mit baseIdCommitted=true, also über den unveränderten S13/Alt-Pfad. Die
     * Group-Setter-Message selbst ist im Puffer enthalten und wird mitreplayed - das erneute Setzen
     * von device.group ist dank !device.group-Guard idempotent.
     *
     * @param device Der zu committende Geräte-Eintrag
     */
    private commitDevice(device: DeviceInfo): void {
        if (device.deviceCommitTimer) {
            this.clearTimeout(device.deviceCommitTimer);
            device.deviceCommitTimer = null;
        }
        device.baseIdCommitted = true;

        const messages = device.pendingDeviceMessages;
        device.pendingDeviceMessages = [];
        for (const { topic, payload } of messages) {
            this.handleMessage(topic, payload);
        }

        // S14-Fix: Erst NACH dem Replay loggen - device.serial wird selbst erst durch die
        // gepufferte Serial-Message im Replay gesetzt (siehe getOrCreateDeviceEntry()/S14-Fix-Gate
        // in handleMessage()), ist also vor diesem Zeitpunkt noch leer. Dient als Nachvollzieh-
        // barkeits-Marker für den Praxistest (§ Testkriterium): erscheint erst, wenn die BaseId
        // endgültig feststeht und alle zugehörigen Objekte angelegt sind.
        //
        // S15-Fix: Für acload/switch traf in der Praxis die Group-Message manchmal VOR der
        // Serial-Message ein (GX publiziert nicht in fester Reihenfolge) - dann löste die
        // Group-Message bereits den sofortigen Commit aus (siehe bufferDeviceMessage()), bevor
        // die Serial überhaupt im Puffer lag. device.serial war an dieser Stelle dann noch leer,
        // obwohl der Sweep später über outputToInstance() trotzdem korrekt lief. Statt "serial: ?"
        // zu loggen, wird der Log-Eintrag zurückgestellt und erst nachgeholt, sobald
        // updateDeviceMeta() die Serial tatsächlich setzt.
        if (device.serial) {
            this.log.info(
                `Device committed: ${KNOWN_DEVICE_TYPES[device.type] || device.type} → serial: ${
                    device.serial
                } group=${device.group || '(none)'}`,
            );
        } else {
            device.pendingCommitLog = true;
        }
    }

    // ── Gesamtleistung overview berechnen ───────────────────────────────────
    private updateOverviewTotalPower(triggeredPath: string): void {
        const entry = OVERVIEW_TOTAL_POWER[triggeredPath];
        if (!entry) {
            return;
        }
        let total = 0;
        for (const src of entry.sources) {
            const v = this.powerValueCache.get(`overview.${src}`);
            if (v !== undefined) {
                total += v;
            }
        }
        const stateId = `overview.${entry.target}`;
        const writeTotal = (): void => {
            void this.setState(stateId, { val: Math.round(total), ack: true });
        };
        if (!this.createdStates.has(stateId)) {
            this.createdStates.add(stateId);
            // setState erst NACH Objekt-Anlage (.then()) - siehe writeStateValue()-Fix, gleiche
            // Race-Klasse. pendingObjectCreation fängt zusätzlich den Fall ab, dass ein zweiter
            // Trigger (anderer Source-Pfad, gleiches Ziel) eintrifft, während diese Anlage noch
            // läuft - mehrere OVERVIEW_TOTAL_POWER-Quellen können im selben Burst dasselbe target
            // treffen.
            const creation = this.extendObjectAsync(stateId, {
                type: 'state',
                common: {
                    name: this.getFriendlyName(entry.target),
                    type: 'number',
                    role: 'value.power',
                    unit: 'W',
                    read: true,
                    write: false,
                },
                native: {},
            }).then(() => {
                this.pendingObjectCreation.delete(stateId);
                writeTotal();
            });
            this.pendingObjectCreation.set(stateId, creation);
        } else {
            const pending = this.pendingObjectCreation.get(stateId);
            if (pending) {
                void pending.then(writeTotal);
            } else {
                writeTotal();
            }
        }
    }

    // ── Settings MQTT → control.system.* ────────────────────────────────────
    private async handleSettingsMqttUpdate(normPath: string, parsed: any): Promise<void> {
        const rawValue = 'value' in parsed ? parsed.value : null;
        if (rawValue === null || rawValue === undefined) {
            return;
        }
        const dpId = ESS_MQTT_MAP[normPath];
        if (!dpId) {
            return;
        }
        // control.<dpId> wird von initControlDatapoints() angelegt (sequentielle Modbus-Discovery,
        // kann mehrere Sekunden dauern) - vor Abschluss verwerfen statt racy setState() auf ein noch
        // nicht existierendes Objekt ("has no existing object", v0.9.3-Fix). Kein Datenverlust:
        // initControlDatapoints() schreibt selbst den initialen Wert per Modbus-Read, und der GX
        // republished Settings-Werte ohnehin bei jeder Änderung/Keepalive erneut.
        if (!this.createdStates.has(`control.${dpId}`)) {
            return;
        }
        const val = typeof rawValue === 'number' ? rawValue : parseFloat(rawValue);
        try {
            await this.setState(`control.${dpId}`, { val, ack: true });
            this.log.debug(`control.${dpId} = ${val} (MQTT ${normPath})`);
        } catch {
            /* Datenpunkt noch nicht angelegt */
        }
    }

    // ── baseId berechnen ─────────────────────────────────────────────────────
    // isOutputPath: true, wenn der Aufrufer einen SwitchableOutput-Pfad auflöst. Steuert das
    // Routing für type==='system': Messwerte/Systemübersicht bleiben unter 'overview' (read-only),
    // Schaltausgänge (z.B. GX internal relay) landen unter devices.system.<Serial> (schreibbar).
    // Group ist ab hier ein optionaler Zwischenordner, einheitlich für alle Typen; Serial ist
    // Pflicht (außer für system ohne Output-Pfad, das weiterhin nach 'overview' mappt). Aufrufer
    // ohne isOutputPath-Argument (Default false) verhalten sich unverändert zum Vorzustand.
    private getBaseId(
        type: string,
        instance: number,
        serial: string | undefined,
        device: DeviceInfo | undefined,
        isOutputPath: boolean = false,
    ): string | null {
        if (type === 'system' && !isOutputPath) {
            return 'overview';
        }
        if (!serial) {
            return null;
        }
        if (device?.group) {
            const groupKey = device.group.replace(/[^a-zA-Z0-9_]/g, '_');
            return `devices.${type}.${groupKey}.${serial}`;
        }
        return `devices.${type}.${serial}`;
    }

    /**
     * S14-Fix: Legt bei Bedarf den In-Memory-DeviceInfo-Eintrag an - erzeugt bewusst KEIN
     * ioBroker-Objekt und schreibt KEIN Log, damit dies gefahrlos auch aus dem Race-Gate in
     * handleMessage() aufgerufen werden kann, bevor überhaupt feststeht, ob die BaseId schon
     * committed ist. Für DEVICE_GROUP_RACE_TYPES startet der Eintrag mit baseIdCommitted=false
     * (siehe bufferDeviceMessage()/commitDevice()), alle anderen Typen bleiben unverändert sofort
     * "committed".
     *
     * @param deviceKey Interner Schlüssel "<type>/<instance>"
     * @param type Victron-Gerätetyp
     * @param instance Geräte-Instanznummer aus dem MQTT-Topic
     * @returns Der (neue oder bereits vorhandene) DeviceInfo-Eintrag
     */
    private getOrCreateDeviceEntry(deviceKey: string, type: string, instance: number): DeviceInfo {
        let device = this.deviceMap.get(deviceKey);
        if (!device) {
            device = {
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
                ready: NO_SERIAL_TYPES_REGISTER.has(type), // system/platform sofort ready
                // S14: nur DEVICE_GROUP_RACE_TYPES puffern - alle anderen Typen starten committed,
                // also 1:1 heutiges Verhalten (kein Puffern, keine Wartezeit).
                baseIdCommitted: !DEVICE_GROUP_RACE_TYPES.has(type),
                pendingDeviceMessages: [],
                deviceCommitTimer: null,
            };
            this.deviceMap.set(deviceKey, device);
        }
        return device;
    }

    /**
     * Setzt Serial + ready=true auf dem Gerät und stößt die üblichen Begleiteffekte an (Logging,
     * S15-pendingCommitLog-Nachholung, Löschen des alten instance-basierten Kanals). Gemeinsam
     * genutzt vom regulären case 'Serial' (echte Victron-Serial) und von derivePseudoSerial()
     * (synthetische Serial für dbus-adc, siehe dort) - beide Wege müssen device.ready identisch
     * scharfschalten, sonst entstehen zwei unterschiedlich robuste Ready-Pfade.
     *
     * @param device Geräte-Metadaten
     * @param deviceKey Interner Schlüssel "<type>/<instance>"
     * @param type Victron-Gerätetyp
     * @param instance Geräte-Instanznummer aus dem MQTT-Topic
     * @param rawSerial Serial (echt oder synthetisch), wird ioBroker-Objekt-ID-safe bereinigt
     */
    private commitSerial(
        device: DeviceInfo,
        deviceKey: string,
        type: string,
        instance: number,
        rawSerial: string,
    ): void {
        const safeSerial = rawSerial.replace(/[^a-zA-Z0-9_-]/g, '_');
        device.serial = safeSerial;
        device.ready = true;
        this.serialMap.set(deviceKey, safeSerial);
        const k = `serial:${deviceKey}`;
        if (!this.loggedDevices.has(k)) {
            this.loggedDevices.add(k);
            this.log.info(`Device detected: ${KNOWN_DEVICE_TYPES[type] || type} → serial: ${safeSerial}`);
        }
        // S15-Fix: siehe commitDevice() - Log war beim Commit zurückgestellt, weil die
        // Serial dort noch unbekannt war. Jetzt nachholen, wo sie feststeht.
        if (device.pendingCommitLog) {
            device.pendingCommitLog = false;
            this.log.info(
                `Device committed: ${KNOWN_DEVICE_TYPES[type] || type} → serial: ${safeSerial} group=${
                    device.group || '(none)'
                }`,
            );
        }
        const oldId = `devices.${type}.${instance}`;
        const newId = `devices.${type}.${safeSerial}`;
        const deleteKey = `deleted:${oldId}`;
        if (type !== 'system' && oldId !== newId && !this.loggedDevices.has(deleteKey)) {
            this.loggedDevices.add(deleteKey);
            void this.delObjectAsync(oldId, { recursive: true })
                .then(() => this.log.debug(`Old channel deleted: ${oldId}`))
                .catch(() => {});
        }
    }

    /**
     * Legt bei Bedarf einen einfachen, nicht-schreibbaren Info-State an (Muster wie die
     * bestehenden Position/NrOfPhases-Handler in updateDeviceMeta()) - genutzt von
     * Mgmt.Connection/Mgmt.ProcessName (siehe MGMT_STATE_TYPES).
     *
     * @param baseId Basis-Objekt-ID des Geräts (z.B. "devices.temperature.adc-20")
     * @param subPath State-Unterpfad relativ zu baseId (z.B. "mgmt.connection")
     * @param name Übersetzter State-Name (alle 11 Sprachen)
     * @param type ioBroker common.type des States
     * @param role ioBroker common.role des States
     * @param value Zu schreibender Wert
     */
    private ensureRegistrationState(
        baseId: string,
        subPath: string,
        name: ioBroker.StringOrTranslated,
        type: 'string' | 'number',
        role: string,
        value: string | number,
    ): void {
        const stateId = `${baseId}.${subPath}`;
        if (!this.createdStates.has(stateId)) {
            void this.setObjectNotExistsAsync(stateId, {
                type: 'state',
                common: { name, type, role, read: true, write: false },
                native: {},
            }).then(() => {
                this.createdStates.add(stateId);
                void this.setState(stateId, { val: value, ack: true });
            });
        } else {
            void this.setState(stateId, { val: value, ack: true });
        }
    }

    // ── Metadaten sammeln ────────────────────────────────────────────────────
    private updateDeviceMeta(type: string, instance: number, field: string, value: string): void {
        const deviceKey = `${type}/${instance}`;
        const device = this.getOrCreateDeviceEntry(deviceKey, type, instance);
        switch (field) {
            case 'Serial':
            case 'Devices.0.SerialNumber': {
                this.commitSerial(device, deviceKey, type, instance, String(value));
                break;
            }
            case 'ProductName': {
                device.productName = value;
                device.virtual = value.toLowerCase().includes('virtual');
                if (device.virtual) {
                    device.ready = true;
                    const k = `virtual:${deviceKey}`;
                    if (!this.loggedDevices.has(k)) {
                        this.loggedDevices.add(k);
                        this.log.info(`Virtual device: ${type}/${instance} → "${value}"`);
                    }
                    const deleteKey = `deleted:devices.${type}.${instance}`;
                    if (type !== 'system' && !this.loggedDevices.has(deleteKey)) {
                        this.loggedDevices.add(deleteKey);
                        void this.delObjectAsync(`devices.${type}.${instance}`, { recursive: true }).catch(() => {});
                    }
                }
                break;
            }
            case 'CustomName': {
                if (device.customName !== value) {
                    device.customName = value;
                    if (device.ready) {
                        const cnBaseId = this.getBaseId(type, instance, device.serial || undefined, device);
                        if (cnBaseId) {
                            void this.ensureChannel(cnBaseId, device);
                        }
                    }
                }
                break;
            }
            case 'Connected': {
                if (!device.ready) {
                    break;
                }
                const baseId = this.getBaseId(type, instance, device.serial || undefined, device);
                if (baseId) {
                    const connected = value === '1' || value === 'true';
                    const connId2 = `${baseId}.info.connected`;
                    if (!this.createdStates.has(connId2)) {
                        void this.setObjectNotExistsAsync(connId2, {
                            type: 'state',
                            common: {
                                name: {
                                    en: 'Connected',
                                    de: 'Verbunden',
                                    ru: 'Connected',
                                    pt: 'Connected',
                                    nl: 'Connected',
                                    fr: 'Connected',
                                    it: 'Connected',
                                    es: 'Connected',
                                    pl: 'Connected',
                                    uk: 'Connected',
                                    'zh-cn': 'Connected',
                                },
                                type: 'boolean',
                                role: 'indicator.connected',
                                read: true,
                                write: false,
                            },
                            native: {},
                        }).then(() => {
                            this.createdStates.add(connId2);
                            void this.setState(connId2, { val: connected, ack: true });
                        });
                    } else {
                        void this.setState(connId2, { val: connected, ack: true });
                    }
                }
                break;
            }
            case 'Mgmt.Connection':
                if (value === 'Node-RED') {
                    device.source = 'node-red';
                    const k = `nodered:${deviceKey}`;
                    if (!this.loggedDevices.has(k)) {
                        this.loggedDevices.add(k);
                        this.log.info(`Node-RED device: ${type}/${instance}`);
                    }
                }
                // Sichtbarer mgmt.connection-State - siehe MGMT_STATE_TYPES.
                if (MGMT_STATE_TYPES.has(type) && device.ready) {
                    const mgmtBaseId = this.getBaseId(type, instance, device.serial || undefined, device);
                    if (mgmtBaseId) {
                        this.ensureRegistrationState(
                            mgmtBaseId,
                            'mgmt.connection',
                            MGMT_CONNECTION_NAME,
                            'string',
                            'text',
                            value,
                        );
                    }
                }
                break;
            case 'Mgmt.ProcessName': {
                if (value === 'dbus-victron-virtual') {
                    device.virtual = true;
                }
                // dbus-adc (Generic Temperature Input) liefert nie eine Serial - siehe
                // derivePseudoSerial(). Nur einmal committen (!device.serial), damit wiederholte
                // Mgmt.ProcessName-Messages (Keepalive-Replay alle 50s) nicht erneut ins Log/den
                // Objekt-Lösch-Pfad von commitSerial() laufen.
                const pseudoSerial = derivePseudoSerial(type, value, instance);
                if (pseudoSerial && !device.serial) {
                    this.commitSerial(device, deviceKey, type, instance, pseudoSerial);
                }
                if (MGMT_STATE_TYPES.has(type) && device.ready) {
                    const mgmtBaseId = this.getBaseId(type, instance, device.serial || undefined, device);
                    if (mgmtBaseId) {
                        this.ensureRegistrationState(
                            mgmtBaseId,
                            'mgmt.processName',
                            MGMT_PROCESSNAME_NAME,
                            'string',
                            'text',
                            value,
                        );
                    }
                }
                break;
            }
            case 'Position': {
                if (!device.ready) {
                    break;
                }
                const baseId = this.getBaseId(type, instance, device.serial || undefined, device);
                if (baseId) {
                    const posStateId = `${baseId}.info.position`;
                    // evcharger.Position hat eine andere Bedeutung als das generische AC-Position-
                    // Enum unten (grid/pvinverter/acload: Lage relativ zum MultiPlus) - Victron
                    // dokumentiert für com.victronenergy.evcharger nur 0=AC output/1=AC input,
                    // ohne "(behind MultiPlus)"/"(Grid)"-Zusatz.
                    const positionStates: Record<number, string> =
                        type === 'evcharger'
                            ? { 0: 'AC Output', 1: 'AC Input' }
                            : { 0: 'AC Output (behind MultiPlus)', 1: 'AC Input (Grid)', 2: 'AC Input 2' };
                    if (!this.createdStates.has(posStateId)) {
                        void this.setObjectNotExistsAsync(posStateId, {
                            type: 'state',
                            common: {
                                name: {
                                    en: 'Position',
                                    de: 'Position',
                                    ru: 'Position',
                                    pt: 'Position',
                                    nl: 'Position',
                                    fr: 'Position',
                                    it: 'Position',
                                    es: 'Position',
                                    pl: 'Position',
                                    uk: 'Position',
                                    'zh-cn': 'Position',
                                },
                                type: 'number',
                                role: 'value',
                                states: positionStates,
                                read: true,
                                write: false,
                            },
                            native: {},
                        }).then(() => {
                            this.createdStates.add(posStateId);
                            void this.setState(posStateId, { val: parseInt(value, 10), ack: true });
                        });
                    } else {
                        void this.setState(posStateId, { val: parseInt(value, 10), ack: true });
                    }
                }
                break;
            }
            case 'NrOfPhases': {
                if (!device.ready) {
                    break;
                }
                const baseId = this.getBaseId(type, instance, device.serial || undefined, device);
                if (baseId) {
                    const phasesStateId = `${baseId}.info.nrOfPhases`;
                    if (!this.createdStates.has(phasesStateId)) {
                        void this.setObjectNotExistsAsync(phasesStateId, {
                            type: 'state',
                            common: {
                                name: {
                                    en: 'Number of phases',
                                    de: 'Anzahl Phasen',
                                    ru: 'Number of phases',
                                    pt: 'Number of phases',
                                    nl: 'Number of phases',
                                    fr: 'Number of phases',
                                    it: 'Number of phases',
                                    es: 'Number of phases',
                                    pl: 'Number of phases',
                                    uk: 'Number of phases',
                                    'zh-cn': 'Number of phases',
                                },
                                type: 'number',
                                role: 'value',
                                read: true,
                                write: false,
                            },
                            native: {},
                        }).then(() => {
                            this.createdStates.add(phasesStateId);
                            void this.setState(phasesStateId, { val: parseInt(value, 10), ack: true });
                        });
                    } else {
                        void this.setState(phasesStateId, { val: parseInt(value, 10), ack: true });
                    }
                }
                break;
            }
        }
    }

    // ── Intermediate-Objekte sicherstellen ───────────────────────────────────
    private async ensureIntermediates(stateId: string): Promise<void> {
        // stateId z.B. "devices.battery.ABC.Dc.0.Voltage"
        // Alle Segmente bis auf das letzte müssen als folder/channel existieren
        const parts = stateId.split('.');
        for (let i = 1; i < parts.length - 1; i++) {
            const intermId = parts.slice(0, i + 1).join('.');
            if (!this.createdStates.has(`__folder_${intermId}`)) {
                try {
                    const seg = parts[i];
                    await this.setObjectNotExistsAsync(intermId, {
                        type: 'folder',
                        common: {
                            name: {
                                en: seg,
                                de: seg,
                                ru: seg,
                                pt: seg,
                                nl: seg,
                                fr: seg,
                                it: seg,
                                es: seg,
                                pl: seg,
                                uk: seg,
                                'zh-cn': seg,
                            },
                        },
                        native: {},
                    });
                } catch {
                    /* existiert bereits */
                }
                this.createdStates.add(`__folder_${intermId}`);
            }
        }
    }

    // ── Channel anlegen ──────────────────────────────────────────────────────
    private async ensureChannel(baseId: string, device: DeviceInfo): Promise<void> {
        // Nicht anlegen bevor Gerät vollständig erkannt (Serial bekannt)
        if (!device.ready) {
            return;
        }

        const label = device.customName || device.productName || device.type;

        if (this.channelReady.has(baseId)) {
            // Channel-Namen immer aktualisieren (CustomName kann später kommen)
            await this.extendObjectAsync(baseId, {
                common: { name: label },
                native: { virtual: device.virtual },
            });
            return;
        }

        // Intermediate: devices.<type> folder
        const typeFolder = `devices.${device.type}`;
        const typeName = device.type;
        await this.setObjectNotExistsAsync(typeFolder, {
            type: 'folder',
            common: {
                name: {
                    en: typeName,
                    de: typeName,
                    ru: typeName,
                    pt: typeName,
                    nl: typeName,
                    fr: typeName,
                    it: typeName,
                    es: typeName,
                    pl: typeName,
                    uk: typeName,
                    'zh-cn': typeName,
                },
            },
            native: {},
        });

        await this.extendObjectAsync(baseId, {
            type: 'channel',
            common: { name: label },
            native: { virtual: device.virtual },
        });

        // Intermediate: info sub-channel
        await this.setObjectNotExistsAsync(`${baseId}.info`, {
            type: 'channel',
            common: {
                name: {
                    en: 'Info',
                    de: 'Info',
                    ru: 'Info',
                    pt: 'Info',
                    nl: 'Info',
                    fr: 'Info',
                    it: 'Info',
                    es: 'Info',
                    pl: 'Info',
                    uk: 'Info',
                    'zh-cn': 'Info',
                },
            },
            native: {},
        });

        await this.setObjectNotExistsAsync(`${baseId}.info.instanceId`, {
            type: 'state',
            common: {
                name: {
                    en: 'Instance ID',
                    de: 'Instanz ID',
                    ru: 'Instance ID',
                    pt: 'Instance ID',
                    nl: 'Instance ID',
                    fr: 'Instance ID',
                    it: 'Instance ID',
                    es: 'Instance ID',
                    pl: 'Instance ID',
                    uk: 'Instance ID',
                    'zh-cn': 'Instance ID',
                },
                type: 'number',
                role: 'value',
                read: true,
                write: false,
            },
            native: {},
        });
        await this.setState(`${baseId}.info.instanceId`, { val: device.instance, ack: true });

        await this.setObjectNotExistsAsync(`${baseId}.info.lastUpdate`, {
            type: 'state',
            common: {
                name: {
                    en: 'Last update',
                    de: 'Letztes Update',
                    ru: 'Last update',
                    pt: 'Last update',
                    nl: 'Last update',
                    fr: 'Last update',
                    it: 'Last update',
                    es: 'Last update',
                    pl: 'Last update',
                    uk: 'Last update',
                    'zh-cn': 'Last update',
                },
                type: 'number',
                role: 'date',
                read: true,
                write: false,
            },
            native: {},
        });
        await this.setObjectNotExistsAsync(`${baseId}.info.stale`, {
            type: 'state',
            common: {
                name: {
                    en: 'No data (stale)',
                    de: 'Keine Daten (stale)',
                    ru: 'No data (stale)',
                    pt: 'No data (stale)',
                    nl: 'No data (stale)',
                    fr: 'No data (stale)',
                    it: 'No data (stale)',
                    es: 'No data (stale)',
                    pl: 'No data (stale)',
                    uk: 'No data (stale)',
                    'zh-cn': 'No data (stale)',
                },
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: false,
            },
            native: {},
        });

        if (['grid', 'acload', 'pvinverter'].includes(device.type)) {
            await this.setObjectNotExistsAsync(`${baseId}.info.activePhase`, {
                type: 'state',
                common: {
                    name: {
                        en: 'Active phases',
                        de: 'Aktive Phasen',
                        ru: 'Active phases',
                        pt: 'Active phases',
                        nl: 'Active phases',
                        fr: 'Active phases',
                        it: 'Active phases',
                        es: 'Active phases',
                        pl: 'Active phases',
                        uk: 'Active phases',
                        'zh-cn': 'Active phases',
                    },
                    type: 'string',
                    role: 'text',
                    read: true,
                    write: false,
                },
                native: {},
            });
        }

        if (device.type === 'battery') {
            await this.setObjectNotExistsAsync(`${baseId}.State`, {
                type: 'state',
                common: {
                    name: {
                        en: 'Charge direction',
                        de: 'Laderichtung',
                        ru: 'Charge direction',
                        pt: 'Charge direction',
                        nl: 'Charge direction',
                        fr: 'Charge direction',
                        it: 'Charge direction',
                        es: 'Charge direction',
                        pl: 'Charge direction',
                        uk: 'Charge direction',
                        'zh-cn': 'Charge direction',
                    },
                    type: 'number',
                    role: 'value',
                    states: { 0: 'Idle', 1: 'Charging', 2: 'Discharging' },
                    read: true,
                    write: false,
                },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${baseId}.cells`, {
                type: 'channel',
                common: {
                    name: {
                        en: 'Cells',
                        de: 'Zellen',
                        ru: 'Cells',
                        pt: 'Cells',
                        nl: 'Cells',
                        fr: 'Cells',
                        it: 'Cells',
                        es: 'Cells',
                        pl: 'Cells',
                        uk: 'Cells',
                        'zh-cn': 'Cells',
                    },
                },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${baseId}.cells.min`, {
                type: 'state',
                common: {
                    name: {
                        en: 'Cell min',
                        de: 'Zelle Min',
                        ru: 'Cell min',
                        pt: 'Cell min',
                        nl: 'Cell min',
                        fr: 'Cell min',
                        it: 'Cell min',
                        es: 'Cell min',
                        pl: 'Cell min',
                        uk: 'Cell min',
                        'zh-cn': 'Cell min',
                    },
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
                    name: {
                        en: 'Cell max',
                        de: 'Zelle Max',
                        ru: 'Cell max',
                        pt: 'Cell max',
                        nl: 'Cell max',
                        fr: 'Cell max',
                        it: 'Cell max',
                        es: 'Cell max',
                        pl: 'Cell max',
                        uk: 'Cell max',
                        'zh-cn': 'Cell max',
                    },
                    type: 'number',
                    role: 'value.voltage',
                    unit: 'V',
                    read: true,
                    write: false,
                },
                native: {},
            });
        }

        this.channelReady.add(baseId);
        this.log.debug(`Channel created: ${baseId}`);
    }

    // ── Batterie Zell-Min/Max berechnen ──────────────────────────────────────
    private async updateBatteryCellMinMax(baseId: string): Promise<void> {
        // ensureChannel() legt .cells.min/.cells.max erst gegen Ende seiner sequentiellen
        // Objekt-Anlage an, setzt channelReady aber erst danach (siehe dort). Ein Batteriepack
        // feuert bis zu 32 Zellspannungs-Messages im selben Burst, jede triggert diese Funktion -
        // ohne dieses Gate gewinnt setState() auf einer realen (langsamen) Objects-DB reihenweise
        // gegen die noch laufende Objekt-Anlage ("has no existing object", v0.9.3-Fix). Verwerfen
        // statt warten: der nächste Zellwert im selben Burst triggert ohnehin sofort erneut.
        if (!this.channelReady.has(baseId)) {
            return;
        }
        // Zellwerte aus RAM-Cache lesen statt 32x getStateAsync
        const vals: number[] = [];
        for (let i = 1; i <= 32; i++) {
            const key = `${baseId}.cells.cell${String(i).padStart(2, '0')}`;
            const v = this.cellValueCache.get(key);
            if (v !== undefined && v > 0) {
                vals.push(v);
            }
        }
        if (vals.length === 0) {
            return;
        }
        await this.setState(`${baseId}.cells.min`, { val: Math.round(Math.min(...vals) * 1000) / 1000, ack: true });
        await this.setState(`${baseId}.cells.max`, { val: Math.round(Math.max(...vals) * 1000) / 1000, ack: true });
    }

    // ── Stale-Erkennung ──────────────────────────────────────────────────────
    private touchDevice(device: DeviceInfo, baseId: string): void {
        const now = Date.now();
        device.lastUpdate = now;
        if (device.staleTimer) {
            this.clearTimeout(device.staleTimer);
        }
        if (!this.channelReady.has(baseId) || baseId === 'overview') {
            return;
        }
        // lastUpdate nur alle 5 Sekunden schreiben (nicht bei jeder MQTT-Nachricht)
        if (!device.lastUpdateWritten || now - device.lastUpdateWritten > 5000) {
            device.lastUpdateWritten = now;
            void this.setState(`${baseId}.info.lastUpdate`, { val: now, ack: true });
        }
        // stale nur zurücksetzen wenn es vorher true war
        if (device.isStale) {
            device.isStale = false;
            void this.setState(`${baseId}.info.stale`, { val: false, ack: true });
        }
        device.staleTimer = this.setTimeout(() => {
            this.log.warn(`Device ${device.type}/${device.instance} no longer responding (stale)`);
            device.isStale = true;
            void this.setState(`${baseId}.info.stale`, { val: true, ack: true });
        }, STALE_TIMEOUT_MS);
    }

    // ── activePhase berechnen ────────────────────────────────────────────────
    private async updateActivePhase(_deviceType: string, baseId: string): Promise<void> {
        const active: string[] = [];
        for (const phase of ['L1', 'L2', 'L3']) {
            const v = this.powerValueCache.get(`${baseId}.Ac.${phase}.Power`);
            if (v !== undefined && v !== 0) {
                active.push(phase);
            }
        }
        const activePhase = active.length === 1 ? active[0] : active.length > 1 ? 'multi' : '';
        await this.setState(`${baseId}.info.activePhase`, { val: activePhase, ack: true });
    }

    // ── onStateChange: Schreibzugriffe ───────────────────────────────────────
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack) {
            return;
        }
        if (!this.mqttClient || !this.vrmId) {
            return;
        }

        const parts = id.split('.');
        if (parts.length < 5 || parts[2] !== 'devices') {
            return;
        }
        const deviceType = parts[3];

        // WRITABLE_DEVICE_FIELDS-Zweig (0.10.0 control-merge): devices.<type>.[<Group>.]<Serial>.<Feld>,
        // <Feld> kann mehrsegmentig sein (z.B. "Hub4.L1.AcPowerSetpoint") - da Feldnamen aus einer
        // festen Whitelist stammen, wird von hinten gematcht (Suffix-Vergleich) statt über feste
        // Segment-Indizes, damit der optionale Group-Zwischenordner nicht extra behandelt werden muss.
        const writableFields = WRITABLE_DEVICE_FIELDS[deviceType];
        if (writableFields) {
            const tail = parts.slice(4).join('.');
            const matchedField = Object.keys(writableFields).find(f => tail === f || tail.endsWith(`.${f}`));
            if (matchedField) {
                void this.dispatchWritableDeviceField(
                    id,
                    deviceType,
                    matchedField,
                    writableFields[matchedField],
                    state,
                );
                return;
            }
        }

        // Struktur: devices.<type>.[<Group>.]<Serial>.outputs.<key>.State - Group optional.
        if (!WRITABLE_TYPES.has(deviceType)) {
            return;
        }
        // Ab 0.10.0 an mqttControlEnabled gebunden (vorher unconditional writable) - zweite
        // Verteidigungslinie zusätzlich zu common.write=false auf dem Objekt (siehe writeStateValue()),
        // falls ein Skript per setForeignState(..., {ack:false}) am UI vorbei schreibt.
        if (!this.config.mqttControlEnabled) {
            this.log.warn('Switch/output write ignored: MQTT control not enabled (mqttControlEnabled)');
            return;
        }

        // "outputs"-Anker rückwärts suchen statt fester Segment-Indizes, weil der optionale
        // Group-Zwischenordner die Position von Serial/outputs verschiebt (§4.12).
        const outputsIdx = parts.indexOf('outputs', 5);
        if (outputsIdx === -1 || outputsIdx + 2 >= parts.length) {
            return;
        }
        const serial = parts[outputsIdx - 1];
        const outputKey = parts[outputsIdx + 1];
        const dpTail = parts.slice(outputsIdx + 2).join('/');
        if (!WRITABLE_OUTPUT_REGEX.test(`outputs.${outputKey}.${dpTail.replace(/\//g, '.')}`)) {
            return;
        }

        // Instance + Original-MQTT-Segmentname aus outputToInstance holen (Multi-Instance-Merging:
        // Shelly Pro3 hat drei DeviceInstances mit identischer Serial, serialMap-Rückwärtssuche
        // wäre hier mehrdeutig).
        const route = this.outputToInstance.get(serial)?.get(outputKey);
        if (!route) {
            this.log.warn(`Could not determine MQTT instance for ${id} (serial=${serial}, output=${outputKey})`);
            return;
        }

        const writeVal = state.val ? 1 : 0;
        this.writeDeviceMqtt(deviceType, route.instance, `SwitchableOutput/${route.mqttKey}/${dpTail}`, writeVal);
    }

    // Schreib-Dispatch für WRITABLE_DEVICE_FIELDS-Treffer (0.10.0 control-merge). Prüft Config-
    // Schalter UND common.write auf dem Objekt (zweite Verteidigungslinie, falls ein Skript per
    // setForeignState(..., {ack:false}) direkt schreibt statt über die Admin-UI/VIS).
    private async dispatchWritableDeviceField(
        id: string,
        deviceType: string,
        field: string,
        channel: 'mqtt' | 'modbus',
        state: ioBroker.State,
    ): Promise<void> {
        if (channel === 'modbus') {
            if (!this.config.modbusControlEnabled || !this.modbusClient) {
                this.log.warn(`${id}: Modbus control not enabled or not connected`);
                return;
            }
        } else if (!this.config.mqttControlEnabled) {
            this.log.warn(`${id}: MQTT device control not enabled (mqttControlEnabled)`);
            return;
        }
        const obj = await this.getObjectAsync(id);
        if (!obj?.common?.write) {
            this.log.warn(`${id}: write ignored, common.write is not set on the object`);
            return;
        }

        if (channel === 'modbus') {
            const dpId = this.controlRegisterDpId(deviceType, field);
            if (!dpId) {
                this.log.warn(`${id}: no CONTROL_REGISTERS entry for ${deviceType}.${field}`);
                return;
            }
            await this.writeControlModbus(dpId, state.val as number);
            if (dpId === 'inverter.AcPowerSetpoint') {
                this.startAcPowerSetpointKeepalive(state.val as number);
            }
            return;
        }

        // MQTT-Zweig: Serial aus der stateId extrahieren (letztes Segment vor dem gematchten Feld -
        // deckt sowohl "devices.<type>.<Serial>.<Feld>" als auch "devices.<type>.<Group>.<Serial>.<Feld>"
        // ab, ohne Group separat behandeln zu müssen) und über findInstanceForSerial() in die
        // MQTT-Instance auflösen, die das W/<vrmId>/<type>/<instance>/...-Topic braucht.
        const idParts = id.split('.');
        const tailParts = idParts.slice(4);
        const fieldParts = field.split('.');
        const serial = tailParts[tailParts.length - fieldParts.length - 1];
        const instance = serial !== undefined ? this.findInstanceForSerial(deviceType, serial) : undefined;
        if (instance === undefined) {
            this.log.warn(`${id}: could not determine MQTT instance (serial=${serial})`);
            return;
        }
        this.writeDeviceMqtt(deviceType, instance, field.replace(/\./g, '/'), state.val);
    }

    // ── Hilfsfunktionen ──────────────────────────────────────────────────────
    private getFriendlyName(path: string): ioBroker.StringOrTranslated {
        const names: Record<string, ioBroker.StringOrTranslated> = {
            Soc: {
                en: 'State of charge',
                de: 'Ladezustand',
                ru: 'State of charge',
                pt: 'State of charge',
                nl: 'State of charge',
                fr: 'State of charge',
                it: 'State of charge',
                es: 'State of charge',
                pl: 'State of charge',
                uk: 'State of charge',
                'zh-cn': 'State of charge',
            },
            'Dc.0.Voltage': {
                en: 'DC voltage',
                de: 'DC Spannung',
                ru: 'DC voltage',
                pt: 'DC voltage',
                nl: 'DC voltage',
                fr: 'DC voltage',
                it: 'DC voltage',
                es: 'DC voltage',
                pl: 'DC voltage',
                uk: 'DC voltage',
                'zh-cn': 'DC voltage',
            },
            'Dc.0.Current': {
                en: 'DC current',
                de: 'DC Strom',
                ru: 'DC current',
                pt: 'DC current',
                nl: 'DC current',
                fr: 'DC current',
                it: 'DC current',
                es: 'DC current',
                pl: 'DC current',
                uk: 'DC current',
                'zh-cn': 'DC current',
            },
            'Dc.0.Power': {
                en: 'DC power',
                de: 'DC Leistung',
                ru: 'DC power',
                pt: 'DC power',
                nl: 'DC power',
                fr: 'DC power',
                it: 'DC power',
                es: 'DC power',
                pl: 'DC power',
                uk: 'DC power',
                'zh-cn': 'DC power',
            },
            'Dc.Battery.Voltage': {
                en: 'Battery voltage',
                de: 'Batterie Spannung',
                ru: 'Battery voltage',
                pt: 'Battery voltage',
                nl: 'Battery voltage',
                fr: 'Battery voltage',
                it: 'Battery voltage',
                es: 'Battery voltage',
                pl: 'Battery voltage',
                uk: 'Battery voltage',
                'zh-cn': 'Battery voltage',
            },
            'Dc.Battery.Current': {
                en: 'Battery current',
                de: 'Batterie Strom',
                ru: 'Battery current',
                pt: 'Battery current',
                nl: 'Battery current',
                fr: 'Battery current',
                it: 'Battery current',
                es: 'Battery current',
                pl: 'Battery current',
                uk: 'Battery current',
                'zh-cn': 'Battery current',
            },
            'Dc.Battery.Power': {
                en: 'Battery power',
                de: 'Batterie Leistung',
                ru: 'Battery power',
                pt: 'Battery power',
                nl: 'Battery power',
                fr: 'Battery power',
                it: 'Battery power',
                es: 'Battery power',
                pl: 'Battery power',
                uk: 'Battery power',
                'zh-cn': 'Battery power',
            },
            'Ac.Power': {
                en: 'Total power',
                de: 'Gesamtleistung',
                ru: 'Total power',
                pt: 'Total power',
                nl: 'Total power',
                fr: 'Total power',
                it: 'Total power',
                es: 'Total power',
                pl: 'Total power',
                uk: 'Total power',
                'zh-cn': 'Total power',
            },
            'Ac.L1.Power': {
                en: 'L1 power',
                de: 'L1 Leistung',
                ru: 'L1 power',
                pt: 'L1 power',
                nl: 'L1 power',
                fr: 'L1 power',
                it: 'L1 power',
                es: 'L1 power',
                pl: 'L1 power',
                uk: 'L1 power',
                'zh-cn': 'L1 power',
            },
            'Ac.Consumption.Power': {
                en: 'Total consumption',
                de: 'Verbrauch Gesamt',
                ru: 'Total consumption',
                pt: 'Total consumption',
                nl: 'Total consumption',
                fr: 'Total consumption',
                it: 'Total consumption',
                es: 'Total consumption',
                pl: 'Total consumption',
                uk: 'Total consumption',
                'zh-cn': 'Total consumption',
            },
            'Ac.Grid.Power': {
                en: 'Grid total',
                de: 'Netz Gesamt',
                ru: 'Grid total',
                pt: 'Grid total',
                nl: 'Grid total',
                fr: 'Grid total',
                it: 'Grid total',
                es: 'Grid total',
                pl: 'Grid total',
                uk: 'Grid total',
                'zh-cn': 'Grid total',
            },
            'Ac.PvOnGrid.Power': {
                en: 'PV grid total',
                de: 'PV Netz Gesamt',
                ru: 'PV grid total',
                pt: 'PV grid total',
                nl: 'PV grid total',
                fr: 'PV grid total',
                it: 'PV grid total',
                es: 'PV grid total',
                pl: 'PV grid total',
                uk: 'PV grid total',
                'zh-cn': 'PV grid total',
            },
            'Ac.L2.Power': {
                en: 'L2 power',
                de: 'L2 Leistung',
                ru: 'L2 power',
                pt: 'L2 power',
                nl: 'L2 power',
                fr: 'L2 power',
                it: 'L2 power',
                es: 'L2 power',
                pl: 'L2 power',
                uk: 'L2 power',
                'zh-cn': 'L2 power',
            },
            'Ac.L3.Power': {
                en: 'L3 power',
                de: 'L3 Leistung',
                ru: 'L3 power',
                pt: 'L3 power',
                nl: 'L3 power',
                fr: 'L3 power',
                it: 'L3 power',
                es: 'L3 power',
                pl: 'L3 power',
                uk: 'L3 power',
                'zh-cn': 'L3 power',
            },
            'Ac.L1.Voltage': {
                en: 'L1 voltage',
                de: 'L1 Spannung',
                ru: 'L1 voltage',
                pt: 'L1 voltage',
                nl: 'L1 voltage',
                fr: 'L1 voltage',
                it: 'L1 voltage',
                es: 'L1 voltage',
                pl: 'L1 voltage',
                uk: 'L1 voltage',
                'zh-cn': 'L1 voltage',
            },
            'Ac.L2.Voltage': {
                en: 'L2 voltage',
                de: 'L2 Spannung',
                ru: 'L2 voltage',
                pt: 'L2 voltage',
                nl: 'L2 voltage',
                fr: 'L2 voltage',
                it: 'L2 voltage',
                es: 'L2 voltage',
                pl: 'L2 voltage',
                uk: 'L2 voltage',
                'zh-cn': 'L2 voltage',
            },
            'Ac.L3.Voltage': {
                en: 'L3 voltage',
                de: 'L3 Spannung',
                ru: 'L3 voltage',
                pt: 'L3 voltage',
                nl: 'L3 voltage',
                fr: 'L3 voltage',
                it: 'L3 voltage',
                es: 'L3 voltage',
                pl: 'L3 voltage',
                uk: 'L3 voltage',
                'zh-cn': 'L3 voltage',
            },
            'Ac.L1.Current': {
                en: 'L1 current',
                de: 'L1 Strom',
                ru: 'L1 current',
                pt: 'L1 current',
                nl: 'L1 current',
                fr: 'L1 current',
                it: 'L1 current',
                es: 'L1 current',
                pl: 'L1 current',
                uk: 'L1 current',
                'zh-cn': 'L1 current',
            },
            'Ac.L2.Current': {
                en: 'L2 current',
                de: 'L2 Strom',
                ru: 'L2 current',
                pt: 'L2 current',
                nl: 'L2 current',
                fr: 'L2 current',
                it: 'L2 current',
                es: 'L2 current',
                pl: 'L2 current',
                uk: 'L2 current',
                'zh-cn': 'L2 current',
            },
            'Ac.L3.Current': {
                en: 'L3 current',
                de: 'L3 Strom',
                ru: 'L3 current',
                pt: 'L3 current',
                nl: 'L3 current',
                fr: 'L3 current',
                it: 'L3 current',
                es: 'L3 current',
                pl: 'L3 current',
                uk: 'L3 current',
                'zh-cn': 'L3 current',
            },
            'Ac.Energy.Forward': {
                en: 'Energy consumption',
                de: 'Energie Bezug',
                ru: 'Energy consumption',
                pt: 'Energy consumption',
                nl: 'Energy consumption',
                fr: 'Energy consumption',
                it: 'Energy consumption',
                es: 'Energy consumption',
                pl: 'Energy consumption',
                uk: 'Energy consumption',
                'zh-cn': 'Energy consumption',
            },
            'Ac.Energy.Reverse': {
                en: 'Energy feed-in',
                de: 'Energie Einspeisung',
                ru: 'Energy feed-in',
                pt: 'Energy feed-in',
                nl: 'Energy feed-in',
                fr: 'Energy feed-in',
                it: 'Energy feed-in',
                es: 'Energy feed-in',
                pl: 'Energy feed-in',
                uk: 'Energy feed-in',
                'zh-cn': 'Energy feed-in',
            },
            Mode: {
                en: 'Operating mode',
                de: 'Betriebsart',
                ru: 'Operating mode',
                pt: 'Operating mode',
                nl: 'Operating mode',
                fr: 'Operating mode',
                it: 'Operating mode',
                es: 'Operating mode',
                pl: 'Operating mode',
                uk: 'Operating mode',
                'zh-cn': 'Operating mode',
            },
            State: {
                en: 'Switch state',
                de: 'Schaltzustand',
                ru: 'Switch state',
                pt: 'Switch state',
                nl: 'Switch state',
                fr: 'Switch state',
                it: 'Switch state',
                es: 'Switch state',
                pl: 'Switch state',
                uk: 'Switch state',
                'zh-cn': 'Switch state',
            },
            VebusError: {
                en: 'Vebus error',
                de: 'VebusError',
                ru: 'Vebus error',
                pt: 'Vebus error',
                nl: 'Vebus error',
                fr: 'Vebus error',
                it: 'Vebus error',
                es: 'Vebus error',
                pl: 'Vebus error',
                uk: 'Vebus error',
                'zh-cn': 'Vebus error',
            },
            VebusChargeState: {
                en: 'Vebus charge state',
                de: 'VebusChargeState',
                ru: 'Vebus charge state',
                pt: 'Vebus charge state',
                nl: 'Vebus charge state',
                fr: 'Vebus charge state',
                it: 'Vebus charge state',
                es: 'Vebus charge state',
                pl: 'Vebus charge state',
                uk: 'Vebus charge state',
                'zh-cn': 'Vebus charge state',
            },
            TimeToGo: {
                en: 'Time to go',
                de: 'Restlaufzeit',
                ru: 'Time to go',
                pt: 'Time to go',
                nl: 'Time to go',
                fr: 'Time to go',
                it: 'Time to go',
                es: 'Time to go',
                pl: 'Time to go',
                uk: 'Time to go',
                'zh-cn': 'Time to go',
            },
            'Dc.0.Temperature': {
                en: 'Temperature',
                de: 'Temperatur',
                ru: 'Temperature',
                pt: 'Temperature',
                nl: 'Temperature',
                fr: 'Temperature',
                it: 'Temperature',
                es: 'Temperature',
                pl: 'Temperature',
                uk: 'Temperature',
                'zh-cn': 'Temperature',
            },
            'temperatures.main': {
                en: 'Main temperature',
                de: 'Temperatur Haupt',
                ru: 'Main temperature',
                pt: 'Main temperature',
                nl: 'Main temperature',
                fr: 'Main temperature',
                it: 'Main temperature',
                es: 'Main temperature',
                pl: 'Main temperature',
                uk: 'Main temperature',
                'zh-cn': 'Main temperature',
            },
            'temperatures.temp1': {
                en: 'Temperature 1',
                de: 'Temperatur 1',
                ru: 'Temperature 1',
                pt: 'Temperature 1',
                nl: 'Temperature 1',
                fr: 'Temperature 1',
                it: 'Temperature 1',
                es: 'Temperature 1',
                pl: 'Temperature 1',
                uk: 'Temperature 1',
                'zh-cn': 'Temperature 1',
            },
            'temperatures.temp2': {
                en: 'Temperature 2',
                de: 'Temperatur 2',
                ru: 'Temperature 2',
                pt: 'Temperature 2',
                nl: 'Temperature 2',
                fr: 'Temperature 2',
                it: 'Temperature 2',
                es: 'Temperature 2',
                pl: 'Temperature 2',
                uk: 'Temperature 2',
                'zh-cn': 'Temperature 2',
            },
            'temperatures.temp3': {
                en: 'Temperature 3',
                de: 'Temperatur 3',
                ru: 'Temperature 3',
                pt: 'Temperature 3',
                nl: 'Temperature 3',
                fr: 'Temperature 3',
                it: 'Temperature 3',
                es: 'Temperature 3',
                pl: 'Temperature 3',
                uk: 'Temperature 3',
                'zh-cn': 'Temperature 3',
            },
            'temperatures.temp4': {
                en: 'Temperature 4',
                de: 'Temperatur 4',
                ru: 'Temperature 4',
                pt: 'Temperature 4',
                nl: 'Temperature 4',
                fr: 'Temperature 4',
                it: 'Temperature 4',
                es: 'Temperature 4',
                pl: 'Temperature 4',
                uk: 'Temperature 4',
                'zh-cn': 'Temperature 4',
            },
            'temperatures.min': {
                en: 'Temperature min',
                de: 'Temperatur Min',
                ru: 'Temperature min',
                pt: 'Temperature min',
                nl: 'Temperature min',
                fr: 'Temperature min',
                it: 'Temperature min',
                es: 'Temperature min',
                pl: 'Temperature min',
                uk: 'Temperature min',
                'zh-cn': 'Temperature min',
            },
            'temperatures.max': {
                en: 'Temperature max',
                de: 'Temperatur Max',
                ru: 'Temperature max',
                pt: 'Temperature max',
                nl: 'Temperature max',
                fr: 'Temperature max',
                it: 'Temperature max',
                es: 'Temperature max',
                pl: 'Temperature max',
                uk: 'Temperature max',
                'zh-cn': 'Temperature max',
            },
            'cells.min': {
                en: 'Cell min',
                de: 'Zelle Min',
                ru: 'Cell min',
                pt: 'Cell min',
                nl: 'Cell min',
                fr: 'Cell min',
                it: 'Cell min',
                es: 'Cell min',
                pl: 'Cell min',
                uk: 'Cell min',
                'zh-cn': 'Cell min',
            },
            'cells.max': {
                en: 'Cell max',
                de: 'Zelle Max',
                ru: 'Cell max',
                pt: 'Cell max',
                nl: 'Cell max',
                fr: 'Cell max',
                it: 'Cell max',
                es: 'Cell max',
                pl: 'Cell max',
                uk: 'Cell max',
                'zh-cn': 'Cell max',
            },
            'cells.minId': {
                en: 'Cell min ID',
                de: 'Zelle Min ID',
                ru: 'Cell min ID',
                pt: 'Cell min ID',
                nl: 'Cell min ID',
                fr: 'Cell min ID',
                it: 'Cell min ID',
                es: 'Cell min ID',
                pl: 'Cell min ID',
                uk: 'Cell min ID',
                'zh-cn': 'Cell min ID',
            },
            'cells.maxId': {
                en: 'Cell max ID',
                de: 'Zelle Max ID',
                ru: 'Cell max ID',
                pt: 'Cell max ID',
                nl: 'Cell max ID',
                fr: 'Cell max ID',
                it: 'Cell max ID',
                es: 'Cell max ID',
                pl: 'Cell max ID',
                uk: 'Cell max ID',
                'zh-cn': 'Cell max ID',
            },
            'cells.diff': {
                en: 'Cell spread',
                de: 'Zell-Spread',
                ru: 'Cell spread',
                pt: 'Cell spread',
                nl: 'Cell spread',
                fr: 'Cell spread',
                it: 'Cell spread',
                es: 'Cell spread',
                pl: 'Cell spread',
                uk: 'Cell spread',
                'zh-cn': 'Cell spread',
            },
            'alarms.lowVoltage': {
                en: 'Alarm: low voltage',
                de: 'Alarm: Unterspannung',
                ru: 'Alarm: low voltage',
                pt: 'Alarm: low voltage',
                nl: 'Alarm: low voltage',
                fr: 'Alarm: low voltage',
                it: 'Alarm: low voltage',
                es: 'Alarm: low voltage',
                pl: 'Alarm: low voltage',
                uk: 'Alarm: low voltage',
                'zh-cn': 'Alarm: low voltage',
            },
            'alarms.highVoltage': {
                en: 'Alarm: high voltage',
                de: 'Alarm: Überspannung',
                ru: 'Alarm: high voltage',
                pt: 'Alarm: high voltage',
                nl: 'Alarm: high voltage',
                fr: 'Alarm: high voltage',
                it: 'Alarm: high voltage',
                es: 'Alarm: high voltage',
                pl: 'Alarm: high voltage',
                uk: 'Alarm: high voltage',
                'zh-cn': 'Alarm: high voltage',
            },
            'alarms.lowSoc': {
                en: 'Alarm: low SoC',
                de: 'Alarm: SOC niedrig',
                ru: 'Alarm: low SoC',
                pt: 'Alarm: low SoC',
                nl: 'Alarm: low SoC',
                fr: 'Alarm: low SoC',
                it: 'Alarm: low SoC',
                es: 'Alarm: low SoC',
                pl: 'Alarm: low SoC',
                uk: 'Alarm: low SoC',
                'zh-cn': 'Alarm: low SoC',
            },
            'Dc.Battery.Soc': {
                en: 'Battery state of charge',
                de: 'Batterie Ladezustand',
                ru: 'Battery state of charge',
                pt: 'Battery state of charge',
                nl: 'Battery state of charge',
                fr: 'Battery state of charge',
                it: 'Battery state of charge',
                es: 'Battery state of charge',
                pl: 'Battery state of charge',
                uk: 'Battery state of charge',
                'zh-cn': 'Battery state of charge',
            },
            'Dc.Battery.ConsumedAmphours': {
                en: 'Battery consumed Ah',
                de: 'Batterie Verbrauch',
                ru: 'Battery consumed Ah',
                pt: 'Battery consumed Ah',
                nl: 'Battery consumed Ah',
                fr: 'Battery consumed Ah',
                it: 'Battery consumed Ah',
                es: 'Battery consumed Ah',
                pl: 'Battery consumed Ah',
                uk: 'Battery consumed Ah',
                'zh-cn': 'Battery consumed Ah',
            },
            'Dc.System.Power': {
                en: 'DC system power',
                de: 'DC System Leistung',
                ru: 'DC system power',
                pt: 'DC system power',
                nl: 'DC system power',
                fr: 'DC system power',
                it: 'DC system power',
                es: 'DC system power',
                pl: 'DC system power',
                uk: 'DC system power',
                'zh-cn': 'DC system power',
            },
            'Dc.Vebus.Power': {
                en: 'MultiPlus DC power',
                de: 'MultiPlus DC Leistung',
                ru: 'MultiPlus DC power',
                pt: 'MultiPlus DC power',
                nl: 'MultiPlus DC power',
                fr: 'MultiPlus DC power',
                it: 'MultiPlus DC power',
                es: 'MultiPlus DC power',
                pl: 'MultiPlus DC power',
                uk: 'MultiPlus DC power',
                'zh-cn': 'MultiPlus DC power',
            },
            'Ac.Consumption.L1.Power': {
                en: 'Consumption L1',
                de: 'Verbrauch L1',
                ru: 'Consumption L1',
                pt: 'Consumption L1',
                nl: 'Consumption L1',
                fr: 'Consumption L1',
                it: 'Consumption L1',
                es: 'Consumption L1',
                pl: 'Consumption L1',
                uk: 'Consumption L1',
                'zh-cn': 'Consumption L1',
            },
            'Ac.Consumption.L2.Power': {
                en: 'Consumption L2',
                de: 'Verbrauch L2',
                ru: 'Consumption L2',
                pt: 'Consumption L2',
                nl: 'Consumption L2',
                fr: 'Consumption L2',
                it: 'Consumption L2',
                es: 'Consumption L2',
                pl: 'Consumption L2',
                uk: 'Consumption L2',
                'zh-cn': 'Consumption L2',
            },
            'Ac.Consumption.L3.Power': {
                en: 'Consumption L3',
                de: 'Verbrauch L3',
                ru: 'Consumption L3',
                pt: 'Consumption L3',
                nl: 'Consumption L3',
                fr: 'Consumption L3',
                it: 'Consumption L3',
                es: 'Consumption L3',
                pl: 'Consumption L3',
                uk: 'Consumption L3',
                'zh-cn': 'Consumption L3',
            },
            'Ac.ConsumptionOnOutput.L1.Power': {
                en: 'Consumption output L1',
                de: 'Verbrauch Ausgang L1',
                ru: 'Consumption output L1',
                pt: 'Consumption output L1',
                nl: 'Consumption output L1',
                fr: 'Consumption output L1',
                it: 'Consumption output L1',
                es: 'Consumption output L1',
                pl: 'Consumption output L1',
                uk: 'Consumption output L1',
                'zh-cn': 'Consumption output L1',
            },
            'Ac.ConsumptionOnInput.L1.Power': {
                en: 'Consumption input L1',
                de: 'Verbrauch Eingang L1',
                ru: 'Consumption input L1',
                pt: 'Consumption input L1',
                nl: 'Consumption input L1',
                fr: 'Consumption input L1',
                it: 'Consumption input L1',
                es: 'Consumption input L1',
                pl: 'Consumption input L1',
                uk: 'Consumption input L1',
                'zh-cn': 'Consumption input L1',
            },
            'Ac.Grid.L1.Power': {
                en: 'Grid L1',
                de: 'Grid L1',
                ru: 'Grid L1',
                pt: 'Grid L1',
                nl: 'Grid L1',
                fr: 'Grid L1',
                it: 'Grid L1',
                es: 'Grid L1',
                pl: 'Grid L1',
                uk: 'Grid L1',
                'zh-cn': 'Grid L1',
            },
            'Ac.Grid.L2.Power': {
                en: 'Grid L2',
                de: 'Grid L2',
                ru: 'Grid L2',
                pt: 'Grid L2',
                nl: 'Grid L2',
                fr: 'Grid L2',
                it: 'Grid L2',
                es: 'Grid L2',
                pl: 'Grid L2',
                uk: 'Grid L2',
                'zh-cn': 'Grid L2',
            },
            'Ac.Grid.L3.Power': {
                en: 'Grid L3',
                de: 'Grid L3',
                ru: 'Grid L3',
                pt: 'Grid L3',
                nl: 'Grid L3',
                fr: 'Grid L3',
                it: 'Grid L3',
                es: 'Grid L3',
                pl: 'Grid L3',
                uk: 'Grid L3',
                'zh-cn': 'Grid L3',
            },
            'Ac.PvOnGrid.L1.Power': {
                en: 'PV grid L1',
                de: 'PV Netz L1',
                ru: 'PV grid L1',
                pt: 'PV grid L1',
                nl: 'PV grid L1',
                fr: 'PV grid L1',
                it: 'PV grid L1',
                es: 'PV grid L1',
                pl: 'PV grid L1',
                uk: 'PV grid L1',
                'zh-cn': 'PV grid L1',
            },
            'Ac.PvOnGrid.L2.Power': {
                en: 'PV grid L2',
                de: 'PV Netz L2',
                ru: 'PV grid L2',
                pt: 'PV grid L2',
                nl: 'PV grid L2',
                fr: 'PV grid L2',
                it: 'PV grid L2',
                es: 'PV grid L2',
                pl: 'PV grid L2',
                uk: 'PV grid L2',
                'zh-cn': 'PV grid L2',
            },
            'BatterySense.Voltage': {
                en: 'Battery voltage (MP)',
                de: 'Batterie Spannung (MP)',
                ru: 'Battery voltage (MP)',
                pt: 'Battery voltage (MP)',
                nl: 'Battery voltage (MP)',
                fr: 'Battery voltage (MP)',
                it: 'Battery voltage (MP)',
                es: 'Battery voltage (MP)',
                pl: 'Battery voltage (MP)',
                uk: 'Battery voltage (MP)',
                'zh-cn': 'Battery voltage (MP)',
            },
            'Hub4.L1.AcPowerSetpoint': {
                en: 'ESS setpoint L1',
                de: 'ESS Sollwert L1',
                ru: 'ESS setpoint L1',
                pt: 'ESS setpoint L1',
                nl: 'ESS setpoint L1',
                fr: 'ESS setpoint L1',
                it: 'ESS setpoint L1',
                es: 'ESS setpoint L1',
                pl: 'ESS setpoint L1',
                uk: 'ESS setpoint L1',
                'zh-cn': 'ESS setpoint L1',
            },
            'Hub4.DisableFeedIn': {
                en: 'Feed-in disabled',
                de: 'Einspeisung gesperrt',
                ru: 'Feed-in disabled',
                pt: 'Feed-in disabled',
                nl: 'Feed-in disabled',
                fr: 'Feed-in disabled',
                it: 'Feed-in disabled',
                es: 'Feed-in disabled',
                pl: 'Feed-in disabled',
                uk: 'Feed-in disabled',
                'zh-cn': 'Feed-in disabled',
            },
            'Hub4.DisableCharge': {
                en: 'Charge disabled',
                de: 'Laden gesperrt',
                ru: 'Charge disabled',
                pt: 'Charge disabled',
                nl: 'Charge disabled',
                fr: 'Charge disabled',
                it: 'Charge disabled',
                es: 'Charge disabled',
                pl: 'Charge disabled',
                uk: 'Charge disabled',
                'zh-cn': 'Charge disabled',
            },
            'Ac.ActiveIn.L1.P': {
                en: 'L1 input power',
                de: 'L1 Eingangsleistung',
                ru: 'L1 input power',
                pt: 'L1 input power',
                nl: 'L1 input power',
                fr: 'L1 input power',
                it: 'L1 input power',
                es: 'L1 input power',
                pl: 'L1 input power',
                uk: 'L1 input power',
                'zh-cn': 'L1 input power',
            },
            'Ac.ActiveIn.L1.I': {
                en: 'L1 input current',
                de: 'L1 Eingangsstrom',
                ru: 'L1 input current',
                pt: 'L1 input current',
                nl: 'L1 input current',
                fr: 'L1 input current',
                it: 'L1 input current',
                es: 'L1 input current',
                pl: 'L1 input current',
                uk: 'L1 input current',
                'zh-cn': 'L1 input current',
            },
            'Ac.ActiveIn.L1.V': {
                en: 'L1 input voltage',
                de: 'L1 Eingangsspannung',
                ru: 'L1 input voltage',
                pt: 'L1 input voltage',
                nl: 'L1 input voltage',
                fr: 'L1 input voltage',
                it: 'L1 input voltage',
                es: 'L1 input voltage',
                pl: 'L1 input voltage',
                uk: 'L1 input voltage',
                'zh-cn': 'L1 input voltage',
            },
            'Ac.ActiveIn.L1.S': {
                en: 'L1 input apparent power',
                de: 'L1 Eingang Scheinleistung',
                ru: 'L1 input apparent power',
                pt: 'L1 input apparent power',
                nl: 'L1 input apparent power',
                fr: 'L1 input apparent power',
                it: 'L1 input apparent power',
                es: 'L1 input apparent power',
                pl: 'L1 input apparent power',
                uk: 'L1 input apparent power',
                'zh-cn': 'L1 input apparent power',
            },
            'Ac.ActiveIn.P': {
                en: 'Total input power',
                de: 'Eingang Gesamtleistung',
                ru: 'Total input power',
                pt: 'Total input power',
                nl: 'Total input power',
                fr: 'Total input power',
                it: 'Total input power',
                es: 'Total input power',
                pl: 'Total input power',
                uk: 'Total input power',
                'zh-cn': 'Total input power',
            },
            'Ac.ActiveIn.S': {
                en: 'Input apparent power',
                de: 'Eingang Scheinleistung',
                ru: 'Input apparent power',
                pt: 'Input apparent power',
                nl: 'Input apparent power',
                fr: 'Input apparent power',
                it: 'Input apparent power',
                es: 'Input apparent power',
                pl: 'Input apparent power',
                uk: 'Input apparent power',
                'zh-cn': 'Input apparent power',
            },
            'Ac.Out.L1.P': {
                en: 'L1 output power',
                de: 'L1 Ausgangsleistung',
                ru: 'L1 output power',
                pt: 'L1 output power',
                nl: 'L1 output power',
                fr: 'L1 output power',
                it: 'L1 output power',
                es: 'L1 output power',
                pl: 'L1 output power',
                uk: 'L1 output power',
                'zh-cn': 'L1 output power',
            },
            'Ac.Out.L1.F': {
                en: 'L1 output frequency',
                de: 'L1 Ausgangsfrequenz',
                ru: 'L1 output frequency',
                pt: 'L1 output frequency',
                nl: 'L1 output frequency',
                fr: 'L1 output frequency',
                it: 'L1 output frequency',
                es: 'L1 output frequency',
                pl: 'L1 output frequency',
                uk: 'L1 output frequency',
                'zh-cn': 'L1 output frequency',
            },
            'Ac.Out.L1.I': {
                en: 'L1 output current',
                de: 'L1 Ausgangsstrom',
                ru: 'L1 output current',
                pt: 'L1 output current',
                nl: 'L1 output current',
                fr: 'L1 output current',
                it: 'L1 output current',
                es: 'L1 output current',
                pl: 'L1 output current',
                uk: 'L1 output current',
                'zh-cn': 'L1 output current',
            },
            'Ac.Out.L1.S': {
                en: 'L1 output apparent power',
                de: 'L1 Ausgang Scheinleistung',
                ru: 'L1 output apparent power',
                pt: 'L1 output apparent power',
                nl: 'L1 output apparent power',
                fr: 'L1 output apparent power',
                it: 'L1 output apparent power',
                es: 'L1 output apparent power',
                pl: 'L1 output apparent power',
                uk: 'L1 output apparent power',
                'zh-cn': 'L1 output apparent power',
            },
            'Ac.Out.P': {
                en: 'Total output power',
                de: 'Ausgang Gesamtleistung',
                ru: 'Total output power',
                pt: 'Total output power',
                nl: 'Total output power',
                fr: 'Total output power',
                it: 'Total output power',
                es: 'Total output power',
                pl: 'Total output power',
                uk: 'Total output power',
                'zh-cn': 'Total output power',
            },
            'Ac.Out.S': {
                en: 'Output apparent power',
                de: 'Ausgang Scheinleistung',
                ru: 'Output apparent power',
                pt: 'Output apparent power',
                nl: 'Output apparent power',
                fr: 'Output apparent power',
                it: 'Output apparent power',
                es: 'Output apparent power',
                pl: 'Output apparent power',
                uk: 'Output apparent power',
                'zh-cn': 'Output apparent power',
            },
            Capacity: {
                en: 'Capacity',
                de: 'Kapazität',
                ru: 'Capacity',
                pt: 'Capacity',
                nl: 'Capacity',
                fr: 'Capacity',
                it: 'Capacity',
                es: 'Capacity',
                pl: 'Capacity',
                uk: 'Capacity',
                'zh-cn': 'Capacity',
            },
            CurrentAvg: {
                en: 'Average current',
                de: 'Durchschnittsstrom',
                ru: 'Average current',
                pt: 'Average current',
                nl: 'Average current',
                fr: 'Average current',
                it: 'Average current',
                es: 'Average current',
                pl: 'Average current',
                uk: 'Average current',
                'zh-cn': 'Average current',
            },
            'Yield.Power': {
                en: 'PV power',
                de: 'PV Leistung',
                ru: 'PV power',
                pt: 'PV power',
                nl: 'PV power',
                fr: 'PV power',
                it: 'PV power',
                es: 'PV power',
                pl: 'PV power',
                uk: 'PV power',
                'zh-cn': 'PV power',
            },
            'Yield.Today': {
                en: 'Today',
                de: 'Ertrag heute',
                ru: 'Today',
                pt: 'Today',
                nl: 'Today',
                fr: 'Today',
                it: 'Today',
                es: 'Today',
                pl: 'Today',
                uk: 'Today',
                'zh-cn': 'Today',
            },
            'Yield.Total': {
                en: 'Total yield',
                de: 'Ertrag gesamt',
                ru: 'Total yield',
                pt: 'Total yield',
                nl: 'Total yield',
                fr: 'Total yield',
                it: 'Total yield',
                es: 'Total yield',
                pl: 'Total yield',
                uk: 'Total yield',
                'zh-cn': 'Total yield',
            },
            'Pv.V': {
                en: 'PV voltage',
                de: 'PV Spannung',
                ru: 'PV voltage',
                pt: 'PV voltage',
                nl: 'PV voltage',
                fr: 'PV voltage',
                it: 'PV voltage',
                es: 'PV voltage',
                pl: 'PV voltage',
                uk: 'PV voltage',
                'zh-cn': 'PV voltage',
            },
            'Pv.P': {
                en: 'PV power',
                de: 'PV Leistung',
                ru: 'PV power',
                pt: 'PV power',
                nl: 'PV power',
                fr: 'PV power',
                it: 'PV power',
                es: 'PV power',
                pl: 'PV power',
                uk: 'PV power',
                'zh-cn': 'PV power',
            },
            StatusCode: {
                en: 'Status',
                de: 'Status',
                ru: 'Status',
                pt: 'Status',
                nl: 'Status',
                fr: 'Status',
                it: 'Status',
                es: 'Status',
                pl: 'Status',
                uk: 'Status',
                'zh-cn': 'Status',
            },
            ErrorCode: {
                en: 'Error code',
                de: 'Fehlercode',
                ru: 'Error code',
                pt: 'Error code',
                nl: 'Error code',
                fr: 'Error code',
                it: 'Error code',
                es: 'Error code',
                pl: 'Error code',
                uk: 'Error code',
                'zh-cn': 'Error code',
            },
            'Ac.Frequency': {
                en: 'Frequency',
                de: 'Frequenz',
                ru: 'Frequency',
                pt: 'Frequency',
                nl: 'Frequency',
                fr: 'Frequency',
                it: 'Frequency',
                es: 'Frequency',
                pl: 'Frequency',
                uk: 'Frequency',
                'zh-cn': 'Frequency',
            },
            'Ac.MaxPower': {
                en: 'Max. power',
                de: 'Max. Leistung',
                ru: 'Max. power',
                pt: 'Max. power',
                nl: 'Max. power',
                fr: 'Max. power',
                it: 'Max. power',
                es: 'Max. power',
                pl: 'Max. power',
                uk: 'Max. power',
                'zh-cn': 'Max. power',
            },
            'Ac.PowerLimit': {
                en: 'Power limit',
                de: 'Leistungsbegrenzung',
                ru: 'Power limit',
                pt: 'Power limit',
                nl: 'Power limit',
                fr: 'Power limit',
                it: 'Power limit',
                es: 'Power limit',
                pl: 'Power limit',
                uk: 'Power limit',
                'zh-cn': 'Power limit',
            },
            'SystemState.State': {
                en: 'System state',
                de: 'Systemzustand',
                ru: 'System state',
                pt: 'System state',
                nl: 'System state',
                fr: 'System state',
                it: 'System state',
                es: 'System state',
                pl: 'System state',
                uk: 'System state',
                'zh-cn': 'System state',
            },
            Remaining: {
                en: 'Remaining',
                de: 'Verbleibend',
                ru: 'Remaining',
                pt: 'Remaining',
                nl: 'Remaining',
                fr: 'Remaining',
                it: 'Remaining',
                es: 'Remaining',
                pl: 'Remaining',
                uk: 'Remaining',
                'zh-cn': 'Remaining',
            },
            FluidType: {
                en: 'Fluid type',
                de: 'Flüssigkeitstyp',
                ru: 'Fluid type',
                pt: 'Fluid type',
                nl: 'Fluid type',
                fr: 'Fluid type',
                it: 'Fluid type',
                es: 'Fluid type',
                pl: 'Fluid type',
                uk: 'Fluid type',
                'zh-cn': 'Fluid type',
            },
            Temperature: {
                en: 'Temperature',
                de: 'Temperatur',
                ru: 'Temperature',
                pt: 'Temperature',
                nl: 'Temperature',
                fr: 'Temperature',
                it: 'Temperature',
                es: 'Temperature',
                pl: 'Temperature',
                uk: 'Temperature',
                'zh-cn': 'Temperature',
            },
            Humidity: {
                en: 'Humidity',
                de: 'Luftfeuchtigkeit',
                ru: 'Humidity',
                pt: 'Humidity',
                nl: 'Humidity',
                fr: 'Humidity',
                it: 'Humidity',
                es: 'Humidity',
                pl: 'Humidity',
                uk: 'Humidity',
                'zh-cn': 'Humidity',
            },
            Pressure: {
                en: 'Air pressure',
                de: 'Luftdruck',
                ru: 'Air pressure',
                pt: 'Air pressure',
                nl: 'Air pressure',
                fr: 'Air pressure',
                it: 'Air pressure',
                es: 'Air pressure',
                pl: 'Air pressure',
                uk: 'Air pressure',
                'zh-cn': 'Air pressure',
            },
            Irradiance: {
                en: 'Solar irradiance',
                de: 'Bestrahlungsstärke',
                ru: 'Solar irradiance',
                pt: 'Solar irradiance',
                nl: 'Solar irradiance',
                fr: 'Solar irradiance',
                it: 'Solar irradiance',
                es: 'Solar irradiance',
                pl: 'Solar irradiance',
                uk: 'Solar irradiance',
                'zh-cn': 'Solar irradiance',
            },
            WindSpeed: {
                en: 'Wind speed',
                de: 'Windgeschwindigkeit',
                ru: 'Wind speed',
                pt: 'Wind speed',
                nl: 'Wind speed',
                fr: 'Wind speed',
                it: 'Wind speed',
                es: 'Wind speed',
                pl: 'Wind speed',
                uk: 'Wind speed',
                'zh-cn': 'Wind speed',
            },
            WindDirection: {
                en: 'Wind direction',
                de: 'Windrichtung',
                ru: 'Wind direction',
                pt: 'Wind direction',
                nl: 'Wind direction',
                fr: 'Wind direction',
                it: 'Wind direction',
                es: 'Wind direction',
                pl: 'Wind direction',
                uk: 'Wind direction',
                'zh-cn': 'Wind direction',
            },
            ExternalTemperature: {
                en: 'Outside temperature',
                de: 'Außentemperatur',
                ru: 'Outside temperature',
                pt: 'Outside temperature',
                nl: 'Outside temperature',
                fr: 'Outside temperature',
                it: 'Outside temperature',
                es: 'Outside temperature',
                pl: 'Outside temperature',
                uk: 'Outside temperature',
                'zh-cn': 'Outside temperature',
            },
            CustomName: {
                en: 'Custom name',
                de: 'Benutzerdefinierter Name',
                ru: 'Custom name',
                pt: 'Custom name',
                nl: 'Custom name',
                fr: 'Custom name',
                it: 'Custom name',
                es: 'Custom name',
                pl: 'Custom name',
                uk: 'Custom name',
                'zh-cn': 'Custom name',
            },
            ProductName: {
                en: 'Product name',
                de: 'Produktname',
                ru: 'Product name',
                pt: 'Product name',
                nl: 'Product name',
                fr: 'Product name',
                it: 'Product name',
                es: 'Product name',
                pl: 'Product name',
                uk: 'Product name',
                'zh-cn': 'Product name',
            },
            Serial: {
                en: 'Serial number',
                de: 'Seriennummer',
                ru: 'Serial number',
                pt: 'Serial number',
                nl: 'Serial number',
                fr: 'Serial number',
                it: 'Serial number',
                es: 'Serial number',
                pl: 'Serial number',
                uk: 'Serial number',
                'zh-cn': 'Serial number',
            },
            ConsumedAmphours: {
                en: 'Consumed Ah',
                de: 'Verbrauchte Ah',
                ru: 'Consumed Ah',
                pt: 'Consumed Ah',
                nl: 'Consumed Ah',
                fr: 'Consumed Ah',
                it: 'Consumed Ah',
                es: 'Consumed Ah',
                pl: 'Consumed Ah',
                uk: 'Consumed Ah',
                'zh-cn': 'Consumed Ah',
            },
            // acload-Ergänzungen (Shelly-Integration, §4.14)
            'Ac.L1.Energy.Reverse': {
                en: 'L1 energy feed-in',
                de: 'L1 Energie Einspeisung',
                ru: 'L1 energy feed-in',
                pt: 'L1 energy feed-in',
                nl: 'L1 energy feed-in',
                fr: 'L1 energy feed-in',
                it: 'L1 energy feed-in',
                es: 'L1 energy feed-in',
                pl: 'L1 energy feed-in',
                uk: 'L1 energy feed-in',
                'zh-cn': 'L1 energy feed-in',
            },
            'Ac.L2.Energy.Reverse': {
                en: 'L2 energy feed-in',
                de: 'L2 Energie Einspeisung',
                ru: 'L2 energy feed-in',
                pt: 'L2 energy feed-in',
                nl: 'L2 energy feed-in',
                fr: 'L2 energy feed-in',
                it: 'L2 energy feed-in',
                es: 'L2 energy feed-in',
                pl: 'L2 energy feed-in',
                uk: 'L2 energy feed-in',
                'zh-cn': 'L2 energy feed-in',
            },
            'Ac.L3.Energy.Reverse': {
                en: 'L3 energy feed-in',
                de: 'L3 Energie Einspeisung',
                ru: 'L3 energy feed-in',
                pt: 'L3 energy feed-in',
                nl: 'L3 energy feed-in',
                fr: 'L3 energy feed-in',
                it: 'L3 energy feed-in',
                es: 'L3 energy feed-in',
                pl: 'L3 energy feed-in',
                uk: 'L3 energy feed-in',
                'zh-cn': 'L3 energy feed-in',
            },
            'Ac.L1.PowerFactor': {
                en: 'L1 power factor',
                de: 'L1 Leistungsfaktor',
                ru: 'L1 power factor',
                pt: 'L1 power factor',
                nl: 'L1 power factor',
                fr: 'L1 power factor',
                it: 'L1 power factor',
                es: 'L1 power factor',
                pl: 'L1 power factor',
                uk: 'L1 power factor',
                'zh-cn': 'L1 power factor',
            },
            'Ac.L2.PowerFactor': {
                en: 'L2 power factor',
                de: 'L2 Leistungsfaktor',
                ru: 'L2 power factor',
                pt: 'L2 power factor',
                nl: 'L2 power factor',
                fr: 'L2 power factor',
                it: 'L2 power factor',
                es: 'L2 power factor',
                pl: 'L2 power factor',
                uk: 'L2 power factor',
                'zh-cn': 'L2 power factor',
            },
            'Ac.L3.PowerFactor': {
                en: 'L3 power factor',
                de: 'L3 Leistungsfaktor',
                ru: 'L3 power factor',
                pt: 'L3 power factor',
                nl: 'L3 power factor',
                fr: 'L3 power factor',
                it: 'L3 power factor',
                es: 'L3 power factor',
                pl: 'L3 power factor',
                uk: 'L3 power factor',
                'zh-cn': 'L3 power factor',
            },
            Role: {
                en: 'Role',
                de: 'Rolle',
                ru: 'Role',
                pt: 'Role',
                nl: 'Role',
                fr: 'Role',
                it: 'Role',
                es: 'Role',
                pl: 'Role',
                uk: 'Role',
                'zh-cn': 'Role',
            },
            IsGenericEnergyMeter: {
                en: 'Generic energy meter',
                de: 'Generischer Energiezähler',
                ru: 'Generic energy meter',
                pt: 'Generic energy meter',
                nl: 'Generic energy meter',
                fr: 'Generic energy meter',
                it: 'Generic energy meter',
                es: 'Generic energy meter',
                pl: 'Generic energy meter',
                uk: 'Generic energy meter',
                'zh-cn': 'Generic energy meter',
            },
            PhaseSetting: {
                en: 'Phase setting',
                de: 'Phaseneinstellung',
                ru: 'Phase setting',
                pt: 'Phase setting',
                nl: 'Phase setting',
                fr: 'Phase setting',
                it: 'Phase setting',
                es: 'Phase setting',
                pl: 'Phase setting',
                uk: 'Phase setting',
                'zh-cn': 'Phase setting',
            },
            ProductId: {
                en: 'Product ID',
                de: 'Produkt-ID',
                ru: 'Product ID',
                pt: 'Product ID',
                nl: 'Product ID',
                fr: 'Product ID',
                it: 'Product ID',
                es: 'Product ID',
                pl: 'Product ID',
                uk: 'Product ID',
                'zh-cn': 'Product ID',
            },
            // temperature (dbus-adc, S2)
            Status: {
                en: 'Status',
                de: 'Status',
                ru: 'Статус',
                pt: 'Status',
                nl: 'Status',
                fr: 'État',
                it: 'Stato',
                es: 'Estado',
                pl: 'Status',
                uk: 'Статус',
                'zh-cn': '状态',
            },
            TemperatureType: {
                en: 'Sensor type',
                de: 'Sensortyp',
                ru: 'Тип датчика',
                pt: 'Tipo de sensor',
                nl: 'Sensortype',
                fr: 'Type de capteur',
                it: 'Tipo di sensore',
                es: 'Tipo de sensor',
                pl: 'Typ czujnika',
                uk: 'Тип датчика',
                'zh-cn': '传感器类型',
            },
            Offset: {
                en: 'Calibration offset',
                de: 'Kalibrierungs-Offset',
                ru: 'Калибровочное смещение',
                pt: 'Offset de calibração',
                nl: 'Kalibratie-offset',
                fr: 'Décalage de calibration',
                it: 'Offset di calibrazione',
                es: 'Offset de calibración',
                pl: 'Przesunięcie kalibracji',
                uk: 'Калібрувальне зміщення',
                'zh-cn': '校准偏移',
            },
            Scale: {
                en: 'Calibration scale',
                de: 'Kalibrierungs-Skalierung',
                ru: 'Калибровочный масштаб',
                pt: 'Escala de calibração',
                nl: 'Kalibratieschaal',
                fr: 'Échelle de calibration',
                it: 'Scala di calibrazione',
                es: 'Escala de calibración',
                pl: 'Skala kalibracji',
                uk: 'Калібрувальний масштаб',
                'zh-cn': '校准比例',
            },
            RawValue: {
                en: 'Raw sensor value',
                de: 'Roher Sensorwert',
                ru: 'Необработанное значение датчика',
                pt: 'Valor bruto do sensor',
                nl: 'Ruwe sensorwaarde',
                fr: 'Valeur brute du capteur',
                it: 'Valore grezzo del sensore',
                es: 'Valor bruto del sensor',
                pl: 'Surowa wartość czujnika',
                uk: 'Необроблене значення датчика',
                'zh-cn': '传感器原始值',
            },
            RawUnit: {
                en: 'Raw value unit',
                de: 'Einheit des Rohwerts',
                ru: 'Единица необработанного значения',
                pt: 'Unidade do valor bruto',
                nl: 'Eenheid van ruwe waarde',
                fr: 'Unité de la valeur brute',
                it: 'Unità del valore grezzo',
                es: 'Unidad del valor bruto',
                pl: 'Jednostka wartości surowej',
                uk: 'Одиниця необробленого значення',
                'zh-cn': '原始值单位',
            },
            FilterLength: {
                en: 'Filter length',
                de: 'Filterlänge',
                ru: 'Длина фильтра',
                pt: 'Comprimento do filtro',
                nl: 'Filterlengte',
                fr: 'Longueur du filtre',
                it: 'Lunghezza del filtro',
                es: 'Longitud del filtro',
                pl: 'Długość filtra',
                uk: 'Довжина фільтра',
                'zh-cn': '滤波长度',
            },
            'Mgmt.ProcessVersion': {
                en: 'Driver version',
                de: 'Treiberversion',
                ru: 'Версия драйвера',
                pt: 'Versão do driver',
                nl: 'Driverversie',
                fr: 'Version du pilote',
                it: 'Versione del driver',
                es: 'Versión del controlador',
                pl: 'Wersja sterownika',
                uk: 'Версія драйвера',
                'zh-cn': '驱动版本',
            },
            // evcharger (S3)
            'Ac.Voltage': {
                en: 'AC voltage',
                de: 'AC Spannung',
                ru: 'Напряжение AC',
                pt: 'Tensão AC',
                nl: 'AC-spanning',
                fr: 'Tension AC',
                it: 'Tensione AC',
                es: 'Tensión AC',
                pl: 'Napięcie AC',
                uk: 'Напруга AC',
                'zh-cn': '交流电压',
            },
            ChargingTime: {
                en: 'Charging time',
                de: 'Ladezeit',
                ru: 'Время зарядки',
                pt: 'Tempo de carregamento',
                nl: 'Laadtijd',
                fr: 'Temps de charge',
                it: 'Tempo di ricarica',
                es: 'Tiempo de carga',
                pl: 'Czas ładowania',
                uk: 'Час заряджання',
                'zh-cn': '充电时间',
            },
            Current: {
                en: 'Current',
                de: 'Strom',
                ru: 'Ток',
                pt: 'Corrente',
                nl: 'Stroom',
                fr: 'Courant',
                it: 'Corrente',
                es: 'Corriente',
                pl: 'Prąd',
                uk: 'Струм',
                'zh-cn': '电流',
            },
            FirmwareVersion: {
                en: 'Firmware version',
                de: 'Firmware-Version',
                ru: 'Версия прошивки',
                pt: 'Versão do firmware',
                nl: 'Firmwareversie',
                fr: 'Version du firmware',
                it: 'Versione firmware',
                es: 'Versión de firmware',
                pl: 'Wersja oprogramowania',
                uk: 'Версія прошивки',
                'zh-cn': '固件版本',
            },
            HardwareVersion: {
                en: 'Hardware version',
                de: 'Hardware-Version',
                ru: 'Версия оборудования',
                pt: 'Versão de hardware',
                nl: 'Hardwareversie',
                fr: 'Version matérielle',
                it: 'Versione hardware',
                es: 'Versión de hardware',
                pl: 'Wersja sprzętu',
                uk: 'Версія обладнання',
                'zh-cn': '硬件版本',
            },
            'MCU.Temperature': {
                en: 'MCU temperature',
                de: 'MCU-Temperatur',
                ru: 'Температура MCU',
                pt: 'Temperatura do MCU',
                nl: 'MCU-temperatuur',
                fr: 'Température MCU',
                it: 'Temperatura MCU',
                es: 'Temperatura del MCU',
                pl: 'Temperatura MCU',
                uk: 'Температура MCU',
                'zh-cn': 'MCU温度',
            },
            MaxCurrent: {
                en: 'Maximum current',
                de: 'Maximaler Strom',
                ru: 'Максимальный ток',
                pt: 'Corrente máxima',
                nl: 'Maximale stroom',
                fr: 'Courant maximal',
                it: 'Corrente massima',
                es: 'Corriente máxima',
                pl: 'Maksymalny prąd',
                uk: 'Максимальний струм',
                'zh-cn': '最大电流',
            },
            SetCurrent: {
                en: 'Charging current setpoint',
                de: 'Ladestrom-Sollwert',
                ru: 'Заданный ток зарядки',
                pt: 'Ponto de ajuste da corrente de carga',
                nl: 'Instelpunt laadstroom',
                fr: 'Consigne de courant de charge',
                it: 'Setpoint corrente di ricarica',
                es: 'Punto de ajuste de corriente de carga',
                pl: 'Zadany prąd ładowania',
                uk: 'Заданий струм заряджання',
                'zh-cn': '充电电流设定值',
            },
            StartStop: {
                en: 'Charging enabled',
                de: 'Laden freigegeben',
                ru: 'Зарядка разрешена',
                pt: 'Carregamento habilitado',
                nl: 'Laden ingeschakeld',
                fr: 'Charge activée',
                it: 'Ricarica abilitata',
                es: 'Carga habilitada',
                pl: 'Ładowanie włączone',
                uk: 'Заряджання дозволено',
                'zh-cn': '充电已启用',
            },
            UpdateIndex: {
                en: 'Update index',
                de: 'Update-Index',
                ru: 'Индекс обновления',
                pt: 'Índice de atualização',
                nl: 'Update-index',
                fr: 'Index de mise à jour',
                it: 'Indice di aggiornamento',
                es: 'Índice de actualización',
                pl: 'Indeks aktualizacji',
                uk: 'Індекс оновлення',
                'zh-cn': '更新索引',
            },
        };
        if (names[path]) {
            return names[path];
        }
        if (path.startsWith('cells.cell')) {
            const n = parseInt(path.replace('cells.cell', ''), 10);
            return {
                en: `Cell ${n}`,
                de: `Zelle ${n}`,
                ru: `Cell ${n}`,
                pt: `Cell ${n}`,
                nl: `Cell ${n}`,
                fr: `Cell ${n}`,
                it: `Cell ${n}`,
                es: `Cell ${n}`,
                pl: `Cell ${n}`,
                uk: `Cell ${n}`,
                'zh-cn': `Cell ${n}`,
            };
        }
        return path;
    }

    private getUnit(path: string): string {
        if (path.startsWith('alarms.')) {
            return '';
        }
        // Vor den generischen Power-/Energy-Substring-Checks: PowerFactor/IsGenericEnergyMeter
        // enthalten "Power" bzw. "Energy" als Teilstring, sind aber selbst keine Leistungs-/
        // Energiewerte (dimensionslos bzw. boolean) - §4.14 acload-Ergänzungen.
        if (path.endsWith('PowerFactor') || path === 'IsGenericEnergyMeter') {
            return '';
        }
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
        if (
            path.includes('Power') ||
            path === 'Hub4.L1.AcPowerSetpoint' ||
            path.endsWith('.P') ||
            path === 'Ac.Power'
        ) {
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
        if (path.startsWith('temperatures.') || path === 'Temperature') {
            return '°C';
        }
        if (path.endsWith('.S')) {
            return 'VA';
        }
        if (path.endsWith('.F') || path === 'Ac.Frequency') {
            return 'Hz';
        }
        if (path === 'Yield.Today' || path === 'Yield.Total') {
            return 'kWh';
        }
        if (path === 'Level' || path === 'Humidity') {
            return '%';
        }
        if (path === 'Remaining') {
            return 'm³';
        }
        if (path === 'Pressure') {
            return 'hPa';
        }
        if (path.includes('ConsumedAmphours')) {
            return 'Ah';
        }
        if (path === 'Capacity') {
            // Wird gerätetyp-abhängig überschrieben; Default für Batterie
            return 'Ah';
        }
        if (path === 'Ac.MaxPower' || path === 'Ac.PowerLimit') {
            return 'W';
        }
        if (path === 'Irradiance') {
            return 'W/m²';
        }
        if (path === 'WindSpeed') {
            return 'm/s';
        }
        if (path === 'WindDirection') {
            return '°';
        }
        if (path === 'ExternalTemperature' || path === 'MCU.Temperature') {
            return '°C';
        }
        if (path === 'ChargingTime') {
            return 's';
        }
        return '';
    }

    private getRole(path: string): string {
        if (path.startsWith('alarms.')) {
            return 'value.warning';
        }
        if (path === 'State') {
            return 'value';
        }
        // Vor den generischen Power-/Energy-Substring-Checks: PowerFactor/IsGenericEnergyMeter
        // enthalten "Power" bzw. "Energy" als Teilstring, sind aber selbst keine Leistungs-/
        // Energiewerte (dimensionslos bzw. boolean) - §4.14 acload-Ergänzungen.
        if (path.endsWith('PowerFactor') || path === 'IsGenericEnergyMeter') {
            return 'value';
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
        if (
            path.includes('Power') ||
            path === 'Hub4.L1.AcPowerSetpoint' ||
            path.endsWith('.P') ||
            path === 'Ac.Power' ||
            path.endsWith('.S')
        ) {
            return 'value.power';
        }
        if (path.includes('Current') || path.endsWith('.I')) {
            return 'value.current';
        }
        if (path.endsWith('.F') || path === 'Ac.Frequency') {
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
        if (path === 'Temperature' || path === 'ExternalTemperature') {
            return 'value.temperature';
        }
        if (path === 'Humidity') {
            return 'value.humidity';
        }
        if (path === 'Pressure') {
            return 'value.pressure';
        }
        if (path === 'Irradiance') {
            return 'value';
        }
        if (path === 'WindSpeed') {
            return 'value.speed.wind';
        }
        if (path === 'WindDirection') {
            return 'value.direction.wind';
        }
        if (path === 'cells.minId' || path === 'cells.maxId') {
            return 'text';
        }
        if (path === 'MCU.Temperature') {
            return 'value.temperature';
        }
        if (path === 'ChargingTime') {
            return 'value.interval';
        }
        return 'value';
    }

    // ── Adapter-Stop ─────────────────────────────────────────────────────────
    private onMessage(obj: ioBroker.Message): void {
        if (obj.command === 'downloadMap') {
            const json = JSON.stringify(this.topicMap, null, 2);
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, { result: json }, obj.callback);
            }
            return;
        }
        if (obj.command === 'openTopicMap') {
            if (obj.callback) {
                this.sendTo(
                    obj.from,
                    obj.command,
                    { openUrl: '/adapter/victron-gx/tab_map.html', window: '_blank' },
                    obj.callback,
                );
            }
            return;
        }
        if (obj.command === 'downloadCatalog') {
            const json = JSON.stringify(this.topicCatalog, null, 2);
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, { result: json }, obj.callback);
            }
            return;
        }
    }

    private onUnload(callback: () => void): void {
        try {
            if (this.keepAliveInterval) {
                this.clearInterval(this.keepAliveInterval);
            }
            if (this.acPowerSetpointInterval) {
                this.clearInterval(this.acPowerSetpointInterval);
                this.acPowerSetpointInterval = null;
            }
            if (this.cleanupTimer) {
                this.clearTimeout(this.cleanupTimer);
                this.cleanupTimer = null;
            }
            for (const pending of this.pendingOutputs.values()) {
                if (pending.timer) {
                    this.clearTimeout(pending.timer);
                }
            }
            this.pendingOutputs.clear();
            for (const device of this.deviceMap.values()) {
                if (device.staleTimer) {
                    this.clearTimeout(device.staleTimer);
                }
                if (device.deviceCommitTimer) {
                    this.clearTimeout(device.deviceCommitTimer);
                }
            }
            if (this.mqttClient) {
                this.mqttClient.end();
            }
            if (this.modbusClient) {
                this.modbusClient.close(() => {});
            }
            callback();
        } catch (error) {
            this.log.error(`Error during shutdown: ${(error as Error).message}`);
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new VictronGx(options);
} else {
    (() => new VictronGx())();
}
