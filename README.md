# ioBroker Victron GX Adapter

<img src="admin/victron-gx.png" width="100" align="right">

Verbindet ioBroker **direkt und lokal** mit Victron GX Geräten (Cerbo GX, Venus GX, Ekrano GX) – ohne Umweg über Home Assistant oder die VRM Cloud.

[![NPM version](https://img.shields.io/npm/v/iobroker.victron-gx.svg)](https://www.npmjs.com/package/iobroker.victron-gx)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## 🇩🇪 Deutsch

### Was macht dieser Adapter?

Der Adapter liest alle relevanten Messwerte deiner Victron Anlage über das lokale MQTT-Protokoll und stellt sie als ioBroker Datenpunkte bereit. Zusätzlich können virtuelle Schalter (Node-RED) über MQTT und der MultiPlus/Quattro über Modbus TCP gesteuert werden.

### Voraussetzungen

**Am GX-Gerät:**
- MQTT aktivieren: `Einstellungen → Integrationen → MQTT-Zugang → Ein`
- Für Steuerung via Modbus: `Einstellungen → Integrationen → Modbus TCP-Server → Aktiviert`
- Zugriffsberechtigungen: `Schreiben erlaubt`

### Installation

1. Adapter über ioBroker Admin installieren
2. Instanz konfigurieren:
   - **IP-Adresse** des GX-Geräts eintragen
   - MQTT-Port: `1883` (Standard)
   - Optional: **Steuerung aktivieren** (Modbus TCP)

### Unterstützte Geräte

| Gerät | Lesen | Steuern |
|---|---|---|
| Batterie / BMS (LiFePO4, AGM, ...) | ✅ | – |
| MultiPlus / Quattro (VE.Bus) | ✅ | ✅ Modbus |
| Netzanschluss (Grid Meter) | ✅ | – |
| AC Lasten (real + Node-RED virtuell) | ✅ | – |
| PV Wechselrichter (real + Node-RED) | ✅ | – |
| Virtuelle Schalter (Node-RED) | ✅ | ✅ MQTT |
| Solarladeregler (MPPT) | ✅ | – |
| Systemübersicht | ✅ | – |

### Datenpunkt-Struktur

```
victron-gx.0
├── info.connection          ← MQTT verbunden (boolean)
├── info.modbusConnected     ← Modbus verbunden (boolean)
├── info.modbusWritable      ← Schreibzugriff OK (boolean)
├── overview.*               ← Systemübersicht
│   ├── Dc.Battery.Soc/Voltage/Current/Power
│   ├── Ac.Grid.L1/L2/L3.Power/Current
│   ├── Ac.Consumption.*
│   ├── Ac.PvOnGrid.*
│   └── SystemState.State / TimeToGo
└── devices
    ├── battery.<Serial>
    │   ├── Soc, Voltage, Current, Power, TimeToGo
    │   ├── cells.cell01–cell32 / min / max / diff
    │   ├── temperatures.temp1–temp4 / main / min / max
    │   └── alarms.lowVoltage / highVoltage / lowSoc
    ├── vebus.<Serial>
    │   ├── Ac.ActiveIn.L1.P/I/V/S
    │   ├── Ac.Out.L1.P/I/V/F/S
    │   ├── Dc.0.Voltage/Current/Power
    │   ├── Hub4.L1.AcPowerSetpoint  ← schreibbar
    │   ├── Ac.In1.CurrentLimit      ← schreibbar
    │   └── Mode                     ← schreibbar
    ├── grid.<Serial>
    │   └── Ac.L1/L2/L3.Power/Voltage/Current/Energy
    ├── acload.<Serial>
    │   └── Ac.L1/L2/L3.Power/Voltage/Current
    ├── pvinverter.<Serial>
    │   ├── Ac.L1/L2/L3.Power/Voltage/Current
    │   └── StatusCode
    └── switch.<Gruppe>.<Serial>
        ├── State  ← schreibbar (true/false)
        └── Status ← Hardware-Rückmeldung
```

### Pro Gerät – info Datenpunkte

| Datenpunkt | Beschreibung |
|---|---|
| `info.serial` | Seriennummer |
| `info.productName` | Produktname vom GX |
| `info.customName` | Anzeigename |
| `info.instanceId` | MQTT Instanz-ID |
| `info.modbusId` | Modbus Unit ID |
| `info.virtual` | Virtuelles Gerät (Node-RED) |
| `info.source` | Quelle ("node-red" oder "") |
| `info.connected` | Verbunden |
| `info.lastUpdate` | Letztes Update |
| `info.stale` | Keine Daten seit > 5 Min |
| `info.position` | AC Ausgang / AC Eingang |
| `info.activePhase` | Aktive Phase(n) |

### Steuerung

**Virtuelle Schalter (Node-RED):**
```
State auf true/false setzen → MQTT Write → GX → Node-RED → Relais
```

**MultiPlus/Quattro (Modbus TCP):**
```
Mode setzen (1=Ladegerät, 2=Wechselrichter, 3=Ein, 4=APS)
ESS Sollwert setzen (Watt, negativ=Einspeisung)
Eingangsstrombegrenzung setzen (Ampere)
```

---

## 🇬🇧 English

### What does this adapter do?

Connects ioBroker directly and locally to Victron GX devices via the local MQTT protocol – without any detour through Home Assistant or the VRM Cloud. Additionally supports controlling virtual switches via MQTT and MultiPlus/Quattro via Modbus TCP.

### Requirements

**On the GX device:**
- Enable MQTT: `Settings → Integrations → MQTT access → On`
- For Modbus control: `Settings → Integrations → Modbus TCP Server → Enabled`
- Access permissions: `Write access allowed`

### Supported Devices

| Device | Read | Control |
|---|---|---|
| Battery / BMS (LiFePO4, AGM, ...) | ✅ | – |
| MultiPlus / Quattro (VE.Bus) | ✅ | ✅ Modbus |
| Grid Meter | ✅ | – |
| AC Loads (real + Node-RED virtual) | ✅ | – |
| PV Inverters (real + Node-RED) | ✅ | – |
| Virtual Switches (Node-RED) | ✅ | ✅ MQTT |
| Solar Chargers (MPPT) | ✅ | – |
| System Overview | ✅ | – |

### Configuration

1. Install adapter via ioBroker Admin
2. Configure instance:
   - Enter **IP address** of GX device
   - MQTT port: `1883` (default)
   - Optional: **Enable control** (Modbus TCP)

### Control

**Virtual Switches (Node-RED):**
Set State to true/false → MQTT Write → GX → Node-RED → Relay

**MultiPlus/Quattro (Modbus TCP):**
- Set Mode (1=Charger, 2=Inverter, 3=On, 4=APS)
- Set ESS setpoint (Watts, negative=feed-in)
- Set input current limit (Amperes)

---

## Changelog

### 0.4.0 (2026-05-29)
- Modbus TCP Discovery (automatic Unit ID detection)
- `info.modbusId` and `info.instanceId` per device
- `info.modbusConnected` and `info.modbusWritable`
- Fixed: numeric ghost channels cleaned up on startup
- Fixed: `ready` flag prevents premature channel creation
- Fixed: Mode register corrected (33 instead of 4)

### 0.3.1 (2026-05-29)
- Fixed duplicate device IDs

### 0.3.0 (2026-05-29)
- Virtual switch control via MQTT working

### 0.1.0 (2026-05-27)
- Complete read support for all device types

---

## License

MIT © 2026 Sefina-DS
