# ioBroker Victron GX Adapter

<img src="../admin/victron-gx.png" width="100" align="right">

Verbindet ioBroker **direkt und lokal** mit Victron GX Geräten (Cerbo GX, Venus GX, Ekrano GX) – ohne Umweg über Home Assistant oder die VRM Cloud.

[![NPM version](https://img.shields.io/npm/v/iobroker.victron-gx.svg)](https://www.npmjs.com/package/iobroker.victron-gx)
[![Downloads](https://img.shields.io/npm/dm/iobroker.victron-gx.svg)](https://www.npmjs.com/package/iobroker.victron-gx)
[![Installations](https://iobroker.live/badges/victron-gx-installed.svg)](https://www.npmjs.com/package/iobroker.victron-gx)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/sefinads)

---

## Was macht dieser Adapter?

Verbindet ioBroker direkt und lokal mit Victron GX Geräten über das lokale MQTT-Protokoll. Unterstützt das Lesen aller Gerätedaten und die vollständige ESS/Wechselrichter-Steuerung via Modbus TCP.

- Alle Geräte-Datenpunkte werden **automatisch erkannt** und als ioBroker States angelegt
- Steuerung ausschließlich über den `control.*` Kanal via Modbus TCP
- Funktioniert mit ein- und dreiphasigen Systemen
- Automatische Modbus Unit ID Erkennung
- **Geringer RAM-Verbrauch**: ~130 MB stabil
- Virtuelle Geräte via Node-RED (`dbus-victron-virtual`) werden vollständig unterstützt

---

## Voraussetzungen

**Am GX-Gerät:**
- MQTT aktivieren: `Einstellungen → Integrationen → MQTT-Zugang → Ein`
- Für Modbus-Steuerung: `Einstellungen → Integrationen → Modbus TCP-Server → Aktiviert`
- Zugriffsberechtigungen: `Zugangslevel → Schreiben erlaubt`

**In ioBroker:**
- Node.js >= 22
- Admin >= 7.7.28

---

## Installation

### Über den ioBroker Admin (empfohlen)

Da dieser Adapter noch nicht im offiziellen ioBroker Repository enthalten ist, wird er über den npm-Tab im Admin installiert:

1. ioBroker Admin öffnen
2. **Adapter** aufrufen
3. Oben rechts auf das **GitHub/Katzen-Symbol** klicken
4. Den **npm** Tab auswählen
5. `iobroker.victron-gx` eingeben und auf **Installieren** klicken

### Über die Kommandozeile

```bash
iobroker add victron-gx --allow-root
```

### Nach der Installation

1. Instanz konfigurieren:
   - **IP-Adresse** des GX-Geräts eintragen
   - MQTT-Port: `1883` (Standard)
   - Optional: **Steuerung aktivieren** (aktiviert Modbus TCP und `control.*` Datenpunkte)

> **Hinweis:** Node.js >= 22 ist erforderlich. Falls ioBroker noch mit Node.js 20 läuft, bitte zuerst ein Update durchführen.

---

## Konfiguration

| Feld | Beschreibung |
|------|--------------|
| IP-Adresse des GX-Geräts | Lokale IP des Cerbo/Venus/Ekrano GX |
| MQTT-Port | Standard: 1883 |
| MQTT-Benutzername / Passwort | Nur wenn MQTT-Auth am GX konfiguriert ist |
| Steuerung aktivieren | Aktiviert Modbus TCP Steuerung |
| Modbus-Port | Standard: 502 |

---

## Unterstützte Geräte

Der Adapter erkennt automatisch alle am GX-Gerät angeschlossenen Geräte:

| Gerätetyp | Beschreibung |
|-----------|--------------|
| `battery` | Batteriesysteme (z.B. SerialBattery/LLT/JBD) |
| `vebus` | MultiPlus/Quattro Wechselrichter |
| `grid` | Netzanschluss-Zähler (z.B. Shelly 3EM, Carlo Gavazzi) |
| `pvinverter` | PV-Wechselrichter |
| `acload` | AC-Verbraucher |
| `switch` | Virtuelle Schalter (Node-RED) |
| `temperature` | Temperatursensoren |
| `meteo` | Wetterstationen |
| `tank` | Tankfüllstandssensoren |
| `system` | Systemübersicht |

---

## Objektstruktur

```
victron-gx.0
├── control.*          → Steuerung via Modbus TCP
├── devices.*          → Alle erkannten Geräte
│   ├── battery.*
│   ├── vebus.*
│   ├── grid.*
│   ├── pvinverter.*
│   ├── acload.*
│   ├── switch.*
│   ├── temperature.*
│   ├── meteo.*
│   ├── tank.*
│   └── system.*
├── overview.*         → Systemübersicht (aus system/0)
└── info.*             → Verbindungsstatus
```

---

## Steuerung

### Virtuelle Schalter (Node-RED)
`State` auf `true`/`false` setzen → MQTT Write → GX → Node-RED → Relais

### ESS Grid Sollwert (einfachste Methode)
`control.system.GridSetpoint` [W] schreiben:
- `0` → Zero Feed-In (Victron ESS-Algorithmus hält Netz bei 0W)
- `-3000` → 3000W ins Netz einspeisen (Batterie entlädt)
- `+500` → 500W aus dem Netz beziehen (Batterie lädt)

Kein Keepalive nötig – Wert wird persistent gespeichert.

### ESS Live-Sollwert (direkte Steuerung)
`control.inverter.AcPowerSetpoint` [W] schreiben:
- Erfordert `control.system.EssMode = 3` (Externe Steuerung)
- Der Adapter sendet den Wert alle 800ms erneut solange er ≠ 0 ist (Victron Watchdog)
- Auf `0` setzen um die Steuerung an den Victron ESS-Algorithmus zurückzugeben

### Laden / Einspeisung deaktivieren
- `control.inverter.DisableCharge = 1` → Batterie lädt nicht
- `control.inverter.DisableFeedIn = 1` → Wechselrichter speist nicht ein

### DVCC Limits (erfordert aktiviertes DVCC am GX)
- `control.system.DvccMaxChargeCurrent` [A]: Systemweite Ladestrom-Begrenzung (-1 = deaktiviert)
- `control.system.MaxDischargePower` [W]: Entladeleistungs-Begrenzung

---

## Virtuelle Geräte (Node-RED)

Der Adapter unterstützt vollständig virtuelle Geräte die via Node-RED mit dem Paket `dbus-victron-virtual` erstellt wurden:

- Virtuelle PV-Wechselrichter
- Virtuelle AC-Verbraucher
- Virtuelle Schalter (mit Gruppe und individuellem Namen)
- Virtuelle Temperatursensoren
- Virtuelle Wetterstationen
- Virtuelle Tankfüllstandssensoren

---

## Changelog

Den vollständigen Changelog gibt es in der englischen README:
→ [README.md Changelog](../README.md#changelog)

---

## Lizenz

MIT License

Copyright (c) 2026 Sefina-DS
