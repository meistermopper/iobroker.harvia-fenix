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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = __importStar(require("@iobroker/adapter-core"));
const axios_1 = __importDefault(require("axios"));
// Harvia API Constants
const CLIENT_ID = "24emhb2mm0v4sscqhbdev86b2v";
const MIN_TARGET_TEMP = 40; // Minimum allowed target temperature in C
const MAX_TARGET_TEMP = 110; // Maximum allowed target temperature in C
const LATENCY_MS = 5000;
class HarviaFenix extends utils.Adapter {
    client;
    idToken = "";
    dataBaseUrl = "";
    deviceBaseUrl = "";
    usersBaseUrl = "";
    authUrl = "";
    partnerId = "ORG/prod:0:6656:0"; // Fallback
    activeDeviceId = "";
    loginPromise = null;
    isSendingCommand = false;
    isUnloading = false;
    lastCommandTime = 0;
    firstPoll = true;
    updateInterval;
    loginInterval;
    lastEventTime = {}; // For debouncing
    constructor(options = {}) {
        super({
            ...options,
            name: "harvia-fenix",
        });
        this.on("ready", this.onReady);
        this.on("stateChange", this.onStateChange);
        this.on("unload", this.onUnload);
        this.client = axios_1.default.create({
            timeout: 20000,
        });
    }
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    onReady = async () => {
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
    };
    async ensureObjects() {
        const states = [
            {
                id: "online",
                type: "boolean",
                role: "indicator.reachable",
                write: false,
                def: false,
            },
            {
                id: "heatOn",
                type: "boolean",
                role: "switch.power",
                write: true,
                def: false,
            },
            {
                id: "lightOn",
                type: "boolean",
                role: "switch.light",
                write: true,
                def: false,
            },
            {
                id: "temp",
                type: "number",
                role: "value.temperature",
                unit: "°C",
                write: false,
                def: 0,
            },
            {
                id: "targetTemp",
                type: "number",
                role: "level.temperature",
                unit: "°C",
                write: true,
                def: 90,
            },
            {
                id: "heaterPower",
                type: "number",
                role: "value.power",
                unit: "kW",
                write: false,
                def: 0,
            },
            {
                id: "doorSafety",
                type: "boolean",
                role: "indicator.safety",
                write: false,
                def: false,
            },
            {
                id: "remoteControl",
                type: "boolean",
                role: "indicator.state",
                write: false,
                def: false,
            },
            { id: "errorMsg", type: "string", role: "text", write: false, def: "" },
            {
                id: "panelTemp",
                type: "number",
                role: "value.temperature",
                unit: "°C",
                write: false,
                def: 0,
            },
            {
                id: "totalBathingHours",
                type: "number",
                role: "value.number",
                unit: "h",
                write: false,
                def: 0,
            },
            {
                id: "totalSessions",
                type: "number",
                role: "value.count",
                write: false,
                def: 0,
            },
            // In original script it was totalHours, we keep totalOperatingHours
            {
                id: "totalOperatingHours",
                type: "number",
                role: "value.hours",
                unit: "h",
                write: false,
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
                    write: s.write,
                    def: s.def,
                },
                native: {},
            });
        }
    }
    /**
     * Robust check for truthy values from Harvia API
     */
    static isTrue(val) {
        if (val === undefined || val === null)
            return false;
        let checkVal = val;
        if (typeof val === "string") {
            checkVal = val.toLowerCase().trim();
        }
        // extended for Fenix Remote Ready (21, 23) and other truthy indicators
        const trueValues = [
            1,
            21,
            23,
            "1",
            "21",
            "23",
            true,
            "true",
            "on",
            "enabled",
            "safe",
            "ready",
            "active",
            "standby",
        ];
        return trueValues.includes(checkVal);
    }
    /**
     * Helper to get value from multiple possible API keys
     */
    static getApiValue(p, keys) {
        if (!p || typeof p !== "object")
            return undefined;
        // 1. Search top level
        for (const key of keys) {
            const val = p[key];
            if (val !== undefined && val !== null) {
                return val;
            }
        }
        // 2. Search in status object (new Harvia API structure)
        const status = p.status;
        if (status && typeof status === "object") {
            for (const key of keys) {
                const val = status[key];
                if (val !== undefined && val !== null) {
                    return val;
                }
            }
        }
        return undefined;
    }
    async fetchConfig() {
        try {
            const response = await this.client.get("https://api.harvia.io/endpoints");
            this.log.debug(`Endpoints Response: ${JSON.stringify(response.data)}`);
            const ep = response.data.RestApi || response.data.endpoints?.RestApi;
            if (!ep) {
                this.log.error("Could not find RestApi configuration in endpoints response");
                return false;
            }
            this.dataBaseUrl = ep.data.https;
            this.deviceBaseUrl = ep.device.https;
            this.usersBaseUrl = ep.users?.https || "";
            this.authUrl = `${ep.generics.https}/auth/token`;
            const partnerId = response.data.Config?.PartnerOrganizationId ||
                response.data.endpoints?.Config?.PartnerOrganizationId;
            if (partnerId) {
                this.partnerId = partnerId;
            }
            this.log.info(`API configuration loaded: Data=${this.dataBaseUrl}, Device=${this.deviceBaseUrl}, Partner=${this.partnerId}`);
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
            if (!this.config.username || !this.config.password) {
                this.log.error("Login failed: Username or password not configured!");
                return false;
            }
            this.log.debug(`Attempting login for user: ${this.config.username?.substring(0, 3)}...`);
            const response = await this.client.post(this.authUrl, {
                username: this.config.username,
                password: this.config.password,
                client_id: CLIENT_ID,
            });
            this.idToken = response.data.idToken.trim(); // JWT-Token trimmed
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
        try {
            if (!this.idToken || !this.deviceBaseUrl) {
                return;
            }
            const endpointsToTry = [];
            const devBase = this.deviceBaseUrl.replace(/\/$/, "");
            endpointsToTry.push(devBase.endsWith("/devices") ? devBase : `${devBase}/devices`);
            if (this.usersBaseUrl) {
                const userBase = this.usersBaseUrl.replace(/\/$/, "");
                endpointsToTry.push(userBase.endsWith("/devices") ? userBase : `${userBase}/devices`);
            }
            let devices = [];
            for (const url of endpointsToTry) {
                this.log.info(`Searching for devices at: ${url}`);
                try {
                    const response = await this.client.get(url, {
                        headers: {
                            Authorization: `Bearer ${this.idToken}`,
                            "x-harvia-partner-id": this.partnerId,
                            "x-harvia-app-id": CLIENT_ID,
                        },
                    });
                    this.log.debug(`Discovery Response: ${JSON.stringify(response.data)}`);
                    const rawDiscovery = response.data;
                    const discoveryData = (rawDiscovery &&
                        typeof rawDiscovery === "object" &&
                        "data" in rawDiscovery
                        ? rawDiscovery.data
                        : rawDiscovery);
                    if (Array.isArray(discoveryData)) {
                        devices = discoveryData;
                    }
                    else if (discoveryData &&
                        typeof discoveryData === "object" &&
                        "devices" in discoveryData &&
                        Array.isArray(discoveryData.devices)) {
                        devices = discoveryData
                            .devices;
                    }
                    if (devices.length > 0)
                        break;
                }
                catch {
                    this.log.debug(`Discovery at ${url} failed, trying next...`);
                }
            }
            if (devices.length > 0) {
                this.log.info(`Harvia Cloud: ${devices.length} device(s) found.`);
                for (const d of devices) {
                    const actualId = d.deviceId || d.id || d.name;
                    this.log.info(`Found device: ${d.name} (ID: ${actualId}, Type: ${d.type ?? "Fenix"})`);
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
                    const attributes = {};
                    if (Array.isArray(d.attr)) {
                        for (const a of d.attr) {
                            if (a.key && a.value !== undefined)
                                attributes[a.key] = a.value;
                        }
                        for (const [key, val] of Object.entries(attributes)) {
                            switch (key) {
                                case "connected":
                                    await this.setState("online", HarviaFenix.isTrue(val), true);
                                    break;
                                case "stats.totalSessions.C1":
                                    {
                                        const num = typeof val === "number"
                                            ? val
                                            : Number.parseInt(String(val), 10);
                                        await this.setState("totalSessions", Math.round(num), true);
                                    }
                                    break;
                                case "stats.totalBathingHours.C1":
                                    {
                                        const num = typeof val === "number"
                                            ? val
                                            : Number.parseFloat(String(val));
                                        await this.setState("totalBathingHours", Math.round(num * 100) / 100, true);
                                    }
                                    break;
                                case "stats.totalOperatingHours.C1":
                                    {
                                        const num = typeof val === "number"
                                            ? val
                                            : Number.parseFloat(String(val));
                                        await this.setState("totalOperatingHours", Math.round(num * 100) / 100, true);
                                    }
                                    break;
                                case "BT_MAC":
                                    this.log.debug(`Bluetooth MAC: ${val}`);
                                    break;
                            }
                        }
                    }
                }
            }
            else {
                if (this.config.deviceId) {
                    this.log.info(`No devices found via discovery, using manually configured Device ID: ${this.config.deviceId}`);
                }
                else {
                    this.log.warn("Login successful, but no devices found in Harvia account.");
                }
            }
        }
        catch (err) {
            this.log.error(`Error during device discovery: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async updateStatus() {
        try {
            if (!this.idToken || !this.dataBaseUrl) {
                return;
            }
            const url = `${this.dataBaseUrl.replace(/\/$/, "")}/data/latest-data`;
            const deviceId = this.activeDeviceId || this.config.deviceId;
            if (!deviceId) {
                return;
            }
            if (this.firstPoll) {
                this.log.info(`Starting status polling for device ID: ${deviceId}`);
                this.firstPoll = false;
            }
            this.log.debug(`Poll Status: ${url} (ID: ${deviceId})`);
            const response = await this.client.get(url, {
                params: { deviceId },
                headers: {
                    // Headers from JS-script and successful calls
                    Accept: "application/json",
                    "x-harvia-app-id": CLIENT_ID,
                    "x-harvia-partner-id": this.partnerId,
                    Authorization: `Bearer ${this.idToken}`,
                },
            });
            if (response.data) {
                this.log.debug(`Poll Response: ${JSON.stringify(response.data)}`);
            }
            // Improved Data Normalization
            const rawData = response.data;
            let p;
            if (rawData &&
                typeof rawData === "object" &&
                "data" in rawData &&
                rawData.data) {
                p = rawData.data;
            }
            else {
                p = rawData;
            }
            if (p &&
                (p.online !== undefined ||
                    HarviaFenix.getApiValue(p, ["temperature", "temp"]) !== undefined)) {
                if (Date.now() - this.lastCommandTime < LATENCY_MS) {
                    this.log.debug(`Polling ignored due to latency protection (${LATENCY_MS}ms). Last command ${Date.now() - this.lastCommandTime}ms ago.`);
                    return;
                }
                // Temperatures
                const currentTemp = HarviaFenix.getApiValue(p, [
                    "temperature",
                    "temp",
                    "current_temperature",
                    "ambient_temperature",
                ]);
                if (currentTemp !== undefined) {
                    const val = typeof currentTemp === "number"
                        ? currentTemp
                        : Number.parseFloat(String(currentTemp));
                    await this.setState("temp", Math.round(val * 10) / 10, true);
                }
                const pPanelTemp = HarviaFenix.getApiValue(p, [
                    "panelTemp",
                    "panelTemperature",
                    "panel_temperature",
                ]);
                if (pPanelTemp !== undefined) {
                    const val = typeof pPanelTemp === "number"
                        ? pPanelTemp
                        : Number.parseFloat(String(pPanelTemp));
                    await this.setState("panelTemp", Math.round(val * 10) / 10, true);
                }
                // Power
                const rawPower = HarviaFenix.getApiValue(p, [
                    "heaterPower",
                    "power",
                    "heater_power",
                ]);
                if (rawPower !== undefined) {
                    const currentPower = Math.round((Number.parseFloat(String(rawPower)) / 1000) * 100) /
                        100;
                    await this.setState("heaterPower", currentPower, true);
                }
                // Stats
                const bathHours = HarviaFenix.getApiValue(p, [
                    "totalBathingHours",
                    "total_bathing_hours",
                    "bathing_hours",
                ]);
                if (bathHours !== undefined) {
                    const val = typeof bathHours === "number"
                        ? bathHours
                        : Number.parseFloat(String(bathHours));
                    await this.setState("totalBathingHours", Math.round(val * 100) / 100, true);
                }
                const sessions = HarviaFenix.getApiValue(p, [
                    "totalSessions",
                    "total_sessions",
                    "sessions",
                ]);
                if (sessions !== undefined) {
                    const val = typeof sessions === "number"
                        ? sessions
                        : Number.parseInt(String(sessions), 10);
                    await this.setState("totalSessions", Math.round(val), true);
                }
                const opHours = HarviaFenix.getApiValue(p, [
                    "totalOperatingHours",
                    "totalHours",
                    "total_hours",
                    "operating_hours",
                ]);
                if (opHours !== undefined) {
                    const val = typeof opHours === "number"
                        ? opHours
                        : Number.parseFloat(String(opHours));
                    await this.setState("totalOperatingHours", Math.round(val * 100) / 100, true);
                }
                const tTemp = HarviaFenix.getApiValue(p, [
                    "targetTemperature",
                    "targetTemp",
                    "target_temperature",
                    "setpoint_temperature",
                ]);
                if (tTemp !== undefined) {
                    const targetValue = typeof tTemp === "number"
                        ? tTemp
                        : Number.parseFloat(String(tTemp));
                    await this.setState("targetTemp", targetValue, true);
                }
                // Boolean States with fallbacks
                const actualHeat = HarviaFenix.getApiValue(p, [
                    "heatOn",
                    "heatState",
                    "heat",
                    "heater",
                    "heat_on",
                    "is_heating",
                ]);
                if (actualHeat !== undefined) {
                    await this.setState("heatOn", HarviaFenix.isTrue(actualHeat), true);
                }
                const actualLight = HarviaFenix.getApiValue(p, [
                    "lightOn",
                    "lightState",
                    "light",
                    "light_on",
                ]);
                if (actualLight !== undefined) {
                    await this.setState("lightOn", HarviaFenix.isTrue(actualLight), true);
                }
                // Remote Control Ready (Fenix priority: onOffTrigger === 21)
                const remoteReady = HarviaFenix.getApiValue(p, [
                    "remoteControl",
                    "remoteReady",
                    "onOffTrigger",
                    "remote_control",
                    "remote_ready",
                    "is_remote_ready",
                    "safetyRelay",
                    "remoteControlState",
                    "remote",
                    "isRemoteReady",
                    "remoteStart",
                    "remoteStartEnabled",
                    "remoteReadyState",
                ]);
                if (remoteReady !== undefined) {
                    await this.setState("remoteControl", HarviaFenix.isTrue(remoteReady), true);
                }
                const doorSafe = HarviaFenix.getApiValue(p, [
                    "doorSafetyState",
                    "doorSafety",
                    "door",
                    "door_closed",
                    "door_safety_state",
                    "door_safety",
                ]);
                if (doorSafe !== undefined) {
                    await this.setState("doorSafety", HarviaFenix.isTrue(doorSafe), true);
                }
                await this.setState("online", true, true);
            }
            else {
                this.log.warn(`Unexpected data structure during status poll: ${JSON.stringify(response.data)}`);
            }
        }
        catch (err) {
            if (axios_1.default.isAxiosError(err)) {
                if (err.response?.status === 401 || err.response?.status === 403) {
                    this.log.info("Token expired or unauthorized, attempting re-login...");
                    void this.login();
                }
                else if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
                    this.log.debug("Cloud connection timeout during status poll, will retry in next interval.");
                }
                else if (err.response?.status === 429) {
                    this.log.warn("Cloud rate limit reached. Slowing down...");
                }
                else {
                    this.log.error(`Status poll failed (${err.response?.status}): ${err.message}. Response Data: ${JSON.stringify(err.response?.data)}`);
                }
            }
            else {
                this.log.error(`Status poll failed: ${err instanceof Error ? err.message : String(err)}`);
            }
            // Avoid flapping: only set to offline if it's currently online
            const currentOnline = await this.getStateAsync("online");
            if (currentOnline?.val !== false) {
                await this.setState("online", false, true);
            }
        }
        finally {
            // Only schedule next poll if adapter is not unloading
            if (!this.isUnloading) {
                const interval = (this.config.pollInterval || 60) * 1000;
                this.updateInterval = this.setTimeout(() => this.updateStatus(), interval);
            }
        }
    }
    async setSaunaState(stateName, value, isRetry = false) {
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
            if (!deviceId) {
                this.log.error(`Cannot send command ${stateName}: No Device ID available. Please check the adapter configuration.`);
                return;
            }
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
                        Authorization: `Bearer ${this.idToken}`,
                        "Content-Type": "application/json",
                        "x-harvia-partner-id": this.partnerId,
                        "x-harvia-app-id": CLIENT_ID,
                    },
                });
                if (resp.data?.handled) {
                    this.log.info(`${commandType} -> ${stateStr}`);
                    // CONFIRMATION: Set ack: true immediately to prevent UI "jumping"
                    await this.setState(stateName, !!value, true);
                    this.lastCommandTime = Date.now();
                    if (stateName === "heatOn") {
                        await this.setState("errorMsg", "", true);
                    }
                }
                else {
                    const reason = resp.data.failureReason || "Unknown";
                    this.log.warn(`Cloud rejected command: ${reason}`);
                    await this.setState("errorMsg", `Cloud error: ${reason}`, true);
                }
            }
            else if (stateName === "targetTemp") {
                const payload = {
                    deviceId,
                    cabin: { id: "C1" },
                    temperature: typeof value === "number"
                        ? value
                        : Number.parseFloat(String(value)),
                };
                const url = `${devicesUrl}/target`;
                await this.client.patch(url, payload, {
                    headers: {
                        Authorization: `Bearer ${this.idToken}`,
                        "Content-Type": "application/json",
                        "x-harvia-partner-id": this.partnerId,
                        "x-harvia-app-id": CLIENT_ID,
                    },
                });
                this.log.info(`Target temperature -> ${value}°C`);
                // Immediate confirmation in ioBroker
                await this.setState("targetTemp", typeof value === "number" ? value : Number.parseFloat(String(value)), true);
                this.lastCommandTime = Date.now();
            }
        }
        catch (err) {
            let detail;
            if (axios_1.default.isAxiosError(err) && err.response?.data) {
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
            if (axios_1.default.isAxiosError(err) &&
                (err.response?.status === 401 || err.response?.status === 403)) {
                this.log.warn("Token expired or unauthorized during control, triggering re-login...");
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
    onUnload = (callback) => {
        try {
            this.isUnloading = true;
            this.updateInterval && this.clearTimeout(this.updateInterval);
            this.loginInterval && this.clearInterval(this.loginInterval);
            callback();
        }
        catch {
            callback();
        }
    };
    // Internal helper function for debouncing ioBroker events (Race Condition protection)
    shouldProcess(id) {
        const now = Date.now();
        if (this.lastEventTime[id] && now - this.lastEventTime[id] < 1500) {
            return false; // Ignore events within 1500ms (VIS bouncing)
        }
        this.lastEventTime[id] = now;
        return true;
    }
    onStateChange = async (id, state) => {
        if (state && !state.ack) {
            const stateId = id.split(".").pop();
            if (!stateId) {
                return;
            }
            if (stateId === "heatOn") {
                if (!this.shouldProcess(id)) {
                    return;
                }
                const val = HarviaFenix.isTrue(state.val);
                const isRemoteReady = HarviaFenix.isTrue((await this.getStateAsync("remoteControl"))?.val);
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
                    val =
                        typeof state.val === "number"
                            ? state.val
                            : Number.parseFloat(String(state.val));
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
                    val = HarviaFenix.isTrue(state.val);
                }
                await this.setSaunaState(stateId, val);
            }
        }
    };
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