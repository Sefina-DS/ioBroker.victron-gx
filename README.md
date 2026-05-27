# ioBroker.victron-gx

<p align="center">
  <img src="admin/victron-gx.png" alt="Victron GX Adapter Logo" width="150"/>
</p>
<p align="center">
  <a href="https://github.com/Sefina-DS/ioBroker.victron-gx/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"/></a>
  <a href="https://www.npmjs.com/package/iobroker.victron-gx"><img src="https://img.shields.io/npm/v/iobroker.victron-gx.svg" alt="NPM Version"/></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js"/>
  <img src="https://img.shields.io/badge/ioBroker-Adapter-orange" alt="ioBroker"/>
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="Version"/>
</p>

---

## 🇩🇪 Deutsch

### Was ist dieser Adapter?

Der **ioBroker Victron GX Adapter** verbindet ioBroker **direkt und lokal** mit Victron GX Geräten (Cerbo GX, Venus GX, Ekrano GX) über das lokale MQTT Protokoll – **ohne Umweg über Home Assistant oder die VRM Cloud**.

### Unterstützte Geräte

| Gerät | Beschreibung |
|---|---|
| 🔋 **Batterie / BMS** | SOC, Spannung, Strom, Leistung, Temperaturen, Zellspannungen (Cell1–Cell32), Min/Max Zelle |
| ⚡ **Wechselrichter (VE.Bus)** | MultiPlus, Quattro – AC/DC Leistung, Modus, Status, ESS Sollwert |
| 🔌 **Netzanschluss (Grid)** | L1/L2/L3 Leistung, Spannung, Strom, Energie, Position |
| 🏠 **AC Last** | Verbrauch pro Phase, Energie pro Phase, virtuelle Lasten via Node-RED |
| ☀️ **PV Wechselrichter** | Leistung pro Phase, Energie, Frequenz, Status, virtuelle Geräte via Node-RED |
| 🔘 **Virtuelle Schalter** | Schalten via GX → Node-RED → Relais, gruppiert nach Verbraucher |
| 📊 **Übersicht (Overview)** | Systemweite Aggregatwerte: Batterie, Netz, Verbrauch, PV, DC System |

### Funktionen

- ✅ **Lokale Verbindung** – kein Internet, kein Cloud-Zwang
- ✅ **Automatische Geräteerkennung** via MQTT Discovery
- ✅ **Seriennummer als stabiler Schlüssel** – Datenpunkte bleiben auch nach Neustart stabil
- ✅ **Virtuelle Geräte** via Node-RED werden erkannt und korrekt behandelt
- ✅ **Phasenfilter** – nicht genutzte Phasen bei virtuellen Geräten werden ausgeblendet
- ✅ **Switch-Steuerung** – virtuelle Schalter schaltbar aus ioBroker
- ✅ **Batterie-Zellspannungen** – Cell1–Cell32, Min/Max/Diff automatisch
- ✅ **Stale-Erkennung** – Geräte die keine Daten mehr liefern werden markiert
- ✅ **Verbindungsindikator** – zeigt ob der GX erreichbar ist
- ✅ **Keepalive Handler** – hält die MQTT Verbindung automatisch aufrecht
- 🔜 **ESS Steuerung** – Hub4 Sollwert, MultiPlus Modus, Eingangsstrombegrenzung (in Arbeit)

### Datenpunkt-Struktur

```
victron-gx.0
├── info.connection                     ← Verbindungsstatus
├── overview.*                          ← Systemweite Aggregatwerte
│   ├── Dc.Battery.Soc/Voltage/...
│   ├── Ac.Grid.L1/L2/L3.Power/Current
│   ├── Ac.Consumption.*                ← Gesamtverbrauch
│   ├── Ac.ConsumptionOnOutput.*        ← Verbrauch hinter MultiPlus
│   ├── Ac.ConsumptionOnInput.*         ← Verbrauch vor MultiPlus
│   ├── Ac.PvOnGrid.*                   ← PV Einspeisung
│   └── SystemState.State / TimeToGo
└── devices
    ├── battery.<Serial>
    │   ├── Soc, Voltage, Current, Power, Capacity, TimeToGo
    │   ├── cells.cell01–cell16         ← Zellspannungen
    │   ├── cells.min / max / diff / minId / maxId
    │   ├── temperatures.temp1 / temp2 / main / min / max
    │   ├── alarms.lowVoltage / highVoltage / lowSoc
    │   └── info.*
    ├── vebus.<Instanz>                 ← kein Serial via MQTT
    │   ├── Ac.ActiveIn.L1.P/S/I/V     ← AC Eingang
    │   ├── Ac.Out.L1.P/S/I/V/F        ← AC Ausgang
    │   ├── Dc.0.Voltage/Current/Power
    │   ├── Hub4.L1.AcPowerSetpoint    ← ESS Sollwert (schreibbar)
    │   ├── Ac.In1.CurrentLimit        ← Eingangsstrombegrenzung (schreibbar)
    │   └── info.*
    ├── grid.<Serial>
    │   ├── Ac.Power / L1/L2/L3 Power/Voltage/Current
    │   ├── Ac.Energy.Forward / Reverse
    │   └── info.* (position, connected)
    ├── acload.<Serial>
    │   ├── Ac.Power / L1/L2/L3 Power/Voltage/Current
    │   ├── Ac.L1/L2/L3.Energy.Forward
    │   └── info.* (virtual, activePhase, position, connected)
    ├── pvinverter.<Serial>
    │   ├── Ac.Power / L1/L2/L3 Power/Voltage/Current
    │   ├── Ac.Frequency / MaxPower / PowerLimit
    │   ├── StatusCode (mit Klartextbeschreibung)
    │   └── info.* (virtual, activePhase, position, connected)
    └── switch.<Gruppe>.<Serial>        ← gruppiert nach Verbraucher
        ├── State                       ← boolean, schreibbar
        ├── Status                      ← boolean, Hardware-Rückmeldung
        └── info.* (connected, customName)
```

### Pro Gerät – info Datenpunkte

| Datenpunkt | Typ | Beschreibung |
|---|---|---|
| `info.deviceId` | string | Stabiler ioBroker Pfad-Schlüssel |
| `info.serial` | string | Seriennummer |
| `info.productName` | string | Produktname vom GX |
| `info.customName` | string | Anzeigename (aus GX Konfiguration) |
| `info.virtual` | boolean | Virtuelles Gerät (via Node-RED) |
| `info.source` | string | Quelle ("node-red" oder "") |
| `info.lastUpdate` | number | Timestamp letztes MQTT Update |
| `info.stale` | boolean | Keine Daten seit > 5 Minuten |
| `info.connected` | boolean | Gerät verbunden (Node-RED Flow aktiv) |
| `info.position` | number | Position: 0=AC Ausgang, 1=AC Eingang |
| `info.activePhase` | string | Aktive Phase(n): L1/L2/L3/multi |
| `info.nrOfPhases` | number | Anzahl aktiver Phasen |

### Virtuelle Geräte via Node-RED

Der Adapter erkennt automatisch Geräte die via Node-RED auf dem GX erstellt wurden:
- `ProductName` enthält "Virtual" → `info.virtual = true`
- `Mgmt.Connection = "Node-RED"` → `info.source = "node-red"`
- Phasenfilter: Voltage = 0 → Phase wird nicht angelegt (spart leere Datenpunkte)

### Schalten via ioBroker

Virtuelle Schalter können aus ioBroker gesteuert werden:

```
ioBroker State setzen (ack=false)
    → Adapter schreibt MQTT W/<VRMID>/switch/<n>/SwitchableOutput/output_1/State
    → GX empfängt und leitet weiter
    → Node-RED Flow schaltet das physische Relais
    → Rückmeldung via Status Datenpunkt (wenn in Node-RED konfiguriert)
```

### Konfiguration

| Feld | Beschreibung | Standard |
|---|---|---|
| `host` | IP-Adresse des Victron GX | – |
| `port` | MQTT Port | 1883 |
| `mqttUsername` | MQTT Benutzername (optional) | – |
| `mqttPassword` | MQTT Passwort (optional) | – |

### Installation

```bash
# Via ioBroker Admin UI: Adapter → Suche → "victron-gx" → Installieren
# Oder via npm:
npm install iobroker.victron-gx
```

---

## 🇬🇧 English

### What is this adapter?

The **ioBroker Victron GX Adapter** connects ioBroker **directly and locally** to Victron GX devices (Cerbo GX, Venus GX, Ekrano GX) via the local MQTT protocol – **without any detour through Home Assistant or the VRM Cloud**.

### Supported Devices

| Device | Description |
|---|---|
| 🔋 **Battery / BMS** | SOC, voltage, current, power, temperatures, cell voltages (Cell1–Cell32), min/max cell |
| ⚡ **Inverter (VE.Bus)** | MultiPlus, Quattro – AC/DC power, mode, status, ESS setpoint |
| 🔌 **Grid** | L1/L2/L3 power, voltage, current, energy, position |
| 🏠 **AC Load** | Consumption per phase, energy per phase, virtual loads via Node-RED |
| ☀️ **PV Inverter** | Power per phase, energy, frequency, status, virtual devices via Node-RED |
| 🔘 **Virtual Switches** | Control via GX → Node-RED → relay, grouped by consumer |
| 📊 **Overview** | System-wide aggregated values: battery, grid, consumption, PV, DC system |

### Features

- ✅ **Local connection** – no internet, no cloud required
- ✅ **Automatic device discovery** via MQTT
- ✅ **Serial number as stable key** – data points remain stable across restarts
- ✅ **Virtual devices** via Node-RED are detected and handled correctly
- ✅ **Phase filter** – unused phases on virtual devices are hidden
- ✅ **Switch control** – virtual switches controllable from ioBroker
- ✅ **Battery cell voltages** – Cell1–Cell32, min/max/diff automatically
- ✅ **Stale detection** – devices that stop sending data are flagged
- ✅ **Connection indicator** – shows whether the GX is reachable
- ✅ **Keepalive handler** – automatically maintains the MQTT connection
- 🔜 **ESS control** – Hub4 setpoint, MultiPlus mode, input current limit (in progress)

### Configuration

| Field | Description | Default |
|---|---|---|
| `host` | IP address of the Victron GX | – |
| `port` | MQTT port | 1883 |
| `mqttUsername` | MQTT username (optional) | – |
| `mqttPassword` | MQTT password (optional) | – |

---

## Changelog

### 0.1.0 (2026-05-27)
- ✅ Complete read implementation for all device types
- ✅ Battery: cell voltages (Cell1–Cell32), temperatures, alarms, min/max from BMS
- ✅ VE.Bus: full AC/DC data, ESS setpoint, current limit (writable)
- ✅ Grid/ACLoad/PVInverter: per-phase power, current, energy
- ✅ Virtual devices via Node-RED: detection, phase filter, position
- ✅ Virtual switches: boolean State/Status, grouping by Settings.Group
- ✅ Overview channel from system/0: battery, grid, consumption, PV, DC system
- ✅ info.deviceId, info.position, info.nrOfPhases, info.connected per device
- ✅ Stale detection (5 min timeout) per device

### 0.0.4 (2026-05-27)
- Battery System.* paths (temperatures, cell min/max from Victron)
- VE.Bus without Serial: instance number as fallback
- ESS setpoint Hub4.L1.AcPowerSetpoint added

### 0.0.3 (2026-05-27)
- Switch structure: devices.switch.`<Group>.<Serial>`
- Switch CustomName lazy update when Settings.CustomName arrives late
- Connected → info.connected as boolean

### 0.0.2 (2026-05-26)
- Virtual flag, Node-RED source detection
- Phase filter for virtual devices (Voltage=0 → skip)
- activePhase calculation
- Stale detection with timer
- Switch type with writable State

### 0.0.1 (2026-05-26)
- Initial release
- MQTT connection with keepalive
- Basic device discovery via Serial/ProductName
- Data points for battery, vebus, grid, acload, pvinverter, system

---

## License

MIT © 2026 Sefina-DS