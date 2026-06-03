"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_axios = __toESM(require("axios"));
const CLIENT_ID = "24emhb2mm0v4sscqhbdev86b2v";
const PARTNER_ID = "ORG/prod:0:6656:0";
const LATENCY_MS = 5e3;
class HarviaFenix extends utils.Adapter {
  client;
  idToken = "";
  dataBaseUrl = "";
  deviceBaseUrl = "";
  authUrl = "";
  isLoggingIn = false;
  isSendingCommand = false;
  lastCommandTime = 0;
  updateInterval;
  loginInterval;
  constructor(options = {}) {
    super({
      ...options,
      name: "harvia-fenix"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.client = import_axios.default.create({
      timeout: 2e4,
      headers: {
        "User-Agent": "ioBroker.harvia-fenix/0.0.1"
      }
    });
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    await this.setState("info.connection", false, true);
    await this.ensureObjects();
    this.subscribeStates("heatOn");
    this.subscribeStates("lightOn");
    this.subscribeStates("targetTemp");
    await this.setState("online", false, true);
    await this.setState("heatOn", false, true);
    await this.setState("lightOn", false, true);
    await this.setState("doorSafety", false, true);
    await this.setState("remoteControl", false, true);
    await this.setState("errorMsg", "", true);
    await this.startCloudConnection();
  }
  async ensureObjects() {
    const states = [
      { id: "online", type: "boolean", role: "indicator.reachable", def: false },
      { id: "heatOn", type: "boolean", role: "switch.power", def: false },
      { id: "lightOn", type: "boolean", role: "switch.light", def: false },
      { id: "temp", type: "number", role: "value.temperature", unit: "\xB0C", def: 0 },
      { id: "targetTemp", type: "number", role: "level.temperature", unit: "\xB0C", def: 90 },
      { id: "heaterPower", type: "number", role: "value.power", unit: "kW", def: 0 },
      { id: "doorSafety", type: "boolean", role: "indicator.safety", def: false },
      { id: "remoteControl", type: "boolean", role: "indicator.state", def: false },
      { id: "errorMsg", type: "string", role: "text", def: "" },
      { id: "panelTemp", type: "number", role: "value.temperature", unit: "\xB0C", def: 0 },
      { id: "totalBathingHours", type: "number", role: "value.number", unit: "h", def: 0 },
      { id: "totalSessions", type: "number", role: "value", def: 0 },
      // Im Skript war es totalHours, wir behalten totalOperatingHours
      { id: "totalOperatingHours", type: "number", role: "value", unit: "h", def: 0 }
    ];
    for (const s of states) {
      await this.setObjectNotExistsAsync(s.id, {
        type: "state",
        common: { name: s.id, type: s.type, role: s.role, unit: s.unit, read: true, write: true },
        native: {}
      });
    }
  }
  async fetchConfig() {
    try {
      const response = await this.client.get("https://api.harvia.io/endpoints");
      this.log.debug(`Endpoints Response: ${JSON.stringify(response.data)}`);
      const ep = response.data.endpoints.RestApi;
      this.dataBaseUrl = ep.data.https;
      this.deviceBaseUrl = ep.device.https;
      this.authUrl = `${ep.generics.https}/auth/token`;
      this.log.info(`API Konfiguration geladen: Data=${this.dataBaseUrl}, Device=${this.deviceBaseUrl}`);
      return true;
    } catch (err) {
      this.log.error(`Fehler beim Laden der API-Konfiguration: ${err.message}`);
      return false;
    }
  }
  async login() {
    if (this.isLoggingIn) {
      let checks = 0;
      while (this.isLoggingIn && checks < 10) {
        await this.wait(500);
        checks++;
      }
      if (this.idToken) return true;
    }
    if (this.isLoggingIn) return false;
    this.isLoggingIn = true;
    try {
      if (!this.authUrl && !await this.fetchConfig()) return false;
      const response = await this.client.post(this.authUrl, {
        username: this.config.username,
        password: this.config.password,
        client_id: CLIENT_ID
      });
      this.idToken = response.data.idToken;
      await this.setState("info.connection", true, true);
      return true;
    } catch (err) {
      this.log.error(`Login fehlgeschlagen: ${err.message}`);
      await this.setState("info.connection", false, true);
      return false;
    } finally {
      this.isLoggingIn = false;
    }
  }
  async startCloudConnection() {
    if (await this.login()) {
      await this.discoverDevices();
      this.updateStatus();
      this.loginInterval = this.setInterval(() => this.login(), 50 * 60 * 1e3);
    } else {
      this.log.warn("Erster Login fehlgeschlagen. Versuche es in 5 Minuten erneut...");
      this.updateInterval = this.setTimeout(() => this.startCloudConnection(), 5 * 60 * 1e3);
    }
  }
  async discoverDevices() {
    var _a;
    try {
      if (!this.idToken || !this.deviceBaseUrl) return;
      const baseUrl = this.deviceBaseUrl.replace(/\/$/, "");
      const url = baseUrl.endsWith("/devices") ? baseUrl : `${baseUrl}/devices`;
      this.log.info(`Suche nach Ger\xE4ten unter: ${url}`);
      const response = await this.client.get(url, {
        headers: {
          "Authorization": `Bearer ${this.idToken}`,
          "x-harvia-partner-id": PARTNER_ID
        }
      });
      const devices = ((_a = response.data) == null ? void 0 : _a.devices) || [];
      if (devices.length > 0) {
        this.log.info(`Harvia Cloud: ${devices.length} Ger\xE4t(e) gefunden.`);
        for (const d of devices) {
          const actualId = d.deviceId || d.id || d.name;
          this.log.info(`Gefundenes Ger\xE4t: ${d.name} (ID: ${actualId}, Typ: ${d.type || "Fenix"})`);
          if (!this.config.deviceId && actualId) {
            this.log.warn(`Device ID in Adapter-Konfiguration nicht gesetzt. Verwende gefundene ID: ${actualId}`);
            this.config.deviceId = actualId;
          } else if (this.config.deviceId !== actualId) {
            this.log.warn(`Konfigurierte Device ID (${this.config.deviceId}) stimmt nicht mit gefundener ID (${actualId}) \xFCberein. Bitte pr\xFCfen Sie die Einstellungen.`);
          }
          if (Array.isArray(d.attr)) {
            for (const a of d.attr) {
              if (a.value === void 0 || a.value === null) {
                continue;
              }
              switch (a.key) {
                case "connected":
                  await this.setState("online", a.value === "true", true);
                  break;
                case "stats.totalSessions.C1":
                  await this.setState("totalSessions", Math.round(parseInt(a.value)), true);
                  break;
                case "stats.totalBathingHours.C1":
                  await this.setState("totalBathingHours", Math.round(parseFloat(a.value) * 100) / 100, true);
                  break;
                case "stats.totalOperatingHours.C1":
                  await this.setState("totalOperatingHours", Math.round(parseFloat(a.value) * 100) / 100, true);
                  break;
                case "BT_MAC":
                  this.log.debug(`Bluetooth MAC: ${a.value}`);
                  break;
              }
            }
          }
        }
      } else {
        this.log.warn("Login erfolgreich, aber keine Ger\xE4te im Harvia-Account gefunden.");
      }
    } catch (err) {
      this.log.error(`Fehler bei der Ger\xE4tesuche: ${err.message}`);
    }
  }
  async updateStatus() {
    var _a, _b, _c, _d, _e;
    try {
      if (!this.idToken || !this.dataBaseUrl) return;
      const url = `${this.dataBaseUrl.replace(/\/$/, "")}/data/latest-data`;
      this.log.debug(`Poll Status: ${url} (ID: ${this.config.deviceId})`);
      const response = await this.client.get(url, {
        params: { deviceId: this.config.deviceId },
        headers: {
          // Header aus dem JS-Skript und den erfolgreichen Aufrufen
          "Accept": "application/json",
          "x-harvia-app-id": CLIENT_ID,
          "x-harvia-partner-id": PARTNER_ID,
          "Authorization": `Bearer ${this.idToken}`
        }
      });
      if (response.data) {
        this.log.debug(`Poll Response: ${JSON.stringify(response.data)}`);
      }
      const p = ((_a = response.data) == null ? void 0 : _a.data) || response.data;
      if (p && typeof p === "object") {
        if (Date.now() - this.lastCommandTime < LATENCY_MS) {
          this.log.debug(`Polling ignoriert wegen Latency-Schutz (${LATENCY_MS}ms). Letzter Befehl vor ${Date.now() - this.lastCommandTime}ms.`);
          return;
        }
        if (p.online) {
          const actualHeat2 = p.heatState !== void 0 ? p.heatState : p.heat;
          const currentHeatOnState = (_b = await this.getStateAsync("heatOn")) == null ? void 0 : _b.val;
          const isHeatingExpected = actualHeat2 === 1 || actualHeat2 === true || actualHeat2 === "on";
          if (isHeatingExpected && !currentHeatOnState) {
            this.log.warn(`Erwartet heatOn=true, aber ioBroker-Status ist false. Rohdaten: ${JSON.stringify(p)}`);
          } else if (actualHeat2 === void 0) {
            this.log.warn(`Heat-Status in API-Antwort undefiniert, aber online. Rohdaten: ${JSON.stringify(p)}`);
          }
        }
        const currentTemp = p.temperature !== void 0 ? p.temperature : p.temp;
        if (currentTemp !== void 0) await this.setState("temp", Math.round(parseFloat(currentTemp) * 10) / 10, true);
        const pPanelTemp = p.panelTemp !== void 0 ? p.panelTemp : p.panelTemperature;
        if (pPanelTemp !== void 0) await this.setState("panelTemp", Math.round(parseFloat(pPanelTemp) * 10) / 10, true);
        let currentPower = p.heaterPower !== void 0 ? p.heaterPower : p.power;
        if (currentPower !== void 0) {
          currentPower = Math.round(parseFloat(currentPower) / 1e3 * 100) / 100;
          await this.setState("heaterPower", currentPower, true);
        }
        if (p.totalBathingHours !== void 0) await this.setState("totalBathingHours", Math.round(parseFloat(p.totalBathingHours) * 100) / 100, true);
        if (p.totalSessions !== void 0) await this.setState("totalSessions", Math.round(parseInt(p.totalSessions)), true);
        if (p.totalHours !== void 0) await this.setState("totalOperatingHours", Math.round(parseFloat(p.totalHours) * 100) / 100, true);
        const tTemp = p.targetTemperature !== void 0 ? p.targetTemperature : p.targetTemp;
        if (tTemp !== void 0) await this.setState("targetTemp", parseFloat(tTemp), true);
        const actualHeat = p.heatOn !== void 0 ? p.heatOn : p.heatState !== void 0 ? p.heatState : p.heat;
        const actualLight = p.lightOn !== void 0 ? p.lightOn : p.lightState !== void 0 ? p.lightState : p.light;
        if (actualHeat !== void 0 && actualHeat !== null) {
          await this.setState("heatOn", !!(actualHeat === 1 || actualHeat === true || actualHeat === "on"), true);
        }
        if (actualLight !== void 0 && actualLight !== null) {
          await this.setState("lightOn", !!(actualLight === 1 || actualLight === true || actualLight === "on"), true);
        }
        if (p.remoteControlState !== void 0) {
          await this.setState("remoteControl", p.remoteControlState === 1, true);
        }
        await this.setState("doorSafety", p.doorSafetyState === 1, true);
        await this.setState("online", true, true);
      } else if (!p || typeof p !== "object") {
        this.log.warn(`Unerwartete Datenstruktur beim Status-Abruf: ${JSON.stringify(response.data)}`);
      }
    } catch (err) {
      if (((_c = err.response) == null ? void 0 : _c.status) === 401) {
        this.login();
      } else {
        this.log.error(`Status-Abruf fehlgeschlagen (${(_d = err.response) == null ? void 0 : _d.status}): ${err.message}. Response Data: ${JSON.stringify((_e = err.response) == null ? void 0 : _e.data)}`);
        await this.setState("online", false, true);
      }
    } finally {
      const interval = (this.config.pollInterval || 60) * 1e3;
      this.updateInterval = this.setTimeout(() => this.updateStatus(), interval);
    }
  }
  async setSaunaState(stateName, value, isRetry = false) {
    if (!this.idToken || !this.deviceBaseUrl) return;
    if (this.isSendingCommand && !isRetry) return;
    const baseUrl = this.deviceBaseUrl.replace(/\/$/, "");
    const devicesUrl = baseUrl.endsWith("/devices") ? baseUrl : `${baseUrl}/devices`;
    this.isSendingCommand = true;
    try {
      if (stateName === "heatOn" || stateName === "lightOn") {
        const commandType = stateName === "heatOn" ? "SAUNA" : "LIGHTS";
        const stateStr = value ? "on" : "off";
        const payload = { deviceId: this.config.deviceId, cabin: { id: "C1" }, command: { type: commandType, state: stateStr } };
        const url = `${devicesUrl}/command`;
        const resp = await this.client.post(url, payload, {
          // Header aus dem JS-Skript und den erfolgreichen Aufrufen
          headers: {
            "Authorization": `Bearer ${this.idToken.trim()}`,
            // .trim() aus JS-Skript
            "Content-Type": "application/json",
            "x-harvia-partner-id": PARTNER_ID,
            "x-harvia-app-id": CLIENT_ID
          }
        });
        if (resp.data && resp.data.handled) {
          this.log.info(`${commandType} -> ${stateStr}`);
          await this.setState(stateName, !!value, true);
          this.lastCommandTime = Date.now();
          if (stateName === "heatOn") await this.setState("errorMsg", "", true);
        } else {
          const reason = resp.data ? resp.data.failureReason : "Unbekannt";
          this.log.warn(`Cloud lehnt Befehl ab: ${reason}`);
          await this.setState("errorMsg", `Cloud-Fehler: ${reason}`, true);
        }
      } else if (stateName === "targetTemp") {
        const payload = {
          deviceId: this.config.deviceId,
          cabin: { id: "C1" },
          temperature: parseFloat(value)
          // Muss zwingend eine Zahl sein
        };
        const url = `${devicesUrl}/target`;
        await this.client.patch(url, payload, {
          headers: {
            "Authorization": `Bearer ${this.idToken.trim()}`,
            // .trim() aus JS-Skript
            "Content-Type": "application/json",
            "x-harvia-partner-id": PARTNER_ID,
            "x-harvia-app-id": CLIENT_ID
          }
        });
        this.log.info(`Temp-Soll -> ${value}\xB0C`);
        await this.setState("targetTemp", parseFloat(value), true);
        this.lastCommandTime = Date.now();
      }
    } catch (err) {
      const detail = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
      if (detail.includes("Device unavailable")) {
        this.log.debug(`Cloud-Sperre: Ger\xE4t belegt, Befehl wird verworfen.`);
      } else {
        this.log.error(`Fehler bei der Steuerung: ${detail}`);
        await this.setState("errorMsg", `Fehler: ${err.message}`, true);
      }
      if (err.response && err.response.status === 401) {
        this.log.warn("Token abgelaufen bei Steuerung, l\xF6se Re-Login aus...");
        this.isSendingCommand = false;
        if (await this.login()) {
          await this.setSaunaState(stateName, value, true);
        }
      }
    } finally {
      this.isSendingCommand = false;
    }
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   */
  onUnload(callback) {
    try {
      if (this.updateInterval) this.clearTimeout(this.updateInterval);
      if (this.loginInterval) this.clearInterval(this.loginInterval);
      callback();
    } catch (error) {
      callback();
    }
  }
  /**
   * Is called if a subscribed state changes
   */
  lastEventTime = {};
  // Für Entprellung
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Interne Hilfsfunktion zur Entprellung von ioBroker-Events (Race Condition Schutz)
  shouldProcess(id) {
    const now = Date.now();
    if (this.lastEventTime[id] && now - this.lastEventTime[id] < 1500) {
      return false;
    }
    this.lastEventTime[id] = now;
    return true;
  }
  async onStateChange(id, state) {
    var _a;
    if (state && !state.ack) {
      const stateId = id.split(".").pop();
      if (stateId === "heatOn") {
        if (!this.shouldProcess(id)) return;
        const val = state.val === true || state.val === "true" || state.val === 1;
        const isRemoteReady = (_a = await this.getStateAsync("remoteControl")) == null ? void 0 : _a.val;
        if (val && !isRemoteReady) {
          this.log.warn("Fernstart nicht bereit!");
          await this.setState("heatOn", false, true);
          await this.setState("errorMsg", "Fernstart am Panel nicht bereit!", true);
        } else {
          await this.setSaunaState("heatOn", val);
        }
      } else if (stateId === "lightOn" || stateId === "targetTemp") {
        if (!this.shouldProcess(id)) return;
        const val = state.val === true || state.val === "true" || state.val === 1 || typeof state.val === "number" ? state.val : false;
        await this.setSaunaState(stateId, val);
      }
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new HarviaFenix(options);
} else {
  (() => new HarviaFenix())();
}
//# sourceMappingURL=main.js.map
