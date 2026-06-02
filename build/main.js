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
    this.client = import_axios.default.create({ timeout: 2e4 });
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
    await this.startCloudConnection();
  }
  async ensureObjects() {
    const states = [
      { id: "online", type: "boolean", role: "indicator.reachable", def: false },
      { id: "heatOn", type: "boolean", role: "switch.power", def: false },
      { id: "lightOn", type: "boolean", role: "switch.light", def: false },
      { id: "temp", type: "number", role: "value.temperature", unit: "\xB0C", def: 0 },
      { id: "targetTemp", type: "number", role: "level.temperature", unit: "\xB0C", def: 90 },
      { id: "heaterPower", type: "number", role: "value.power", unit: "W", def: 0 },
      { id: "doorSafety", type: "boolean", role: "indicator.safety", def: false },
      { id: "remoteControl", type: "boolean", role: "indicator.state", def: false },
      { id: "errorMsg", type: "string", role: "text", def: "" },
      { id: "panelTemp", type: "number", role: "value.temperature", unit: "\xB0C", def: 0 },
      { id: "totalSessions", type: "number", role: "value", def: 0 },
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
      const ep = response.data.endpoints.RestApi;
      this.dataBaseUrl = ep.data.https;
      this.deviceBaseUrl = ep.device.https;
      this.authUrl = `${ep.generics.https}/auth/token`;
      return true;
    } catch (err) {
      this.log.error(`Fehler beim Laden der API-Konfiguration: ${err.message}`);
      return false;
    }
  }
  async login() {
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
      return false;
    } finally {
      this.isLoggingIn = false;
    }
  }
  async startCloudConnection() {
    if (await this.login()) {
      this.updateStatus();
      this.loginInterval = this.setInterval(() => this.login(), 50 * 60 * 1e3);
    } else {
      this.log.warn("Erster Login fehlgeschlagen. Versuche es in 5 Minuten erneut...");
      this.updateInterval = this.setTimeout(() => this.startCloudConnection(), 5 * 60 * 1e3);
    }
  }
  async updateStatus() {
    var _a, _b;
    try {
      if (!this.idToken || !this.dataBaseUrl) return;
      const response = await this.client.get(`${this.dataBaseUrl}/data/latest-data?deviceId=${this.config.deviceId}`, {
        headers: { "Authorization": `Bearer ${this.idToken}`, "x-harvia-partner-id": PARTNER_ID }
      });
      const p = (_a = response.data) == null ? void 0 : _a.data;
      if (p && Date.now() - this.lastCommandTime > LATENCY_MS) {
        const currentTemp = p.temperature !== void 0 ? p.temperature : p.temp;
        if (currentTemp !== void 0) await this.setState("temp", parseFloat(currentTemp), true);
        const actualHeat = p.heatState !== void 0 ? p.heatState : p.heat;
        await this.setState("heatOn", !!(actualHeat === 1 || actualHeat === true || actualHeat === "on"), true);
        const actualLight = p.lightState !== void 0 ? p.lightState : p.light;
        await this.setState("lightOn", !!(actualLight === 1 || actualLight === true || actualLight === "on"), true);
        if (p.targetTemperature !== void 0) await this.setState("targetTemp", parseFloat(p.targetTemperature), true);
        await this.setState("doorSafety", p.doorSafetyState === 1, true);
        await this.setState("remoteControl", p.remoteControlState === 1, true);
        await this.setState("online", true, true);
        if (p.panelTemperature !== void 0) await this.setState("panelTemp", parseFloat(p.panelTemperature), true);
        if (p.totalSessions !== void 0) await this.setState("totalSessions", parseInt(p.totalSessions), true);
        if (p.totalOperatingHours !== void 0) await this.setState("totalOperatingHours", parseFloat(p.totalOperatingHours), true);
      }
    } catch (err) {
      if (((_b = err.response) == null ? void 0 : _b.status) === 401) {
        this.login();
      } else {
        this.log.debug(`Abruf-Fehler: ${err.message}`);
        await this.setState("online", false, true);
      }
    } finally {
      this.updateInterval = this.setTimeout(() => this.updateStatus(), 60 * 1e3);
    }
  }
  async setSaunaState(stateName, value) {
    var _a;
    if (!this.idToken || !this.deviceBaseUrl) return;
    if (this.isSendingCommand) return;
    this.isSendingCommand = true;
    try {
      if (stateName === "heatOn" || stateName === "lightOn") {
        const commandType = stateName === "heatOn" ? "SAUNA" : "LIGHTS";
        const stateStr = value ? "on" : "off";
        const payload = { deviceId: this.config.deviceId, cabin: { id: "C1" }, command: { type: commandType, state: stateStr } };
        const resp = await this.client.post(`${this.deviceBaseUrl}/devices/command`, payload, {
          headers: { "Authorization": `Bearer ${this.idToken}`, "Content-Type": "application/json" }
        });
        if ((_a = resp.data) == null ? void 0 : _a.handled) {
          this.log.info(`${commandType} -> ${stateStr}`);
          await this.setState(stateName, !!value, true);
          this.lastCommandTime = Date.now();
        }
      } else if (stateName === "targetTemp") {
        const payload = { deviceId: this.config.deviceId, cabin: { id: "C1" }, temperature: parseFloat(value) };
        await this.client.patch(`${this.deviceBaseUrl}/devices/target`, payload, {
          headers: { "Authorization": `Bearer ${this.idToken}`, "Content-Type": "application/json" }
        });
        await this.setState("targetTemp", parseFloat(value), true);
        this.lastCommandTime = Date.now();
      }
    } catch (err) {
      this.log.error(`Steuerungsfehler: ${err.message}`);
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
  async onStateChange(id, state) {
    var _a;
    if (state && !state.ack) {
      const stateId = id.split(".").pop();
      if (stateId === "heatOn") {
        const isRemoteReady = (_a = await this.getStateAsync("remoteControl")) == null ? void 0 : _a.val;
        if (state.val && !isRemoteReady) {
          this.log.warn("Fernstart nicht bereit!");
          await this.setState("heatOn", false, true);
          await this.setState("errorMsg", "Fernstart am Panel nicht bereit!", true);
        } else {
          await this.setSaunaState("heatOn", state.val);
        }
      } else if (stateId === "lightOn" || stateId === "targetTemp") {
        await this.setSaunaState(stateId, state.val);
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
