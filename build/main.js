"use strict";
/*
 * Created with @iobroker/create-adapter v3.1.5
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = __importStar(require("@iobroker/adapter-core"));
const axios_1 = __importStar(require("axios"));
// Harvia API Constants
const CLIENT_ID = "24emhb2mm0v4sscqhbdev86b2v";
const PARTNER_ID = "ORG/prod:0:6656:0";
const MIN_TARGET_TEMP = 40; // Minimum allowed target temperature in C
const MAX_TARGET_TEMP = 110; // Maximum allowed target temperature in C
const LATENCY_MS = 5000;
class HarviaFenix extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: "harvia-fenix",
        });
        this.idToken = "";
        this.dataBaseUrl = "";
        this.deviceBaseUrl = "";
        this.authUrl = "";
        this.activeDeviceId = "";
        this.loginPromise = null;
        this.isSendingCommand = false;
        this.lastCommandTime = 0;
        this.lastEventTime = {}; // For debouncing
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        // this.on('objectChange', this.onObjectChange.bind(this));
        // this.on('message', this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.client = axios_1.default.create({
            timeout: 20000,
            headers: {
                "User-Agent": "ioBroker.harvia-fenix/0.0.1",
            },
        });
    }
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Reset status states
        await this.setState("info.connection", false, true);
        // Create necessary state objects
        await this.ensureObjects();
        // Subscribe to writable states
        this.subscribeStates("heatOn");
        this.subscribeStates("lightOn");
        this.subscribeStates("targetTemp");
        // CLEAN START: Reset all status values to 'false' on startup
        await this.setState("online", false, true);
        await this.setState("heatOn", false, true);
        await this.setState("lightOn", false, true);
        await this.setState("doorSafety", false, true);
        await this.setState("remoteControl", false, true);
        await this.setState("errorMsg", "", true);
        // Start connection logic
        await this.startCloudConnection();
    }
    async ensureObjects() {
        const states = [
            {
                id: "online",
                type: "boolean",
                role: "indicator.reachable",
                def: false,
            },
            { id: "heatOn", type: "boolean", role: "switch.power", def: false },
            { id: "lightOn", type: "boolean", role: "switch.light", def: false },
            {
                id: "temp",
                type: "number",
                role: "value.temperature",
                unit: "°C",
                def: 0,
            },
            {
                id: "targetTemp",
                type: "number",
                role: "level.temperature",
                unit: "°C",
                def: 90,
            },
            {
                id: "heaterPower",
                type: "number",
                role: "value.power",
                unit: "kW",
                def: 0,
            },
            {
                id: "doorSafety",
                type: "boolean",
                role: "indicator.safety",
                def: false,
            },
            {
                id: "remoteControl",
                type: "boolean",
                role: "indicator.state",
                def: false,
            },
            { id: "errorMsg", type: "string", role: "text", def: "" },
            {
                id: "panelTemp",
                type: "number",
                role: "value.temperature",
                unit: "°C",
                def: 0,
            },
            {
                id: "totalBathingHours",
                type: "number",
                role: "value.number",
                unit: "h",
                def: 0,
            },
            { id: "totalSessions", type: "number", role: "value", def: 0 },
            // In original script it was totalHours, we keep totalOperatingHours
            {
                id: "totalOperatingHours",
                type: "number",
                role: "value",
                unit: "h",
                def: 0,
            },
        ];
        for (const s of states) {
            await this.setObjectNotExistsAsync(s.id, {
                type: "state",
                common: {
                    name: s.id,
                    type: s.type,
                    role: s.role,
                    unit: s.unit,
                    read: true,
                    write: true,
                    def: s.def,
                },
                native: {},
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
            this.log.info(`API configuration loaded: Data=${this.dataBaseUrl}, Device=${this.deviceBaseUrl}`);
            return true;
        }
        catch (err) {
            this.log.error(`Error loading API configuration: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }
    async login() {
        if (this.loginPromise) {
            return this.loginPromise;
        }
        this.loginPromise = this.performLogin();
        try {
            return await this.loginPromise;
        }
        finally {
            this.loginPromise = null;
        }
    }
    async performLogin() {
        try {
            if (!this.authUrl && !(await this.fetchConfig())) {
                return false;
            }
            const response = await this.client.post(this.authUrl, {
                username: this.config.username,
                password: this.config.password,
                client_id: CLIENT_ID,
            });
            this.idToken = response.data.idToken; // JWT-Token
            await this.setState("info.connection", true, true);
            return true;
        }
        catch (err) {
            this.log.error(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
            await this.setState("info.connection", false, true);
            return false;
        }
    }
    async startCloudConnection() {
        if (await this.login()) {
            await this.discoverDevices();
            void this.updateStatus(); // Start first poll
            this.loginInterval = this.setInterval(() => void this.login(), 50 * 60 * 1000);
        }
        else {
            this.log.warn("Initial login failed. Retrying in 5 minutes...");
            this.updateInterval = this.setTimeout(() => this.startCloudConnection(), 5 * 60 * 1000);
        }
    }
    async discoverDevices() {
        var _a;
        try {
            if (!this.idToken || !this.deviceBaseUrl) {
                return;
            }
            const baseUrl = this.deviceBaseUrl.replace(/\/$/, "");
            // Try to retrieve the list of devices
            const url = baseUrl.endsWith("/devices") ? baseUrl : `${baseUrl}/devices`;
            this.log.info(`Searching for devices at: ${url}`);
            const response = await this.client.get(url, {
                headers: {
                    Authorization: `Bearer ${this.idToken}`,
                    "x-harvia-partner-id": PARTNER_ID,
                },
            });
            const devices = response.data.devices || [];
            if (devices.length > 0) {
                this.log.info(`Harvia Cloud: ${devices.length} device(s) found.`);
                for (const d of devices) {
                    const actualId = d.deviceId || d.id || d.name;
                    this.log.info(`Found device: ${d.name} (ID: ${actualId}, Type: ${(_a = d.type) !== null && _a !== void 0 ? _a : "Fenix"})`);
                    // Use the configured ID if available, otherwise fall back to discovered ID
                    if (!this.activeDeviceId && !this.config.deviceId && actualId) {
                        this.log.warn(`Device ID not set in adapter configuration. Using found ID: ${actualId}`);
                        this.activeDeviceId = actualId;
                    }
                    else if (this.config.deviceId &&
                        this.config.deviceId !== actualId) {
                        this.log.info(`Configured Device ID (${this.config.deviceId}) does not match found ID (${actualId}). Please check settings.`);
                    }
                    // Read static attributes directly at startup
                    if (Array.isArray(d.attr)) {
                        for (const a of d.attr) {
                            // Ensure value exists before parsing
                            if (a.value === undefined || a.value === null) {
                                continue;
                            }
                            switch (a.key) {
                                case "connected":
                                    await this.setState("online", a.value === "true", true);
                                    break;
                                case "stats.totalSessions.C1":
                                    await this.setState("totalSessions", Math.round(Number.parseInt(a.value, 10)), true);
                                    break;
                                case "stats.totalBathingHours.C1": // In script it was totalBathingHours
                                    await this.setState("totalBathingHours", Math.round(Number.parseFloat(a.value) * 100) / 100, true);
                                    break;
                                case "stats.totalOperatingHours.C1":
                                    await this.setState("totalOperatingHours", Math.round(Number.parseFloat(a.value) * 100) / 100, true);
                                    break;
                                case "BT_MAC":
                                    this.log.debug(`Bluetooth MAC: ${a.value}`);
                                    break;
                            }
                        }
                    }
                }
            }
            else {
                this.log.warn("Login successful, but no devices found in Harvia account.");
            }
        }
        catch (err) {
            this.log.error(`Error during device discovery: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async updateStatus() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        try {
            if (!this.idToken || !this.dataBaseUrl) {
                return;
            }
            const url = `${this.dataBaseUrl.replace(/\/$/, "")}/data/latest-data`; // Path from JS-script
            const deviceId = this.activeDeviceId || this.config.deviceId;
            this.log.debug(`Poll Status: ${url} (ID: ${deviceId})`);
            const response = await this.client.get(url, {
                params: { deviceId },
                headers: {
                    // Headers from JS-script and successful calls
                    Accept: "application/json",
                    "x-harvia-app-id": CLIENT_ID,
                    "x-harvia-partner-id": PARTNER_ID,
                    Authorization: `Bearer ${this.idToken}`,
                },
            });
            if (response.data) {
                this.log.debug(`Poll Response: ${JSON.stringify(response.data)}`);
            }
            const responseData = response.data;
            let p;
            if (responseData && "data" in responseData && responseData.data) {
                p = responseData.data;
            }
            else if (responseData &&
                typeof responseData === "object" &&
                !("data" in responseData)) {
                p = responseData;
            }
            if (p) {
                // LATENCY PROTECTION: If a command was sent less than LATENCY_MS ago,
                // ignore this update to prevent UI jumping.
                if (Date.now() - this.lastCommandTime < LATENCY_MS) {
                    this.log.debug(`Polling ignored due to latency protection (${LATENCY_MS}ms). Last command ${Date.now() - this.lastCommandTime}ms ago.`);
                    return;
                }
                // NEW DEBUG LOGGING FOR HEATON
                if (p.online && p.heatOn !== undefined) {
                    const actualHeat = (_a = p.heatState) !== null && _a !== void 0 ? _a : p.heat;
                    const currentHeatOnState = (_b = (await this.getStateAsync("heatOn"))) === null || _b === void 0 ? void 0 : _b.val;
                    const isHeatingExpected = actualHeat === 1 || actualHeat === true || actualHeat === "on";
                    if (isHeatingExpected && !currentHeatOnState) {
                        this.log.warn(`Expected heatOn=true, but ioBroker state is false. Raw data: ${JSON.stringify(p.heatOn)}`);
                    }
                    else if (actualHeat === undefined) {
                        this.log.debug(`Heat status undefined in API response, but device is online. Raw data: ${JSON.stringify(p)}`);
                    }
                }
                // NORMALIZATION: Harvia uses 'temp' or 'temperature' depending on model.
                const currentTemp = (_c = p.temperature) !== null && _c !== void 0 ? _c : p.temp;
                if (currentTemp !== undefined) {
                    await this.setState("temp", Math.round(Number.parseFloat(currentTemp) * 10) / 10, true);
                }
                const pPanelTemp = (_d = p.panelTemp) !== null && _d !== void 0 ? _d : p.panelTemperature;
                if (pPanelTemp !== undefined) {
                    await this.setState("panelTemp", Math.round(Number.parseFloat(pPanelTemp) * 10) / 10, true);
                }
                // Normalization of heater power (heaterPower vs power)
                let currentPower = (_e = p.heaterPower) !== null && _e !== void 0 ? _e : p.power;
                if (currentPower !== undefined) {
                    currentPower =
                        Math.round((Number.parseFloat(currentPower) / 1000) * 100) / 100;
                    await this.setState("heaterPower", currentPower, true);
                }
                if (p.totalBathingHours !== undefined) {
                    await this.setState("totalBathingHours", Math.round(Number.parseFloat(p.totalBathingHours) * 100) /
                        100, true);
                }
                if (p.totalSessions !== undefined) {
                    await this.setState("totalSessions", Math.round(Number.parseInt(p.totalSessions, 10)), true);
                }
                if (p.totalHours !== undefined) {
                    await this.setState("totalOperatingHours", Math.round(Number.parseFloat(p.totalHours) * 100) / 100, true);
                }
                const tTemp = (_f = p.targetTemperature) !== null && _f !== void 0 ? _f : p.targetTemp;
                if (tTemp !== undefined) {
                    await this.setState("targetTemp", typeof tTemp === "string" ? Number.parseFloat(tTemp) : tTemp, true);
                }
                // STATUS-FIX (Light/Heating): Robust check of state fields and base fields.
                // Some cloud versions omit fields on 'off' or use alternative names.
                const actualHeat = (_h = (_g = p.heatOn) !== null && _g !== void 0 ? _g : p.heatState) !== null && _h !== void 0 ? _h : p.heat;
                const actualLight = (_k = (_j = p.lightOn) !== null && _j !== void 0 ? _j : p.lightState) !== null && _k !== void 0 ? _k : p.light;
                // Conversion of 0/1 or "on"/"off" to boolean for ioBroker
                if (actualHeat !== undefined && actualHeat !== null) {
                    await this.setState("heatOn", actualHeat === 1 || actualHeat === true || actualHeat === "on", true);
                }
                if (actualLight !== undefined && actualLight !== null) {
                    await this.setState("lightOn", actualLight === 1 || actualLight === true || actualLight === "on", true);
                }
                // Remote control readiness (safety chain acknowledged on panel?)
                if (p.remoteControlState !== undefined) {
                    await this.setState("remoteControl", p.remoteControlState === 1, true);
                }
                await this.setState("doorSafety", p.doorSafetyState === 1, true); // 1 = Safe/Closed
                await this.setState("online", true, true);
            }
            else {
                this.log.warn(`Unexpected data structure during status poll: ${JSON.stringify(response.data)}`);
            }
        }
        catch (err) {
            if ((0, axios_1.isAxiosError)(err)) {
                if (((_l = err.response) === null || _l === void 0 ? void 0 : _l.status) === 401) {
                    void this.login();
                }
                else {
                    this.log.error(`Status poll failed (${(_m = err.response) === null || _m === void 0 ? void 0 : _m.status}): ${err.message}. Response Data: ${JSON.stringify((_o = err.response) === null || _o === void 0 ? void 0 : _o.data)}`);
                    await this.setState("online", false, true);
                }
            }
            else {
                this.log.error(`Status poll failed: ${err instanceof Error ? err.message : String(err)}`);
                await this.setState("online", false, true);
            }
        }
        finally {
            const interval = (this.config.pollInterval || 60) * 1000;
            this.updateInterval = this.setTimeout(() => this.updateStatus(), interval);
        }
    }
    async setSaunaState(stateName, value, isRetry = false) {
        var _a, _b, _c;
        if (!this.idToken || !this.deviceBaseUrl) {
            return;
        }
        // Lock-Check: Only block if not an internal retry
        if (this.isSendingCommand && !isRetry) {
            return;
        }
        // RACE-CONDITION PROTECTION
        const baseUrl = this.deviceBaseUrl.replace(/\/$/, "");
        const devicesUrl = baseUrl.endsWith("/devices")
            ? baseUrl
            : `${baseUrl}/devices`;
        this.isSendingCommand = true;
        try {
            const deviceId = this.activeDeviceId || this.config.deviceId;
            if (stateName === "heatOn" || stateName === "lightOn") {
                const commandType = stateName === "heatOn" ? "SAUNA" : "LIGHTS";
                const stateStr = value ? "on" : "off";
                const payload = {
                    deviceId,
                    cabin: { id: "C1" },
                    command: { type: commandType, state: stateStr },
                };
                const url = `${devicesUrl}/command`;
                const resp = await this.client.post(url, payload, {
                    // Headers from JS-script and successful calls
                    headers: {
                        Authorization: `Bearer ${this.idToken.trim()}`, // .trim() from original JS-script
                        "Content-Type": "application/json",
                        "x-harvia-partner-id": PARTNER_ID,
                        "x-harvia-app-id": CLIENT_ID,
                    },
                });
                if ((_a = resp.data) === null || _a === void 0 ? void 0 : _a.handled) {
                    this.log.info(`${commandType} -> ${stateStr}`);
                    // CONFIRMATION: Set ack: true immediately to prevent UI "jumping"
                    await this.setState(stateName, !!value, true);
                    this.lastCommandTime = Date.now();
                    if (stateName === "heatOn") {
                        await this.setState("errorMsg", "", true);
                    }
                }
                else {
                    const reason = resp.data ? resp.data.failureReason : "Unknown";
                    this.log.warn(`Cloud rejected command: ${reason}`);
                    await this.setState("errorMsg", `Cloud error: ${reason}`, true);
                }
            }
            else if (stateName === "targetTemp") {
                const payload = {
                    deviceId,
                    cabin: { id: "C1" },
                    temperature: Number.parseFloat(value),
                };
                const url = `${devicesUrl}/target`;
                await this.client.patch(url, payload, {
                    headers: {
                        Authorization: `Bearer ${this.idToken.trim()}`,
                        "Content-Type": "application/json",
                        "x-harvia-partner-id": PARTNER_ID,
                        "x-harvia-app-id": CLIENT_ID,
                    },
                });
                this.log.info(`Target temperature -> ${value}°C`);
                // Immediate confirmation in ioBroker
                await this.setState("targetTemp", Number.parseFloat(value), true);
                this.lastCommandTime = Date.now();
            }
        }
        catch (err) {
            let detail;
            if ((0, axios_1.isAxiosError)(err) && ((_b = err.response) === null || _b === void 0 ? void 0 : _b.data)) {
                detail = JSON.stringify(err.response.data);
            }
            else if (err instanceof Error) {
                detail = err.message;
            }
            else {
                detail = String(err);
            }
            // "Device unavailable" is a cloud lock effect during rapid clicking.
            // Log as debug to keep the info log clean.
            if (detail.includes("Device unavailable")) {
                this.log.debug("Cloud lock: Device busy, command discarded.");
            }
            else {
                this.log.error(`Control error: ${detail}`);
                const msg = err instanceof Error ? err.message : String(err);
                await this.setState("errorMsg", `Error: ${msg}`, true);
            }
            // RE-LOGIN LOGIC: If token became invalid during runtime
            // Automatic re-login on expired token (HTTP 401)
            if ((0, axios_1.isAxiosError)(err) && ((_c = err.response) === null || _c === void 0 ? void 0 : _c.status) === 401) {
                this.log.warn("Token expired during control, triggering re-login...");
                this.isSendingCommand = false; // Briefly release lock for login
                if (await this.login()) {
                    // Repeat command once after successful login
                    await this.setSaunaState(stateName, value, true);
                }
            }
        }
        finally {
            this.isSendingCommand = false;
        }
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback to be called after shutdown logic
     */
    onUnload(callback) {
        try {
            if (this.updateInterval) {
                this.clearTimeout(this.updateInterval);
            }
            if (this.loginInterval) {
                this.clearInterval(this.loginInterval);
            }
            callback();
        }
        catch {
            callback();
        }
    }
    // Internal helper function for debouncing ioBroker events (Race Condition protection)
    shouldProcess(id) {
        const now = Date.now();
        if (this.lastEventTime[id] && now - this.lastEventTime[id] < 1500) {
            return false; // Ignore events within 1500ms (VIS bouncing)
        }
        this.lastEventTime[id] = now;
        return true;
    }
    async onStateChange(id, state) {
        var _a;
        if (state && !state.ack) {
            const stateId = id.split(".").pop();
            if (!stateId) {
                return;
            }
            if (stateId === "heatOn") {
                if (!this.shouldProcess(id)) {
                    return;
                }
                // Ensure boolean conversion (VIS often sends strings)
                const val = state.val === true || state.val === "true" || state.val === 1;
                const isRemoteReady = (_a = (await this.getStateAsync("remoteControl"))) === null || _a === void 0 ? void 0 : _a.val;
                if (val && !isRemoteReady) {
                    this.log.warn("Remote start not ready!");
                    await this.setState("heatOn", false, true);
                    await this.setState("errorMsg", "Remote start not ready at panel!", true);
                }
                else {
                    await this.setSaunaState("heatOn", val);
                }
            }
            else if (stateId === "lightOn" || stateId === "targetTemp") {
                if (!this.shouldProcess(id)) {
                    return;
                }
                // Ensure type conversion
                let val = state.val;
                if (stateId === "targetTemp") {
                    val = Number.parseFloat(state.val);
                    if (Number.isNaN(val) ||
                        val < MIN_TARGET_TEMP ||
                        val > MAX_TARGET_TEMP) {
                        this.log.warn(`Invalid target temperature (${state.val}°C) received. Allowed range: ${MIN_TARGET_TEMP}-${MAX_TARGET_TEMP}°C. Resetting to default (${MAX_TARGET_TEMP}°C).`);
                        await this.setState("targetTemp", MAX_TARGET_TEMP, true); // Reset to default or max
                        await this.setState("errorMsg", `Invalid target temperature: ${state.val}°C`, true);
                        return;
                    }
                }
                else {
                    val = state.val === true || state.val === "true" || state.val === 1;
                }
                await this.setSaunaState(stateId, val);
            }
        }
    }
}
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new HarviaFenix(options);
}
else {
    // otherwise start the instance directly
    (() => new HarviaFenix())();
}
//# sourceMappingURL=main.js.map