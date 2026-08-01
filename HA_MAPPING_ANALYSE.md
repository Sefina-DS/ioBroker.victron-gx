# HA-Mapping-Analyse: victron-gx-Adapter vs. `victron_mqtt.json` (HA-Integration)

**Zweck:** Reine Vergleichsdaten zwischen unserem Adapter (Stand main / v0.9.4) und der
maschinenlesbaren Topic-Liste der Home-Assistant-Integration
[`tomer-w/victron_mqtt`](https://github.com/tomer-w/victron_mqtt) (`victron_mqtt.json`, Version aus
dem Repo-Root, 484 Topics). Kandidatenliste für spätere Adapter-Versionen — **keine Priorisierung,
keine Empfehlung**, kein Einfluss auf den 0.10.0-Scope von `CONTROL_MERGE_PLAN.md`.

**Quelle HA:** `https://raw.githubusercontent.com/tomer-w/victron_mqtt/refs/heads/main/victron_mqtt.json`
**Quelle bei uns:** `src/main.ts` — `RELEVANT_PATHS`, `CONTROL_REGISTERS`, `MQTT_CONTROL_FIELDS`, `STATES_MAP`

**Legende:**
- HA `message_type`: `SENSOR`/`BINARY_SENSOR` = read-only, `NUMBER`/`SWITCH`/`SELECT`/`BUTTON`/`TIME` = schreibbar (HA erzeugt daraus ein UI-Control)
- „Bei uns" = Pfad nach unserer Namenskonvention (Punkt-Notation, wie in `RELEVANT_PATHS`)
- „—" = bei uns nicht implementiert

---

## evcharger (HA: 16 Topics, bei uns: 20 Felder)

| HA-Topic | HA writable | Einheit | Bei uns | Bei uns writable |
|---|---|---|---|---|
| `Ac/Energy/Forward` | nein | kWh | `Ac.Energy.Forward` | nein |
| `Ac/Power` | nein | W | `Ac.Power` | nein |
| `Ac/{phase}/Power` | nein | W | `Ac.L1/L2/L3.Power` | nein |
| `AutoStart` | **ja (SWITCH)** | – | — | — |
| `Connected` | nein | – | `Connected` (Registration) | nein |
| `Current` | nein | A | `Current` | nein |
| `MaxCurrent` | nein | A | `MaxCurrent` | nein |
| `MinCurrent` | nein | A | — | — |
| `Mode` | **ja (SELECT)** | – | `Mode` | **ja** (Scope 0.10.0) |
| `Position` | nein | – | — | — |
| `Session/Cost` | nein | – | — | — |
| `Session/Energy` | nein | kWh | — | — |
| `Session/Time` | nein | min | — | — |
| `SetCurrent` | **ja (NUMBER)** | A | `SetCurrent` | **ja** (Scope 0.10.0) |
| `StartStop` | **ja (SWITCH)** | – | `StartStop` | **ja** (Scope 0.10.0) |
| `Status` | nein | – | `Status` | nein |
| – | – | – | `ChargingTime`, `FirmwareVersion`, `HardwareVersion`, `MCU/Temperature`, `ProductId`, `UpdateIndex` | nein (bei HA nicht gelistet) |

**Delta:** HA kennt zusätzlich `AutoStart` (writable), `MinCurrent`, `Position`, `Session/*` (3 Felder) — bei uns nicht implementiert. Umgekehrt haben wir `ChargingTime`, `FirmwareVersion`, `HardwareVersion`, `MCU/Temperature`, `UpdateIndex`, die HA nicht listet.

---

## system (HA: 45 Topics unter `system/*` + 48 unter separatem `settings/*`, bei uns: `system`-RELEVANT_PATHS + `CONTROL_REGISTERS['system.*']`)

**Wichtige Architektur-Differenz:** HA trennt scharf zwischen `system/0/*` (reine Messwerte/Status,
alles `SENSOR`, routet bei uns nach `overview.*`) und `settings/0/Settings/*` (ESS-Konfiguration,
überwiegend schreibbar). Unsere `CONTROL_REGISTERS['system.*']` (Modbus, künftig
`devices.system.<serial>.*`) bilden semantisch HA's `settings/CGwacs/*`-Feldgruppe ab — **nicht**
HA's `system/*`-Feldgruppe. Tabelle daher in zwei Teilen.

### Teil 1 — `system/0/*` (Messwerte, bei uns → `overview.*`)

| HA-Topic | HA writable | Bei uns (routet nach `overview.*`) | Bei uns writable |
|---|---|---|---|
| `Ac/ActiveIn/Source` | nein | `Ac.ActiveIn.Source` | nein |
| `Ac/Consumption/*`, `Ac/ConsumptionOn{Input,Output}/*` | nein | `Ac.Consumption(OnInput/OnOutput).*` | nein |
| `Ac/Grid/*`, `Ac/PvOnGrid/*` | nein | `Ac.Grid.*`, `Ac.PvOnGrid.*` | nein |
| `Ac/PvOnOutput/*` | nein | — | — |
| `Ac/Genset/{phase}/Power` | nein | — | — |
| `Control/ActiveSocLimit`, `Control/ScheduledSoc` | nein | — | — |
| `Dc/Alternator/Power` | nein | — | — |
| `Dc/Battery/*` (Current/Power/Soc/State/Voltage) | nein | `Dc.Battery.*` | nein |
| `Dc/Pv/Current`, `Dc/Pv/Power` | nein | — | — |
| `Dc/System/Power` | nein | `Dc.System.Power` | nein |
| `DynamicEss/*` (10 Felder) | nein (2× BINARY_SENSOR) | — | — |
| `PV/Current` | nein | — | — |
| `Relay/{relay}/State` | **ja (SWITCH)** | — (bei uns nur `outputs.*` generisch, kein separates `Relay/*`) | — |
| `SwitchableOutput/{output}/State` | **ja (SWITCH)** | `outputs.<n>.State` | **ja** (aktuell ungegatet, ab 0.10.0 gegated) |
| `SystemState/State` | nein | `SystemState.State` | nein |

**Delta:** HA modelliert ein komplettes `DynamicEss/*`-Feature (Scheduling/Zielwerte, 10 Topics) das bei uns komplett fehlt. `Ac/PvOnOutput/*`, `Ac/Genset/*`, `Control/*`, `Dc/Alternator`, `Dc/Pv/*` fehlen ebenfalls. `Relay/{relay}/State` scheint bei HA redundant zu `SwitchableOutput/{output}/State` zu sein (zwei Schreibpfade fürs gleiche physische Relais) — bei uns gibt es nur den einen (`outputs.*`).

### Teil 2 — `settings/0/Settings/CGwacs/*` (ESS-Konfiguration) vs. `CONTROL_REGISTERS['system.*']`

| HA-Topic (`Settings/CGwacs/…`) | HA writable | Einheit | Bei uns (`control.system.*` → `devices.system.*`) | Bei uns writable |
|---|---|---|---|---|
| `AcPowerSetPoint` | ja (NUMBER) | W | `GridSetpoint` (Reg 2700) | ja (Scope 0.10.0) |
| `Hub4Mode` | ja (SELECT) | – | `EssMode` (Reg 2902) | ja (Scope 0.10.0) |
| `BatteryLife/MinimumSocLimit` | ja (NUMBER) | % | `MinimumSoc` (Reg 2901) | ja (Scope 0.10.0) |
| `BatteryLife/State` | ja (SELECT) | – | `BatteryLifeState` (Reg 2900) | ja (Scope 0.10.0) |
| `PreventFeedback` | ja (SWITCH) | – | `AcFeedInEnabled` (Reg 2708) | ja (Scope 0.10.0) |
| `OvervoltageFeedIn` | ja (SWITCH) | – | `DcFeedInEnabled` (Reg 2707) | ja (Scope 0.10.0) |
| `MaxFeedInPower` | ja (NUMBER) | W | `MaxFeedInPower` (Reg 2706) | ja (Scope 0.10.0) |
| – (kein direktes HA-Pendant) | – | – | `BatteryLifeSocLimit` (Reg 2903) | nein — bewusst aus 0.10.0-Scope gestrichen (David-Entscheidung nach S1-Checkpoint: ohne Live-Hardware-Verifikation zu riskant), bleibt read-only. HA hat hierfür kein MQTT-Settings-Pendant, kann also auch extern nicht validiert werden. |
| – (kein direktes HA-Pendant) | – | – | `FeedInLimitActive` (Reg 2709) | nein — gleiche Entscheidung wie oben, ebenfalls kein HA-Pendant zur Validierung |
| – (kein MQTT-Pendant, nur Modbus laut Code-Kommentar) | – | – | `DvccMaxChargeCurrent` (Reg 2705) | ja (Scope 0.10.0) |
| – (kein MQTT-Pendant, nur Modbus laut Code-Kommentar) | – | – | `MaxDischargePower` (Reg 2704) | ja (Scope 0.10.0) |
| `AcExportLimit`, `AcInputLimit` | ja (NUMBER) | A | — | — |
| `AlwaysPeakShave` | ja (SWITCH) | – | — | — |
| `BatteryLife/Schedule/Charge/{slot}/*` (Day/Duration/Soc/Start, 4 Felder × Slots) | ja (SELECT/NUMBER/TIME) | – | — | — |
| `BatteryUse` | ja (SWITCH) | – | — | — |
| `MaxChargePower` | ja (NUMBER) | W | — | — |

**Delta:** Siehe zwei ⚠️-Zeilen oben — Code-Diskrepanz zwischen Plan-Scope und Ist-Zustand, an David
gemeldet (siehe Checkpoint-Bericht Teil A). Zusätzlich fehlen uns komplett: `AcExportLimit`,
`AcInputLimit`, `AlwaysPeakShave`, `BatteryLife/Schedule/*` (Lade-Zeitpläne — potenziell großes
Feature), `BatteryUse`, `MaxChargePower`.

### Teil 3 — weitere `settings/*`-Bereiche ohne jede Entsprechung bei uns

`Settings/DynamicEss/Mode`, `Settings/Generator{0,1}/*` (18 Felder — komplette Generator-Steuerung),
`Settings/Network/VrmPortal`, `Settings/Relay/{relay}/CustomName`, `Settings/Services/Bol`,
`Settings/SystemSetup/*` (3 Felder), `Settings/TransferSwitch/GeneratorCurrentLimit`. Kompletter
Themenblock (Generator, Network, TransferSwitch) bei uns nicht abgedeckt.

---

## vebus (HA: 57 Topics, bei uns: 24 Felder)

| HA-Topic | HA writable | Einheit | Bei uns | Bei uns writable |
|---|---|---|---|---|
| `Mode` | ja (SELECT) | – | `Mode` | ja (Scope 0.10.0, Reg 33) |
| `Ac/ActiveIn/CurrentLimit` | ja (NUMBER) | A | `Ac.In1.CurrentLimit` | ja (Scope 0.10.0 als `AcIn1CurrentLimit`, Reg 22) |
| `Hub4/{phase}/AcPowerSetpoint` | ja (NUMBER) | W | `Hub4.L1.AcPowerSetpoint` | ja (Scope 0.10.0 als `AcPowerSetpoint`, Reg 37) |
| `Hub4/DisableCharge` | ja (SWITCH) | – | `Hub4.DisableCharge` | ja (Scope 0.10.0, Reg 38) |
| `Hub4/DoNotFeedInOvervoltage` | ja (SWITCH) | – | `Hub4.DisableFeedIn` | ja (Scope 0.10.0 als `DisableFeedIn`, Reg 39) — **Namensabweichung: HA "DoNotFeedInOvervoltage" vs. unser "DisableFeedIn", semantisch vermutlich deckungsgleich, nicht verifiziert** |
| `Ac/Control/IgnoreAcIn1` | ja (SWITCH) | – | — | — |
| `Dc/0/PreferRenewableEnergy` | ja (SELECT) | – | — | — |
| `Devices/{n}/Settings/PowerAssistEnabled` | ja (SWITCH) | – | — | — |
| `Hub4/FixSolarOffsetTo100mV` | ja (SWITCH) | – | — | — |
| `Hub4/TargetPowerIsMaxFeedIn` | ja (SWITCH) | – | — | — |
| `PvInverter/Disable` | ja (SWITCH) | – | — | — |
| `Settings/Alarm/System/GridLost` | ja (SWITCH) | – | — | — |
| `Settings/AssistCurrentBoostFactor` | ja (NUMBER) | – | — | — |
| `Soc`, `State`, `VebusError`(fehlt bei HA), `VebusChargeState`(fehlt bei HA) | nein | – | `Soc`, `State`, `VebusError`, `VebusChargeState` | nein |
| `Ac/ActiveIn/{phase}/{F,I,P,S,V}`, `Ac/Out/{phase}/{F,I,P,S,V}` | nein | – | `Ac.ActiveIn.*`, `Ac.Out.*` | nein |
| `Dc/0/{Current,Power,Temperature,Voltage}` | nein | – | `Dc.0.*` | nein |
| `Alarms/*` (9 Felder) | nein | – | — | — |
| `Devices/{n}/Ac/*` (5 Felder) | nein | – | — | — |
| `Energy/*` (9 kWh-Zähler) | nein | – | — | — |
| `Ac/ActiveIn/ActiveInput`, `Ac/State/*` (2), `BatterySense.Voltage`(nur bei uns), `Connected` | teils | – | teils vorhanden | nein |

**Delta — HA writable, bei uns nicht:** `Ac/Control/IgnoreAcIn1`, `Dc/0/PreferRenewableEnergy`,
`Devices/{n}/Settings/PowerAssistEnabled`, `Hub4/FixSolarOffsetTo100mV`,
`Hub4/TargetPowerIsMaxFeedIn`, `PvInverter/Disable`, `Settings/Alarm/System/GridLost`,
`Settings/AssistCurrentBoostFactor` — 7 zusätzliche Schreibpunkte, potenzielle Kandidaten für
spätere Versionen.
**Delta — bei uns vorhanden, HA nicht:** `BatterySense.Voltage`, `VebusError`, `VebusChargeState`,
`Devices.0.SerialNumber`.
**Delta — bei keinem vorhanden bzw. groß fehlend bei uns:** `Alarms/*` (9 Einzelalarme), `Energy/*`
(9 Zähler), `Devices/{n}/Ac/*` (Multi-Device-Aufschlüsselung bei RS/Quattro-Verbünden).

---

## battery (HA: 62 Topics, bei uns: 45 Felder)

| Bereich | HA writable | Bei uns |
|---|---|---|
| `Mode` (SELECT) | **ja** | — (nicht implementiert) |
| Alle übrigen 61 Topics | nein | teils vorhanden (Soc, Dc.0.*, Voltages.Cell1-32, System.Min/MaxCell*, Alarms.LowVoltage/HighVoltage/LowSoc, ConsumedAmphours, TimeToGo, Capacity, CurrentAvg) |
| `Alarms/*` (17 Felder bei HA) | nein | nur 3 (`LowVoltage`, `HighVoltage`, `LowSoc`) — 14 fehlen |
| `History/*` (11 Felder) | nein | — komplett fehlend |
| `Info/*` (4 Felder), `Soh`, `Io/AllowTo{Charge,Discharge}`, `System/NrOfModules*` (4), `InstalledCapacity`, `Dc/0/MidVoltage(Deviation)`, `Dc/1/Voltage` | nein | — komplett fehlend |

**Delta:** `Mode` ist einziger schreibbarer Battery-Topic bei HA und fehlt uns komplett. Größere
Read-Lücken: `History/*`, `Info/*`, erweiterte `Alarms/*`, Multi-Modul-Status (`System/NrOfModules*`).

---

## grid (HA: 16 Topics, bei uns: 12 Felder)

Beide Seiten 0 schreibbare Topics. Bei uns fehlend: `Ac/N/Current`, `Ac/PENVoltage`,
`Ac/PowerFactor` (gesamt + pro Phase), `Ac/{phase}/VoltageLineToLine`, `Ac/{phase}/Energy/{Forward,Reverse}`
(wir haben nur den Gesamtwert, nicht pro Phase).

---

## pvinverter (HA: 6 Topics, bei uns: 16 Felder)

Beide Seiten 0 schreibbare Topics. Wir haben deutlich mehr Felder als HA modelliert
(`StatusCode`, `ErrorCode`, `Ac.Frequency`, `Ac.MaxPower`, `Ac.PowerLimit`, `Position`,
`Mgmt.*`, `NrOfPhases`, pro-Phase-Energy) — HA's Liste wirkt hier unvollständig gegenüber unserer.

---

## solarcharger (HA: 32 Topics, bei uns: 10 Felder)

| HA-Topic | HA writable | Einheit | Bei uns |
|---|---|---|---|
| `Mode` | **ja (SWITCH)** | – | — |
| `Relay/0/State` | **ja (SWITCH)** | – | — |
| `Settings/ChargeCurrentLimit` | **ja (NUMBER)** | A | — |
| `Pv/{tracker}/*` (Multi-Tracker: MppOperationMode/Name/P/V) | nein | – | nur `Pv.V`/`Pv.P` (kein Multi-Tracker) |
| `History/Daily/*` (10 Felder) | nein | – | — |
| `Load/I`, `Load/State`, `DeviceOffReason`, `ErrorCode`, `MppOperationMode` | nein | – | — |
| `Dc/0/{Current,Temperature,Voltage}`, `State`, `Yield/{Power,System,User}` | nein | – | `Dc.0.*`, `State`, `Yield.{Power,Today,Total}` (Namensabweichung `System/User` vs. `Today/Total`, nicht verifiziert ob deckungsgleich) |

**Delta:** 3 komplett fehlende Schreibpunkte (`Mode`, `Relay/0/State`, `Settings/ChargeCurrentLimit`)
— wir haben aktuell **keinerlei** Control-Datenpunkte für Solarcharger. Größte Read-Lücke:
Multi-Tracker-Support (`Pv/{tracker}/*`) und `History/Daily/*`.

---

## temperature (HA: 8 Topics, bei uns: 13 Felder)

| HA-Topic | HA writable | Einheit | Bei uns | Bei uns writable |
|---|---|---|---|---|
| `Offset` | ja (NUMBER) | °C | `Offset` | ja (Scope 0.10.0) |
| `Scale` | ja (NUMBER) | – | `Scale` | ja (Scope 0.10.0) |
| `Temperature`, `TemperatureType`, `Status`, `Humidity`, `Pressure` | nein | – | vorhanden | nein |
| `BatteryVoltage` | nein | V | — | — |
| – (kein HA-Pendant) | – | – | `FilterLength` | ja (Scope 0.10.0) — **HA kennt dieses Feld nicht, keine Bestätigung der Schreib-Semantik von dritter Seite möglich** |
| – (kein HA-Pendant) | – | – | `RawValue`, `RawUnit`, `Mgmt/ProcessVersion`, `ProductId` | nein |

**Delta:** `BatteryVoltage` (Sensorversorgungsspannung) fehlt uns. `FilterLength` ist bei uns geplant
schreibbar (Plan-Scope), hat aber kein HA-Pendant — sollte beim Live-Test (S8) besonders sorgfältig
verifiziert werden, da keine externe Referenzimplementierung zum Abgleich existiert.

---

## switch (HA: 8 Topics unter `SwitchableOutput/{output}/*`, bei uns: dynamisch via `outputs.<n>.*`)

| HA-Topic | HA writable | Bei uns |
|---|---|---|
| `SwitchableOutput/{output}/State` | technisch `DYNAMIC` (abhängig vom konfigurierten Output-Typ) | `outputs.<n>.State` — **ja** (aktuell ungegatet, ab 0.10.0 gegated auf `mqttControlEnabled`) |
| `SwitchableOutput/{output}/Dimming` | **ja (NUMBER)** | — nicht implementiert |
| `SwitchableOutput/{output}/Settings/{DimmingMax,DimmingMin,Labels,StepSize,Type,Unit}` | nein | teilweise vorhanden laut Catalog (`Settings/CustomName`, `Settings/Function`, `Settings/Group`, `Settings/ShowUIControl`, `Settings/Type`, `Settings/ValidFunctions`, `Settings/ValidTypes`), aber `Dimming*`/`Labels`/`StepSize`/`Unit` fehlen |

**Delta:** Dimmbare Ausgänge (`Dimming` + zugehörige Settings) sind bei uns komplett unimplementiert
— betrifft vermutlich nur eine Untermenge der Switch-Hardware (dimmbare Relais/PWM-Ausgänge).

---

## meteo (HA: 7 Topics, bei uns: 6 Felder)

| HA-Topic | HA writable | Bei uns |
|---|---|---|
| `Irradiance` | nein | `Irradiance` |
| `Alarms/LowBattery`, `BatteryVoltage`, `CellTemperature`, `InstallationPower`, `TimeSinceLastSun`, `TodaysYield` | nein | — alle fehlend |
| – (kein HA-Pendant) | – | `WindSpeed`, `WindDirection`, `ExternalTemperature` |

**Delta:** Nahezu keine Überschneidung außer `Irradiance` — unterschiedliche Sensor-Vokabulare
(vermutlich unterschiedliche Wetterstations-Hardware-Generationen: wir decken windfähige Stationen
ab, HA-Schema fokussiert auf reine PV-Wetterstationen mit Batteriemodul).

---

## tank (HA: 5 Topics, bei uns: 7 Felder)

| HA-Topic | HA writable | Bei uns |
|---|---|---|
| `Level`, `Remaining`, `FluidType` | nein | vorhanden |
| `Temperature`, `BatteryVoltage` | nein | fehlend |
| – (kein HA-Pendant) | – | `Capacity`, `Status` |

Beide Seiten 0 schreibbare Topics.

---

## digitalinput (HA: 5 Topics — **bei uns als Device-Type nicht implementiert**)

| HA-Topic | HA writable |
|---|---|
| `Alarm`, `InputState`, `State`, `Type` | nein |
| `Settings/InvertTranslation` | **ja (SWITCH)** |

**Delta:** Kompletter Device-Type fehlt bei uns (kein Eintrag in `KNOWN_DEVICE_TYPES`/`RELEVANT_PATHS`).
Größter „Alles fehlt"-Befund dieser Analyse für einen in der Plan-Liste explizit genannten Typ.

---

## Weitere HA-Device-Typen ohne jede Entsprechung bei uns

Nicht im Plan-Scope, nur zur Vollständigkeit gezählt (Topic-Anzahl aus `victron_mqtt.json`):
`multi` (41 — vermutlich MultiPlus-spezifische Erweiterung zu `vebus`), `inverter` (18 — separate
Standalone-Inverter, nicht MP2/vebus), `ev` (24 — evtl. generische EV-Daten losgelöst vom
`evcharger`-Typ, nicht untersucht), `alternator` (9), `heatpump` (9), `dcdc` (8 — DC-DC-Wandler),
`gps` (8), `generator` (7 — reine Messwerte, zusätzlich zu `settings/Generator*` oben),
`charger` (6 — vermutlich Standalone-Batterielader getrennt von `solarcharger`), `dcsystem` (4),
`dcload` (3), `platform` (3 — teilweise bei uns als `platform`-Typ vorhanden, nicht im Detail
abgeglichen), `acsystem` (1). Keine inhaltliche Tiefenanalyse in diesem Dokument — reine Nennung
für spätere Priorisierung.

---

## Zusammenfassung der Deltas

### 1. Topics die HA kennt, wir nicht (Auswahl der größten Blöcke)
- **`digitalinput`** — kompletter Device-Type (5 Topics, 1 schreibbar)
- **`system` → `DynamicEss/*`** — komplettes Scheduling-Feature (10 Topics)
- **`settings` → Generator/Network/TransferSwitch/SystemSetup** — 24 Topics, überwiegend schreibbar
- **`settings` → `BatteryLife/Schedule/Charge/{slot}/*`** — Lade-Zeitpläne (4 Felder × Slots)
- **`battery` → `History/*`, `Info/*`, erweiterte `Alarms/*`** — 32 Topics
- **`solarcharger`** — 22 von 32 Topics fehlen, inkl. aller 3 Schreibpunkte und Multi-Tracker-Support
- **`vebus`** — `Alarms/*` (9), `Energy/*` (9), `Devices/{n}/Ac/*` (5)

### 2. Topics die HA writable macht, wir nicht (potenzielle Feature-Kandidaten)
- `evcharger.AutoStart`
- `system/settings`: `AcExportLimit`, `AcInputLimit`, `AlwaysPeakShave`, `BatteryUse`, `MaxChargePower`, komplettes `BatteryLife/Schedule/*`, `Settings/DynamicEss/Mode`, komplettes Generator-Set, `Network/VrmPortal`, `Services/Bol`, `SystemSetup/*`, `TransferSwitch/GeneratorCurrentLimit`
- `vebus`: `Ac/Control/IgnoreAcIn1`, `Dc/0/PreferRenewableEnergy`, `Devices/{n}/Settings/PowerAssistEnabled`, `Hub4/FixSolarOffsetTo100mV`, `Hub4/TargetPowerIsMaxFeedIn`, `PvInverter/Disable`, `Settings/Alarm/System/GridLost`, `Settings/AssistCurrentBoostFactor`
- `battery.Mode`
- `solarcharger`: `Mode`, `Relay/0/State`, `Settings/ChargeCurrentLimit`
- `switch.SwitchableOutput/{output}/Dimming`
- `system.Relay/{relay}/State` (evtl. redundant zu unserem `outputs.*`, zu klären)
- `digitalinput.Settings/InvertTranslation`

### 3. Topics die wir writable machen (0.10.0-Scope), HA nicht (oder nicht identisch)
- `temperature.FilterLength` — kein HA-Pendant, Schreib-Semantik nicht extern verifizierbar
- Namensabweichungen ohne Bedeutungsprüfung: `Hub4.DisableFeedIn` (uns) vs. `Hub4/DoNotFeedInOvervoltage`
  (HA) — vermutlich dasselbe Register, aber nicht verifiziert

### 4. Code-Diskrepanz Plan vs. Ist (kein HA-Bezug, aber im Zuge dieser Analyse aufgefallen) — GEKLÄRT
- `CONTROL_REGISTERS['system.BatteryLifeSocLimit']` und `['system.FeedInLimitActive']` standen im
  Code auf `write: false`, obwohl `CONTROL_MERGE_PLAN.md` beide ursprünglich im Scope als
  „Modbus-schreibbar" listete. David-Entscheidung nach S1-Checkpoint: beide bleiben read-only,
  aus dem 0.10.0-Scope gestrichen (kein Hardware-Verifikations-Risiko eingehen). Plan aktualisiert.

---

*Dieses Dokument hat keinen Einfluss auf den 0.10.0-Umbau. Priorisierung der hier gelisteten
Kandidaten erfolgt später gemeinsam mit David.*
