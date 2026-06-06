<p align="center">
  <img src="https://raw.githubusercontent.com/meistermopper/ioBroker.harvia-fenix/main/admin/harvia.png" alt="Logo">
</p>
# ioBroker.harvia-fenix

[![NPM version](https://img.shields.io/npm/v/iobroker.harvia-fenix.svg)](https://www.npmjs.com/package/iobroker.harvia-fenix)
[![Downloads](https://img.shields.io/npm/dm/iobroker.harvia-fenix.svg)](https://www.npmjs.com/package/iobroker.harvia-fenix)
![Number of Installations](https://iobroker.live/badges/harvia-fenix-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/harvia-fenix-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.harvia-fenix.png?downloads=true)](https://nodei.co/npm/iobroker.harvia-fenix/)

**Tests:** ![Test and Release](https://github.com/meistermopper/ioBroker.harvia-fenix/workflows/Test%20and%20Release/badge.svg)

### An ioBroker adapter to integrate and control your **Harvia Fenix** sauna control unit via the MyHarvia cloud infrastructure.
---
## Prerequisites / Voraussetzungen

To use this adapter, you need:
1. A registered account within the official **MyHarvia 2** smartphone application.
2. Your valid login credentials:
   * **Email Address**
   * **Password**

---

## Device Configuration & Multi-Device Support

### Automatic Discovery
If you leave the **Device ID** field in the adapter settings empty, the adapter will automatically search for devices linked to your account upon startup. It will use the first device it finds as the active unit. The detected ID will be printed to the ioBroker log.

### Manual Device ID
For most users with a single sauna, automatic discovery is sufficient. However, it is recommended to copy the detected ID from the log and paste it into the configuration to ensure a stable connection to the specific hardware.

*Note: Currently, the Device ID is not displayed anywhere within the MyHarvia 2 app interface.*

### Multiple Saunas
If your MyHarvia account manages multiple control units (e.g., one at home and one in a vacation cottage):
1. Create a separate instance of the adapter for each sauna (e.g., `harvia-fenix.0` and `harvia-fenix.1`).
2. Manually enter the specific **Device ID** for each unit in its respective instance configuration.
This allows you to monitor and control both saunas independently with their own set of datapoints.

---

## Features & State Points / Datenpunkte

The adapter maps your sauna's cloud states into structured ioBroker datapoints under `harvia-fenix.0.*`.

### Available Datapoints
| Datapoint | Type | Role | Access | Description |
|---|---|---|---|---|
| `online` | boolean | `indicator.reachable` | Read-only | Connection state of the control unit to the cloud. |
| `doorSafety` | boolean | `indicator.safety` | Read-only | Safety loop status (e.g., `true` if the door is secure / safe to run). |
| `errorMsg` | string | `text` | Read-only | Current error messages or status text from the heater. |
| `heatOn` | boolean | `switch.power` | Read/Write | Main toggle to switch the sauna heater ON (`true`) or OFF (`false`). |
| `heaterPower` | number | `value.power` | Read-only | *Note:* This object is provisioned by the MyHarvia API structure but is currently delivered as `0 kW` (unpopulated). It appears to be reserved for future hardware or app updates. |
| `lightOn` | boolean | `switch.light` | Read/Write | Toggle to switch the integrated sauna lighting ON or OFF. |
| `panelTemp` | number | `value.temperature` | Read-only | The temperature reading measured at the physical control panel unit. |
| `remoteControl` | boolean | `indicator.state` | Read-only | Indicates if remote control authorization is currently active on the device. |
| `targetTemp` | number | `level.temperature` | Read/Write | Target temperature setpoint for the sauna cabin (e.g., `90 °C`). |
| `temp` | number | `value.temperature` | Read-only | The current ambient temperature inside the sauna cabin (e.g., `17 °C`). |
| `totalBathingHours` | number | `value.number` | Read-only | Total historical cumulative hours the sauna has been actively used (`h`). |
| `totalOperatingHours`| number | `value.hours` | Read-only | Total system operational running hours (`h`). |
| `totalSessions` | number | `value.count` | Read-only | Counter for the total number of individual sauna heating sessions executed. |
---

## ⚠️ CRITICAL SAFETY WARNING & DISCLAIMER / WICHTIGER SICHERHEITSHINWEIS

### English
**Remote operation of a sauna heater is subject to strict safety regulations!** According to the European safety standard **EN 60335-2-53** in conjunction with **EN 60335-1**, fire protection measures are mandatory for remote control setups. The sauna cabin must be equipped with an approved door sensor or a safety switch-off system. This ensures that the heater cannot be started remotely or via a timer if a flammable object (e.g., a towel) has been left on or near the heater.

* **No Liability:** The developer of this adapter assumes absolutely no responsibility, warranty, or liability for any damages, fires, injuries, or legal issues resulting from the use or misconfiguration of this software. You operate this integration entirely at your own risk.
---

## Compatibility Note / Kompatibilität

* **Supported:** **Harvia Fenix** control units managed via the **MyHarvia 2** mobile application.
* **NOT Supported:** **Harvia Xenio** series (e.g., Xenio WiFi / CX001WIFI). The Xenio series relies on a legacy hardware ecosystem and uses the older *"MyHarvia for Xenio"* app, which is fundamentally incompatible with the API utilized by this adapter.
---

## Changelog
### 0.0.8 (2026-06-06)
* (meistermopper) Fix license file redundancy and add MIT content.

### 0.0.7 (2026-06-06)
* (meistermopper) Update comprehensive documentation, feature mapping, and legal safety declarations.

### 0.0.6 (2026-06-06)
* (meistermopper) Force identity fix for README and license.

### 0.0.4 (2026-06-06)
* (meistermopper) Cleanup project structure and fix documentation.

### 0.0.3 (2026-06-05)
* (meistermopper) Initial release

### 0.0.2
* (meistermopper) Fixed configuration schema and improved type safety

### 0.0.1
* (meistermopper) Initial release

---

## Trademarks / Markenhinweis
Harvia and MyHarvia 2 are registered trademarks of Harvia Group. This adapter is an independent, community-driven open-source project and is neither officially endorsed, sponsored, nor supported by Harvia.

## License
MIT License - Copyright (c) 2026 meistermopper
