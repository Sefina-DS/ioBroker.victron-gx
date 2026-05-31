"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var mqtt = __toESM(require("mqtt"));
var import_modbus_serial = __toESM(require("modbus-serial"));
const KNOWN_DEVICE_TYPES = {
  battery: "Batterie",
  vebus: "Wechselrichter",
  solarcharger: "Solarladeregler (MPPT)",
  acload: "AC Last",
  grid: "Netzanschluss",
  pvinverter: "PV Wechselrichter",
  switch: "Virtueller Schalter",
  overview: "\xDCbersicht",
  platform: "GX Ger\xE4t",
  temperature: "Temperatursensor",
  tank: "Tanksensor"
};
const RELEVANT_PATHS = {
  battery: [
    "Soc",
    "Dc.0.Voltage",
    "Dc.0.Current",
    "Dc.0.Power",
    "Dc.0.Temperature",
    "ConsumedAmphours",
    "TimeToGo",
    "Capacity",
    "CurrentAvg",
    "System.Temperature1",
    "System.Temperature2",
    "System.Temperature3",
    "System.Temperature4",
    "System.MinCellTemperature",
    "System.MaxCellTemperature",
    "System.MinCellVoltage",
    "System.MaxCellVoltage",
    "System.MinVoltageCellId",
    "System.MaxVoltageCellId",
    "Alarms.LowVoltage",
    "Alarms.HighVoltage",
    "Alarms.LowSoc",
    "Voltages.Cell1",
    "Voltages.Cell2",
    "Voltages.Cell3",
    "Voltages.Cell4",
    "Voltages.Cell5",
    "Voltages.Cell6",
    "Voltages.Cell7",
    "Voltages.Cell8",
    "Voltages.Cell9",
    "Voltages.Cell10",
    "Voltages.Cell11",
    "Voltages.Cell12",
    "Voltages.Cell13",
    "Voltages.Cell14",
    "Voltages.Cell15",
    "Voltages.Cell16",
    "Voltages.Cell17",
    "Voltages.Cell18",
    "Voltages.Cell19",
    "Voltages.Cell20",
    "Voltages.Cell21",
    "Voltages.Cell22",
    "Voltages.Cell23",
    "Voltages.Cell24",
    "Voltages.Cell25",
    "Voltages.Cell26",
    "Voltages.Cell27",
    "Voltages.Cell28",
    "Voltages.Cell29",
    "Voltages.Cell30",
    "Voltages.Cell31",
    "Voltages.Cell32",
    "Voltages.Diff",
    "Serial",
    "ProductName",
    "CustomName"
  ],
  vebus: [
    "Soc",
    "State",
    "Mode",
    "VebusError",
    "VebusChargeState",
    "Ac.ActiveIn.L1.P",
    "Ac.ActiveIn.L1.S",
    "Ac.ActiveIn.L1.I",
    "Ac.ActiveIn.L1.V",
    "Ac.ActiveIn.L2.P",
    "Ac.ActiveIn.L3.P",
    "Ac.ActiveIn.P",
    "Ac.ActiveIn.S",
    "Ac.In1.CurrentLimit",
    "Ac.Out.L1.P",
    "Ac.Out.L1.S",
    "Ac.Out.L1.I",
    "Ac.Out.L1.V",
    "Ac.Out.L1.F",
    "Ac.Out.L2.P",
    "Ac.Out.L3.P",
    "Ac.Out.P",
    "Ac.Out.S",
    "Dc.0.Voltage",
    "Dc.0.Current",
    "Dc.0.Power",
    "BatterySense.Voltage",
    "Hub4.L1.AcPowerSetpoint",
    "Hub4.DisableFeedIn",
    "Hub4.DisableCharge",
    "Serial",
    "ProductName",
    "CustomName",
    "Devices.0.SerialNumber"
  ],
  solarcharger: [
    "Pv.V",
    "Pv.P",
    "Dc.0.Voltage",
    "Dc.0.Current",
    "State",
    "Yield.Power",
    "Yield.Today",
    "Yield.Total",
    "Serial",
    "ProductName",
    "CustomName"
  ],
  grid: [
    "Ac.L1.Power",
    "Ac.L2.Power",
    "Ac.L3.Power",
    "Ac.L1.Voltage",
    "Ac.L2.Voltage",
    "Ac.L3.Voltage",
    "Ac.L1.Current",
    "Ac.L2.Current",
    "Ac.L3.Current",
    "Ac.Energy.Forward",
    "Ac.Energy.Reverse",
    "Serial",
    "ProductName",
    "CustomName",
    "Connected",
    "Position"
  ],
  acload: [
    "Ac.L1.Power",
    "Ac.L2.Power",
    "Ac.L3.Power",
    "Ac.L1.Voltage",
    "Ac.L2.Voltage",
    "Ac.L3.Voltage",
    "Ac.L1.Current",
    "Ac.L2.Current",
    "Ac.L3.Current",
    "Ac.L1.Energy.Forward",
    "Ac.L2.Energy.Forward",
    "Ac.L3.Energy.Forward",
    "Ac.Energy.Forward",
    "Serial",
    "ProductName",
    "CustomName",
    "Mgmt.Connection",
    "Mgmt.ProcessName",
    "Connected",
    "Position",
    "NrOfPhases"
  ],
  pvinverter: [
    "Ac.L1.Power",
    "Ac.L2.Power",
    "Ac.L3.Power",
    "Ac.L1.Voltage",
    "Ac.L2.Voltage",
    "Ac.L3.Voltage",
    "Ac.L1.Current",
    "Ac.L2.Current",
    "Ac.L3.Current",
    "Ac.L1.Energy.Forward",
    "Ac.L2.Energy.Forward",
    "Ac.L3.Energy.Forward",
    "Ac.Energy.Forward",
    "Ac.Energy.Reverse",
    "Ac.Frequency",
    "Ac.MaxPower",
    "Ac.PowerLimit",
    "StatusCode",
    "ErrorCode",
    "Serial",
    "ProductName",
    "CustomName",
    "Mgmt.Connection",
    "Mgmt.ProcessName",
    "Connected",
    "Position",
    "NrOfPhases"
  ],
  switch: [
    "SwitchableOutput.output_1.State",
    "SwitchableOutput.output_1.Status",
    "Connected",
    "Serial",
    "ProductName",
    "CustomName",
    "Mgmt.Connection",
    "Mgmt.ProcessName",
    "SwitchableOutput.output_1.Settings.CustomName",
    "SwitchableOutput.output_1.Settings.Group"
  ],
  system: [
    "Dc.Battery.Soc",
    "Dc.Battery.Voltage",
    "Dc.Battery.Current",
    "Dc.Battery.Power",
    "Dc.Battery.ConsumedAmphours",
    "Dc.System.Power",
    "Dc.System.Current",
    "Dc.Vebus.Power",
    "Dc.Vebus.Current",
    "Dc.InverterCharger.Power",
    "Dc.InverterCharger.Current",
    "Ac.Consumption.L1.Power",
    "Ac.Consumption.L2.Power",
    "Ac.Consumption.L3.Power",
    "Ac.Consumption.L1.Current",
    "Ac.Consumption.L2.Current",
    "Ac.Consumption.L3.Current",
    "Ac.ConsumptionOnOutput.L1.Power",
    "Ac.ConsumptionOnOutput.L2.Power",
    "Ac.ConsumptionOnOutput.L3.Power",
    "Ac.ConsumptionOnOutput.L1.Current",
    "Ac.ConsumptionOnOutput.L2.Current",
    "Ac.ConsumptionOnOutput.L3.Current",
    "Ac.ConsumptionOnInput.L1.Power",
    "Ac.ConsumptionOnInput.L2.Power",
    "Ac.ConsumptionOnInput.L3.Power",
    "Ac.ConsumptionOnInput.L1.Current",
    "Ac.ConsumptionOnInput.L2.Current",
    "Ac.ConsumptionOnInput.L3.Current",
    "Ac.Grid.L1.Power",
    "Ac.Grid.L2.Power",
    "Ac.Grid.L3.Power",
    "Ac.Grid.L1.Current",
    "Ac.Grid.L2.Current",
    "Ac.Grid.L3.Current",
    "Ac.PvOnGrid.L1.Power",
    "Ac.PvOnGrid.L2.Power",
    "Ac.PvOnGrid.L3.Power",
    "Ac.PvOnGrid.L1.Current",
    "Ac.PvOnGrid.L2.Current",
    "Ac.PvOnGrid.L3.Current",
    "Ac.ActiveIn.L1.Power",
    "Ac.ActiveIn.L2.Power",
    "Ac.ActiveIn.L3.Power",
    "Ac.ActiveIn.L1.Current",
    "Ac.ActiveIn.L2.Current",
    "Ac.ActiveIn.L3.Current",
    "Ac.ActiveIn.Source",
    "TimeToGo",
    "SystemState.State",
    "Serial"
  ],
  temperature: ["Temperature", "Humidity", "Pressure", "ProductName", "CustomName"],
  tank: ["Level", "Remaining", "Status", "ProductName", "CustomName"]
};
const REGISTRATION_PATHS = /* @__PURE__ */ new Set([
  "Serial",
  "ProductName",
  "CustomName",
  "Devices.0.SerialNumber",
  "Connected",
  "Position",
  "NrOfPhases",
  "Mgmt.Connection",
  "Mgmt.ProcessName",
  "SwitchableOutput.output_1.Settings.CustomName",
  "SwitchableOutput.output_1.Settings.Group"
]);
const PATH_REMAP = {
  switch: {
    "SwitchableOutput.output_1.State": "State",
    "SwitchableOutput.output_1.Status": "Status"
  },
  battery: {
    "Dc.0.Temperature": "temperatures.main",
    "System.Temperature1": "temperatures.temp1",
    "System.Temperature2": "temperatures.temp2",
    "System.Temperature3": "temperatures.temp3",
    "System.Temperature4": "temperatures.temp4",
    "System.MinCellTemperature": "temperatures.min",
    "System.MaxCellTemperature": "temperatures.max",
    "System.MinCellVoltage": "cells.min",
    "System.MaxCellVoltage": "cells.max",
    "System.MinVoltageCellId": "cells.minId",
    "System.MaxVoltageCellId": "cells.maxId",
    "Voltages.Cell1": "cells.cell01",
    "Voltages.Cell2": "cells.cell02",
    "Voltages.Cell3": "cells.cell03",
    "Voltages.Cell4": "cells.cell04",
    "Voltages.Cell5": "cells.cell05",
    "Voltages.Cell6": "cells.cell06",
    "Voltages.Cell7": "cells.cell07",
    "Voltages.Cell8": "cells.cell08",
    "Voltages.Cell9": "cells.cell09",
    "Voltages.Cell10": "cells.cell10",
    "Voltages.Cell11": "cells.cell11",
    "Voltages.Cell12": "cells.cell12",
    "Voltages.Cell13": "cells.cell13",
    "Voltages.Cell14": "cells.cell14",
    "Voltages.Cell15": "cells.cell15",
    "Voltages.Cell16": "cells.cell16",
    "Voltages.Cell17": "cells.cell17",
    "Voltages.Cell18": "cells.cell18",
    "Voltages.Cell19": "cells.cell19",
    "Voltages.Cell20": "cells.cell20",
    "Voltages.Cell21": "cells.cell21",
    "Voltages.Cell22": "cells.cell22",
    "Voltages.Cell23": "cells.cell23",
    "Voltages.Cell24": "cells.cell24",
    "Voltages.Cell25": "cells.cell25",
    "Voltages.Cell26": "cells.cell26",
    "Voltages.Cell27": "cells.cell27",
    "Voltages.Cell28": "cells.cell28",
    "Voltages.Cell29": "cells.cell29",
    "Voltages.Cell30": "cells.cell30",
    "Voltages.Cell31": "cells.cell31",
    "Voltages.Cell32": "cells.cell32",
    "Voltages.Diff": "cells.diff",
    "Temperature": "temperatures.temp1",
    "Temperature2": "temperatures.temp2",
    "Temperature3": "temperatures.temp3",
    "Temperature4": "temperatures.temp4",
    "Alarms.LowVoltage": "alarms.lowVoltage",
    "Alarms.HighVoltage": "alarms.highVoltage",
    "Alarms.LowSoc": "alarms.lowSoc"
  }
};
const WRITE_PATH_REMAP = {
  switch: { State: "SwitchableOutput/output_1/State" }
};
const WRITABLE_PATHS = {
  switch: ["State"]
  // vebus: read-only via MQTT; schreibbar nur via Modbus über control.*
  // ess:   read-only via MQTT; schreibbar nur via Modbus über control.*
};
const CONTROL_REGISTERS = {
  // ── Inverter (vebus, Unit 238) ───────────────────────────────────────────
  "inverter.Mode": {
    register: 33,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: "Betriebsmodus",
    write: true,
    states: { 1: "Nur Laden", 2: "Nur Wechselrichter", 3: "Ein (Normal)", 4: "Aus (APS)" }
  },
  "inverter.AcIn1CurrentLimit": {
    register: 22,
    scaleRead: 0.1,
    scaleWrite: 10,
    signed: false,
    unit: "A",
    name: "Eingangsstrombegrenzung",
    write: true
  },
  "inverter.AcPowerSetpoint": {
    register: 37,
    scaleRead: 1,
    scaleWrite: 1,
    signed: true,
    unit: "W",
    name: "ESS Sollwert (Reg 37)",
    write: true
    // Positiv = Netz → Akku laden, Negativ = Akku → Netz einspeisen
    // Keepalive nötig! Wird alle 800ms wiederholt wenn ≠ 0
  },
  "inverter.DisableCharge": {
    register: 38,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: "Laden sperren",
    write: true,
    states: { 0: "Laden erlaubt", 1: "Laden gesperrt" }
  },
  "inverter.DisableFeedIn": {
    register: 39,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: "AC-Einspeisung sperren",
    write: true,
    states: { 0: "Einspeisung erlaubt", 1: "Einspeisung gesperrt" }
  },
  // ── System / ESS-Einstellungen (Unit 100) ────────────────────────────────
  "system.GridSetpoint": {
    register: 2700,
    scaleRead: 1,
    scaleWrite: 1,
    signed: true,
    unit: "W",
    name: "Grid-Sollwert",
    write: true
    // 0=Nulleinspeisung, +W=Grid-Bezug, -W=Einspeisung
    // Victron ESS-Algorithmus regelt Reg 37 automatisch auf diesen Wert
  },
  "system.EssMode": {
    register: 2902,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: "ESS Phasenmodus",
    write: true,
    states: { 1: "Mit Phasenkompensation", 2: "Ohne Phasenkompensation", 3: "Externe Steuerung" }
  },
  "system.BatteryLifeState": {
    register: 2900,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: "BatteryLife Modus",
    write: true,
    states: {
      0: "Deaktiviert",
      2: "Self-consumption",
      3: "Self-consumption",
      4: "Self-consumption (mit BatteryLife)",
      5: "Entladung deaktiviert",
      6: "Zwangsladen",
      7: "Sustain",
      8: "Low SoC Nachladen",
      9: "Batterie geladen halten",
      10: "Ohne BatteryLife",
      11: "Ohne BatteryLife (Low SoC)",
      12: "Ohne BatteryLife (Low SoC Nachladen)"
    }
  },
  "system.MinimumSoc": {
    register: 2901,
    scaleRead: 0.1,
    scaleWrite: 10,
    signed: false,
    unit: "%",
    name: "Minimum SoC (au\xDFer Netzausfall)",
    write: true
  },
  "system.BatteryLifeSocLimit": {
    register: 2903,
    scaleRead: 0.1,
    scaleWrite: 10,
    signed: false,
    unit: "%",
    name: "BatteryLife SoC Limit",
    write: false
  },
  "system.MaxFeedInPower": {
    register: 2706,
    scaleRead: 0.01,
    scaleWrite: 100,
    signed: true,
    unit: "W",
    name: "Max. Einspeisung",
    write: true
    // -1 = kein Limit, 0 = gesperrt, >0 = Limit in W
  },
  "system.AcFeedInEnabled": {
    register: 2708,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: "AC-Einspeisung ins Netz",
    write: true,
    states: { 0: "Einspeisung erlaubt", 1: "Einspeisung gesperrt" }
  },
  "system.DcFeedInEnabled": {
    register: 2707,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: "DC-\xDCberschuss ins Netz (Overvoltage Feed-in)",
    write: true,
    states: { 0: "Deaktiviert", 1: "Aktiviert" }
  },
  "system.FeedInLimitActive": {
    register: 2709,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: "Einspeisebegrenzung aktiv",
    write: false,
    states: { 0: "Nein", 1: "Ja" }
  },
  "system.DvccMaxChargeCurrent": {
    register: 2705,
    scaleRead: 1,
    scaleWrite: 1,
    signed: true,
    unit: "A",
    name: "DVCC Max. Ladestrom",
    write: true
    // -1 = kein Limit (DVCC deaktiviert für Ladestrom)
  },
  "system.MaxDischargePower": {
    register: 2704,
    scaleRead: 0.1,
    scaleWrite: 10,
    signed: true,
    unit: "W",
    name: "Max. Entladeleistung",
    write: true
    // Victron Scalefactor 0.1 → raw * 0.1 = W
    // Nur aktiv wenn DVCC aktiviert
  }
};
const PVINVERTER_STATUS = {
  0: "Aus",
  1: "Keine Verbindung",
  2: "Fehler",
  3: "Aus (Nacht)",
  7: "In Betrieb",
  8: "Normalbetrieb",
  9: "Tempor\xE4re Last-Reduzierung",
  10: "Maximale Ausgangsleistung"
};
const STATES_MAP = {
  vebus: {
    Mode: { 1: "Nur Laden", 2: "Nur Wechselrichter", 3: "Ein (Normal)", 4: "Aus (APS)" },
    State: {
      0: "Aus",
      1: "Niedriglast",
      2: "Fehler",
      3: "Bulk (Laden)",
      4: "Absorption",
      5: "Float",
      6: "Speicher",
      7: "Ausgleichsladen",
      8: "Passthrough",
      9: "Wechselrichter aktiv",
      10: "Power Assist",
      11: "Stromversorgung",
      244: "Sustain",
      252: "Externe Steuerung"
    },
    "Hub4.DisableFeedIn": { 0: "Einspeisung erlaubt", 1: "Einspeisung gesperrt" },
    "Hub4.DisableCharge": { 0: "Laden erlaubt", 1: "Laden gesperrt" },
    VebusChargeState: {
      0: "Initialisierung",
      1: "Bulk",
      2: "Absorption",
      3: "Float",
      4: "Speicher",
      5: "Ausgleichsladen",
      6: "Wiederherstellen"
    }
  },
  battery: {
    "alarms.lowVoltage": { 0: "OK", 1: "Warnung", 2: "Alarm" },
    "alarms.highVoltage": { 0: "OK", 1: "Warnung", 2: "Alarm" },
    "alarms.lowSoc": { 0: "OK", 1: "Warnung", 2: "Alarm" }
  }
};
const OVERVIEW_TOTAL_POWER = {
  "Ac.Consumption.L1.Power": { sources: ["Ac.Consumption.L1.Power", "Ac.Consumption.L2.Power", "Ac.Consumption.L3.Power"], target: "Ac.Consumption.Power" },
  "Ac.Consumption.L2.Power": { sources: ["Ac.Consumption.L1.Power", "Ac.Consumption.L2.Power", "Ac.Consumption.L3.Power"], target: "Ac.Consumption.Power" },
  "Ac.Consumption.L3.Power": { sources: ["Ac.Consumption.L1.Power", "Ac.Consumption.L2.Power", "Ac.Consumption.L3.Power"], target: "Ac.Consumption.Power" },
  "Ac.Grid.L1.Power": { sources: ["Ac.Grid.L1.Power", "Ac.Grid.L2.Power", "Ac.Grid.L3.Power"], target: "Ac.Grid.Power" },
  "Ac.Grid.L2.Power": { sources: ["Ac.Grid.L1.Power", "Ac.Grid.L2.Power", "Ac.Grid.L3.Power"], target: "Ac.Grid.Power" },
  "Ac.Grid.L3.Power": { sources: ["Ac.Grid.L1.Power", "Ac.Grid.L2.Power", "Ac.Grid.L3.Power"], target: "Ac.Grid.Power" },
  "Ac.PvOnGrid.L1.Power": { sources: ["Ac.PvOnGrid.L1.Power", "Ac.PvOnGrid.L2.Power", "Ac.PvOnGrid.L3.Power"], target: "Ac.PvOnGrid.Power" },
  "Ac.PvOnGrid.L2.Power": { sources: ["Ac.PvOnGrid.L1.Power", "Ac.PvOnGrid.L2.Power", "Ac.PvOnGrid.L3.Power"], target: "Ac.PvOnGrid.Power" },
  "Ac.PvOnGrid.L3.Power": { sources: ["Ac.PvOnGrid.L1.Power", "Ac.PvOnGrid.L2.Power", "Ac.PvOnGrid.L3.Power"], target: "Ac.PvOnGrid.Power" }
};
const PHASE_POWER_PATHS = {
  pvinverter: ["Ac.L1.Power", "Ac.L2.Power", "Ac.L3.Power"],
  acload: ["Ac.L1.Power", "Ac.L2.Power", "Ac.L3.Power"],
  grid: ["Ac.L1.Power", "Ac.L2.Power", "Ac.L3.Power"]
};
const PHASE_VOLTAGE_PATHS = {
  pvinverter: ["Ac.L1.Voltage", "Ac.L2.Voltage", "Ac.L3.Voltage"],
  acload: ["Ac.L1.Voltage", "Ac.L2.Voltage", "Ac.L3.Voltage"],
  grid: ["Ac.L1.Voltage", "Ac.L2.Voltage", "Ac.L3.Voltage"]
};
const CELL_PATH_RE = /^cells\.cell\d+$/;
const STALE_TIMEOUT_MS = 5 * 60 * 1e3;
const ESS_MQTT_MAP = {
  "Settings.CGwacs.Hub4Mode": "system.EssMode",
  "Settings.CGwacs.BatteryLife.MinimumSocLimit": "system.MinimumSoc",
  "Settings.CGwacs.BatteryLife.State": "system.BatteryLifeState",
  "Settings.CGwacs.BatteryLife.SocLimit": "system.BatteryLifeSocLimit",
  "Settings.CGwacs.AcPowerSetPoint": "system.GridSetpoint",
  "Settings.CGwacs.MaxFeedInPower": "system.MaxFeedInPower",
  "Settings.CGwacs.PreventFeedback": "system.AcFeedInEnabled",
  "Settings.CGwacs.OvervoltageFeedIn": "system.DcFeedInEnabled",
  "Settings.CGwacs.PvPowerLimiterActive": "system.FeedInLimitActive"
  // DvccMaxChargeCurrent und MaxDischargePower kommen nicht per MQTT → nur Modbus
};
class VictronGx extends utils.Adapter {
  mqttClient = null;
  keepAliveInterval = null;
  acPowerSetpointInterval = null;
  vrmId = "";
  deviceMap = /* @__PURE__ */ new Map();
  serialMap = /* @__PURE__ */ new Map();
  loggedDevices = /* @__PURE__ */ new Set();
  channelReady = /* @__PURE__ */ new Set();
  modbusClient = null;
  modbusUnitMap = /* @__PURE__ */ new Map();
  modbusBusy = false;
  constructor(options = {}) {
    super({ ...options, name: "victron-gx" });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  // ── Adapter-Start ────────────────────────────────────────────────────────
  onReady() {
    void this.setState("info.connection", false, true);
    void this.setObjectNotExistsAsync("info.modbusConnected", {
      type: "state",
      common: { name: "Modbus TCP verbunden", type: "boolean", role: "indicator.connected", read: true, write: false, def: false },
      native: {}
    });
    void this.setObjectNotExistsAsync("info.modbusWritable", {
      type: "state",
      common: { name: "Modbus Schreibzugriff", type: "boolean", role: "indicator", read: true, write: false, def: false },
      native: {}
    });
    void this.setState("info.modbusConnected", false, true);
    void this.setState("info.modbusWritable", false, true);
    this.subscribeStates("devices.switch.*");
    if (this.config.controlEnabled) {
      this.subscribeStates("control.*");
    }
    void this.cleanupNumericChannels();
    void this.cleanupLegacyChannels();
    const host = this.config.host;
    const port = this.config.port || 1883;
    if (!host) {
      this.log.error("Keine IP-Adresse konfiguriert!");
      return;
    }
    this.log.info(`Verbinde mit Victron GX unter ${host}:${port}...`);
    this.connectMqtt(host, port, this.config.mqttUsername, this.config.mqttPassword);
    if (this.config.controlEnabled) {
      const modbusPort = this.config.modbusPort || 502;
      this.log.info(`Steuerung aktiviert \u2013 verbinde Modbus TCP ${host}:${modbusPort}...`);
      void this.connectModbus(host, modbusPort);
    }
  }
  // ── Bereinigung alte Struktur ─────────────────────────────────────────────
  async cleanupLegacyChannels() {
    try {
      await this.delObjectAsync("ess", { recursive: true });
      this.log.info("Alte ess.* Struktur bereinigt");
    } catch {
    }
  }
  async cleanupNumericChannels() {
    try {
      const allObjects = await this.getObjectListAsync({
        startkey: `${this.namespace}.devices.`,
        endkey: `${this.namespace}.devices.\u9999`
      });
      for (const obj of allObjects.rows) {
        const id = obj.id.replace(`${this.namespace}.`, "");
        const parts = id.split(".");
        if (parts.length !== 3) continue;
        if (/^\d{1,3}$/.test(parts[2])) {
          this.log.debug(`Bereinige numerischen Channel: ${id}`);
          await this.delObjectAsync(id, { recursive: true }).catch(() => {
          });
        }
      }
    } catch {
    }
  }
  // ── MQTT ─────────────────────────────────────────────────────────────────
  connectMqtt(host, port, username, password) {
    const options = {
      port,
      clientId: `iobroker_victron_${Math.random().toString(16).slice(2)}`,
      clean: true,
      reconnectPeriod: 5e3
    };
    if (username) options.username = username;
    if (password) options.password = password;
    this.mqttClient = mqtt.connect(`mqtt://${host}`, options);
    this.mqttClient.on("connect", () => {
      this.log.info("MQTT verbunden mit Victron GX!");
      void this.setState("info.connection", true, true);
      this.mqttClient.subscribe("N/#", (err) => {
        if (err) this.log.error(`Subscribe Fehler: ${err.message}`);
      });
    });
    this.mqttClient.on("message", (topic, payload) => {
      void this.handleMessage(topic, payload);
    });
    this.mqttClient.on("error", (err) => {
      this.log.error(`MQTT Fehler: ${err.message}`);
      void this.setState("info.connection", false, true);
    });
    this.mqttClient.on("offline", () => {
      this.log.warn("MQTT Verbindung getrennt");
      void this.setState("info.connection", false, true);
    });
    this.mqttClient.on("reconnect", () => {
      this.log.info("MQTT verbindet neu...");
      if (this.vrmId) this.startKeepAlive();
    });
  }
  // ── Modbus TCP ───────────────────────────────────────────────────────────
  async connectModbus(host, port) {
    try {
      this.modbusClient = new import_modbus_serial.default();
      await this.modbusClient.connectTCP(host, { port });
      this.modbusClient.setTimeout(3e3);
      this.log.info("Modbus TCP verbunden!");
      void this.setState("info.modbusConnected", true, true);
      void this.testModbusWrite();
      setTimeout(() => void this.discoverModbusUnits(), 2e4);
    } catch (err) {
      this.log.error(`Modbus Verbindungsfehler: ${err.message}`);
      void this.setState("info.modbusConnected", false, true);
      void this.setState("info.modbusWritable", false, true);
      setTimeout(() => void this.connectModbus(host, port), 3e4);
    }
  }
  async testModbusWrite() {
    if (!this.modbusClient) return;
    let vebusEntry;
    for (let i = 0; i < 60; i++) {
      vebusEntry = Array.from(this.modbusUnitMap.entries()).find(([k]) => k.startsWith("vebus/"));
      if (vebusEntry) break;
      await new Promise((r) => setTimeout(r, 1e3));
    }
    if (!vebusEntry) {
      this.log.warn("Modbus Schreibtest: vebus Unit ID nicht bekannt");
      return;
    }
    const [, vebusUnitId] = vebusEntry;
    try {
      if (this.modbusBusy) await this.waitModbus();
      this.modbusBusy = true;
      this.modbusClient.setID(vebusUnitId);
      const result = await this.modbusClient.readHoldingRegisters(37, 1);
      await this.modbusClient.writeRegister(37, result.data[0]);
      this.modbusBusy = false;
      this.log.info(`Modbus Schreibzugriff best\xE4tigt! (vebus Unit ID ${vebusUnitId})`);
      void this.setState("info.modbusWritable", true, true);
    } catch (err) {
      this.modbusBusy = false;
      this.log.warn(`Modbus Schreibzugriff nicht m\xF6glich: ${err.message}`);
      void this.setState("info.modbusWritable", false, true);
    }
  }
  async discoverModbusUnits() {
    if (!this.modbusClient) return;
    this.log.info(`Starte Modbus Unit ID Discovery... (deviceMap: ${this.deviceMap.size} Ger\xE4te)`);
    const TYPE_TEST_REGISTER = {
      vebus: 3,
      battery: 259,
      grid: 2616,
      pvinverter: 1026,
      solarcharger: 771
    };
    const neededTypes = /* @__PURE__ */ new Set(["vebus", "battery", "grid", "pvinverter", "solarcharger"]);
    for (let unitId = 1; unitId <= 247; unitId++) {
      if (neededTypes.size === 0) break;
      for (const type of Array.from(neededTypes)) {
        try {
          if (this.modbusBusy) await this.waitModbus();
          this.modbusBusy = true;
          this.modbusClient.setID(unitId);
          await this.modbusClient.readHoldingRegisters(TYPE_TEST_REGISTER[type], 1);
          this.modbusBusy = false;
          const matchingEntry = Array.from(this.deviceMap.entries()).find(([, d]) => d.type === type);
          if (matchingEntry) {
            const [deviceKey, device] = matchingEntry;
            this.modbusUnitMap.set(deviceKey, unitId);
            neededTypes.delete(type);
            this.log.info(`Modbus Discovery: ${type} \u2192 Unit ID ${unitId}`);
            const serial = this.serialMap.get(deviceKey);
            const baseId = this.getBaseId(device.type, device.instance, serial, device);
            if (baseId) {
              await this.extendObjectAsync(`${baseId}.info.modbusId`, {
                type: "state",
                common: { name: "Modbus Unit ID", type: "number", role: "info", read: true, write: false },
                native: {}
              });
              await this.setState(`${baseId}.info.modbusId`, { val: unitId, ack: true });
            }
          }
          break;
        } catch {
          this.modbusBusy = false;
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    this.log.info(`Modbus Discovery abgeschlossen. ${this.modbusUnitMap.size} Ger\xE4te gefunden.`);
    if (this.config.controlEnabled) {
      try {
        if (this.modbusBusy) await this.waitModbus();
        this.modbusBusy = true;
        this.modbusClient.setID(100);
        await this.modbusClient.readHoldingRegisters(2902, 1);
        this.modbusBusy = false;
        this.modbusUnitMap.set("ess/0", 100);
        this.log.info("Modbus Discovery: ess/settings \u2192 Unit ID 100");
        await this.initControlDatapoints();
      } catch (err) {
        this.modbusBusy = false;
        this.log.warn(`ESS Unit 100 nicht erreichbar: ${err.message}`);
      }
    }
  }
  // ── control.* Datenpunkte anlegen und initial per Modbus lesen ───────────
  async initControlDatapoints() {
    if (!this.modbusClient) return;
    await this.setObjectNotExistsAsync("control", {
      type: "channel",
      common: { name: "Steuerung" },
      native: {}
    });
    await this.setObjectNotExistsAsync("control.inverter", {
      type: "channel",
      common: { name: "Wechselrichter (MP2)" },
      native: {}
    });
    await this.setObjectNotExistsAsync("control.system", {
      type: "channel",
      common: { name: "System / ESS-Einstellungen" },
      native: {}
    });
    const vebusEntry = Array.from(this.modbusUnitMap.entries()).find(([k]) => k.startsWith("vebus/"));
    const vebusUnitId = vebusEntry == null ? void 0 : vebusEntry[1];
    for (const [dpId, reg] of Object.entries(CONTROL_REGISTERS)) {
      const isInverter = dpId.startsWith("inverter.");
      const unitId = isInverter ? vebusUnitId : 100;
      const commonDef = {
        name: reg.name,
        type: "number",
        role: reg.unit === "W" ? "value.power" : reg.unit === "A" ? "value.current" : reg.unit === "%" ? "value" : "value",
        unit: reg.unit,
        read: true,
        write: reg.write && this.config.controlEnabled
      };
      if (reg.states) commonDef.states = reg.states;
      await this.extendObjectAsync(`control.${dpId}`, {
        type: "state",
        common: commonDef,
        native: {}
      });
      if (unitId === void 0) {
        this.log.warn(`control.${dpId}: keine Unit ID bekannt, \xFCberspringe Modbus-Read`);
        continue;
      }
      try {
        if (this.modbusBusy) await this.waitModbus();
        this.modbusBusy = true;
        this.modbusClient.setID(unitId);
        const result = await this.modbusClient.readHoldingRegisters(reg.register, 1);
        this.modbusBusy = false;
        let raw = result.data[0];
        if (reg.signed && raw > 32767) raw = raw - 65536;
        const val = Math.round(raw * reg.scaleRead * 100) / 100;
        await this.setState(`control.${dpId}`, { val, ack: true });
        this.log.info(`control.${dpId} = ${val}${reg.unit} (Reg ${reg.register})`);
      } catch (err) {
        this.modbusBusy = false;
        this.log.warn(`control.${dpId} Modbus-Read Fehler: ${err.message}`);
      }
    }
    this.log.info("control.* Datenpunkte initialisiert");
  }
  // ── Modbus Write ─────────────────────────────────────────────────────────
  async writeControlModbus(dpId, value) {
    if (!this.modbusClient) return;
    const reg = CONTROL_REGISTERS[dpId];
    if (!reg) {
      this.log.warn(`Kein Register f\xFCr control.${dpId}`);
      return;
    }
    const isInverter = dpId.startsWith("inverter.");
    let unitId;
    if (isInverter) {
      const vebusEntry = Array.from(this.modbusUnitMap.entries()).find(([k]) => k.startsWith("vebus/"));
      unitId = vebusEntry == null ? void 0 : vebusEntry[1];
    } else {
      unitId = this.modbusUnitMap.get("ess/0");
    }
    if (unitId === void 0) {
      this.log.warn(`control.${dpId}: keine Modbus Unit ID bekannt`);
      return;
    }
    const rawValue = Math.round(value * reg.scaleWrite);
    const writeValue = reg.signed && rawValue < 0 ? rawValue + 65536 : rawValue;
    try {
      if (this.modbusBusy) await this.waitModbus();
      this.modbusBusy = true;
      this.modbusClient.setID(unitId);
      await this.modbusClient.writeRegister(reg.register, writeValue);
      this.modbusBusy = false;
      this.log.info(`Modbus Write: control.${dpId} = ${value}${reg.unit} \u2192 Reg ${reg.register} = ${writeValue} (Unit ${unitId})`);
      await this.setState(`control.${dpId}`, { val: value, ack: true });
    } catch (err) {
      this.modbusBusy = false;
      this.log.error(`Modbus Write Fehler control.${dpId}: ${err.message}`);
    }
  }
  waitModbus() {
    return new Promise((r) => setTimeout(r, 100));
  }
  // ── AcPowerSetpoint Keepalive ─────────────────────────────────────────────
  // Victron erwartet Reg 37 alle ~1s neu wenn externe Steuerung aktiv
  startAcPowerSetpointKeepalive(value) {
    if (this.acPowerSetpointInterval) {
      this.clearInterval(this.acPowerSetpointInterval);
    }
    if (value === 0) {
      this.acPowerSetpointInterval = null;
      this.log.info("AcPowerSetpoint Keepalive gestoppt");
      return;
    }
    this.acPowerSetpointInterval = this.setInterval(() => {
      void (async () => {
        try {
          const s = await this.getStateAsync("control.inverter.AcPowerSetpoint");
          const v = typeof (s == null ? void 0 : s.val) === "number" ? s.val : 0;
          if (v === 0) {
            if (this.acPowerSetpointInterval) {
              this.clearInterval(this.acPowerSetpointInterval);
              this.acPowerSetpointInterval = null;
            }
            return;
          }
          const reg = CONTROL_REGISTERS["inverter.AcPowerSetpoint"];
          const vebusEntry = Array.from(this.modbusUnitMap.entries()).find(([k]) => k.startsWith("vebus/"));
          if (!vebusEntry || !this.modbusClient) return;
          const [, unitId] = vebusEntry;
          const rawValue = Math.round(v * reg.scaleWrite);
          const writeValue = reg.signed && rawValue < 0 ? rawValue + 65536 : rawValue;
          if (this.modbusBusy) return;
          if (!this.modbusClient) return;
          this.modbusBusy = true;
          this.modbusClient.setID(unitId);
          await this.modbusClient.writeRegister(reg.register, writeValue);
          this.modbusBusy = false;
          this.log.debug(`AcPowerSetpoint Keepalive: ${v}W \u2192 Reg 37 = ${writeValue}`);
        } catch (err) {
          this.modbusBusy = false;
          this.log.warn(`AcPowerSetpoint Keepalive Fehler: ${err.message}`);
        }
      })();
    }, 800);
    this.log.info(`AcPowerSetpoint Keepalive gestartet: ${value}W`);
  }
  startKeepAlive() {
    if (this.keepAliveInterval) this.clearInterval(this.keepAliveInterval);
    this.keepAliveInterval = this.setInterval(() => {
      if (this.mqttClient && this.vrmId) {
        this.mqttClient.publish(`R/${this.vrmId}/keepalive`, "");
        this.log.debug("MQTT Keepalive gesendet");
      }
    }, 5e4);
    if (this.vrmId) this.mqttClient.publish(`R/${this.vrmId}/keepalive`, "");
  }
  // ── Haupt-Message-Handler ────────────────────────────────────────────────
  async handleMessage(topic, payload) {
    var _a, _b, _c, _d, _e;
    try {
      const raw = payload.toString();
      if (!raw) return;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const topicParts = topic.split("/");
      if (topicParts[0] !== "N" || topicParts.length < 3) return;
      const vrmId = topicParts[1];
      if (!this.vrmId && vrmId) {
        this.vrmId = vrmId;
        this.log.info(`VRM ID erkannt: ${vrmId}`);
        this.startKeepAlive();
      }
      const parts = topicParts;
      if (parts.length < 5) return;
      const deviceType = parts[2];
      const instanceStr = parts[3];
      const instance = parseInt(instanceStr, 10);
      const path = parts.slice(4).join("/");
      const normPath = path.replace(/\//g, ".");
      if (!path || !RELEVANT_PATHS[deviceType]) {
        if (deviceType === "settings") {
          await this.handleSettingsMqttUpdate(normPath, parsed);
        }
        return;
      }
      const rawValue = "value" in parsed ? parsed.value : parsed;
      if (rawValue === null || rawValue === void 0) return;
      if (REGISTRATION_PATHS.has(normPath)) {
        if (typeof rawValue === "string" || typeof rawValue === "number") {
          this.updateDeviceMeta(deviceType, instance, normPath, String(rawValue));
        }
        return;
      }
      const remappedPath = (_b = (_a = PATH_REMAP[deviceType]) == null ? void 0 : _a[normPath]) != null ? _b : normPath;
      const isRelevant = RELEVANT_PATHS[deviceType].some((rp) => normPath === rp.replace(/\//g, "."));
      if (!isRelevant) return;
      const deviceKey = `${deviceType}/${instance}`;
      const device = this.deviceMap.get(deviceKey);
      const serial = this.serialMap.get(deviceKey);
      const NO_SERIAL_TYPES = /* @__PURE__ */ new Set(["system", "platform"]);
      if (!serial && !NO_SERIAL_TYPES.has(deviceType)) return;
      const baseId = this.getBaseId(deviceType, instance, serial, device);
      if (!baseId) return;
      if ((device == null ? void 0 : device.virtual) && PHASE_VOLTAGE_PATHS[deviceType]) {
        const vMatch = normPath.match(/^Ac\.(L[123])\.Voltage$/);
        if (vMatch) device.phaseVoltage[vMatch[1]] = typeof rawValue === "number" ? rawValue : 0;
        const pMatch = normPath.match(/^Ac\.(L[123])\./);
        if (pMatch && ((_c = device.phaseVoltage[pMatch[1]]) != null ? _c : 0) === 0) return;
      }
      if (!this.channelReady.has(baseId)) {
        if (device) {
          await this.ensureChannel(baseId, device);
        } else if (baseId === "overview") {
          await this.setObjectNotExistsAsync("overview", {
            type: "channel",
            common: { name: "System\xFCbersicht" },
            native: {}
          });
          this.channelReady.add("overview");
          this.log.debug("Channel angelegt: overview");
        }
      }
      if (device) this.touchDevice(device, baseId);
      const isSwitchBool = deviceType === "switch" && (remappedPath === "State" || remappedPath === "Status");
      const storeValue = isSwitchBool ? rawValue !== 0 : rawValue;
      const storeType = isSwitchBool ? "boolean" : typeof rawValue === "number" ? "number" : typeof rawValue === "boolean" ? "boolean" : "string";
      const isWritable = deviceType === "switch" ? (WRITABLE_PATHS[deviceType] || []).some((wp) => remappedPath === wp) : false;
      const stateId = `${baseId}.${remappedPath}`;
      const commonBase = {
        name: this.getFriendlyName(remappedPath),
        type: storeType,
        role: this.getRole(remappedPath),
        unit: this.getUnit(remappedPath),
        read: true,
        write: isWritable
      };
      if (deviceType === "pvinverter" && remappedPath === "StatusCode") {
        commonBase.states = PVINVERTER_STATUS;
      }
      const statesForPath = (_d = STATES_MAP[deviceType]) == null ? void 0 : _d[remappedPath];
      if (statesForPath) commonBase.states = statesForPath;
      await this.extendObjectAsync(stateId, { type: "state", common: commonBase, native: {} });
      await this.setState(stateId, { val: storeValue, ack: true });
      if (deviceType === "battery" && CELL_PATH_RE.test(remappedPath)) {
        void this.updateBatteryCellMinMax(baseId);
      }
      if (deviceType === "system" && OVERVIEW_TOTAL_POWER[normPath]) {
        void this.updateOverviewTotalPower(normPath);
      }
      if (((_e = PHASE_POWER_PATHS[deviceType]) == null ? void 0 : _e.includes(normPath)) && this.channelReady.has(baseId)) {
        void this.updateActivePhase(deviceType, baseId);
      }
    } catch (err) {
      this.log.debug(`Fehler bei Topic ${topic}: ${err.message}`);
    }
  }
  // ── Gesamtleistung overview berechnen ───────────────────────────────────
  async updateOverviewTotalPower(triggeredPath) {
    const entry = OVERVIEW_TOTAL_POWER[triggeredPath];
    if (!entry) return;
    let total = 0;
    for (const src of entry.sources) {
      try {
        const s = await this.getStateAsync(`overview.${src}`);
        if (s && typeof s.val === "number") total += s.val;
      } catch {
      }
    }
    const stateId = `overview.${entry.target}`;
    await this.extendObjectAsync(stateId, {
      type: "state",
      common: {
        name: this.getFriendlyName(entry.target),
        type: "number",
        role: "value.power",
        unit: "W",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setState(stateId, { val: Math.round(total), ack: true });
  }
  // ── Settings MQTT → control.system.* ────────────────────────────────────
  async handleSettingsMqttUpdate(normPath, parsed) {
    const rawValue = "value" in parsed ? parsed.value : null;
    if (rawValue === null || rawValue === void 0) return;
    const dpId = ESS_MQTT_MAP[normPath];
    if (!dpId) return;
    const val = typeof rawValue === "number" ? rawValue : parseFloat(rawValue);
    try {
      await this.setState(`control.${dpId}`, { val, ack: true });
      this.log.debug(`control.${dpId} = ${val} (MQTT ${normPath})`);
    } catch {
    }
  }
  // ── baseId berechnen ─────────────────────────────────────────────────────
  getBaseId(type, instance, serial, device) {
    if (type === "system") return "overview";
    if (type === "switch") {
      if (!serial || !(device == null ? void 0 : device.group)) return null;
      return `devices.switch.${device.group.replace(/[^a-zA-Z0-9_]/g, "_")}.${serial}`;
    }
    if (serial) return `devices.${type}.${serial}`;
    return `devices.${type}.${instance}`;
  }
  // ── Metadaten sammeln ────────────────────────────────────────────────────
  updateDeviceMeta(type, instance, field, value) {
    const deviceKey = `${type}/${instance}`;
    if (!this.deviceMap.has(deviceKey)) {
      const NO_SERIAL_TYPES = /* @__PURE__ */ new Set(["system", "platform", "switch"]);
      this.deviceMap.set(deviceKey, {
        type,
        instance,
        serial: "",
        productName: "",
        customName: "",
        virtual: false,
        source: "",
        group: "",
        phaseVoltage: { L1: 0, L2: 0, L3: 0 },
        lastUpdate: Date.now(),
        staleTimer: null,
        ready: NO_SERIAL_TYPES.has(type)
        // system/platform/switch sofort ready
      });
    }
    const device = this.deviceMap.get(deviceKey);
    switch (field) {
      case "Serial":
      case "Devices.0.SerialNumber": {
        device.serial = value;
        device.ready = true;
        this.serialMap.set(deviceKey, value);
        const k = `serial:${deviceKey}`;
        if (!this.loggedDevices.has(k)) {
          this.loggedDevices.add(k);
          this.log.info(`Ger\xE4t erkannt: ${KNOWN_DEVICE_TYPES[type] || type} \u2192 Serial: ${value}`);
        }
        const oldId = `devices.${type}.${instance}`;
        const newId = `devices.${type}.${value}`;
        const deleteKey = `deleted:${oldId}`;
        if (type !== "system" && oldId !== newId && !this.loggedDevices.has(deleteKey)) {
          this.loggedDevices.add(deleteKey);
          void this.delObjectAsync(oldId, { recursive: true }).then(
            () => this.log.debug(`Alter Channel gel\xF6scht: ${oldId}`)
          ).catch(() => {
          });
        }
        break;
      }
      case "ProductName": {
        device.productName = value;
        device.virtual = value.toLowerCase().includes("virtual");
        if (device.virtual) {
          device.ready = true;
          const k = `virtual:${deviceKey}`;
          if (!this.loggedDevices.has(k)) {
            this.loggedDevices.add(k);
            this.log.info(`Virtuelles Ger\xE4t: ${type}/${instance} \u2192 "${value}"`);
          }
          const deleteKey = `deleted:devices.${type}.${instance}`;
          if (type !== "system" && !this.loggedDevices.has(deleteKey)) {
            this.loggedDevices.add(deleteKey);
            void this.delObjectAsync(`devices.${type}.${instance}`, { recursive: true }).catch(() => {
            });
          }
        }
        break;
      }
      case "CustomName":
        if (!device.customName) device.customName = value;
        break;
      case "Connected": {
        if (!device.ready) break;
        const baseId = this.getBaseId(type, instance, device.serial || void 0, device);
        if (baseId) {
          const connected = value === "1" || value === "true";
          void this.setObjectNotExistsAsync(`${baseId}.info.connected`, {
            type: "state",
            common: { name: "Verbunden", type: "boolean", role: "indicator.connected", read: true, write: false },
            native: {}
          }).then(() => {
            void this.setState(`${baseId}.info.connected`, { val: connected, ack: true });
          });
        }
        break;
      }
      case "Mgmt.Connection":
        if (value === "Node-RED") {
          device.source = "node-red";
          const k = `nodered:${deviceKey}`;
          if (!this.loggedDevices.has(k)) {
            this.loggedDevices.add(k);
            this.log.info(`Node-RED Ger\xE4t: ${type}/${instance}`);
          }
        }
        break;
      case "Mgmt.ProcessName":
        if (value === "dbus-victron-virtual") device.virtual = true;
        break;
      case "Position": {
        if (!device.ready) break;
        const baseId = this.getBaseId(type, instance, device.serial || void 0, device);
        if (baseId) {
          void this.setObjectNotExistsAsync(`${baseId}.info.position`, {
            type: "state",
            common: {
              name: "Position",
              type: "number",
              role: "value",
              states: { 0: "AC Ausgang (hinter MultiPlus)", 1: "AC Eingang (Netz)", 2: "AC Eingang 2" },
              read: true,
              write: false
            },
            native: {}
          }).then(() => {
            void this.setState(`${baseId}.info.position`, { val: parseInt(value, 10), ack: true });
          });
        }
        break;
      }
      case "NrOfPhases": {
        if (!device.ready) break;
        const baseId = this.getBaseId(type, instance, device.serial || void 0, device);
        if (baseId) {
          void this.setObjectNotExistsAsync(`${baseId}.info.nrOfPhases`, {
            type: "state",
            common: { name: "Anzahl Phasen", type: "number", role: "value", read: true, write: false },
            native: {}
          }).then(() => {
            void this.setState(`${baseId}.info.nrOfPhases`, { val: parseInt(value, 10), ack: true });
          });
        }
        break;
      }
      case "SwitchableOutput.output_1.Settings.Group": {
        if (!device.group) device.group = value;
        const groupKey = value.replace(/[^a-zA-Z0-9_]/g, "_");
        void this.setObjectNotExistsAsync(`devices.switch.${groupKey}`, {
          type: "channel",
          common: { name: value },
          native: {}
        });
        break;
      }
      case "SwitchableOutput.output_1.Settings.CustomName": {
        if (!device.serial) break;
        const groupKey = device.group.replace(/[^a-zA-Z0-9_]/g, "_");
        const channelId = `devices.switch.${groupKey}.${device.serial}`;
        const suffix = value ? ` (${value})` : "";
        void this.extendObjectAsync(channelId, { common: { name: `${device.productName}${suffix}` } });
        break;
      }
    }
  }
  // ── Channel anlegen ──────────────────────────────────────────────────────
  async ensureChannel(baseId, device) {
    if (this.channelReady.has(baseId)) return;
    if (!device.ready) return;
    const label = device.customName || device.productName || device.type;
    await this.setObjectNotExistsAsync(baseId, {
      type: "channel",
      common: { name: label },
      native: {}
    });
    await this.setObjectNotExistsAsync(`${baseId}.info.instanceId`, {
      type: "state",
      common: { name: "Instanz ID", type: "number", role: "info", read: true, write: false },
      native: {}
    });
    await this.setState(`${baseId}.info.instanceId`, { val: device.instance, ack: true });
    await this.setObjectNotExistsAsync(`${baseId}.info.lastUpdate`, {
      type: "state",
      common: { name: "Letztes Update", type: "number", role: "date", read: true, write: false },
      native: {}
    });
    await this.setObjectNotExistsAsync(`${baseId}.info.stale`, {
      type: "state",
      common: { name: "Keine Daten (stale)", type: "boolean", role: "indicator", read: true, write: false },
      native: {}
    });
    if (["grid", "acload", "pvinverter"].includes(device.type)) {
      await this.setObjectNotExistsAsync(`${baseId}.info.activePhase`, {
        type: "state",
        common: { name: "Aktive Phasen", type: "string", role: "text", read: true, write: false },
        native: {}
      });
    }
    if (device.type === "battery") {
      await this.setObjectNotExistsAsync(`${baseId}.State`, {
        type: "state",
        common: {
          name: "Laderichtung",
          type: "number",
          role: "value",
          states: { 0: "Ruhend", 1: "Laden", 2: "Entladen" },
          read: true,
          write: false
        },
        native: {}
      });
      await this.setObjectNotExistsAsync(`${baseId}.cells`, {
        type: "channel",
        common: { name: "Zellen" },
        native: {}
      });
      await this.setObjectNotExistsAsync(`${baseId}.cells.min`, {
        type: "state",
        common: { name: "Zelle Min", type: "number", role: "value.voltage", unit: "V", read: true, write: false },
        native: {}
      });
      await this.setObjectNotExistsAsync(`${baseId}.cells.max`, {
        type: "state",
        common: { name: "Zelle Max", type: "number", role: "value.voltage", unit: "V", read: true, write: false },
        native: {}
      });
    }
    this.channelReady.add(baseId);
    this.log.debug(`Channel angelegt: ${baseId}`);
  }
  // ── Batterie Zell-Min/Max berechnen ──────────────────────────────────────
  async updateBatteryCellMinMax(baseId) {
    const vals = [];
    for (let i = 1; i <= 32; i++) {
      try {
        const s = await this.getStateAsync(`${baseId}.cells.cell${String(i).padStart(2, "0")}`);
        if (s && typeof s.val === "number" && s.val > 0) vals.push(s.val);
      } catch {
      }
    }
    if (vals.length === 0) return;
    await this.setState(`${baseId}.cells.min`, { val: Math.round(Math.min(...vals) * 1e3) / 1e3, ack: true });
    await this.setState(`${baseId}.cells.max`, { val: Math.round(Math.max(...vals) * 1e3) / 1e3, ack: true });
  }
  // ── Stale-Erkennung ──────────────────────────────────────────────────────
  touchDevice(device, baseId) {
    device.lastUpdate = Date.now();
    if (device.staleTimer) clearTimeout(device.staleTimer);
    if (!this.channelReady.has(baseId) || baseId === "overview") return;
    void this.setState(`${baseId}.info.lastUpdate`, { val: device.lastUpdate, ack: true });
    void this.setState(`${baseId}.info.stale`, { val: false, ack: true });
    device.staleTimer = this.setTimeout(() => {
      this.log.warn(`Ger\xE4t ${device.type}/${device.instance} antwortet nicht mehr (stale)`);
      void this.setState(`${baseId}.info.stale`, { val: true, ack: true });
    }, STALE_TIMEOUT_MS);
  }
  // ── activePhase berechnen ────────────────────────────────────────────────
  async updateActivePhase(_deviceType, baseId) {
    const active = [];
    for (const phase of ["L1", "L2", "L3"]) {
      try {
        const s = await this.getStateAsync(`${baseId}.Ac.${phase}.Power`);
        if (s && typeof s.val === "number" && s.val !== 0) active.push(phase);
      } catch {
      }
    }
    const activePhase = active.length === 1 ? active[0] : active.length > 1 ? "multi" : "";
    await this.setState(`${baseId}.info.activePhase`, { val: activePhase, ack: true });
  }
  // ── onStateChange: Schreibzugriffe ───────────────────────────────────────
  onStateChange(id, state) {
    var _a, _b;
    if (!state || state.ack) return;
    if (!this.mqttClient || !this.vrmId) return;
    const parts = id.split(".");
    if (parts[2] === "control") {
      const dpId = parts.slice(3).join(".");
      if (!this.config.controlEnabled || !this.modbusClient) {
        this.log.warn("Steuerung: Modbus nicht aktiviert oder nicht verbunden");
        return;
      }
      void (async () => {
        await this.writeControlModbus(dpId, state.val);
        if (dpId === "inverter.AcPowerSetpoint") {
          this.startAcPowerSetpointKeepalive(state.val);
        }
      })();
      return;
    }
    if (parts.length < 5) return;
    const deviceType = parts[3];
    let serial;
    let dpPath;
    if (deviceType === "switch") {
      if (parts.length < 7) return;
      serial = parts[5];
      const remapped = parts.slice(6).join(".");
      dpPath = (_b = (_a = WRITE_PATH_REMAP[deviceType]) == null ? void 0 : _a[remapped]) != null ? _b : remapped.replace(/\./g, "/");
    } else {
      serial = parts[4];
      dpPath = parts.slice(5).join("/");
    }
    let instance = null;
    for (const [key, ser] of this.serialMap.entries()) {
      if (ser === serial) {
        instance = parseInt(key.split("/")[1], 10);
        break;
      }
    }
    if (instance === null) {
      const num = parseInt(serial, 10);
      if (!isNaN(num)) instance = num;
    }
    if (instance === null) {
      this.log.warn(`Konnte Instanz f\xFCr ${id} nicht ermitteln`);
      return;
    }
    if (deviceType === "switch") {
      const writeVal = state.val ? 1 : 0;
      const mqttTopic = `W/${this.vrmId}/${deviceType}/${instance}/${dpPath}`;
      this.log.info(`MQTT Write: ${mqttTopic} = ${writeVal}`);
      this.mqttClient.publish(mqttTopic, JSON.stringify({ value: writeVal }));
    }
  }
  // ── Hilfsfunktionen ──────────────────────────────────────────────────────
  getFriendlyName(path) {
    const names = {
      Soc: "Ladezustand",
      "Dc.0.Voltage": "DC Spannung",
      "Dc.0.Current": "DC Strom",
      "Dc.0.Power": "DC Leistung",
      "Dc.Battery.Voltage": "Batterie Spannung",
      "Dc.Battery.Current": "Batterie Strom",
      "Dc.Battery.Power": "Batterie Leistung",
      "Ac.Power": "Gesamtleistung",
      "Ac.L1.Power": "L1 Leistung",
      "Ac.Consumption.Power": "Verbrauch Gesamt",
      "Ac.Grid.Power": "Netz Gesamt",
      "Ac.PvOnGrid.Power": "PV Netz Gesamt",
      "Ac.L2.Power": "L2 Leistung",
      "Ac.L3.Power": "L3 Leistung",
      "Ac.L1.Voltage": "L1 Spannung",
      "Ac.L2.Voltage": "L2 Spannung",
      "Ac.L3.Voltage": "L3 Spannung",
      "Ac.L1.Current": "L1 Strom",
      "Ac.L2.Current": "L2 Strom",
      "Ac.L3.Current": "L3 Strom",
      "Ac.Energy.Forward": "Energie Bezug",
      "Ac.Energy.Reverse": "Energie Einspeisung",
      Mode: "Betriebsart",
      State: "Schaltzustand",
      VebusError: "VebusError",
      VebusChargeState: "VebusChargeState",
      TimeToGo: "Restlaufzeit",
      "Dc.0.Temperature": "Temperatur",
      "temperatures.main": "Temperatur Haupt",
      "temperatures.temp1": "Temperatur 1",
      "temperatures.temp2": "Temperatur 2",
      "temperatures.temp3": "Temperatur 3",
      "temperatures.temp4": "Temperatur 4",
      "temperatures.min": "Temperatur Min",
      "temperatures.max": "Temperatur Max",
      "cells.min": "Zelle Min",
      "cells.max": "Zelle Max",
      "cells.minId": "Zelle Min ID",
      "cells.maxId": "Zelle Max ID",
      "cells.diff": "Zell-Spread",
      "alarms.lowVoltage": "Alarm: Unterspannung",
      "alarms.highVoltage": "Alarm: \xDCberspannung",
      "alarms.lowSoc": "Alarm: SOC niedrig",
      "Dc.Battery.Soc": "Batterie Ladezustand",
      "Dc.Battery.ConsumedAmphours": "Batterie Verbrauch",
      "Dc.System.Power": "DC System Leistung",
      "Dc.Vebus.Power": "MultiPlus DC Leistung",
      "Ac.Consumption.L1.Power": "Verbrauch L1",
      "Ac.Consumption.L2.Power": "Verbrauch L2",
      "Ac.Consumption.L3.Power": "Verbrauch L3",
      "Ac.ConsumptionOnOutput.L1.Power": "Verbrauch Ausgang L1",
      "Ac.ConsumptionOnInput.L1.Power": "Verbrauch Eingang L1",
      "Ac.Grid.L1.Power": "Grid L1",
      "Ac.Grid.L2.Power": "Grid L2",
      "Ac.Grid.L3.Power": "Grid L3",
      "Ac.PvOnGrid.L1.Power": "PV Netz L1",
      "Ac.PvOnGrid.L2.Power": "PV Netz L2",
      "BatterySense.Voltage": "Batterie Spannung (MP)",
      "Hub4.L1.AcPowerSetpoint": "ESS Sollwert L1",
      "Hub4.DisableFeedIn": "Einspeisung gesperrt",
      "Hub4.DisableCharge": "Laden gesperrt",
      "Ac.ActiveIn.L1.P": "L1 Eingangsleistung",
      "Ac.ActiveIn.L1.I": "L1 Eingangsstrom",
      "Ac.ActiveIn.L1.V": "L1 Eingangsspannung",
      "Ac.ActiveIn.L1.S": "L1 Eingang Scheinleistung",
      "Ac.ActiveIn.P": "Eingang Gesamtleistung",
      "Ac.ActiveIn.S": "Eingang Scheinleistung",
      "Ac.Out.L1.P": "L1 Ausgangsleistung",
      "Ac.Out.L1.F": "L1 Ausgangsfrequenz",
      "Ac.Out.L1.I": "L1 Ausgangsstrom",
      "Ac.Out.L1.S": "L1 Ausgang Scheinleistung",
      "Ac.Out.P": "Ausgang Gesamtleistung",
      "Ac.Out.S": "Ausgang Scheinleistung",
      Capacity: "Kapazit\xE4t",
      CurrentAvg: "Durchschnittsstrom",
      "Yield.Power": "PV Leistung",
      "Yield.Today": "Ertrag heute",
      "Yield.Total": "Ertrag gesamt",
      "Pv.V": "PV Spannung",
      "Pv.P": "PV Leistung",
      StatusCode: "Status",
      ErrorCode: "Fehlercode",
      "Ac.Frequency": "Frequenz",
      "Ac.MaxPower": "Max. Leistung",
      "Ac.PowerLimit": "Leistungsbegrenzung",
      "SystemState.State": "Systemzustand"
    };
    if (names[path]) return names[path];
    if (path.startsWith("cells.cell")) return `Zelle ${parseInt(path.replace("cells.cell", ""), 10)}`;
    return path;
  }
  getUnit(path) {
    if (path.startsWith("cells.cell") || path === "cells.min" || path === "cells.max" || path === "cells.diff" || path.includes("Voltage") || path.endsWith(".V")) return "V";
    if (path.includes("Power") || path === "Hub4.L1.AcPowerSetpoint" || path.endsWith(".P") || path === "Ac.Power") return "W";
    if (path.includes("Current") || path.endsWith(".I")) return "A";
    if (path.includes("Energy")) return "kWh";
    if (path.includes("Soc")) return "%";
    if (path.startsWith("temperatures.")) return "\xB0C";
    if (path.endsWith(".S")) return "VA";
    if (path.endsWith(".F") || path === "Ac.Frequency") return "Hz";
    if (path === "Yield.Today" || path === "Yield.Total") return "kWh";
    if (path === "Level" || path === "Humidity") return "%";
    if (path === "Remaining") return "m\xB3";
    if (path === "Pressure") return "hPa";
    if (path === "Capacity" || path.includes("ConsumedAmphours")) return "Ah";
    if (path === "Ac.MaxPower" || path === "Ac.PowerLimit") return "W";
    return "";
  }
  getRole(path) {
    if (path === "State") return "switch";
    if (path.startsWith("cells.cell") || path === "cells.min" || path === "cells.max" || path === "cells.diff" || path.includes("Voltage") || path.endsWith(".V")) return "value.voltage";
    if (path.includes("Power") || path === "Hub4.L1.AcPowerSetpoint" || path.endsWith(".P") || path === "Ac.Power" || path.endsWith(".S")) return "value.power";
    if (path.includes("Current") || path.endsWith(".I")) return "value.current";
    if (path.endsWith(".F") || path === "Ac.Frequency") return "value.frequency";
    if (path.includes("Energy")) return "value.energy.consumed";
    if (path.includes("Soc")) return "value.battery";
    if (path.startsWith("temperatures.")) return "value.temperature";
    if (path.startsWith("alarms.")) return "indicator.alarm";
    if (path === "cells.minId" || path === "cells.maxId") return "text";
    return "value";
  }
  // ── Adapter-Stop ─────────────────────────────────────────────────────────
  onUnload(callback) {
    try {
      if (this.keepAliveInterval) this.clearInterval(this.keepAliveInterval);
      if (this.acPowerSetpointInterval) {
        this.clearInterval(this.acPowerSetpointInterval);
        this.acPowerSetpointInterval = null;
      }
      for (const device of this.deviceMap.values()) {
        if (device.staleTimer) clearTimeout(device.staleTimer);
      }
      if (this.mqttClient) this.mqttClient.end();
      if (this.modbusClient) this.modbusClient.close(() => {
      });
      callback();
    } catch (error) {
      this.log.error(`Fehler beim Beenden: ${error.message}`);
      callback();
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new VictronGx(options);
} else {
  (() => new VictronGx())();
}
//# sourceMappingURL=main.js.map
