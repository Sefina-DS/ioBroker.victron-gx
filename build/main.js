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
const KNOWN_DEVICE_TYPES = {
  battery: "Batterie",
  vebus: "Wechselrichter",
  solarcharger: "Solarladeregler (MPPT)",
  acload: "AC Last",
  grid: "Netzanschluss",
  pvinverter: "PV Wechselrichter",
  switch: "Virtueller Schalter",
  system: "System",
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
    "Temperature",
    "ConsumedAmphours",
    "TimeToGo",
    "Alarms.LowVoltage",
    "Alarms.HighVoltage",
    "Alarms.LowSoc",
    "Info.ChargeMode",
    "Info.ChargeRequest",
    // Zellenspannungen
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
    "Voltages.Sum",
    "Voltages.Diff",
    // Registrierung
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
    "Ac.ActiveIn.L2.P",
    "Ac.ActiveIn.L3.P",
    "Ac.Out.L1.P",
    "Ac.Out.L2.P",
    "Ac.Out.L3.P",
    "Ac.Out.L1.V",
    "Ac.Out.L2.V",
    "Ac.Out.L3.V",
    "Ac.In1.CurrentLimit",
    "Dc.0.Voltage",
    "Dc.0.Current",
    "Dc.0.Power",
    "Serial",
    "ProductName",
    "CustomName"
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
    // grid hat keine Serial → ProductName für Erkennung
    "ProductName",
    "CustomName"
  ],
  acload: [
    "Ac.L1.Power",
    "Ac.L2.Power",
    "Ac.L3.Power",
    "Ac.L1.Voltage",
    "Ac.L2.Voltage",
    "Ac.L3.Voltage",
    "Ac.Energy.Forward",
    "Serial",
    "ProductName",
    "CustomName",
    "Mgmt.Connection",
    "Mgmt.ProcessName"
  ],
  pvinverter: [
    "Ac.Power",
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
    "StatusCode",
    "Serial",
    "ProductName",
    "CustomName",
    "Mgmt.Connection",
    "Mgmt.ProcessName"
  ],
  // Virtuelle Schalter: über Node-RED auf dem GX angelegt
  // State ist schreibbar → ioBroker → MQTT Write → GX → Node-RED → Relais
  switch: [
    "SwitchableOutput.output_1.State",
    "SwitchableOutput.output_1.Status",
    "Connected",
    "Serial",
    "ProductName",
    "CustomName",
    "Mgmt.Connection",
    "Mgmt.ProcessName",
    // Einstellungen für Channel-Name und Gruppierung
    "SwitchableOutput.output_1.Settings.CustomName",
    "SwitchableOutput.output_1.Settings.Group"
  ],
  system: [
    "Soc",
    "Dc.Battery.Voltage",
    "Dc.Battery.Current",
    "Dc.Battery.Power",
    "Dc.Pv.Power",
    "Dc.Pv.Current",
    "Ac.ConsumptionOnOutput.L1.Power",
    "Ac.ConsumptionOnOutput.L2.Power",
    "Ac.ConsumptionOnOutput.L3.Power",
    "Ac.Grid.L1.Power",
    "Ac.Grid.L2.Power",
    "Ac.Grid.L3.Power",
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
  "Mgmt.Connection",
  "Mgmt.ProcessName",
  "SwitchableOutput.output_1.Settings.CustomName",
  "SwitchableOutput.output_1.Settings.Group"
]);
const UNITS = {
  Soc: "%",
  Voltage: "V",
  Current: "A",
  Power: "W",
  Temperature: "\xB0C",
  Humidity: "%",
  Pressure: "hPa",
  "Yield.Today": "kWh",
  "Yield.Total": "kWh",
  "Yield.Power": "W",
  Level: "%",
  Remaining: "m\xB3",
  "Voltages.Sum": "V",
  "Voltages.Diff": "V"
};
const WRITABLE_PATHS = {
  switch: ["SwitchableOutput.output_1.State"],
  vebus: ["Mode", "Ac.In1.CurrentLimit"]
};
const STALE_TIMEOUT_MS = 5 * 60 * 1e3;
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
class VictronGx extends utils.Adapter {
  mqttClient = null;
  keepAliveInterval = null;
  vrmId = "";
  deviceMap = /* @__PURE__ */ new Map();
  serialMap = /* @__PURE__ */ new Map();
  // Bereits geloggte Geräte → verhindert Log-Spam beim Keepalive-Refresh
  loggedDevices = /* @__PURE__ */ new Set();
  // Channels die vollständig angelegt wurden → touchDevice schreibt erst danach
  channelReady = /* @__PURE__ */ new Set();
  constructor(options = {}) {
    super({ ...options, name: "victron-gx" });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  // ── Adapter-Start ────────────────────────────────────────────────────────
  onReady() {
    void void this.setState("info.connection", false, true);
    const host = this.config.host;
    const port = this.config.port || 1883;
    const username = this.config.mqttUsername;
    const password = this.config.mqttPassword;
    if (!host) {
      this.log.error("Keine IP-Adresse konfiguriert!");
      return;
    }
    this.log.info(`Verbinde mit Victron GX unter ${host}:${port}...`);
    this.connectMqtt(host, port, username, password);
  }
  // ── MQTT Verbindung ──────────────────────────────────────────────────────
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
      void void this.setState("info.connection", false, true);
    });
    this.mqttClient.on("offline", () => {
      this.log.warn("MQTT Verbindung getrennt");
      void void this.setState("info.connection", false, true);
    });
    this.mqttClient.on("reconnect", () => {
      this.log.info("MQTT verbindet neu...");
      if (this.vrmId) {
        this.startKeepAlive();
      }
    });
  }
  startKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
    this.keepAliveInterval = setInterval(() => {
      if (this.mqttClient && this.vrmId) {
        this.mqttClient.publish(`R/${this.vrmId}/keepalive`, "");
        this.log.debug("Keepalive gesendet");
      }
    }, 5e4);
    if (this.vrmId) {
      this.mqttClient.publish(`R/${this.vrmId}/keepalive`, "");
    }
  }
  // ── Haupt-Message-Handler ────────────────────────────────────────────────
  async handleMessage(topic, payload) {
    var _a, _b;
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
      const parts = topic.split("/");
      if (parts[0] !== "N" || parts.length < 4) {
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
      const path = parts.slice(4).join("/");
      const normalizedPath = path.replace(/\//g, ".");
      if (!path) {
        return;
      }
      if (!RELEVANT_PATHS[deviceType]) {
        return;
      }
      const rawValue = "value" in parsed ? parsed.value : parsed;
      if (rawValue === null || rawValue === void 0) {
        return;
      }
      const value = rawValue;
      if (REGISTRATION_PATHS.has(normalizedPath)) {
        if (typeof value === "string" || typeof value === "number") {
          this.updateDeviceMeta(deviceType, instance, normalizedPath, String(value));
        }
        return;
      }
      const deviceKey = `${deviceType}/${instance}`;
      const device = this.deviceMap.get(deviceKey);
      const serial = this.serialMap.get(deviceKey);
      const baseId = serial ? `devices.${deviceType}.${serial}` : `devices.${deviceType}.${instanceStr}`;
      if ((device == null ? void 0 : device.virtual) && PHASE_VOLTAGE_PATHS[deviceType]) {
        const voltageMatch = normalizedPath.match(/^Ac\.(L[123])\.Voltage$/);
        if (voltageMatch) {
          const phase = voltageMatch[1];
          device.phaseVoltage[phase] = typeof value === "number" ? value : 0;
        }
        const phaseMatch = normalizedPath.match(/^Ac\.(L[123])\./);
        if (phaseMatch) {
          const phase = phaseMatch[1];
          const voltage = (_a = device.phaseVoltage[phase]) != null ? _a : 0;
          if (voltage === 0) {
            return;
          }
        }
      }
      if (value === null || value === void 0) {
        return;
      }
      const relevantPaths = RELEVANT_PATHS[deviceType];
      const isRelevant = relevantPaths.some((rp) => normalizedPath === rp.replace(/\//g, "."));
      if (!isRelevant) {
        return;
      }
      if (device) {
        this.touchDevice(device, baseId);
      }
      const isWritable = (WRITABLE_PATHS[deviceType] || []).some((wp) => normalizedPath === wp.replace(/\//g, "."));
      const stateId = `${baseId}.${normalizedPath}`;
      await this.setObjectNotExistsAsync(stateId, {
        type: "state",
        common: {
          name: this.getFriendlyName(normalizedPath),
          type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string",
          role: this.getRole(normalizedPath),
          unit: this.getUnit(normalizedPath),
          read: true,
          write: isWritable
        },
        native: {}
      });
      await this.setState(stateId, { val: value, ack: true });
      if ((_b = PHASE_POWER_PATHS[deviceType]) == null ? void 0 : _b.includes(normalizedPath)) {
        if (this.channelReady.has(baseId)) {
          void this.updateActivePhase(deviceType, baseId, deviceKey);
        }
      }
    } catch (err) {
      this.log.debug(`Fehler bei Topic ${topic}: ${err.message}`);
    }
  }
  // ── Geräte-Metadaten sammeln und Channel anlegen ─────────────────────────
  //
  // Reihenfolge der MQTT-Nachrichten ist nicht garantiert:
  // ProductName kann vor oder nach Serial kommen, CustomName ebenso.
  // Wir sammeln alles in DeviceInfo und legen den Channel erst an
  // wenn wir Serial ODER bei Geräten ohne Serial (grid) ProductName haben.
  //
  updateDeviceMeta(type, instance, field, value) {
    const deviceKey = `${type}/${instance}`;
    if (!this.deviceMap.has(deviceKey)) {
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
        staleTimer: null
      });
    }
    const device = this.deviceMap.get(deviceKey);
    switch (field) {
      case "Serial": {
        device.serial = value;
        this.serialMap.set(deviceKey, value);
        const serialLogKey = `serial:${deviceKey}`;
        if (!this.loggedDevices.has(serialLogKey)) {
          this.loggedDevices.add(serialLogKey);
          this.log.info(`Ger\xE4t erkannt: ${KNOWN_DEVICE_TYPES[type] || type} \u2192 Serial: ${value}`);
        } else {
          this.log.debug(`Ger\xE4t bekannt: ${KNOWN_DEVICE_TYPES[type] || type} \u2192 Serial: ${value}`);
        }
        break;
      }
      case "ProductName": {
        device.productName = value;
        device.virtual = value.toLowerCase().includes("virtual");
        if (device.virtual) {
          const virtualLogKey = `virtual:${deviceKey}`;
          if (!this.loggedDevices.has(virtualLogKey)) {
            this.loggedDevices.add(virtualLogKey);
            this.log.info(`Virtuelles Ger\xE4t: ${type}/${instance} \u2192 "${value}"`);
          } else {
            this.log.debug(`Virtuelles Ger\xE4t (bekannt): ${type}/${instance} \u2192 "${value}"`);
          }
        }
        break;
      }
      case "CustomName":
        if (!device.customName) {
          device.customName = value;
        }
        break;
      case "Mgmt.Connection":
        if (value === "Node-RED") {
          device.source = "node-red";
          const nodeRedLogKey = `nodered:${deviceKey}`;
          if (!this.loggedDevices.has(nodeRedLogKey)) {
            this.loggedDevices.add(nodeRedLogKey);
            this.log.info(`Node-RED Ger\xE4t: ${type}/${instance}`);
          } else {
            this.log.debug(`Node-RED Ger\xE4t (bekannt): ${type}/${instance}`);
          }
        }
        break;
      case "Mgmt.ProcessName":
        if (value === "dbus-victron-virtual") {
          device.virtual = true;
        }
        break;
      case "SwitchableOutput.output_1.Settings.Group":
        device.group = value;
        break;
      case "SwitchableOutput.output_1.Settings.CustomName":
        device.customName = value;
        {
          const channelKey = device.serial || device.instance.toString();
          const channelId = `devices.${device.type}.${channelKey}`;
          const suffix = device.source === "node-red" ? " [Node-RED]" : device.virtual ? " [Virtual]" : "";
          void this.extendObjectAsync(channelId, {
            common: { name: `${value}${suffix}` }
          });
        }
        break;
    }
    void this.ensureDeviceChannel(device);
  }
  // ── Channel in ioBroker anlegen / aktualisieren ──────────────────────────
  async ensureDeviceChannel(device) {
    const hasSerial = !!device.serial;
    const hasProduct = !!device.productName;
    if (!hasSerial && !hasProduct) {
      return;
    }
    if (device.type === "switch" && !hasSerial) {
      return;
    }
    const channelKey = device.serial || device.instance.toString();
    const channelId = `devices.${device.type}.${channelKey}`;
    const displayName = device.customName || device.productName || KNOWN_DEVICE_TYPES[device.type] || device.type;
    const suffix = device.virtual ? device.source === "node-red" ? " [Node-RED]" : " [Virtual]" : "";
    await this.setObjectNotExistsAsync(channelId, {
      type: "channel",
      common: {
        name: `${displayName}${suffix}`
      },
      native: {
        type: device.type,
        instance: device.instance,
        serial: device.serial,
        virtual: device.virtual,
        source: device.source,
        group: device.group
      }
    });
    const infoDps = [
      { id: "info.serial", name: "Seriennummer", val: device.serial },
      { id: "info.productName", name: "Produktname", val: device.productName },
      { id: "info.customName", name: "Anzeigename", val: device.customName },
      { id: "info.virtual", name: "Virtuell", val: device.virtual },
      { id: "info.source", name: "Quelle", val: device.source }
    ];
    for (const dp of infoDps) {
      await this.setObjectNotExistsAsync(`${channelId}.${dp.id}`, {
        type: "state",
        common: {
          name: dp.name,
          type: typeof dp.val === "boolean" ? "boolean" : "string",
          role: dp.id === "info.serial" ? "info.serial" : "info.name",
          read: true,
          write: false
        },
        native: {}
      });
      if (dp.val !== "" && dp.val !== false) {
        await this.setState(`${channelId}.${dp.id}`, { val: dp.val, ack: true });
      }
    }
    await this.setObjectNotExistsAsync(`${channelId}.info.lastUpdate`, {
      type: "state",
      common: { name: "Letztes Update", type: "number", role: "value.time", read: true, write: false },
      native: {}
    });
    await this.setObjectNotExistsAsync(`${channelId}.info.stale`, {
      type: "state",
      common: { name: "Keine Daten", type: "boolean", role: "indicator.maintenance", read: true, write: false },
      native: {}
    });
    if (PHASE_POWER_PATHS[device.type]) {
      await this.setObjectNotExistsAsync(`${channelId}.info.activePhase`, {
        type: "state",
        common: {
          name: "Aktive Phase(n)",
          type: "string",
          role: "info",
          states: { L1: "L1", L2: "L2", L3: "L3", multi: "Mehrphasig", "": "Unbekannt" },
          read: true,
          write: false
        },
        native: {}
      });
    }
    if (device.type === "switch") {
      const stateId = `${channelId}.SwitchableOutput.output_1.State`;
      await this.setObjectNotExistsAsync(stateId, {
        type: "state",
        common: {
          name: device.customName || "Schalter",
          type: "number",
          role: "switch",
          states: { 0: "Aus", 1: "Ein" },
          read: true,
          write: true
          // ← schreibbar!
        },
        native: {}
      });
    }
    if (device.type === "switch" && device.group) {
      const groupId = `devices.switch._groups.${device.group.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      await this.setObjectNotExistsAsync(groupId, {
        type: "folder",
        common: { name: device.group },
        native: {}
      });
    }
    this.channelReady.add(channelId);
  }
  // ── Stale-Erkennung ──────────────────────────────────────────────────────
  touchDevice(device, baseId) {
    device.lastUpdate = Date.now();
    if (device.staleTimer) {
      clearTimeout(device.staleTimer);
    }
    const channelId = baseId;
    if (!this.channelReady.has(channelId)) {
      return;
    }
    void this.setState(`${baseId}.info.lastUpdate`, { val: device.lastUpdate, ack: true });
    void this.setState(`${baseId}.info.stale`, { val: false, ack: true });
    device.staleTimer = setTimeout(() => {
      this.log.warn(`Ger\xE4t ${device.type}/${device.instance} antwortet nicht mehr (stale)`);
      void this.setState(`${baseId}.info.stale`, { val: true, ack: true });
    }, STALE_TIMEOUT_MS);
  }
  // ── activePhase berechnen und schreiben ──────────────────────────────────
  async updateActivePhase(deviceType, baseId, _deviceKey) {
    const phases = ["L1", "L2", "L3"];
    const active = [];
    for (const phase of phases) {
      const stateId = `${baseId}.Ac.${phase}.Power`;
      try {
        const state = await this.getStateAsync(stateId);
        if (state && typeof state.val === "number" && state.val !== 0) {
          active.push(phase);
        }
      } catch {
      }
    }
    let activePhase = "";
    if (active.length === 1) {
      activePhase = active[0];
    } else if (active.length > 1) {
      activePhase = "multi";
    }
    await this.setState(`${baseId}.info.activePhase`, { val: activePhase, ack: true });
  }
  // ── MQTT Write: ioBroker → GX ────────────────────────────────────────────
  //
  // Steuerfluss: ioBroker State (ack=false) → MQTT W/-Topic → GX
  // GX bestätigt → MQTT N/-Topic kommt zurück → ack=true
  //
  onStateChange(id, state) {
    if (!state || state.ack) {
      return;
    }
    if (!this.mqttClient || !this.vrmId) {
      return;
    }
    const parts = id.split(".");
    if (parts[2] !== "devices" || parts.length < 6) {
      return;
    }
    const deviceType = parts[3];
    const serial = parts[4];
    const dpPath = parts.slice(5).join("/");
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
    const mqttTopic = `W/${this.vrmId}/${deviceType}/${instance}/${dpPath}`;
    const payload = JSON.stringify({ value: state.val });
    this.log.info(`Schreibe: ${mqttTopic} = ${payload}`);
    this.mqttClient.publish(mqttTopic, payload);
  }
  // ── Hilfsfunktionen ──────────────────────────────────────────────────────
  getFriendlyName(path) {
    const names = {
      Soc: "Ladezustand",
      "Dc.0.Voltage": "DC Spannung",
      "Dc.0.Current": "DC Strom",
      "Dc.0.Power": "DC Leistung",
      "Ac.Power": "AC Gesamtleistung",
      "Ac.L1.Power": "L1 Leistung",
      "Ac.L2.Power": "L2 Leistung",
      "Ac.L3.Power": "L3 Leistung",
      "Ac.L1.Voltage": "L1 Spannung",
      "Ac.L2.Voltage": "L2 Spannung",
      "Ac.L3.Voltage": "L3 Spannung",
      "Ac.L1.Current": "L1 Strom",
      "Ac.L2.Current": "L2 Strom",
      "Ac.L3.Current": "L3 Strom",
      "Ac.Energy.Forward": "Bezug gesamt",
      "Ac.Energy.Reverse": "Einspeisung gesamt",
      State: "Status",
      Mode: "Betriebsart",
      Temperature: "Temperatur",
      "Voltages.Sum": "Zellspannung gesamt",
      "Voltages.Diff": "Zellspannung Differenz",
      TimeToGo: "Restlaufzeit",
      "Yield.Power": "PV Leistung",
      "Yield.Today": "Ertrag heute",
      "Yield.Total": "Ertrag gesamt",
      "SwitchableOutput.output_1.State": "Schaltzustand",
      "SwitchableOutput.output_1.Status": "Schaltstatus",
      Connected: "Verbunden"
    };
    return names[path] || path;
  }
  getUnit(path) {
    for (const [key, unit] of Object.entries(UNITS)) {
      if (path === key || path.endsWith(`.${key}`)) {
        return unit;
      }
    }
    if (path.includes("Power")) {
      return "W";
    }
    if (path.includes("Voltage") || path.endsWith(".V")) {
      return "V";
    }
    if (path.includes("Current")) {
      return "A";
    }
    if (path.includes("Energy")) {
      return "kWh";
    }
    if (path.includes("Soc")) {
      return "%";
    }
    if (path.includes("Temperature")) {
      return "\xB0C";
    }
    if (path.startsWith("Voltages.Cell")) {
      return "V";
    }
    return "";
  }
  getRole(path) {
    if (path.includes("Power")) {
      return "value.power";
    }
    if (path.includes("Voltage") || path.endsWith(".V")) {
      return "value.voltage";
    }
    if (path.includes("Current")) {
      return "value.current";
    }
    if (path.includes("Energy")) {
      return "value.energy.consumed";
    }
    if (path.includes("Soc")) {
      return "value.battery";
    }
    if (path.includes("Temperature")) {
      return "value.temperature";
    }
    if (path === "SwitchableOutput.output_1.State") {
      return "switch";
    }
    if (path.includes("State") || path.includes("Mode")) {
      return "value";
    }
    return "value";
  }
  // ── Adapter-Stop ─────────────────────────────────────────────────────────
  onUnload(callback) {
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
