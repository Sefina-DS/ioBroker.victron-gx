# ioBroker Victron GX Adapter

<img src="admin/victron-gx.png" width="100" align="right">

Verbindet ioBroker **direkt und lokal** mit Victron GX Geräten (Cerbo GX, Venus GX, Ekrano GX) – ohne Umweg über Home Assistant oder die VRM Cloud.

[![NPM version](https://img.shields.io/npm/v/iobroker.victron-gx.svg)](https://www.npmjs.com/package/iobroker.victron-gx)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## 🇩🇪 Deutsch

### Was macht dieser Adapter?

Der Adapter liest alle relevanten Messwerte deiner Victron Anlage über das lokale MQTT-Protokoll und stellt sie als ioBroker Datenpunkte bereit. Zusätzlich können virtuelle Schalter (Node-RED) über MQTT, der MultiPlus/Quattro über Modbus TCP und alle ESS-Einstellungen direkt gesteuert werden.

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
| ESS Einstellungen | ✅ | ✅ Modbus |
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
├── ess.*                    ← ESS Steuerung (schreibbar)
│   ├── BatteryLifeState     ← ESS Modus (10=ohne BatteryLife, 4=mit BatteryLife)
│   ├── Mode                 ← Phasenmodus (1=mit Phase, 2=ohne Phase, 3=Extern)
│   ├── MinimumSoc           ← Min SoC % (außer Netzausfall)
│   ├── AcPowerSetPoint      ← Sollwert Netz W
│   ├── AcFeedInEnabled      ← AC-Einspeisung (0=erlaubt, 1=gesperrt)
│   ├── DcFeedInEnabled      ← DC-Einspeisung (0=aus, 1=an)
│   ├── MaxFeedInPower       ← Max Einspeisung W (0=gesperrt)
│   ├── MaxChargePercent     ← Max Laden % (veraltet)
│   ├── MaxDischargePercent  ← Max Entladen % (veraltet)
│   ├── BatteryLifeSocLimit  ← BL SoC Limit % (nur lesen)
│   └── FeedInLimitActive    ← Begrenzung aktiv (nur lesen)
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
    │   ├── Hub4.L1.AcPowerSetpoint  ← schreibbar (ESS Live-Sollwert)
    │   ├── Hub4.DisableFeedIn       ← schreibbar (0=erlaubt, 1=gesperrt)
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

### Steuerung

**Virtuelle Schalter (Node-RED):**
```
State auf true/false setzen → MQTT Write → GX → Node-RED → Relais
```

**MultiPlus/Quattro (Modbus TCP):**
```
Mode setzen (1=Ladegerät, 2=Wechselrichter, 3=Ein, 4=APS)
ESS Live-Sollwert setzen (Watt, negativ=Einspeisung)
Eingangsstrombegrenzung setzen (Ampere)
Einspeisung deaktivieren (Hub4.DisableFeedIn)
```

**ESS Einstellungen (Modbus TCP):**
```
BatteryLifeState: 10=ohne BatteryLife, 4=mit BatteryLife
Mode: 1=mit Phasenkompensation, 2=ohne, 3=Externe Steuerung
MinimumSoc: Mindest-SoC in % (außer bei Netzausfall)
AcFeedInEnabled: 0=Einspeisung erlaubt, 1=gesperrt
MaxFeedInPower: Maximale Einspeisung in Watt (0=gesperrt)
```

---

## 🇬🇧 English

### What does this adapter do?

Connects ioBroker directly and locally to Victron GX devices via the local MQTT protocol – without any detour through Home Assistant or the VRM Cloud. Supports reading all device data and full ESS control via Modbus TCP.

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
| ESS Settings | ✅ | ✅ Modbus |
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
- Set ESS live setpoint (Watts, negative=feed-in)
- Set input current limit (Amperes)

**ESS Settings (Modbus TCP):**
- BatteryLifeState: 10=without BatteryLife, 4=with BatteryLife
- Mode: 1=with phase compensation, 2=without, 3=External control
- MinimumSoc: minimum SoC in % (except grid failure)
- AcFeedInEnabled: 0=feed-in allowed, 1=blocked
- MaxFeedInPower: maximum feed-in in Watts (0=blocked)

---

## Changelog

### 0.5.0 (2026-05-29)
- ESS control via Modbus Unit 100 (all settings)
- `ess.*` datapoints: BatteryLifeState, Mode, MinimumSoc, AcPowerSetPoint, AcFeedInEnabled, DcFeedInEnabled, MaxFeedInPower and more
- Hub4.DisableFeedIn (Reg 39) added to vebus
- MQTT feedback loop for ESS settings (ack=true on GX confirmation)
- Corrected register scales based on live testing

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
