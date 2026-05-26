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
  system: "System",
  platform: "GX Ger\xE4t",
  temperature: "Temperatursensor",
  tank: "Tanksensor"
};
const RELEVANT_PATHS = {
  battery: [
    "Soc",
    "Voltage",
    "Current",
    "Power",
    "Temperature",
    "ConsumedAmphours",
    "TimeToGo",
    "Alarms.LowVoltage",
    "Alarms.HighVoltage",
    "Alarms.LowSoc",
    "Serial",
    "ProductName",
    "Info.ChargeMode",
    "Info.ChargeRequest"
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
    "Dc.0.Voltage",
    "Dc.0.Current",
    "Dc.0.Power",
    "Serial",
    "ProductName"
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
    "History.Overall.DaysAvailable",
    "Serial",
    "ProductName"
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
    "Ac.Energy.Reverse"
  ],
  acload: [
    "Ac.L1.Power",
    "Ac.L2.Power",
    "Ac.L3.Power",
    "Ac.L1.Voltage",
    "Ac.L2.Voltage",
    "Ac.L3.Voltage",
    "Ac.Energy.Forward"
  ],
  pvinverter: [
    "Ac.Power",
    "Ac.L1.Power",
    "Ac.L2.Power",
    "Ac.L3.Power",
    "Ac.L1.Voltage",
    "Ac.Energy.Forward",
    "Serial",
    "ProductName"
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
  temperature: [
    "Temperature",
    "Humidity",
    "Pressure",
    "ProductName"
  ],
  tank: [
    "Level",
    "Remaining",
    "Status",
    "ProductName"
  ]
};
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
  Remaining: "m\xB3"
};
class VictronGx extends utils.Adapter {
  mqttClient = null;
  keepAliveInterval = null;
  vrmId = "";
  // Mapping: "type/instance" → DeviceInfo
  deviceMap = /* @__PURE__ */ new Map();
  // Mapping: "type/instance" → serial (für schnellen Lookup)
  serialMap = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    super({
      ...options,
      name: "victron-gx"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    this.setState("info.connection", false, true);
    const host = this.config.host;
    const port = this.config.port || 1883;
    const username = this.config.mqttUsername;
    const password = this.config.mqttPassword;
    if (!host) {
      this.log.error("Keine IP-Adresse konfiguriert! Bitte in den Adapter-Einstellungen eintragen.");
      return;
    }
    this.log.info(`Verbinde mit Victron GX unter ${host}:${port}...`);
    this.connectMqtt(host, port, username, password);
  }
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
      this.setState("info.connection", true, true);
      this.mqttClient.subscribe("N/#", (err) => {
        if (err) {
          this.log.error(`Subscribe Fehler: ${err.message}`);
        }
      });
    });
    this.mqttClient.on("message", (topic, payload) => {
      this.handleMessage(topic, payload);
    });
    this.mqttClient.on("error", (err) => {
      this.log.error(`MQTT Fehler: ${err.message}`);
      this.setState("info.connection", false, true);
    });
    this.mqttClient.on("offline", () => {
      this.log.warn("MQTT Verbindung getrennt");
      this.setState("info.connection", false, true);
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
  async handleMessage(topic, payload) {
    var _a, _b;
    try {
      const raw = payload.toString();
      if (!raw) return;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const parts = topic.split("/");
      if (parts[0] !== "N" || parts.length < 4) return;
      if (!this.vrmId && parts[1]) {
        this.vrmId = parts[1];
        this.log.info(`VRM ID gefunden: ${this.vrmId}`);
        this.startKeepAlive();
      }
      const deviceType = parts[2];
      const instanceStr = parts[3];
      const instance = parseInt(instanceStr, 10);
      const path = parts.slice(4).join("/");
      if (!path) return;
      if (path === "Serial" || path === "ProductName") {
        const value2 = (_a = parsed == null ? void 0 : parsed.value) != null ? _a : parsed;
        if (typeof value2 === "string" && value2) {
          await this.registerDevice(deviceType, instance, path, value2);
        }
        return;
      }
      if (!RELEVANT_PATHS[deviceType]) return;
      const relevantPaths = RELEVANT_PATHS[deviceType];
      const normalizedPath = path.replace(/\//g, ".");
      const isRelevant = relevantPaths.some((rp) => normalizedPath === rp.replace(/\//g, "."));
      if (!isRelevant) return;
      const deviceKey = `${deviceType}/${instance}`;
      const serial = this.serialMap.get(deviceKey);
      const baseId = serial ? `devices.${deviceType}.${serial}` : `devices.${deviceType}.${instanceStr}`;
      const stateId = `${baseId}.${normalizedPath}`;
      const value = (_b = parsed == null ? void 0 : parsed.value) != null ? _b : parsed;
      if (value === null || value === void 0) return;
      const unit = this.getUnit(normalizedPath);
      await this.setObjectNotExistsAsync(stateId, {
        type: "state",
        common: {
          name: normalizedPath,
          type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string",
          role: this.getRole(normalizedPath),
          unit,
          read: true,
          write: false
        },
        native: {}
      });
      await this.setState(stateId, { val: value, ack: true });
    } catch (err) {
      this.log.debug(`Fehler bei Topic ${topic}: ${err.message}`);
    }
  }
  async registerDevice(type, instance, field, value) {
    const deviceKey = `${type}/${instance}`;
    if (!this.deviceMap.has(deviceKey)) {
      this.deviceMap.set(deviceKey, {
        type,
        instance,
        serial: "",
        productName: ""
      });
    }
    const device = this.deviceMap.get(deviceKey);
    if (field === "Serial") {
      device.serial = value;
      this.serialMap.set(deviceKey, value);
      this.log.info(`Ger\xE4t erkannt: ${KNOWN_DEVICE_TYPES[type] || type} \u2192 Serial: ${value}`);
      const channelId = `devices.${type}.${value}`;
      await this.setObjectNotExistsAsync(channelId, {
        type: "channel",
        common: {
          name: `${KNOWN_DEVICE_TYPES[type] || type} (${value})`
        },
        native: {
          type,
          instance,
          serial: value
        }
      });
      await this.setObjectNotExistsAsync(`${channelId}.info.serial`, {
        type: "state",
        common: { name: "Seriennummer", type: "string", role: "info.serial", read: true, write: false },
        native: {}
      });
      await this.setState(`${channelId}.info.serial`, { val: value, ack: true });
    } else if (field === "ProductName") {
      device.productName = value;
      const serial = device.serial || instance.toString();
      const channelId = `devices.${type}.${serial}`;
      await this.setObjectNotExistsAsync(`${channelId}.info.productName`, {
        type: "state",
        common: { name: "Produktname", type: "string", role: "info.name", read: true, write: false },
        native: {}
      });
      await this.setState(`${channelId}.info.productName`, { val: value, ack: true });
    }
  }
  getUnit(path) {
    for (const [key, unit] of Object.entries(UNITS)) {
      if (path.endsWith(key.replace(/\./g, "."))) return unit;
    }
    if (path.includes("Power")) return "W";
    if (path.includes("Voltage") || path.endsWith(".V")) return "V";
    if (path.includes("Current")) return "A";
    if (path.includes("Energy")) return "kWh";
    if (path.includes("Soc")) return "%";
    if (path.includes("Temperature")) return "\xB0C";
    return "";
  }
  getRole(path) {
    if (path.includes("Power")) return "value.power";
    if (path.includes("Voltage") || path.endsWith(".V")) return "value.voltage";
    if (path.includes("Current")) return "value.current";
    if (path.includes("Energy")) return "value.energy.consumed";
    if (path.includes("Soc")) return "value.battery";
    if (path.includes("Temperature")) return "value.temperature";
    if (path.includes("State") || path.includes("Mode")) return "value";
    return "value";
  }
  onUnload(callback) {
    try {
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
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
  onStateChange(id, state) {
    if (state && state.ack === false) {
      this.log.info(`Steuerbefehl empfangen: ${id} = ${state.val}`);
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new VictronGx(options);
} else {
  (() => new VictronGx())();
}
//# sourceMappingURL=main.js.map
