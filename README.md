# ioBroker Victron GX Adapter

<img src="admin/victron-gx.png" width="100" align="right">

Connects ioBroker **directly and locally** to Victron GX devices (Cerbo GX, Venus GX, Ekrano GX) – without any detour through Home Assistant or the VRM Cloud.

[![NPM version](https://img.shields.io/npm/v/iobroker.victron-gx.svg)](https://www.npmjs.com/package/iobroker.victron-gx)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## What does this adapter do?

Connects ioBroker directly and locally to Victron GX devices via the local MQTT protocol. Supports reading all device data and full ESS/inverter control via Modbus TCP.

- All device datapoints are **read-only** (except virtual switches via MQTT)
- Control happens exclusively through the `control.*` channel via Modbus TCP
- Works with single-phase and three-phase systems
- Automatic Modbus Unit ID discovery
- **Low RAM footprint**: ~100 MB stable after discovery phase

## Requirements

**On the GX device:**
- Enable MQTT: `Settings → Integrations → MQTT access → On`
- For Modbus control: `Settings → Integrations → Modbus TCP Server → Enabled`
- Write access: `Write access allowed`

## Installation

1. Install adapter via ioBroker Admin
2. Configure instance:
   - Enter **IP address** of GX device
   - MQTT port: `1883` (default)
   - Optional: **Enable control** (activates Modbus TCP and `control.*` datapoints)

## Device Discovery

The adapter uses a two-phase approach for minimal RAM usage:

**Discovery phase** (first 60 seconds after start):
- All connected Victron devices and their datapoints are discovered automatically
- States and channels are created dynamically

**Static mode** (after 60 seconds):
- Adapter switches to an optimized fast-path with minimal overhead
- Only `setState` is called when values actually change
- RAM usage stabilizes at ~100 MB regardless of message rate

**Rescan** (Admin → Devices tab):
- If you add new hardware, use the "Start device scan" button
- All existing device objects are deleted and rediscovered

## Supported Devices

| Device | Read | Control |
|---|---|---|
| Battery / BMS (LiFePO4, AGM, ...) | ✅ | – |
| MultiPlus / Quattro (VE.Bus) | ✅ | ✅ Modbus |
| ESS / GX System Settings | ✅ | ✅ Modbus |
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
├── info.modbusWritable      ← Write access confirmed (boolean)
├── info.scanStatus          ← Device scan status (text)
│
├── overview.*               ← Aggregated system values (read only)
│   ├── Dc.Battery.Soc / Voltage / Current / Power
│   ├── Ac.Grid.L1/L2/L3.Power/Current
│   ├── Ac.Grid.Power            ← calculated: L1+L2+L3
│   ├── Ac.Consumption.L1/L2/L3.Power
│   ├── Ac.Consumption.Power     ← calculated: L1+L2+L3
│   ├── Ac.PvOnGrid.L1/L2/L3.Power
│   ├── Ac.PvOnGrid.Power        ← calculated: L1+L2+L3
│   └── SystemState.State / TimeToGo
│
├── control.*                ← Writable control registers (only when control enabled)
│   ├── inverter.*           ← MultiPlus/Quattro (Modbus Unit 238)
│   │   ├── Mode             ← Reg 33: 1=Charger only, 2=Inverter only, 3=On, 4=Off (APS)
│   │   ├── AcIn1CurrentLimit← Reg 22: AC input current limit [A]
│   │   ├── AcPowerSetpoint  ← Reg 37: ESS live setpoint [W] (+=charge, -=feed-in)
│   │   │                       ⚠ Keepalive: value is re-sent every 800ms while ≠ 0
│   │   │                       ⚠ Requires ESS mode = External control (EssMode = 3)
│   │   ├── DisableCharge    ← Reg 38: 0=charging allowed, 1=charging blocked
│   │   └── DisableFeedIn    ← Reg 39: 0=feed-in allowed, 1=feed-in blocked
│   └── system.*             ← GX/ESS settings (Modbus Unit 100)
│       ├── GridSetpoint     ← Reg 2700: grid setpoint [W] (0=zero feed-in, -W=feed-in)
│       ├── EssMode          ← Reg 2902: 1=with compensation, 2=without, 3=External
│       ├── BatteryLifeState ← Reg 2900: ESS operating mode
│       ├── MinimumSoc       ← Reg 2901: minimum SoC % (except grid failure)
│       ├── BatteryLifeSocLimit ← Reg 2903: BL SoC limit % (read only)
│       ├── MaxFeedInPower   ← Reg 2706: max feed-in [W] (-1=no limit, 0=blocked)
│       ├── AcFeedInEnabled  ← Reg 2708: 0=allowed, 1=blocked
│       ├── DcFeedInEnabled  ← Reg 2707: DC overvoltage feed-in (0=off, 1=on)
│       ├── FeedInLimitActive← Reg 2709: limiting active (read only)
│       ├── DvccMaxChargeCurrent ← Reg 2705: DVCC max charge current [A] (-1=disabled)
│       └── MaxDischargePower    ← Reg 2704: max discharge power [W] (DVCC only)
│
└── devices.*                ← Device data (read only, values exactly as received from GX)
    ├── battery.<Serial>
    │   ├── Soc, Dc.0.Voltage/Current/Power, TimeToGo, Capacity
    │   ├── cells.cell01–cell32 / min / max / diff
    │   ├── temperatures.main / temp1–temp4 / min / max
    │   └── alarms.lowVoltage / highVoltage / lowSoc
    ├── vebus.<Serial>
    │   ├── Mode, State, VebusError, VebusChargeState, Soc
    │   ├── Ac.ActiveIn.L1.P/I/V/S, Ac.ActiveIn.P
    │   ├── Ac.Out.L1.P/I/V/F/S, Ac.Out.P
    │   ├── Hub4.L1.AcPowerSetpoint  ← live value (read only here, write via control.*)
    │   ├── Hub4.DisableFeedIn       ← live value (read only here)
    │   ├── Hub4.DisableCharge       ← live value (read only here)
    │   └── Dc.0.Voltage/Current/Power
    ├── grid.<Serial>
    │   └── Ac.L1/L2/L3.Power/Voltage/Current, Ac.Energy.Forward/Reverse
    ├── acload.<Serial>
    │   └── Ac.L1/L2/L3.Power/Voltage/Current, Ac.Energy.Forward
    ├── pvinverter.<Serial>
    │   ├── Ac.L1/L2/L3.Power/Voltage/Current
    │   └── StatusCode, ErrorCode, Ac.Frequency, Ac.MaxPower
    ├── solarcharger.<Serial>
    │   ├── Pv.V, Pv.P, Dc.0.Voltage/Current
    │   └── State, Yield.Power/Today/Total
    └── switch.<Group>.<Serial>
        ├── State  ← writable (true/false) via MQTT
        └── Status ← hardware feedback
```

## Control

### Virtual Switches (Node-RED)
Set `State` to `true`/`false` → MQTT Write → GX → Node-RED → Relay

### ESS Grid Setpoint (simplest approach)
Write `control.system.GridSetpoint` [W]:
- `0` → zero feed-in (Victron ESS algorithm keeps grid at 0W)
- `-3000` → feed 3000W into grid (battery discharges)
- `+500` → draw 500W from grid (battery charges)

The Victron ESS algorithm automatically calculates the correct inverter setpoint. No keepalive needed.

### ESS Live Setpoint (advanced / external control)
Write `control.inverter.AcPowerSetpoint` [W]:
- Requires `control.system.EssMode = 3` (External control)
- The adapter sends this value every 800ms as long as it is ≠ 0 (Victron watchdog)
- Set to `0` to return control to Victron ESS algorithm
- Use for dynamic control scripts (e.g. dynamic electricity tariffs)

### Disable Charge / Feed-In
- `control.inverter.DisableCharge = 1` → battery will not charge
- `control.inverter.DisableFeedIn = 1` → inverter will not feed into grid

### DVCC Limits (requires DVCC enabled on GX)
- `control.system.DvccMaxChargeCurrent` [A]: limit charge current system-wide (-1 = disabled)
- `control.system.MaxDischargePower` [W]: limit discharge power (DVCC only)

---

## Changelog

### 0.7.5 (2026-06-08)
- Fix: remove invalid supportedMessages from io-package.json

### 0.7.4 (2026-06-08)
- Add meteo device support, fix temperature device (Humidity/Pressure), fix CustomName for all devices

### 0.7.3 (2026-06-08)
- Performance: static fast-path after 60s discovery reduces RAM to ~100MB stable; device scan button in admin with full rescan; setState only on value change; all hot-path getStateAsync replaced with in-memory caches

### 0.7.2 (2026-06-08)
- Add full i18n support for all state names (ru, pt, nl, fr, it, es, pl, uk, zh-cn)

### 0.7.1 (2026-06-07)
- Fix object structure: add missing intermediate objects (folder/channel hierarchy)
- Fix state roles (level for writable controls, indicator for switch status, value for instanceId)
- Fix switch device channel type

### 0.7.0 (2026-06-07)
- Performance: state object cache reduces RAM usage from ~660MB to ~155MB (stable)
- Fix: use this.setTimeout() instead of plain setTimeout
- i18n support for all state names (en/de)

### 0.6.9 (2026-06-06)
- Fix: extendObjectAsync cache via createdStates Set (W5005 fixed)
- Fix: i18n for all state names (W5022 fixed)
- Fix: intermediate folder/channel objects via ensureIntermediates() (E3009 fixed)
- Fix: corrected state roles (E1008, E1009, E1011 fixed)

### 0.6.8 (2026-06-05)
- Fix: tank sensor support, virtual switch detection

### 0.6.7 (2026-06-05)
- Fix: lint formatting for this.setTimeout Promise wrappers

### 0.6.4 (2026-06-02)
- Fix: remove @types/mocha from devDependencies

### 0.6.3 (2026-06-02)
- Fix: add mocha types to tsconfig for TypeScript 6 compatibility

### 0.6.0 (2026-05-31)
- Breaking change: `ess.*` renamed to `control.system.*`, `control.inverter.*` added
- All device datapoints are now strictly read-only
- `control.*` channel added for all writable registers (Modbus only)
- `AcPowerSetpoint` keepalive: value re-sent every 800ms while ≠ 0

### 0.1.0 (2026-05-27)
- Complete read support for all device types

---

[Older changelogs can be found there](CHANGELOG_OLD.md)

## License

MIT License

Copyright (c) 2026 Sefina-DS