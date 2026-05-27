# ioBroker.victron-gx

<p align="center">
  <img src="admin/victron-gx.png" alt="Victron GX Adapter Logo" width="150"/>
</p>

<p align="center">
  <a href="https://github.com/Sefina-DS/ioBroker.victron-gx/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"/></a>
  <a href="https://www.npmjs.com/package/iobroker.victron-gx"><img src="https://img.shields.io/npm/v/iobroker.victron-gx.svg" alt="NPM Version"/></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js"/>
  <img src="https://img.shields.io/badge/ioBroker-Adapter-orange" alt="ioBroker"/>
</p>

---

## 🇩🇪 Deutsch

### Was ist dieser Adapter?

Der **ioBroker Victron GX Adapter** verbindet ioBroker **direkt und lokal** mit Victron GX Geräten (Cerbo GX, Venus GX, Ekrano GX) über das lokale MQTT Protokoll – **ohne Umweg über Home Assistant oder die VRM Cloud**.

### Unterstützte Geräte

| Gerät | Beschreibung |
|---|---|
| 🔋 **Batterie / BMS** | SOC, Spannung, Strom, Leistung, Temperatur, Zellspannungen |
| ⚡ **Wechselrichter (VE.Bus)** | MultiPlus, Quattro – AC/DC Leistung, Modus, Status |
| ☀️ **Solarladeregler (MPPT)** | PV Spannung, Leistung, Ertrag heute/gesamt |
| 🔌 **Netzanschluss (Grid)** | L1/L2/L3 Leistung, Spannung, Energie |
| 🏠 **AC Last** | Verbrauch pro Phase |
| 📊 **System** | SOC, PV Gesamtleistung, Batteriestatus |

### Funktionen

- ✅ **Lokale Verbindung** – kein Internet, kein Cloud-Zwang
- ✅ **Automatische Geräteerkennung** via MQTT Discovery
- ✅ **Seriennummer als stabiler Schlüssel** – Datenpunkte bleiben auch nach Geräteänderungen stabil
- ✅ **Automatische Datenpunkt-Generierung** – keine manuelle Konfiguration nötig
- ✅ **Verbindungsindikator** – zeigt in der Admin UI ob der GX erreichbar ist
- ✅ **Keepalive Handler** – hält die MQTT Verbindung automatisch aufrecht
- 🔜 **Steuerung via Modbus** – ESS Modus, Ladestrom, Einspeisebegrenzung (geplant)

### Datenpunkt-Struktur

```
victron-gx.0
├── info
│   └── connection              ← Verbindungsstatus (grün/gelb)
└── devices
    ├── battery
    │   └── 57_280_0Ah          ← Seriennummer als stabiler Key
    │       ├── info.serial
    │       ├── info.productName
    │       ├── Soc             ← Ladestand in %
    │       ├── Voltage         ← Spannung in V
    │       ├── Current         ← Strom in A
    │       ├── Power           ← Leistung in W
    │       └── Temperature     ← Temperatur in °C
    ├── vebus
    │   └── <Seriennummer>      ← MultiPlus / Quattro
    │       ├── State
    │       ├── Ac.Out.L1.P
    │       └── ...
    ├── solarcharger
    │   └── <Seriennummer>      ← MPPT Laderegler
    │       ├── Pv.V
    │       ├── Pv.P
    │       └── Yield.Today
    ├── grid
    │   └── <Seriennummer>
    │       ├── Ac.L1.Power
    │       └── ...
    └── system
        └── 0
            ├── Soc
            ├── Dc.Pv.Power
            └── ...
```

### Installation

> ⚠️ Der Adapter ist aktuell in Entwicklung und noch nicht im offiziellen ioBroker Repository.

**Manuelle Installation:**
```bash
iobroker url https://github.com/Sefina-DS/ioBroker.victron-gx --allow-root
iobroker add victron-gx --allow-root
```

### Konfiguration

| Einstellung | Beschreibung | Standard |
|---|---|---|
| **IP-Adresse** | IP des Victron GX Geräts im lokalen Netzwerk | *(leer)* |
| **MQTT Port** | Port des lokalen MQTT Brokers auf dem GX | `1883` |
| **MQTT Benutzername** | Optional, falls am GX konfiguriert | *(leer)* |
| **MQTT Passwort** | Optional, falls am GX konfiguriert | *(leer)* |
| **Polling Intervall** | Modbus Polling Intervall in ms (für Steuerung) | `5000` |

### Voraussetzungen

- ioBroker mit Node.js ≥ 20
- Victron GX Gerät (Cerbo GX, Venus GX, Ekrano GX) im lokalen Netzwerk
- MQTT auf dem GX Gerät aktiviert (Einstellungen → Services → MQTT on LAN)

### MQTT auf dem GX aktivieren

1. GX Display oder VRM Portal öffnen
2. **Einstellungen → Services → MQTT on LAN (Plaintext)** → Aktivieren
3. IP-Adresse des GX notieren und in den Adapter-Einstellungen eintragen

---

## 🇬🇧 English

### What is this adapter?

The **ioBroker Victron GX Adapter** connects ioBroker **directly and locally** to Victron GX devices (Cerbo GX, Venus GX, Ekrano GX) via the local MQTT protocol – **without detour through Home Assistant or the VRM Cloud**.

### Supported Devices

| Device | Description |
|---|---|
| 🔋 **Battery / BMS** | SOC, voltage, current, power, temperature, cell voltages |
| ⚡ **Inverter (VE.Bus)** | MultiPlus, Quattro – AC/DC power, mode, state |
| ☀️ **Solar Charger (MPPT)** | PV voltage, power, yield today/total |
| 🔌 **Grid** | L1/L2/L3 power, voltage, energy |
| 🏠 **AC Load** | Consumption per phase |
| 📊 **System** | SOC, total PV power, battery status |

### Features

- ✅ **Local connection** – no internet, no cloud required
- ✅ **Automatic device discovery** via MQTT
- ✅ **Serial number as stable key** – data points remain stable even after device changes
- ✅ **Automatic data point generation** – no manual configuration needed
- ✅ **Connection indicator** – shows GX reachability in Admin UI
- ✅ **Keepalive handler** – maintains MQTT connection automatically
- 🔜 **Modbus control** – ESS mode, charge current, feed-in limit (planned)

### Requirements

- ioBroker with Node.js ≥ 20
- Victron GX device (Cerbo GX, Venus GX, Ekrano GX) on local network
- MQTT enabled on GX (Settings → Services → MQTT on LAN)

---

## Changelog

### 0.0.1 (2026-05-27)
- Initial release
- Local MQTT connection to Victron GX devices
- Automatic device discovery
- Serial number based data point structure
- Support for battery, inverter, solar charger, grid, AC load, system

---

## License

MIT License – Copyright (c) 2026 Sefina-DS

---

<p align="center">
  <i>Not affiliated with Victron Energy. Victron Energy is a trademark of Victron Energy B.V.</i>
</p>
