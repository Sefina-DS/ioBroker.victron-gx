# ioBroker Victron GX Adapter

<img src="admin/victron-gx.png" width="100" align="right">

Connects ioBroker **directly and locally** to Victron GX devices (Cerbo GX, Venus GX, Ekrano GX) – without any detour through Home Assistant or the VRM Cloud.

[![NPM version](https://img.shields.io/npm/v/iobroker.victron-gx.svg)](https://www.npmjs.com/package/iobroker.victron-gx)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## What does this adapter do?

Connects ioBroker directly and locally to Victron GX devices via the local MQTT protocol – without any detour through Home Assistant or the VRM Cloud. Supports reading all device data and full ESS control via Modbus TCP.

## Requirements

**On the GX device:**
- Enable MQTT: `Settings → Integrations → MQTT access → On`
- For Modbus control: `Settings → Integrations → Modbus TCP Server → Enabled`
- Access permissions: `Write access allowed`

## Installation

1. Install adapter via ioBroker Admin
2. Configure instance:
   - Enter **IP address** of GX device
   - MQTT port: `1883` (default)
   - Optional: **Enable control** (Modbus TCP)

## Supported Devices

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

## Datapoint Structure

```
victron-gx.0
├── info.connection          ← MQTT connected (boolean)
├── info.modbusConnected     ← Modbus connected (boolean)
├── info.modbusWritable      ← Write access OK (boolean)
├── overview.*               ← System overview
│   ├── Dc.Battery.Soc/Voltage/Current/Power
│   ├── Ac.Grid.L1/L2/L3.Power/Current
│   ├── Ac.Consumption.*
│   ├── Ac.PvOnGrid.*
│   └── SystemState.State / TimeToGo
├── ess.*                    ← ESS control (writable via Modbus Unit 100)
│   ├── BatteryLifeState     ← ESS mode (10=without BatteryLife, 4=with BatteryLife)
│   ├── Mode                 ← Phase mode (1=with compensation, 2=without, 3=External)
│   ├── MinimumSoc           ← Min SoC % (except grid failure)
│   ├── AcPowerSetPoint      ← Grid setpoint W
│   ├── AcFeedInEnabled      ← AC feed-in (0=allowed, 1=blocked)
│   ├── DcFeedInEnabled      ← DC feed-in (0=off, 1=on)
│   ├── MaxFeedInPower       ← Max feed-in W (0=blocked)
│   ├── MaxChargePercent     ← Max charge % (deprecated)
│   ├── MaxDischargePercent  ← Max discharge % (deprecated)
│   ├── BatteryLifeSocLimit  ← BL SoC limit % (read only)
│   └── FeedInLimitActive    ← Limit active (read only)
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
    │   ├── Hub4.L1.AcPowerSetpoint  ← writable (ESS live setpoint)
    │   ├── Hub4.DisableFeedIn       ← writable (0=allowed, 1=blocked)
    │   ├── Ac.In1.CurrentLimit      ← writable
    │   └── Mode                     ← writable
    ├── grid.<Serial>
    │   └── Ac.L1/L2/L3.Power/Voltage/Current/Energy
    ├── acload.<Serial>
    │   └── Ac.L1/L2/L3.Power/Voltage/Current
    ├── pvinverter.<Serial>
    │   ├── Ac.L1/L2/L3.Power/Voltage/Current
    │   └── StatusCode
    └── switch.<Group>.<Serial>
        ├── State  ← writable (true/false)
        └── Status ← hardware feedback
```

## Control

**Virtual Switches (Node-RED):**
Set State to true/false → MQTT Write → GX → Node-RED → Relay

**MultiPlus/Quattro (Modbus TCP):**
- Set Mode (1=Charger, 2=Inverter, 3=On, 4=APS)
- Set ESS live setpoint (Watts, negative=feed-in)
- Set input current limit (Amperes)
- Disable feed-in (Hub4.DisableFeedIn)

**ESS Settings (Modbus TCP):**
- BatteryLifeState: 10=without BatteryLife, 4=with BatteryLife
- Mode: 1=with phase compensation, 2=without, 3=External control
- MinimumSoc: minimum SoC in % (except grid failure)
- AcFeedInEnabled: 0=feed-in allowed, 1=blocked
- MaxFeedInPower: maximum feed-in in Watts (0=blocked)

---

## Changelog

### 0.5.2 (2026-05-29)
- Fix: Node.js >= 22, admin >= 7.6.20, dependabot config, auto-merge workflow migrated

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