<p align="center">
  <img src="https://raw.githubusercontent.com/meistermopper/ioBroker.harvia-fenix/main/admin/harvia.png" alt="Logo">
</p>

# ioBroker.harvia-fenix

**[Click here for the English version of the documentation.](README.md)**

### Ein ioBroker-Adapter zur Integration und Steuerung Ihrer **Harvia Fenix** Saunasteuerung über die MyHarvia Cloud-Infrastruktur.
---

## Voraussetzungen

Um diesen Adapter zu nutzen, benötigen Sie:
1. Ein registriertes Konto in der offiziellen **MyHarvia 2** Smartphone-App.
2. Ihre gültigen Login-Daten:
   * **E-Mail-Adresse**
   * **Passwort**
*Wir empfehlen, ein separates Konto für ioBroker in der Harvia 2 App einzurichten und diese Zugangsdaten in der Instanz zu verwenden.*
---

## Gerätekonfiguration & Multi-Geräte-Unterstützung

### Automatische Erkennung (Discovery)
Wenn Sie das Feld **Geräte-ID** in den Adapter-Einstellungen leer lassen, sucht der Adapter beim Start automatisch nach Geräten, die mit Ihrem Konto verknüpft sind. Er verwendet das erste gefundene Gerät als aktive Einheit. Die erkannte ID wird im ioBroker-Log ausgegeben.

### Manuelle Geräte-ID
Für die meisten Benutzer mit einer einzigen Sauna ist die automatische Erkennung ausreichend. Es wird jedoch empfohlen, die erkannte ID aus dem Log zu kopieren und in die Konfiguration einzufügen, um eine stabile Verbindung zur spezifischen Hardware zu gewährleisten.

*Hinweis: Derzeit wird die Geräte-ID in der MyHarvia 2 App-Oberfläche nirgends angezeigt.*

### Mehrere Saunen
Wenn Ihr MyHarvia-Konto mehrere Steuereinheiten verwaltet (z. B. eine zu Hause und eine im Ferienhaus):
1. Erstellen Sie für jede Sauna eine eigene Instanz des Adapters (z. B. `harvia-fenix.0` und `harvia-fenix.1`).
2. Geben Sie die spezifische **Geräte-ID** für jede Einheit manuell in der jeweiligen Instanz-Konfiguration ein.
Dies ermöglicht es Ihnen, beide Saunen unabhängig voneinander mit eigenen Datenpunkten zu überwachen und zu steuern.

---

## Funktionen & Datenpunkte

Der Adapter bildet die Cloud-Zustände Ihrer Sauna in strukturierten ioBroker-Datenpunkten unter `harvia-fenix.0.*` ab.

### Verfügbare Datenpunkte
| Datenpunkt | Typ | Rolle | Zugriff | Beschreibung |
|---|---|---|---|---|
| `online` | boolean | `indicator.reachable` | Nur Lesen | Verbindungsstatus der Steuereinheit zur Cloud. |
| `doorSafety` | boolean | `indicator.safety` | Nur Lesen | Status der Türsicherung (z. B. `true`, wenn die Tür sicher geschlossen ist). |
| `errorMsg` | string | `text` | Nur Lesen | Aktuelle Fehlermeldungen oder Statustexte des Ofens. |
| `heatOn` | boolean | `switch.power` | Lesen/Schreiben | Hauptschalter, um den Saunaofen EIN (`true`) oder AUS (`false`) zu schalten. |
| `heaterPower` | number | `value.power` | Nur Lesen | *Hinweis:* Dieses Objekt wird von der API bereitgestellt, liefert aber derzeit oft `0 kW`. |
| `lightOn` | boolean | `switch.light` | Lesen/Schreiben | Schalter für die integrierte Saunabeleuchtung. |
| `panelTemp` | number | `value.temperature` | Nur Lesen | Temperaturmesswert direkt an der physischen Steuereinheit (Panel). |
| `remoteControl` | boolean | `indicator.state` | Nur Lesen | Zeigt an, ob die Fernstartfreigabe am Gerät aktuell aktiv ist. |
| `targetTemp` | number | `level.temperature` | Lesen/Schreiben | Zieltemperatur-Sollwert für die Saunakabine (z. B. `90 °C`). |
| `temp` | number | `value.temperature` | Nur Lesen | Die aktuelle Umgebungstemperatur in der Saunakabine (z. B. `17 °C`). |
| `totalBathingHours` | number | `value.number` | Nur Lesen | Historische kumulierte Betriebsstunden der Saunanutzung (`h`). |
| `totalOperatingHours`| number | `value.hours` | Nur Lesen | Gesamte Betriebsstunden des Systems (`h`). |
| `totalSessions` | number | `value.count` | Nur Lesen | Zähler für die Gesamtzahl der durchgeführten Heizvorgänge. |

---

## ⚠️ KRITISCHER SICHERHEITSHINWEIS & HAFTUNGSAUSSCHLUSS

**Der Fernbetrieb eines Saunaofens unterliegt strengen Sicherheitsvorschriften!** Gemäß der europäischen Sicherheitsnorm **EN 60335-2-53** in Verbindung mit **EN 60335-1** sind Brandschutzmaßnahmen für Fernsteuerungssysteme zwingend erforderlich. Die Saunakabine muss mit einem zugelassenen Türsensor oder einem Sicherheits-Abschaltsystem ausgestattet sein. Dies stellt sicher, dass der Ofen nicht aus der Ferne oder per Timer gestartet werden kann, wenn ein brennbarer Gegenstand (z. B. ein Handtuch) auf oder in der Nähe des Ofens vergessen wurde.

* **Keine Haftung:** Der Entwickler dieses Adapters übernimmt absolut keine Verantwortung, Gewährleistung oder Haftung für Schäden, Brände, Verletzungen oder rechtliche Probleme, die aus der Nutzung oder Fehlkonfiguration dieser Software resultieren. Sie betreiben diese Integration vollständig auf eigenes Risiko.

---

## Kompatibilitätshinweis

* **Unterstützt:** **Harvia Fenix** Steuereinheiten, die über die **MyHarvia 2** App verwaltet werden.
* **NICHT unterstützt:** **Harvia Xenio** Serie (z. B. Xenio WiFi / CX001WIFI). Die Xenio-Serie basiert auf einem älteren Hardware-Ökosystem und verwendet die ältere *"MyHarvia for Xenio"* App, die grundlegend inkompatibel mit der von diesem Adapter verwendeten API ist.

---

## Änderungsprotokoll (Changelog)
### 0.0.8 (2026-06-06)
* (meistermopper) Redundante Lizenzdatei entfernt und MIT-Inhalt hinzugefügt.
* (meistermopper) Deutsche Übersetzung der Dokumentation hinzugefügt.

### 0.0.7 (2026-06-06)
* (meistermopper) Umfassende Dokumentation, Feature-Mapping und Sicherheitshinweise aktualisiert.

### 0.0.4 (2026-06-06)
* (meistermopper) Projektstruktur bereinigt und Dokumentation korrigiert.

### 0.0.3 (2026-06-05)
* (meistermopper) Erstveröffentlichung

---

## Markenhinweis
Harvia und MyHarvia 2 sind eingetragene Marken der Harvia Group. Dieser Adapter ist ein unabhängiges, gemeinschaftsbasiertes Open-Source-Projekt und wird weder offiziell von Harvia unterstützt, gesponsert noch betreut.

## Lizenz
MIT License - Copyright (c) 2026 meistermopper
