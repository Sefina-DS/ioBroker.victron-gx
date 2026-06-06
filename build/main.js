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
  tank: ["Level", "Remaining", "Capacity", "FluidType", "Status", "ProductName", "CustomName"]
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
    Temperature: "temperatures.temp1",
    Temperature2: "temperatures.temp2",
    Temperature3: "temperatures.temp3",
    Temperature4: "temperatures.temp4",
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
    name: {
      en: "Operating mode",
      de: "Betriebsmodus",
      ru: "Operating mode",
      pt: "Operating mode",
      nl: "Operating mode",
      fr: "Operating mode",
      it: "Operating mode",
      es: "Operating mode",
      pl: "Operating mode",
      uk: "Operating mode",
      "zh-cn": "Operating mode"
    },
    write: true,
    states: { 1: "Nur Laden", 2: "Nur Wechselrichter", 3: "Ein (Normal)", 4: "Aus (APS)" }
  },
  "inverter.AcIn1CurrentLimit": {
    register: 22,
    scaleRead: 0.1,
    scaleWrite: 10,
    signed: false,
    unit: "A",
    name: {
      en: "AC input current limit",
      de: "Eingangsstrombegrenzung",
      ru: "AC input current limit",
      pt: "AC input current limit",
      nl: "AC input current limit",
      fr: "AC input current limit",
      it: "AC input current limit",
      es: "AC input current limit",
      pl: "AC input current limit",
      uk: "AC input current limit",
      "zh-cn": "AC input current limit"
    },
    write: true
  },
  "inverter.AcPowerSetpoint": {
    register: 37,
    scaleRead: 1,
    scaleWrite: 1,
    signed: true,
    unit: "W",
    name: {
      en: "ESS setpoint (Reg 37)",
      de: "ESS Sollwert (Reg 37)",
      ru: "ESS setpoint (Reg 37)",
      pt: "ESS setpoint (Reg 37)",
      nl: "ESS setpoint (Reg 37)",
      fr: "ESS setpoint (Reg 37)",
      it: "ESS setpoint (Reg 37)",
      es: "ESS setpoint (Reg 37)",
      pl: "ESS setpoint (Reg 37)",
      uk: "ESS setpoint (Reg 37)",
      "zh-cn": "ESS setpoint (Reg 37)"
    },
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
    name: {
      en: "Disable charge",
      de: "Laden sperren",
      ru: "Disable charge",
      pt: "Disable charge",
      nl: "Disable charge",
      fr: "Disable charge",
      it: "Disable charge",
      es: "Disable charge",
      pl: "Disable charge",
      uk: "Disable charge",
      "zh-cn": "Disable charge"
    },
    write: true,
    states: { 0: "Laden erlaubt", 1: "Laden gesperrt" }
  },
  "inverter.DisableFeedIn": {
    register: 39,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: {
      en: "Disable AC feed-in",
      de: "AC-Einspeisung sperren",
      ru: "Disable AC feed-in",
      pt: "Disable AC feed-in",
      nl: "Disable AC feed-in",
      fr: "Disable AC feed-in",
      it: "Disable AC feed-in",
      es: "Disable AC feed-in",
      pl: "Disable AC feed-in",
      uk: "Disable AC feed-in",
      "zh-cn": "Disable AC feed-in"
    },
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
    name: {
      en: "Grid setpoint",
      de: "Grid-Sollwert",
      ru: "Grid setpoint",
      pt: "Grid setpoint",
      nl: "Grid setpoint",
      fr: "Grid setpoint",
      it: "Grid setpoint",
      es: "Grid setpoint",
      pl: "Grid setpoint",
      uk: "Grid setpoint",
      "zh-cn": "Grid setpoint"
    },
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
    name: {
      en: "ESS phase mode",
      de: "ESS Phasenmodus",
      ru: "ESS phase mode",
      pt: "ESS phase mode",
      nl: "ESS phase mode",
      fr: "ESS phase mode",
      it: "ESS phase mode",
      es: "ESS phase mode",
      pl: "ESS phase mode",
      uk: "ESS phase mode",
      "zh-cn": "ESS phase mode"
    },
    write: true,
    states: { 1: "Mit Phasenkompensation", 2: "Ohne Phasenkompensation", 3: "Externe Steuerung" }
  },
  "system.BatteryLifeState": {
    register: 2900,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: {
      en: "BatteryLife mode",
      de: "BatteryLife Modus",
      ru: "BatteryLife mode",
      pt: "BatteryLife mode",
      nl: "BatteryLife mode",
      fr: "BatteryLife mode",
      it: "BatteryLife mode",
      es: "BatteryLife mode",
      pl: "BatteryLife mode",
      uk: "BatteryLife mode",
      "zh-cn": "BatteryLife mode"
    },
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
    name: {
      en: "Minimum SoC (except grid failure)",
      de: "Minimum SoC (au\xDFer Netzausfall)",
      ru: "Minimum SoC (except grid failure)",
      pt: "Minimum SoC (except grid failure)",
      nl: "Minimum SoC (except grid failure)",
      fr: "Minimum SoC (except grid failure)",
      it: "Minimum SoC (except grid failure)",
      es: "Minimum SoC (except grid failure)",
      pl: "Minimum SoC (except grid failure)",
      uk: "Minimum SoC (except grid failure)",
      "zh-cn": "Minimum SoC (except grid failure)"
    },
    write: true
  },
  "system.BatteryLifeSocLimit": {
    register: 2903,
    scaleRead: 0.1,
    scaleWrite: 10,
    signed: false,
    unit: "%",
    name: {
      en: "BatteryLife SoC limit",
      de: "BatteryLife SoC Limit",
      ru: "BatteryLife SoC limit",
      pt: "BatteryLife SoC limit",
      nl: "BatteryLife SoC limit",
      fr: "BatteryLife SoC limit",
      it: "BatteryLife SoC limit",
      es: "BatteryLife SoC limit",
      pl: "BatteryLife SoC limit",
      uk: "BatteryLife SoC limit",
      "zh-cn": "BatteryLife SoC limit"
    },
    write: false
  },
  "system.MaxFeedInPower": {
    register: 2706,
    scaleRead: 0.01,
    scaleWrite: 100,
    signed: true,
    unit: "W",
    name: {
      en: "Max. feed-in power",
      de: "Max. Einspeisung",
      ru: "Max. feed-in power",
      pt: "Max. feed-in power",
      nl: "Max. feed-in power",
      fr: "Max. feed-in power",
      it: "Max. feed-in power",
      es: "Max. feed-in power",
      pl: "Max. feed-in power",
      uk: "Max. feed-in power",
      "zh-cn": "Max. feed-in power"
    },
    write: true
    // -1 = kein Limit, 0 = gesperrt, >0 = Limit in W
  },
  "system.AcFeedInEnabled": {
    register: 2708,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: {
      en: "AC feed-in to grid",
      de: "AC-Einspeisung ins Netz",
      ru: "AC feed-in to grid",
      pt: "AC feed-in to grid",
      nl: "AC feed-in to grid",
      fr: "AC feed-in to grid",
      it: "AC feed-in to grid",
      es: "AC feed-in to grid",
      pl: "AC feed-in to grid",
      uk: "AC feed-in to grid",
      "zh-cn": "AC feed-in to grid"
    },
    write: true,
    states: { 0: "Einspeisung erlaubt", 1: "Einspeisung gesperrt" }
  },
  "system.DcFeedInEnabled": {
    register: 2707,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: {
      en: "DC surplus to grid (overvoltage feed-in)",
      de: "DC-\xDCberschuss ins Netz (Overvoltage Feed-in)",
      ru: "DC surplus to grid (overvoltage feed-in)",
      pt: "DC surplus to grid (overvoltage feed-in)",
      nl: "DC surplus to grid (overvoltage feed-in)",
      fr: "DC surplus to grid (overvoltage feed-in)",
      it: "DC surplus to grid (overvoltage feed-in)",
      es: "DC surplus to grid (overvoltage feed-in)",
      pl: "DC surplus to grid (overvoltage feed-in)",
      uk: "DC surplus to grid (overvoltage feed-in)",
      "zh-cn": "DC surplus to grid (overvoltage feed-in)"
    },
    write: true,
    states: { 0: "Deaktiviert", 1: "Aktiviert" }
  },
  "system.FeedInLimitActive": {
    register: 2709,
    scaleRead: 1,
    scaleWrite: 1,
    signed: false,
    unit: "",
    name: {
      en: "Feed-in limit active",
      de: "Einspeisebegrenzung aktiv",
      ru: "Feed-in limit active",
      pt: "Feed-in limit active",
      nl: "Feed-in limit active",
      fr: "Feed-in limit active",
      it: "Feed-in limit active",
      es: "Feed-in limit active",
      pl: "Feed-in limit active",
      uk: "Feed-in limit active",
      "zh-cn": "Feed-in limit active"
    },
    write: false,
    states: { 0: "Nein", 1: "Ja" }
  },
  "system.DvccMaxChargeCurrent": {
    register: 2705,
    scaleRead: 1,
    scaleWrite: 1,
    signed: true,
    unit: "A",
    name: {
      en: "DVCC max. charge current",
      de: "DVCC Max. Ladestrom",
      ru: "DVCC max. charge current",
      pt: "DVCC max. charge current",
      nl: "DVCC max. charge current",
      fr: "DVCC max. charge current",
      it: "DVCC max. charge current",
      es: "DVCC max. charge current",
      pl: "DVCC max. charge current",
      uk: "DVCC max. charge current",
      "zh-cn": "DVCC max. charge current"
    },
    write: true
    // -1 = kein Limit (DVCC deaktiviert für Ladestrom)
  },
  "system.MaxDischargePower": {
    register: 2704,
    scaleRead: 0.1,
    scaleWrite: 10,
    signed: true,
    unit: "W",
    name: {
      en: "Max. discharge power",
      de: "Max. Entladeleistung",
      ru: "Max. discharge power",
      pt: "Max. discharge power",
      nl: "Max. discharge power",
      fr: "Max. discharge power",
      it: "Max. discharge power",
      es: "Max. discharge power",
      pl: "Max. discharge power",
      uk: "Max. discharge power",
      "zh-cn": "Max. discharge power"
    },
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
  },
  tank: {
    FluidType: {
      0: "Fuel",
      1: "Fresh water",
      2: "Waste water",
      3: "Live well",
      4: "Oil",
      5: "Black water",
      6: "Gasoline",
      7: "Diesel",
      8: "LPG",
      9: "LNG",
      10: "Hydraulic oil",
      11: "Raw water"
    },
    Status: {
      0: "OK",
      1: "Disconnected",
      2: "Short circuit",
      3: "Reverse polarity",
      4: "Unknown"
    }
  }
};
const OVERVIEW_TOTAL_POWER = {
  "Ac.Consumption.L1.Power": {
    sources: ["Ac.Consumption.L1.Power", "Ac.Consumption.L2.Power", "Ac.Consumption.L3.Power"],
    target: "Ac.Consumption.Power"
  },
  "Ac.Consumption.L2.Power": {
    sources: ["Ac.Consumption.L1.Power", "Ac.Consumption.L2.Power", "Ac.Consumption.L3.Power"],
    target: "Ac.Consumption.Power"
  },
  "Ac.Consumption.L3.Power": {
    sources: ["Ac.Consumption.L1.Power", "Ac.Consumption.L2.Power", "Ac.Consumption.L3.Power"],
    target: "Ac.Consumption.Power"
  },
  "Ac.Grid.L1.Power": {
    sources: ["Ac.Grid.L1.Power", "Ac.Grid.L2.Power", "Ac.Grid.L3.Power"],
    target: "Ac.Grid.Power"
  },
  "Ac.Grid.L2.Power": {
    sources: ["Ac.Grid.L1.Power", "Ac.Grid.L2.Power", "Ac.Grid.L3.Power"],
    target: "Ac.Grid.Power"
  },
  "Ac.Grid.L3.Power": {
    sources: ["Ac.Grid.L1.Power", "Ac.Grid.L2.Power", "Ac.Grid.L3.Power"],
    target: "Ac.Grid.Power"
  },
  "Ac.PvOnGrid.L1.Power": {
    sources: ["Ac.PvOnGrid.L1.Power", "Ac.PvOnGrid.L2.Power", "Ac.PvOnGrid.L3.Power"],
    target: "Ac.PvOnGrid.Power"
  },
  "Ac.PvOnGrid.L2.Power": {
    sources: ["Ac.PvOnGrid.L1.Power", "Ac.PvOnGrid.L2.Power", "Ac.PvOnGrid.L3.Power"],
    target: "Ac.PvOnGrid.Power"
  },
  "Ac.PvOnGrid.L3.Power": {
    sources: ["Ac.PvOnGrid.L1.Power", "Ac.PvOnGrid.L2.Power", "Ac.PvOnGrid.L3.Power"],
    target: "Ac.PvOnGrid.Power"
  }
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
  createdStates = /* @__PURE__ */ new Set();
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
      common: {
        name: {
          en: "Modbus TCP connected",
          de: "Modbus TCP verbunden",
          ru: "Modbus TCP connected",
          pt: "Modbus TCP connected",
          nl: "Modbus TCP connected",
          fr: "Modbus TCP connected",
          it: "Modbus TCP connected",
          es: "Modbus TCP connected",
          pl: "Modbus TCP connected",
          uk: "Modbus TCP connected",
          "zh-cn": "Modbus TCP connected"
        },
        type: "boolean",
        role: "indicator.connected",
        read: true,
        write: false,
        def: false
      },
      native: {}
    });
    void this.setObjectNotExistsAsync("info.modbusWritable", {
      type: "state",
      common: {
        name: {
          en: "Modbus write access",
          de: "Modbus Schreibzugriff",
          ru: "Modbus write access",
          pt: "Modbus write access",
          nl: "Modbus write access",
          fr: "Modbus write access",
          it: "Modbus write access",
          es: "Modbus write access",
          pl: "Modbus write access",
          uk: "Modbus write access",
          "zh-cn": "Modbus write access"
        },
        type: "boolean",
        role: "indicator",
        read: true,
        write: false,
        def: false
      },
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
    void this.setObjectNotExistsAsync("devices", {
      type: "folder",
      common: {
        name: {
          en: "Devices",
          de: "Ger\xE4te",
          ru: "Devices",
          pt: "Devices",
          nl: "Devices",
          fr: "Devices",
          it: "Devices",
          es: "Devices",
          pl: "Devices",
          uk: "Devices",
          "zh-cn": "Devices"
        }
      },
      native: {}
    });
    void this.setObjectNotExistsAsync("overview", {
      type: "channel",
      common: {
        name: {
          en: "System overview",
          de: "System\xFCbersicht",
          ru: "System overview",
          pt: "System overview",
          nl: "System overview",
          fr: "System overview",
          it: "System overview",
          es: "System overview",
          pl: "System overview",
          uk: "System overview",
          "zh-cn": "System overview"
        }
      },
      native: {}
    });
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
        if (parts.length !== 3) {
          continue;
        }
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
    if (username) {
      options.username = username;
    }
    if (password) {
      options.password = password;
    }
    this.mqttClient = mqtt.connect(`mqtt://${host}`, options);
    this.mqttClient.on("connect", () => {
      this.log.info("MQTT verbunden mit Victron GX!");
      void this.setState("info.connection", true, true);
      this.mqttClient.subscribe("N/#", (err) => {
        if (err) {
          this.log.error(`Subscribe Fehler: ${err.message}`);
        }
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
      if (this.vrmId) {
        this.startKeepAlive();
      }
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
      this.setTimeout(() => void this.discoverModbusUnits(), 2e4);
    } catch (err) {
      this.log.error(`Modbus Verbindungsfehler: ${err.message}`);
      void this.setState("info.modbusConnected", false, true);
      void this.setState("info.modbusWritable", false, true);
      this.setTimeout(() => void this.connectModbus(host, port), 3e4);
    }
  }
  async testModbusWrite() {
    if (!this.modbusClient) {
      return;
    }
    let vebusEntry;
    for (let i = 0; i < 60; i++) {
      vebusEntry = Array.from(this.modbusUnitMap.entries()).find(([k]) => k.startsWith("vebus/"));
      if (vebusEntry) {
        break;
      }
      await new Promise((resolve) => {
        this.setTimeout(() => resolve(), 1e3);
      });
    }
    if (!vebusEntry) {
      this.log.warn("Modbus Schreibtest: vebus Unit ID nicht bekannt");
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
      this.log.info(`Modbus Schreibzugriff best\xE4tigt! (vebus Unit ID ${vebusUnitId})`);
      void this.setState("info.modbusWritable", true, true);
    } catch (err) {
      this.modbusBusy = false;
      this.log.warn(`Modbus Schreibzugriff nicht m\xF6glich: ${err.message}`);
      void this.setState("info.modbusWritable", false, true);
    }
  }
  async discoverModbusUnits() {
    if (!this.modbusClient) {
      return;
    }
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
            this.log.info(`Modbus Discovery: ${type} \u2192 Unit ID ${unitId}`);
            const serial = this.serialMap.get(deviceKey);
            const baseId = this.getBaseId(device.type, device.instance, serial, device);
            if (baseId) {
              await this.extendObjectAsync(`${baseId}.info.modbusId`, {
                type: "state",
                common: {
                  name: {
                    en: "Modbus Unit ID",
                    de: "Modbus Unit ID",
                    ru: "Modbus Unit ID",
                    pt: "Modbus Unit ID",
                    nl: "Modbus Unit ID",
                    fr: "Modbus Unit ID",
                    it: "Modbus Unit ID",
                    es: "Modbus Unit ID",
                    pl: "Modbus Unit ID",
                    uk: "Modbus Unit ID",
                    "zh-cn": "Modbus Unit ID"
                  },
                  type: "number",
                  role: "value",
                  read: true,
                  write: false
                },
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
      await new Promise((resolve) => {
        this.setTimeout(() => resolve(), 50);
      });
    }
    this.log.info(`Modbus Discovery abgeschlossen. ${this.modbusUnitMap.size} Ger\xE4te gefunden.`);
    if (this.config.controlEnabled) {
      try {
        if (this.modbusBusy) {
          await this.waitModbus();
        }
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
    if (!this.modbusClient) {
      return;
    }
    await this.setObjectNotExistsAsync("control", {
      type: "channel",
      common: {
        name: {
          en: "Control",
          de: "Steuerung",
          ru: "Control",
          pt: "Control",
          nl: "Control",
          fr: "Control",
          it: "Control",
          es: "Control",
          pl: "Control",
          uk: "Control",
          "zh-cn": "Control"
        }
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("control.inverter", {
      type: "channel",
      common: {
        name: {
          en: "Inverter (MP2)",
          de: "Wechselrichter (MP2)",
          ru: "Inverter (MP2)",
          pt: "Inverter (MP2)",
          nl: "Inverter (MP2)",
          fr: "Inverter (MP2)",
          it: "Inverter (MP2)",
          es: "Inverter (MP2)",
          pl: "Inverter (MP2)",
          uk: "Inverter (MP2)",
          "zh-cn": "Inverter (MP2)"
        }
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("control.system", {
      type: "channel",
      common: {
        name: {
          en: "System / ESS settings",
          de: "System / ESS-Einstellungen",
          ru: "System / ESS settings",
          pt: "System / ESS settings",
          nl: "System / ESS settings",
          fr: "System / ESS settings",
          it: "System / ESS settings",
          es: "System / ESS settings",
          pl: "System / ESS settings",
          uk: "System / ESS settings",
          "zh-cn": "System / ESS settings"
        }
      },
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
        role: reg.write && this.config.controlEnabled ? "level" : reg.unit === "W" ? "value.power" : reg.unit === "A" ? "value.current" : reg.unit === "%" ? "value" : "value",
        unit: reg.unit,
        read: true,
        write: reg.write && this.config.controlEnabled
      };
      if (reg.states) {
        commonDef.states = reg.states;
      }
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
    if (!this.modbusClient) {
      return;
    }
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
      if (this.modbusBusy) {
        await this.waitModbus();
      }
      this.modbusBusy = true;
      this.modbusClient.setID(unitId);
      await this.modbusClient.writeRegister(reg.register, writeValue);
      this.modbusBusy = false;
      this.log.info(
        `Modbus Write: control.${dpId} = ${value}${reg.unit} \u2192 Reg ${reg.register} = ${writeValue} (Unit ${unitId})`
      );
      await this.setState(`control.${dpId}`, { val: value, ack: true });
    } catch (err) {
      this.modbusBusy = false;
      this.log.error(`Modbus Write Fehler control.${dpId}: ${err.message}`);
    }
  }
  waitModbus() {
    return new Promise((r) => this.setTimeout(r, 100));
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
          if (!vebusEntry || !this.modbusClient) {
            return;
          }
          const [, unitId] = vebusEntry;
          const rawValue = Math.round(v * reg.scaleWrite);
          const writeValue = reg.signed && rawValue < 0 ? rawValue + 65536 : rawValue;
          if (this.modbusBusy) {
            return;
          }
          if (!this.modbusClient) {
            return;
          }
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
    if (this.keepAliveInterval) {
      this.clearInterval(this.keepAliveInterval);
    }
    this.keepAliveInterval = this.setInterval(() => {
      if (this.mqttClient && this.vrmId) {
        this.mqttClient.publish(`R/${this.vrmId}/keepalive`, "");
        this.log.debug("MQTT Keepalive gesendet");
      }
    }, 5e4);
    if (this.vrmId) {
      this.mqttClient.publish(`R/${this.vrmId}/keepalive`, "");
    }
  }
  // ── Haupt-Message-Handler ────────────────────────────────────────────────
  async handleMessage(topic, payload) {
    var _a, _b, _c, _d, _e;
    try {
      const raw = payload.toString();
      if (!raw) {
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const topicParts = topic.split("/");
      if (topicParts[0] !== "N" || topicParts.length < 3) {
        return;
      }
      const vrmId = topicParts[1];
      if (!this.vrmId && vrmId) {
        this.vrmId = vrmId;
        this.log.info(`VRM ID erkannt: ${vrmId}`);
        this.startKeepAlive();
      }
      const parts = topicParts;
      if (parts.length < 5) {
        return;
      }
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
      if (rawValue === null || rawValue === void 0) {
        return;
      }
      if (REGISTRATION_PATHS.has(normPath)) {
        if (typeof rawValue === "string" || typeof rawValue === "number") {
          this.updateDeviceMeta(deviceType, instance, normPath, String(rawValue));
        }
        return;
      }
      const remappedPath = (_b = (_a = PATH_REMAP[deviceType]) == null ? void 0 : _a[normPath]) != null ? _b : normPath;
      const isRelevant = RELEVANT_PATHS[deviceType].some((rp) => normPath === rp.replace(/\//g, "."));
      if (!isRelevant) {
        return;
      }
      const deviceKey = `${deviceType}/${instance}`;
      const device = this.deviceMap.get(deviceKey);
      const serial = this.serialMap.get(deviceKey);
      const NO_SERIAL_TYPES = /* @__PURE__ */ new Set(["system", "platform"]);
      if (!serial && !NO_SERIAL_TYPES.has(deviceType)) {
        return;
      }
      const baseId = this.getBaseId(deviceType, instance, serial, device);
      if (!baseId) {
        return;
      }
      if ((device == null ? void 0 : device.virtual) && PHASE_VOLTAGE_PATHS[deviceType]) {
        const vMatch = normPath.match(/^Ac\.(L[123])\.Voltage$/);
        if (vMatch) {
          device.phaseVoltage[vMatch[1]] = typeof rawValue === "number" ? rawValue : 0;
        }
        const pMatch = normPath.match(/^Ac\.(L[123])\./);
        if (pMatch && ((_c = device.phaseVoltage[pMatch[1]]) != null ? _c : 0) === 0) {
          return;
        }
      }
      if (!this.channelReady.has(baseId)) {
        if (device) {
          await this.ensureChannel(baseId, device);
        } else if (baseId === "overview") {
          await this.setObjectNotExistsAsync("overview", {
            type: "channel",
            common: {
              name: {
                en: "System overview",
                de: "System\xFCbersicht",
                ru: "System overview",
                pt: "System overview",
                nl: "System overview",
                fr: "System overview",
                it: "System overview",
                es: "System overview",
                pl: "System overview",
                uk: "System overview",
                "zh-cn": "System overview"
              }
            },
            native: {}
          });
          await this.setObjectNotExistsAsync("overview.info", {
            type: "channel",
            common: {
              name: {
                en: "Info",
                de: "Info",
                ru: "Info",
                pt: "Info",
                nl: "Info",
                fr: "Info",
                it: "Info",
                es: "Info",
                pl: "Info",
                uk: "Info",
                "zh-cn": "Info"
              }
            },
            native: {}
          });
          this.channelReady.add("overview");
          this.log.debug("Channel angelegt: overview");
        }
      }
      if (device) {
        this.touchDevice(device, baseId);
      }
      const isSwitchBool = deviceType === "switch" && (remappedPath === "State" || remappedPath === "Status");
      const storeValue = isSwitchBool ? rawValue !== 0 : rawValue;
      const storeType = isSwitchBool ? "boolean" : typeof rawValue === "number" ? "number" : typeof rawValue === "boolean" ? "boolean" : "string";
      const isWritable = deviceType === "switch" ? (WRITABLE_PATHS[deviceType] || []).some((wp) => remappedPath === wp) : false;
      const stateId = `${baseId}.${remappedPath}`;
      let stateRole = this.getRole(remappedPath);
      if (deviceType === "switch") {
        if (remappedPath === "State") {
          stateRole = "switch";
        } else if (remappedPath === "Status") {
          stateRole = "indicator";
        }
      }
      const commonBase = {
        name: this.getFriendlyName(remappedPath),
        type: storeType,
        role: stateRole,
        unit: this.getUnit(remappedPath),
        read: true,
        write: isWritable
      };
      if (deviceType === "pvinverter" && remappedPath === "StatusCode") {
        commonBase.states = PVINVERTER_STATUS;
      }
      const statesForPath = (_d = STATES_MAP[deviceType]) == null ? void 0 : _d[remappedPath];
      if (statesForPath) {
        commonBase.states = statesForPath;
      }
      if (deviceType === "tank" && (remappedPath === "Capacity" || remappedPath === "Remaining")) {
        commonBase.unit = "m\xB3";
      }
      if (!this.createdStates.has(stateId)) {
        await this.ensureIntermediates(stateId);
        await this.extendObjectAsync(stateId, { type: "state", common: commonBase, native: {} });
        this.createdStates.add(stateId);
      }
      await this.setState(stateId, { val: storeValue, ack: true });
      if (deviceType === "tank" && typeof storeValue === "number") {
        if (remappedPath === "Capacity") {
          const literId = `${baseId}.CapacityLiter`;
          if (!this.createdStates.has(literId)) {
            await this.extendObjectAsync(literId, {
              type: "state",
              common: {
                name: {
                  en: "Capacity (liters)",
                  de: "Kapazit\xE4t (Liter)",
                  ru: "Capacity (liters)",
                  pt: "Capacity (liters)",
                  nl: "Capacity (liters)",
                  fr: "Capacity (liters)",
                  it: "Capacity (liters)",
                  es: "Capacity (liters)",
                  pl: "Capacity (liters)",
                  uk: "Capacity (liters)",
                  "zh-cn": "Capacity (liters)"
                },
                type: "number",
                role: "value",
                unit: "l",
                read: true,
                write: false
              },
              native: {}
            });
            this.createdStates.add(literId);
          }
          await this.setState(literId, { val: Math.round(storeValue * 1e3), ack: true });
        }
        if (remappedPath === "Remaining") {
          const literId = `${baseId}.RemainingLiter`;
          if (!this.createdStates.has(literId)) {
            await this.extendObjectAsync(literId, {
              type: "state",
              common: {
                name: {
                  en: "Remaining (liters)",
                  de: "Verbleibend (Liter)",
                  ru: "Remaining (liters)",
                  pt: "Remaining (liters)",
                  nl: "Remaining (liters)",
                  fr: "Remaining (liters)",
                  it: "Remaining (liters)",
                  es: "Remaining (liters)",
                  pl: "Remaining (liters)",
                  uk: "Remaining (liters)",
                  "zh-cn": "Remaining (liters)"
                },
                type: "number",
                role: "value",
                unit: "l",
                read: true,
                write: false
              },
              native: {}
            });
            this.createdStates.add(literId);
          }
          await this.setState(literId, { val: Math.round(storeValue * 1e3), ack: true });
        }
      }
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
    if (!entry) {
      return;
    }
    let total = 0;
    for (const src of entry.sources) {
      try {
        const s = await this.getStateAsync(`overview.${src}`);
        if (s && typeof s.val === "number") {
          total += s.val;
        }
      } catch {
      }
    }
    const stateId = `overview.${entry.target}`;
    if (!this.createdStates.has(stateId)) {
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
      this.createdStates.add(stateId);
    }
    await this.setState(stateId, { val: Math.round(total), ack: true });
  }
  // ── Settings MQTT → control.system.* ────────────────────────────────────
  async handleSettingsMqttUpdate(normPath, parsed) {
    const rawValue = "value" in parsed ? parsed.value : null;
    if (rawValue === null || rawValue === void 0) {
      return;
    }
    const dpId = ESS_MQTT_MAP[normPath];
    if (!dpId) {
      return;
    }
    const val = typeof rawValue === "number" ? rawValue : parseFloat(rawValue);
    try {
      await this.setState(`control.${dpId}`, { val, ack: true });
      this.log.debug(`control.${dpId} = ${val} (MQTT ${normPath})`);
    } catch {
    }
  }
  // ── baseId berechnen ─────────────────────────────────────────────────────
  getBaseId(type, instance, serial, device) {
    if (type === "system") {
      return "overview";
    }
    if (type === "switch") {
      if (!serial || !(device == null ? void 0 : device.group)) {
        return null;
      }
      return `devices.switch.${device.group.replace(/[^a-zA-Z0-9_]/g, "_")}.${serial}`;
    }
    if (serial) {
      return `devices.${type}.${serial}`;
    }
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
          void this.delObjectAsync(oldId, { recursive: true }).then(() => this.log.debug(`Alter Channel gel\xF6scht: ${oldId}`)).catch(() => {
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
        if (!device.customName) {
          device.customName = value;
        }
        break;
      case "Connected": {
        if (!device.ready) {
          break;
        }
        const baseId = this.getBaseId(type, instance, device.serial || void 0, device);
        if (baseId) {
          const connected = value === "1" || value === "true";
          void this.setObjectNotExistsAsync(`${baseId}.info.connected`, {
            type: "state",
            common: {
              name: {
                en: "Connected",
                de: "Verbunden",
                ru: "Connected",
                pt: "Connected",
                nl: "Connected",
                fr: "Connected",
                it: "Connected",
                es: "Connected",
                pl: "Connected",
                uk: "Connected",
                "zh-cn": "Connected"
              },
              type: "boolean",
              role: "indicator.connected",
              read: true,
              write: false
            },
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
        if (value === "dbus-victron-virtual") {
          device.virtual = true;
        }
        break;
      case "Position": {
        if (!device.ready) {
          break;
        }
        const baseId = this.getBaseId(type, instance, device.serial || void 0, device);
        if (baseId) {
          void this.setObjectNotExistsAsync(`${baseId}.info.position`, {
            type: "state",
            common: {
              name: {
                en: "Position",
                de: "Position",
                ru: "Position",
                pt: "Position",
                nl: "Position",
                fr: "Position",
                it: "Position",
                es: "Position",
                pl: "Position",
                uk: "Position",
                "zh-cn": "Position"
              },
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
        if (!device.ready) {
          break;
        }
        const baseId = this.getBaseId(type, instance, device.serial || void 0, device);
        if (baseId) {
          void this.setObjectNotExistsAsync(`${baseId}.info.nrOfPhases`, {
            type: "state",
            common: {
              name: {
                en: "Number of phases",
                de: "Anzahl Phasen",
                ru: "Number of phases",
                pt: "Number of phases",
                nl: "Number of phases",
                fr: "Number of phases",
                it: "Number of phases",
                es: "Number of phases",
                pl: "Number of phases",
                uk: "Number of phases",
                "zh-cn": "Number of phases"
              },
              type: "number",
              role: "value",
              read: true,
              write: false
            },
            native: {}
          }).then(() => {
            void this.setState(`${baseId}.info.nrOfPhases`, { val: parseInt(value, 10), ack: true });
          });
        }
        break;
      }
      case "SwitchableOutput.output_1.Settings.Group": {
        if (!device.group) {
          device.group = value;
        }
        const groupKey = value.replace(/[^a-zA-Z0-9_]/g, "_");
        void this.setObjectNotExistsAsync(`devices.switch.${groupKey}`, {
          type: "channel",
          common: { name: value },
          native: {}
        });
        break;
      }
      case "SwitchableOutput.output_1.Settings.CustomName": {
        if (!device.serial) {
          break;
        }
        const groupKey = device.group.replace(/[^a-zA-Z0-9_]/g, "_");
        const channelId = `devices.switch.${groupKey}.${device.serial}`;
        const suffix = value ? ` (${value})` : "";
        void this.setObjectNotExistsAsync(channelId, {
          type: "channel",
          common: { name: `${device.productName}${suffix}` },
          native: {}
        }).then(() => {
          void this.extendObjectAsync(channelId, { common: { name: `${device.productName}${suffix}` } });
        });
        void this.setObjectNotExistsAsync(`${channelId}.info`, {
          type: "channel",
          common: {
            name: {
              en: "Info",
              de: "Info",
              ru: "Info",
              pt: "Info",
              nl: "Info",
              fr: "Info",
              it: "Info",
              es: "Info",
              pl: "Info",
              uk: "Info",
              "zh-cn": "Info"
            }
          },
          native: {}
        });
        break;
      }
    }
  }
  // ── Intermediate-Objekte sicherstellen ───────────────────────────────────
  async ensureIntermediates(stateId) {
    const parts = stateId.split(".");
    for (let i = 1; i < parts.length - 1; i++) {
      const intermId = parts.slice(0, i + 1).join(".");
      if (!this.createdStates.has(`__folder_${intermId}`)) {
        try {
          await this.setObjectNotExistsAsync(intermId, {
            type: "folder",
            common: { name: parts[i] },
            native: {}
          });
        } catch {
        }
        this.createdStates.add(`__folder_${intermId}`);
      }
    }
  }
  // ── Channel anlegen ──────────────────────────────────────────────────────
  async ensureChannel(baseId, device) {
    if (this.channelReady.has(baseId)) {
      return;
    }
    if (!device.ready) {
      return;
    }
    const label = device.customName || device.productName || device.type;
    const typeFolder = `devices.${device.type}`;
    await this.setObjectNotExistsAsync(typeFolder, {
      type: "folder",
      common: { name: { en: device.type, de: device.type } },
      native: {}
    });
    await this.setObjectNotExistsAsync(baseId, {
      type: "channel",
      common: { name: label },
      native: {}
    });
    await this.setObjectNotExistsAsync(`${baseId}.info`, {
      type: "channel",
      common: {
        name: {
          en: "Info",
          de: "Info",
          ru: "Info",
          pt: "Info",
          nl: "Info",
          fr: "Info",
          it: "Info",
          es: "Info",
          pl: "Info",
          uk: "Info",
          "zh-cn": "Info"
        }
      },
      native: {}
    });
    await this.setObjectNotExistsAsync(`${baseId}.info.instanceId`, {
      type: "state",
      common: {
        name: {
          en: "Instance ID",
          de: "Instanz ID",
          ru: "Instance ID",
          pt: "Instance ID",
          nl: "Instance ID",
          fr: "Instance ID",
          it: "Instance ID",
          es: "Instance ID",
          pl: "Instance ID",
          uk: "Instance ID",
          "zh-cn": "Instance ID"
        },
        type: "number",
        role: "value",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setState(`${baseId}.info.instanceId`, { val: device.instance, ack: true });
    await this.setObjectNotExistsAsync(`${baseId}.info.lastUpdate`, {
      type: "state",
      common: {
        name: {
          en: "Last update",
          de: "Letztes Update",
          ru: "Last update",
          pt: "Last update",
          nl: "Last update",
          fr: "Last update",
          it: "Last update",
          es: "Last update",
          pl: "Last update",
          uk: "Last update",
          "zh-cn": "Last update"
        },
        type: "number",
        role: "date",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setObjectNotExistsAsync(`${baseId}.info.stale`, {
      type: "state",
      common: {
        name: {
          en: "No data (stale)",
          de: "Keine Daten (stale)",
          ru: "No data (stale)",
          pt: "No data (stale)",
          nl: "No data (stale)",
          fr: "No data (stale)",
          it: "No data (stale)",
          es: "No data (stale)",
          pl: "No data (stale)",
          uk: "No data (stale)",
          "zh-cn": "No data (stale)"
        },
        type: "boolean",
        role: "indicator",
        read: true,
        write: false
      },
      native: {}
    });
    if (["grid", "acload", "pvinverter"].includes(device.type)) {
      await this.setObjectNotExistsAsync(`${baseId}.info.activePhase`, {
        type: "state",
        common: {
          name: {
            en: "Active phases",
            de: "Aktive Phasen",
            ru: "Active phases",
            pt: "Active phases",
            nl: "Active phases",
            fr: "Active phases",
            it: "Active phases",
            es: "Active phases",
            pl: "Active phases",
            uk: "Active phases",
            "zh-cn": "Active phases"
          },
          type: "string",
          role: "text",
          read: true,
          write: false
        },
        native: {}
      });
    }
    if (device.type === "battery") {
      await this.setObjectNotExistsAsync(`${baseId}.State`, {
        type: "state",
        common: {
          name: {
            en: "Charge direction",
            de: "Laderichtung",
            ru: "Charge direction",
            pt: "Charge direction",
            nl: "Charge direction",
            fr: "Charge direction",
            it: "Charge direction",
            es: "Charge direction",
            pl: "Charge direction",
            uk: "Charge direction",
            "zh-cn": "Charge direction"
          },
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
        common: {
          name: {
            en: "Cells",
            de: "Zellen",
            ru: "Cells",
            pt: "Cells",
            nl: "Cells",
            fr: "Cells",
            it: "Cells",
            es: "Cells",
            pl: "Cells",
            uk: "Cells",
            "zh-cn": "Cells"
          }
        },
        native: {}
      });
      await this.setObjectNotExistsAsync(`${baseId}.cells.min`, {
        type: "state",
        common: {
          name: {
            en: "Cell min",
            de: "Zelle Min",
            ru: "Cell min",
            pt: "Cell min",
            nl: "Cell min",
            fr: "Cell min",
            it: "Cell min",
            es: "Cell min",
            pl: "Cell min",
            uk: "Cell min",
            "zh-cn": "Cell min"
          },
          type: "number",
          role: "value.voltage",
          unit: "V",
          read: true,
          write: false
        },
        native: {}
      });
      await this.setObjectNotExistsAsync(`${baseId}.cells.max`, {
        type: "state",
        common: {
          name: {
            en: "Cell max",
            de: "Zelle Max",
            ru: "Cell max",
            pt: "Cell max",
            nl: "Cell max",
            fr: "Cell max",
            it: "Cell max",
            es: "Cell max",
            pl: "Cell max",
            uk: "Cell max",
            "zh-cn": "Cell max"
          },
          type: "number",
          role: "value.voltage",
          unit: "V",
          read: true,
          write: false
        },
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
        if (s && typeof s.val === "number" && s.val > 0) {
          vals.push(s.val);
        }
      } catch {
      }
    }
    if (vals.length === 0) {
      return;
    }
    await this.setState(`${baseId}.cells.min`, { val: Math.round(Math.min(...vals) * 1e3) / 1e3, ack: true });
    await this.setState(`${baseId}.cells.max`, { val: Math.round(Math.max(...vals) * 1e3) / 1e3, ack: true });
  }
  // ── Stale-Erkennung ──────────────────────────────────────────────────────
  touchDevice(device, baseId) {
    device.lastUpdate = Date.now();
    if (device.staleTimer) {
      clearTimeout(device.staleTimer);
    }
    if (!this.channelReady.has(baseId) || baseId === "overview") {
      return;
    }
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
        if (s && typeof s.val === "number" && s.val !== 0) {
          active.push(phase);
        }
      } catch {
      }
    }
    const activePhase = active.length === 1 ? active[0] : active.length > 1 ? "multi" : "";
    await this.setState(`${baseId}.info.activePhase`, { val: activePhase, ack: true });
  }
  // ── onStateChange: Schreibzugriffe ───────────────────────────────────────
  onStateChange(id, state) {
    var _a, _b;
    if (!state || state.ack) {
      return;
    }
    if (!this.mqttClient || !this.vrmId) {
      return;
    }
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
    if (parts.length < 5) {
      return;
    }
    const deviceType = parts[3];
    let serial;
    let dpPath;
    if (deviceType === "switch") {
      if (parts.length < 7) {
        return;
      }
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
      if (!isNaN(num)) {
        instance = num;
      }
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
      Soc: {
        en: "State of charge",
        de: "Ladezustand",
        ru: "State of charge",
        pt: "State of charge",
        nl: "State of charge",
        fr: "State of charge",
        it: "State of charge",
        es: "State of charge",
        pl: "State of charge",
        uk: "State of charge",
        "zh-cn": "State of charge"
      },
      "Dc.0.Voltage": {
        en: "DC voltage",
        de: "DC Spannung",
        ru: "DC voltage",
        pt: "DC voltage",
        nl: "DC voltage",
        fr: "DC voltage",
        it: "DC voltage",
        es: "DC voltage",
        pl: "DC voltage",
        uk: "DC voltage",
        "zh-cn": "DC voltage"
      },
      "Dc.0.Current": {
        en: "DC current",
        de: "DC Strom",
        ru: "DC current",
        pt: "DC current",
        nl: "DC current",
        fr: "DC current",
        it: "DC current",
        es: "DC current",
        pl: "DC current",
        uk: "DC current",
        "zh-cn": "DC current"
      },
      "Dc.0.Power": {
        en: "DC power",
        de: "DC Leistung",
        ru: "DC power",
        pt: "DC power",
        nl: "DC power",
        fr: "DC power",
        it: "DC power",
        es: "DC power",
        pl: "DC power",
        uk: "DC power",
        "zh-cn": "DC power"
      },
      "Dc.Battery.Voltage": {
        en: "Battery voltage",
        de: "Batterie Spannung",
        ru: "Battery voltage",
        pt: "Battery voltage",
        nl: "Battery voltage",
        fr: "Battery voltage",
        it: "Battery voltage",
        es: "Battery voltage",
        pl: "Battery voltage",
        uk: "Battery voltage",
        "zh-cn": "Battery voltage"
      },
      "Dc.Battery.Current": {
        en: "Battery current",
        de: "Batterie Strom",
        ru: "Battery current",
        pt: "Battery current",
        nl: "Battery current",
        fr: "Battery current",
        it: "Battery current",
        es: "Battery current",
        pl: "Battery current",
        uk: "Battery current",
        "zh-cn": "Battery current"
      },
      "Dc.Battery.Power": {
        en: "Battery power",
        de: "Batterie Leistung",
        ru: "Battery power",
        pt: "Battery power",
        nl: "Battery power",
        fr: "Battery power",
        it: "Battery power",
        es: "Battery power",
        pl: "Battery power",
        uk: "Battery power",
        "zh-cn": "Battery power"
      },
      "Ac.Power": {
        en: "Total power",
        de: "Gesamtleistung",
        ru: "Total power",
        pt: "Total power",
        nl: "Total power",
        fr: "Total power",
        it: "Total power",
        es: "Total power",
        pl: "Total power",
        uk: "Total power",
        "zh-cn": "Total power"
      },
      "Ac.L1.Power": {
        en: "L1 power",
        de: "L1 Leistung",
        ru: "L1 power",
        pt: "L1 power",
        nl: "L1 power",
        fr: "L1 power",
        it: "L1 power",
        es: "L1 power",
        pl: "L1 power",
        uk: "L1 power",
        "zh-cn": "L1 power"
      },
      "Ac.Consumption.Power": {
        en: "Total consumption",
        de: "Verbrauch Gesamt",
        ru: "Total consumption",
        pt: "Total consumption",
        nl: "Total consumption",
        fr: "Total consumption",
        it: "Total consumption",
        es: "Total consumption",
        pl: "Total consumption",
        uk: "Total consumption",
        "zh-cn": "Total consumption"
      },
      "Ac.Grid.Power": {
        en: "Grid total",
        de: "Netz Gesamt",
        ru: "Grid total",
        pt: "Grid total",
        nl: "Grid total",
        fr: "Grid total",
        it: "Grid total",
        es: "Grid total",
        pl: "Grid total",
        uk: "Grid total",
        "zh-cn": "Grid total"
      },
      "Ac.PvOnGrid.Power": {
        en: "PV grid total",
        de: "PV Netz Gesamt",
        ru: "PV grid total",
        pt: "PV grid total",
        nl: "PV grid total",
        fr: "PV grid total",
        it: "PV grid total",
        es: "PV grid total",
        pl: "PV grid total",
        uk: "PV grid total",
        "zh-cn": "PV grid total"
      },
      "Ac.L2.Power": {
        en: "L2 power",
        de: "L2 Leistung",
        ru: "L2 power",
        pt: "L2 power",
        nl: "L2 power",
        fr: "L2 power",
        it: "L2 power",
        es: "L2 power",
        pl: "L2 power",
        uk: "L2 power",
        "zh-cn": "L2 power"
      },
      "Ac.L3.Power": {
        en: "L3 power",
        de: "L3 Leistung",
        ru: "L3 power",
        pt: "L3 power",
        nl: "L3 power",
        fr: "L3 power",
        it: "L3 power",
        es: "L3 power",
        pl: "L3 power",
        uk: "L3 power",
        "zh-cn": "L3 power"
      },
      "Ac.L1.Voltage": {
        en: "L1 voltage",
        de: "L1 Spannung",
        ru: "L1 voltage",
        pt: "L1 voltage",
        nl: "L1 voltage",
        fr: "L1 voltage",
        it: "L1 voltage",
        es: "L1 voltage",
        pl: "L1 voltage",
        uk: "L1 voltage",
        "zh-cn": "L1 voltage"
      },
      "Ac.L2.Voltage": {
        en: "L2 voltage",
        de: "L2 Spannung",
        ru: "L2 voltage",
        pt: "L2 voltage",
        nl: "L2 voltage",
        fr: "L2 voltage",
        it: "L2 voltage",
        es: "L2 voltage",
        pl: "L2 voltage",
        uk: "L2 voltage",
        "zh-cn": "L2 voltage"
      },
      "Ac.L3.Voltage": {
        en: "L3 voltage",
        de: "L3 Spannung",
        ru: "L3 voltage",
        pt: "L3 voltage",
        nl: "L3 voltage",
        fr: "L3 voltage",
        it: "L3 voltage",
        es: "L3 voltage",
        pl: "L3 voltage",
        uk: "L3 voltage",
        "zh-cn": "L3 voltage"
      },
      "Ac.L1.Current": {
        en: "L1 current",
        de: "L1 Strom",
        ru: "L1 current",
        pt: "L1 current",
        nl: "L1 current",
        fr: "L1 current",
        it: "L1 current",
        es: "L1 current",
        pl: "L1 current",
        uk: "L1 current",
        "zh-cn": "L1 current"
      },
      "Ac.L2.Current": {
        en: "L2 current",
        de: "L2 Strom",
        ru: "L2 current",
        pt: "L2 current",
        nl: "L2 current",
        fr: "L2 current",
        it: "L2 current",
        es: "L2 current",
        pl: "L2 current",
        uk: "L2 current",
        "zh-cn": "L2 current"
      },
      "Ac.L3.Current": {
        en: "L3 current",
        de: "L3 Strom",
        ru: "L3 current",
        pt: "L3 current",
        nl: "L3 current",
        fr: "L3 current",
        it: "L3 current",
        es: "L3 current",
        pl: "L3 current",
        uk: "L3 current",
        "zh-cn": "L3 current"
      },
      "Ac.Energy.Forward": {
        en: "Energy consumption",
        de: "Energie Bezug",
        ru: "Energy consumption",
        pt: "Energy consumption",
        nl: "Energy consumption",
        fr: "Energy consumption",
        it: "Energy consumption",
        es: "Energy consumption",
        pl: "Energy consumption",
        uk: "Energy consumption",
        "zh-cn": "Energy consumption"
      },
      "Ac.Energy.Reverse": {
        en: "Energy feed-in",
        de: "Energie Einspeisung",
        ru: "Energy feed-in",
        pt: "Energy feed-in",
        nl: "Energy feed-in",
        fr: "Energy feed-in",
        it: "Energy feed-in",
        es: "Energy feed-in",
        pl: "Energy feed-in",
        uk: "Energy feed-in",
        "zh-cn": "Energy feed-in"
      },
      Mode: {
        en: "Operating mode",
        de: "Betriebsart",
        ru: "Operating mode",
        pt: "Operating mode",
        nl: "Operating mode",
        fr: "Operating mode",
        it: "Operating mode",
        es: "Operating mode",
        pl: "Operating mode",
        uk: "Operating mode",
        "zh-cn": "Operating mode"
      },
      State: {
        en: "Switch state",
        de: "Schaltzustand",
        ru: "Switch state",
        pt: "Switch state",
        nl: "Switch state",
        fr: "Switch state",
        it: "Switch state",
        es: "Switch state",
        pl: "Switch state",
        uk: "Switch state",
        "zh-cn": "Switch state"
      },
      VebusError: {
        en: "Vebus error",
        de: "VebusError",
        ru: "Vebus error",
        pt: "Vebus error",
        nl: "Vebus error",
        fr: "Vebus error",
        it: "Vebus error",
        es: "Vebus error",
        pl: "Vebus error",
        uk: "Vebus error",
        "zh-cn": "Vebus error"
      },
      VebusChargeState: {
        en: "Vebus charge state",
        de: "VebusChargeState",
        ru: "Vebus charge state",
        pt: "Vebus charge state",
        nl: "Vebus charge state",
        fr: "Vebus charge state",
        it: "Vebus charge state",
        es: "Vebus charge state",
        pl: "Vebus charge state",
        uk: "Vebus charge state",
        "zh-cn": "Vebus charge state"
      },
      TimeToGo: {
        en: "Time to go",
        de: "Restlaufzeit",
        ru: "Time to go",
        pt: "Time to go",
        nl: "Time to go",
        fr: "Time to go",
        it: "Time to go",
        es: "Time to go",
        pl: "Time to go",
        uk: "Time to go",
        "zh-cn": "Time to go"
      },
      "Dc.0.Temperature": {
        en: "Temperature",
        de: "Temperatur",
        ru: "Temperature",
        pt: "Temperature",
        nl: "Temperature",
        fr: "Temperature",
        it: "Temperature",
        es: "Temperature",
        pl: "Temperature",
        uk: "Temperature",
        "zh-cn": "Temperature"
      },
      "temperatures.main": {
        en: "Main temperature",
        de: "Temperatur Haupt",
        ru: "Main temperature",
        pt: "Main temperature",
        nl: "Main temperature",
        fr: "Main temperature",
        it: "Main temperature",
        es: "Main temperature",
        pl: "Main temperature",
        uk: "Main temperature",
        "zh-cn": "Main temperature"
      },
      "temperatures.temp1": {
        en: "Temperature 1",
        de: "Temperatur 1",
        ru: "Temperature 1",
        pt: "Temperature 1",
        nl: "Temperature 1",
        fr: "Temperature 1",
        it: "Temperature 1",
        es: "Temperature 1",
        pl: "Temperature 1",
        uk: "Temperature 1",
        "zh-cn": "Temperature 1"
      },
      "temperatures.temp2": {
        en: "Temperature 2",
        de: "Temperatur 2",
        ru: "Temperature 2",
        pt: "Temperature 2",
        nl: "Temperature 2",
        fr: "Temperature 2",
        it: "Temperature 2",
        es: "Temperature 2",
        pl: "Temperature 2",
        uk: "Temperature 2",
        "zh-cn": "Temperature 2"
      },
      "temperatures.temp3": {
        en: "Temperature 3",
        de: "Temperatur 3",
        ru: "Temperature 3",
        pt: "Temperature 3",
        nl: "Temperature 3",
        fr: "Temperature 3",
        it: "Temperature 3",
        es: "Temperature 3",
        pl: "Temperature 3",
        uk: "Temperature 3",
        "zh-cn": "Temperature 3"
      },
      "temperatures.temp4": {
        en: "Temperature 4",
        de: "Temperatur 4",
        ru: "Temperature 4",
        pt: "Temperature 4",
        nl: "Temperature 4",
        fr: "Temperature 4",
        it: "Temperature 4",
        es: "Temperature 4",
        pl: "Temperature 4",
        uk: "Temperature 4",
        "zh-cn": "Temperature 4"
      },
      "temperatures.min": {
        en: "Temperature min",
        de: "Temperatur Min",
        ru: "Temperature min",
        pt: "Temperature min",
        nl: "Temperature min",
        fr: "Temperature min",
        it: "Temperature min",
        es: "Temperature min",
        pl: "Temperature min",
        uk: "Temperature min",
        "zh-cn": "Temperature min"
      },
      "temperatures.max": {
        en: "Temperature max",
        de: "Temperatur Max",
        ru: "Temperature max",
        pt: "Temperature max",
        nl: "Temperature max",
        fr: "Temperature max",
        it: "Temperature max",
        es: "Temperature max",
        pl: "Temperature max",
        uk: "Temperature max",
        "zh-cn": "Temperature max"
      },
      "cells.min": {
        en: "Cell min",
        de: "Zelle Min",
        ru: "Cell min",
        pt: "Cell min",
        nl: "Cell min",
        fr: "Cell min",
        it: "Cell min",
        es: "Cell min",
        pl: "Cell min",
        uk: "Cell min",
        "zh-cn": "Cell min"
      },
      "cells.max": {
        en: "Cell max",
        de: "Zelle Max",
        ru: "Cell max",
        pt: "Cell max",
        nl: "Cell max",
        fr: "Cell max",
        it: "Cell max",
        es: "Cell max",
        pl: "Cell max",
        uk: "Cell max",
        "zh-cn": "Cell max"
      },
      "cells.minId": {
        en: "Cell min ID",
        de: "Zelle Min ID",
        ru: "Cell min ID",
        pt: "Cell min ID",
        nl: "Cell min ID",
        fr: "Cell min ID",
        it: "Cell min ID",
        es: "Cell min ID",
        pl: "Cell min ID",
        uk: "Cell min ID",
        "zh-cn": "Cell min ID"
      },
      "cells.maxId": {
        en: "Cell max ID",
        de: "Zelle Max ID",
        ru: "Cell max ID",
        pt: "Cell max ID",
        nl: "Cell max ID",
        fr: "Cell max ID",
        it: "Cell max ID",
        es: "Cell max ID",
        pl: "Cell max ID",
        uk: "Cell max ID",
        "zh-cn": "Cell max ID"
      },
      "cells.diff": {
        en: "Cell spread",
        de: "Zell-Spread",
        ru: "Cell spread",
        pt: "Cell spread",
        nl: "Cell spread",
        fr: "Cell spread",
        it: "Cell spread",
        es: "Cell spread",
        pl: "Cell spread",
        uk: "Cell spread",
        "zh-cn": "Cell spread"
      },
      "alarms.lowVoltage": {
        en: "Alarm: low voltage",
        de: "Alarm: Unterspannung",
        ru: "Alarm: low voltage",
        pt: "Alarm: low voltage",
        nl: "Alarm: low voltage",
        fr: "Alarm: low voltage",
        it: "Alarm: low voltage",
        es: "Alarm: low voltage",
        pl: "Alarm: low voltage",
        uk: "Alarm: low voltage",
        "zh-cn": "Alarm: low voltage"
      },
      "alarms.highVoltage": {
        en: "Alarm: high voltage",
        de: "Alarm: \xDCberspannung",
        ru: "Alarm: high voltage",
        pt: "Alarm: high voltage",
        nl: "Alarm: high voltage",
        fr: "Alarm: high voltage",
        it: "Alarm: high voltage",
        es: "Alarm: high voltage",
        pl: "Alarm: high voltage",
        uk: "Alarm: high voltage",
        "zh-cn": "Alarm: high voltage"
      },
      "alarms.lowSoc": {
        en: "Alarm: low SoC",
        de: "Alarm: SOC niedrig",
        ru: "Alarm: low SoC",
        pt: "Alarm: low SoC",
        nl: "Alarm: low SoC",
        fr: "Alarm: low SoC",
        it: "Alarm: low SoC",
        es: "Alarm: low SoC",
        pl: "Alarm: low SoC",
        uk: "Alarm: low SoC",
        "zh-cn": "Alarm: low SoC"
      },
      "Dc.Battery.Soc": {
        en: "Battery state of charge",
        de: "Batterie Ladezustand",
        ru: "Battery state of charge",
        pt: "Battery state of charge",
        nl: "Battery state of charge",
        fr: "Battery state of charge",
        it: "Battery state of charge",
        es: "Battery state of charge",
        pl: "Battery state of charge",
        uk: "Battery state of charge",
        "zh-cn": "Battery state of charge"
      },
      "Dc.Battery.ConsumedAmphours": {
        en: "Battery consumed Ah",
        de: "Batterie Verbrauch",
        ru: "Battery consumed Ah",
        pt: "Battery consumed Ah",
        nl: "Battery consumed Ah",
        fr: "Battery consumed Ah",
        it: "Battery consumed Ah",
        es: "Battery consumed Ah",
        pl: "Battery consumed Ah",
        uk: "Battery consumed Ah",
        "zh-cn": "Battery consumed Ah"
      },
      "Dc.System.Power": {
        en: "DC system power",
        de: "DC System Leistung",
        ru: "DC system power",
        pt: "DC system power",
        nl: "DC system power",
        fr: "DC system power",
        it: "DC system power",
        es: "DC system power",
        pl: "DC system power",
        uk: "DC system power",
        "zh-cn": "DC system power"
      },
      "Dc.Vebus.Power": {
        en: "MultiPlus DC power",
        de: "MultiPlus DC Leistung",
        ru: "MultiPlus DC power",
        pt: "MultiPlus DC power",
        nl: "MultiPlus DC power",
        fr: "MultiPlus DC power",
        it: "MultiPlus DC power",
        es: "MultiPlus DC power",
        pl: "MultiPlus DC power",
        uk: "MultiPlus DC power",
        "zh-cn": "MultiPlus DC power"
      },
      "Ac.Consumption.L1.Power": {
        en: "Consumption L1",
        de: "Verbrauch L1",
        ru: "Consumption L1",
        pt: "Consumption L1",
        nl: "Consumption L1",
        fr: "Consumption L1",
        it: "Consumption L1",
        es: "Consumption L1",
        pl: "Consumption L1",
        uk: "Consumption L1",
        "zh-cn": "Consumption L1"
      },
      "Ac.Consumption.L2.Power": {
        en: "Consumption L2",
        de: "Verbrauch L2",
        ru: "Consumption L2",
        pt: "Consumption L2",
        nl: "Consumption L2",
        fr: "Consumption L2",
        it: "Consumption L2",
        es: "Consumption L2",
        pl: "Consumption L2",
        uk: "Consumption L2",
        "zh-cn": "Consumption L2"
      },
      "Ac.Consumption.L3.Power": {
        en: "Consumption L3",
        de: "Verbrauch L3",
        ru: "Consumption L3",
        pt: "Consumption L3",
        nl: "Consumption L3",
        fr: "Consumption L3",
        it: "Consumption L3",
        es: "Consumption L3",
        pl: "Consumption L3",
        uk: "Consumption L3",
        "zh-cn": "Consumption L3"
      },
      "Ac.ConsumptionOnOutput.L1.Power": {
        en: "Consumption output L1",
        de: "Verbrauch Ausgang L1",
        ru: "Consumption output L1",
        pt: "Consumption output L1",
        nl: "Consumption output L1",
        fr: "Consumption output L1",
        it: "Consumption output L1",
        es: "Consumption output L1",
        pl: "Consumption output L1",
        uk: "Consumption output L1",
        "zh-cn": "Consumption output L1"
      },
      "Ac.ConsumptionOnInput.L1.Power": {
        en: "Consumption input L1",
        de: "Verbrauch Eingang L1",
        ru: "Consumption input L1",
        pt: "Consumption input L1",
        nl: "Consumption input L1",
        fr: "Consumption input L1",
        it: "Consumption input L1",
        es: "Consumption input L1",
        pl: "Consumption input L1",
        uk: "Consumption input L1",
        "zh-cn": "Consumption input L1"
      },
      "Ac.Grid.L1.Power": {
        en: "Grid L1",
        de: "Grid L1",
        ru: "Grid L1",
        pt: "Grid L1",
        nl: "Grid L1",
        fr: "Grid L1",
        it: "Grid L1",
        es: "Grid L1",
        pl: "Grid L1",
        uk: "Grid L1",
        "zh-cn": "Grid L1"
      },
      "Ac.Grid.L2.Power": {
        en: "Grid L2",
        de: "Grid L2",
        ru: "Grid L2",
        pt: "Grid L2",
        nl: "Grid L2",
        fr: "Grid L2",
        it: "Grid L2",
        es: "Grid L2",
        pl: "Grid L2",
        uk: "Grid L2",
        "zh-cn": "Grid L2"
      },
      "Ac.Grid.L3.Power": {
        en: "Grid L3",
        de: "Grid L3",
        ru: "Grid L3",
        pt: "Grid L3",
        nl: "Grid L3",
        fr: "Grid L3",
        it: "Grid L3",
        es: "Grid L3",
        pl: "Grid L3",
        uk: "Grid L3",
        "zh-cn": "Grid L3"
      },
      "Ac.PvOnGrid.L1.Power": {
        en: "PV grid L1",
        de: "PV Netz L1",
        ru: "PV grid L1",
        pt: "PV grid L1",
        nl: "PV grid L1",
        fr: "PV grid L1",
        it: "PV grid L1",
        es: "PV grid L1",
        pl: "PV grid L1",
        uk: "PV grid L1",
        "zh-cn": "PV grid L1"
      },
      "Ac.PvOnGrid.L2.Power": {
        en: "PV grid L2",
        de: "PV Netz L2",
        ru: "PV grid L2",
        pt: "PV grid L2",
        nl: "PV grid L2",
        fr: "PV grid L2",
        it: "PV grid L2",
        es: "PV grid L2",
        pl: "PV grid L2",
        uk: "PV grid L2",
        "zh-cn": "PV grid L2"
      },
      "BatterySense.Voltage": {
        en: "Battery voltage (MP)",
        de: "Batterie Spannung (MP)",
        ru: "Battery voltage (MP)",
        pt: "Battery voltage (MP)",
        nl: "Battery voltage (MP)",
        fr: "Battery voltage (MP)",
        it: "Battery voltage (MP)",
        es: "Battery voltage (MP)",
        pl: "Battery voltage (MP)",
        uk: "Battery voltage (MP)",
        "zh-cn": "Battery voltage (MP)"
      },
      "Hub4.L1.AcPowerSetpoint": {
        en: "ESS setpoint L1",
        de: "ESS Sollwert L1",
        ru: "ESS setpoint L1",
        pt: "ESS setpoint L1",
        nl: "ESS setpoint L1",
        fr: "ESS setpoint L1",
        it: "ESS setpoint L1",
        es: "ESS setpoint L1",
        pl: "ESS setpoint L1",
        uk: "ESS setpoint L1",
        "zh-cn": "ESS setpoint L1"
      },
      "Hub4.DisableFeedIn": {
        en: "Feed-in disabled",
        de: "Einspeisung gesperrt",
        ru: "Feed-in disabled",
        pt: "Feed-in disabled",
        nl: "Feed-in disabled",
        fr: "Feed-in disabled",
        it: "Feed-in disabled",
        es: "Feed-in disabled",
        pl: "Feed-in disabled",
        uk: "Feed-in disabled",
        "zh-cn": "Feed-in disabled"
      },
      "Hub4.DisableCharge": {
        en: "Charge disabled",
        de: "Laden gesperrt",
        ru: "Charge disabled",
        pt: "Charge disabled",
        nl: "Charge disabled",
        fr: "Charge disabled",
        it: "Charge disabled",
        es: "Charge disabled",
        pl: "Charge disabled",
        uk: "Charge disabled",
        "zh-cn": "Charge disabled"
      },
      "Ac.ActiveIn.L1.P": {
        en: "L1 input power",
        de: "L1 Eingangsleistung",
        ru: "L1 input power",
        pt: "L1 input power",
        nl: "L1 input power",
        fr: "L1 input power",
        it: "L1 input power",
        es: "L1 input power",
        pl: "L1 input power",
        uk: "L1 input power",
        "zh-cn": "L1 input power"
      },
      "Ac.ActiveIn.L1.I": {
        en: "L1 input current",
        de: "L1 Eingangsstrom",
        ru: "L1 input current",
        pt: "L1 input current",
        nl: "L1 input current",
        fr: "L1 input current",
        it: "L1 input current",
        es: "L1 input current",
        pl: "L1 input current",
        uk: "L1 input current",
        "zh-cn": "L1 input current"
      },
      "Ac.ActiveIn.L1.V": {
        en: "L1 input voltage",
        de: "L1 Eingangsspannung",
        ru: "L1 input voltage",
        pt: "L1 input voltage",
        nl: "L1 input voltage",
        fr: "L1 input voltage",
        it: "L1 input voltage",
        es: "L1 input voltage",
        pl: "L1 input voltage",
        uk: "L1 input voltage",
        "zh-cn": "L1 input voltage"
      },
      "Ac.ActiveIn.L1.S": {
        en: "L1 input apparent power",
        de: "L1 Eingang Scheinleistung",
        ru: "L1 input apparent power",
        pt: "L1 input apparent power",
        nl: "L1 input apparent power",
        fr: "L1 input apparent power",
        it: "L1 input apparent power",
        es: "L1 input apparent power",
        pl: "L1 input apparent power",
        uk: "L1 input apparent power",
        "zh-cn": "L1 input apparent power"
      },
      "Ac.ActiveIn.P": {
        en: "Total input power",
        de: "Eingang Gesamtleistung",
        ru: "Total input power",
        pt: "Total input power",
        nl: "Total input power",
        fr: "Total input power",
        it: "Total input power",
        es: "Total input power",
        pl: "Total input power",
        uk: "Total input power",
        "zh-cn": "Total input power"
      },
      "Ac.ActiveIn.S": {
        en: "Input apparent power",
        de: "Eingang Scheinleistung",
        ru: "Input apparent power",
        pt: "Input apparent power",
        nl: "Input apparent power",
        fr: "Input apparent power",
        it: "Input apparent power",
        es: "Input apparent power",
        pl: "Input apparent power",
        uk: "Input apparent power",
        "zh-cn": "Input apparent power"
      },
      "Ac.Out.L1.P": {
        en: "L1 output power",
        de: "L1 Ausgangsleistung",
        ru: "L1 output power",
        pt: "L1 output power",
        nl: "L1 output power",
        fr: "L1 output power",
        it: "L1 output power",
        es: "L1 output power",
        pl: "L1 output power",
        uk: "L1 output power",
        "zh-cn": "L1 output power"
      },
      "Ac.Out.L1.F": {
        en: "L1 output frequency",
        de: "L1 Ausgangsfrequenz",
        ru: "L1 output frequency",
        pt: "L1 output frequency",
        nl: "L1 output frequency",
        fr: "L1 output frequency",
        it: "L1 output frequency",
        es: "L1 output frequency",
        pl: "L1 output frequency",
        uk: "L1 output frequency",
        "zh-cn": "L1 output frequency"
      },
      "Ac.Out.L1.I": {
        en: "L1 output current",
        de: "L1 Ausgangsstrom",
        ru: "L1 output current",
        pt: "L1 output current",
        nl: "L1 output current",
        fr: "L1 output current",
        it: "L1 output current",
        es: "L1 output current",
        pl: "L1 output current",
        uk: "L1 output current",
        "zh-cn": "L1 output current"
      },
      "Ac.Out.L1.S": {
        en: "L1 output apparent power",
        de: "L1 Ausgang Scheinleistung",
        ru: "L1 output apparent power",
        pt: "L1 output apparent power",
        nl: "L1 output apparent power",
        fr: "L1 output apparent power",
        it: "L1 output apparent power",
        es: "L1 output apparent power",
        pl: "L1 output apparent power",
        uk: "L1 output apparent power",
        "zh-cn": "L1 output apparent power"
      },
      "Ac.Out.P": {
        en: "Total output power",
        de: "Ausgang Gesamtleistung",
        ru: "Total output power",
        pt: "Total output power",
        nl: "Total output power",
        fr: "Total output power",
        it: "Total output power",
        es: "Total output power",
        pl: "Total output power",
        uk: "Total output power",
        "zh-cn": "Total output power"
      },
      "Ac.Out.S": {
        en: "Output apparent power",
        de: "Ausgang Scheinleistung",
        ru: "Output apparent power",
        pt: "Output apparent power",
        nl: "Output apparent power",
        fr: "Output apparent power",
        it: "Output apparent power",
        es: "Output apparent power",
        pl: "Output apparent power",
        uk: "Output apparent power",
        "zh-cn": "Output apparent power"
      },
      Capacity: {
        en: "Capacity",
        de: "Kapazit\xE4t",
        ru: "Capacity",
        pt: "Capacity",
        nl: "Capacity",
        fr: "Capacity",
        it: "Capacity",
        es: "Capacity",
        pl: "Capacity",
        uk: "Capacity",
        "zh-cn": "Capacity"
      },
      CurrentAvg: {
        en: "Average current",
        de: "Durchschnittsstrom",
        ru: "Average current",
        pt: "Average current",
        nl: "Average current",
        fr: "Average current",
        it: "Average current",
        es: "Average current",
        pl: "Average current",
        uk: "Average current",
        "zh-cn": "Average current"
      },
      "Yield.Power": {
        en: "PV power",
        de: "PV Leistung",
        ru: "PV power",
        pt: "PV power",
        nl: "PV power",
        fr: "PV power",
        it: "PV power",
        es: "PV power",
        pl: "PV power",
        uk: "PV power",
        "zh-cn": "PV power"
      },
      "Yield.Today": {
        en: "Today",
        de: "Ertrag heute",
        ru: "Today",
        pt: "Today",
        nl: "Today",
        fr: "Today",
        it: "Today",
        es: "Today",
        pl: "Today",
        uk: "Today",
        "zh-cn": "Today"
      },
      "Yield.Total": {
        en: "Total yield",
        de: "Ertrag gesamt",
        ru: "Total yield",
        pt: "Total yield",
        nl: "Total yield",
        fr: "Total yield",
        it: "Total yield",
        es: "Total yield",
        pl: "Total yield",
        uk: "Total yield",
        "zh-cn": "Total yield"
      },
      "Pv.V": {
        en: "PV voltage",
        de: "PV Spannung",
        ru: "PV voltage",
        pt: "PV voltage",
        nl: "PV voltage",
        fr: "PV voltage",
        it: "PV voltage",
        es: "PV voltage",
        pl: "PV voltage",
        uk: "PV voltage",
        "zh-cn": "PV voltage"
      },
      "Pv.P": {
        en: "PV power",
        de: "PV Leistung",
        ru: "PV power",
        pt: "PV power",
        nl: "PV power",
        fr: "PV power",
        it: "PV power",
        es: "PV power",
        pl: "PV power",
        uk: "PV power",
        "zh-cn": "PV power"
      },
      StatusCode: {
        en: "Status",
        de: "Status",
        ru: "Status",
        pt: "Status",
        nl: "Status",
        fr: "Status",
        it: "Status",
        es: "Status",
        pl: "Status",
        uk: "Status",
        "zh-cn": "Status"
      },
      ErrorCode: {
        en: "Error code",
        de: "Fehlercode",
        ru: "Error code",
        pt: "Error code",
        nl: "Error code",
        fr: "Error code",
        it: "Error code",
        es: "Error code",
        pl: "Error code",
        uk: "Error code",
        "zh-cn": "Error code"
      },
      "Ac.Frequency": {
        en: "Frequency",
        de: "Frequenz",
        ru: "Frequency",
        pt: "Frequency",
        nl: "Frequency",
        fr: "Frequency",
        it: "Frequency",
        es: "Frequency",
        pl: "Frequency",
        uk: "Frequency",
        "zh-cn": "Frequency"
      },
      "Ac.MaxPower": {
        en: "Max. power",
        de: "Max. Leistung",
        ru: "Max. power",
        pt: "Max. power",
        nl: "Max. power",
        fr: "Max. power",
        it: "Max. power",
        es: "Max. power",
        pl: "Max. power",
        uk: "Max. power",
        "zh-cn": "Max. power"
      },
      "Ac.PowerLimit": {
        en: "Power limit",
        de: "Leistungsbegrenzung",
        ru: "Power limit",
        pt: "Power limit",
        nl: "Power limit",
        fr: "Power limit",
        it: "Power limit",
        es: "Power limit",
        pl: "Power limit",
        uk: "Power limit",
        "zh-cn": "Power limit"
      },
      "SystemState.State": {
        en: "System state",
        de: "Systemzustand",
        ru: "System state",
        pt: "System state",
        nl: "System state",
        fr: "System state",
        it: "System state",
        es: "System state",
        pl: "System state",
        uk: "System state",
        "zh-cn": "System state"
      },
      Remaining: {
        en: "Remaining",
        de: "Verbleibend",
        ru: "Remaining",
        pt: "Remaining",
        nl: "Remaining",
        fr: "Remaining",
        it: "Remaining",
        es: "Remaining",
        pl: "Remaining",
        uk: "Remaining",
        "zh-cn": "Remaining"
      },
      FluidType: {
        en: "Fluid type",
        de: "Fl\xFCssigkeitstyp",
        ru: "Fluid type",
        pt: "Fluid type",
        nl: "Fluid type",
        fr: "Fluid type",
        it: "Fluid type",
        es: "Fluid type",
        pl: "Fluid type",
        uk: "Fluid type",
        "zh-cn": "Fluid type"
      },
      Temperature: {
        en: "Temperature",
        de: "Temperatur",
        ru: "Temperature",
        pt: "Temperature",
        nl: "Temperature",
        fr: "Temperature",
        it: "Temperature",
        es: "Temperature",
        pl: "Temperature",
        uk: "Temperature",
        "zh-cn": "Temperature"
      },
      CustomName: {
        en: "Custom name",
        de: "Benutzerdefinierter Name",
        ru: "Custom name",
        pt: "Custom name",
        nl: "Custom name",
        fr: "Custom name",
        it: "Custom name",
        es: "Custom name",
        pl: "Custom name",
        uk: "Custom name",
        "zh-cn": "Custom name"
      },
      ProductName: {
        en: "Product name",
        de: "Produktname",
        ru: "Product name",
        pt: "Product name",
        nl: "Product name",
        fr: "Product name",
        it: "Product name",
        es: "Product name",
        pl: "Product name",
        uk: "Product name",
        "zh-cn": "Product name"
      },
      Serial: {
        en: "Serial number",
        de: "Seriennummer",
        ru: "Serial number",
        pt: "Serial number",
        nl: "Serial number",
        fr: "Serial number",
        it: "Serial number",
        es: "Serial number",
        pl: "Serial number",
        uk: "Serial number",
        "zh-cn": "Serial number"
      },
      ConsumedAmphours: {
        en: "Consumed Ah",
        de: "Verbrauchte Ah",
        ru: "Consumed Ah",
        pt: "Consumed Ah",
        nl: "Consumed Ah",
        fr: "Consumed Ah",
        it: "Consumed Ah",
        es: "Consumed Ah",
        pl: "Consumed Ah",
        uk: "Consumed Ah",
        "zh-cn": "Consumed Ah"
      }
    };
    if (names[path]) {
      return names[path];
    }
    if (path.startsWith("cells.cell")) {
      const n = parseInt(path.replace("cells.cell", ""), 10);
      return { en: `Cell ${n}`, de: `Zelle ${n}` };
    }
    return path;
  }
  getUnit(path) {
    if (path.startsWith("cells.cell") || path === "cells.min" || path === "cells.max" || path === "cells.diff" || path.includes("Voltage") || path.endsWith(".V")) {
      return "V";
    }
    if (path.includes("Power") || path === "Hub4.L1.AcPowerSetpoint" || path.endsWith(".P") || path === "Ac.Power") {
      return "W";
    }
    if (path.includes("Current") || path.endsWith(".I")) {
      return "A";
    }
    if (path.includes("Energy")) {
      return "kWh";
    }
    if (path.includes("Soc")) {
      return "%";
    }
    if (path.startsWith("temperatures.")) {
      return "\xB0C";
    }
    if (path.endsWith(".S")) {
      return "VA";
    }
    if (path.endsWith(".F") || path === "Ac.Frequency") {
      return "Hz";
    }
    if (path === "Yield.Today" || path === "Yield.Total") {
      return "kWh";
    }
    if (path === "Level" || path === "Humidity") {
      return "%";
    }
    if (path === "Remaining") {
      return "m\xB3";
    }
    if (path === "Pressure") {
      return "hPa";
    }
    if (path.includes("ConsumedAmphours")) {
      return "Ah";
    }
    if (path === "Capacity") {
      return "Ah";
    }
    if (path === "Ac.MaxPower" || path === "Ac.PowerLimit") {
      return "W";
    }
    return "";
  }
  getRole(path) {
    if (path === "State") {
      return "value";
    }
    if (path.startsWith("cells.cell") || path === "cells.min" || path === "cells.max" || path === "cells.diff" || path.includes("Voltage") || path.endsWith(".V")) {
      return "value.voltage";
    }
    if (path.includes("Power") || path === "Hub4.L1.AcPowerSetpoint" || path.endsWith(".P") || path === "Ac.Power" || path.endsWith(".S")) {
      return "value.power";
    }
    if (path.includes("Current") || path.endsWith(".I")) {
      return "value.current";
    }
    if (path.endsWith(".F") || path === "Ac.Frequency") {
      return "value.frequency";
    }
    if (path.includes("Energy")) {
      return "value.energy.consumed";
    }
    if (path.includes("Soc")) {
      return "value.battery";
    }
    if (path.startsWith("temperatures.")) {
      return "value.temperature";
    }
    if (path.startsWith("alarms.")) {
      return "indicator.alarm";
    }
    if (path === "cells.minId" || path === "cells.maxId") {
      return "text";
    }
    return "value";
  }
  // ── Adapter-Stop ─────────────────────────────────────────────────────────
  onUnload(callback) {
    try {
      if (this.keepAliveInterval) {
        this.clearInterval(this.keepAliveInterval);
      }
      if (this.acPowerSetpointInterval) {
        this.clearInterval(this.acPowerSetpointInterval);
        this.acPowerSetpointInterval = null;
      }
      for (const device of this.deviceMap.values()) {
        if (device.staleTimer) {
          clearTimeout(device.staleTimer);
        }
      }
      if (this.mqttClient) {
        this.mqttClient.end();
      }
      if (this.modbusClient) {
        this.modbusClient.close(() => {
        });
      }
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
