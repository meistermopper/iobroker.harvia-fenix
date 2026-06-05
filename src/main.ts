/*
 * Created with @iobroker/create-adapter v3.1.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";
import axios, { type AxiosInstance, isAxiosError } from "axios";

// Harvia API Constants
const CLIENT_ID = "24emhb2mm0v4sscqhbdev86b2v";
const PARTNER_ID = "ORG/prod:0:6656:0";

const MIN_TARGET_TEMP = 40; // Minimum allowed target temperature in C
const MAX_TARGET_TEMP = 110; // Maximum allowed target temperature in C
const LATENCY_MS = 5000;

interface HarviaEndpoints {
	endpoints: {
		RestApi: {
			data: { https: string };
			device: { https: string };
			generics: { https: string };
		};
	};
}

interface HarviaDevice {
	deviceId?: string;
	id?: string;
	name?: string;
	type?: string;
	attr?: Array<{ key: string; value: string }>;
}

interface HarviaStatusData {
	online?: boolean;
	heatOn?: number | boolean | string;
	heatState?: number | boolean | string;
	heat?: number | boolean | string;
	temperature?: string | number;
	temp?: string | number;
	panelTemp?: string | number;
	panelTemperature?: string | number;
	heaterPower?: string | number;
	power?: string | number;
	totalBathingHours?: string | number;
	totalSessions?: string | number;
	totalHours?: string | number;
	targetTemperature?: string | number;
	targetTemp?: string | number;
	lightOn?: number | boolean | string;
	lightState?: number | boolean | string;
	light?: number | boolean | string;
	remoteControlState?: number;
	doorSafetyState?: number;
}

interface HarviaLoginResponse {
	idToken: string;
}

interface HarviaSaunaCommand {
	deviceId: string;
	cabin: { id: string };
	command?: { type: string; state: string };
	temperature?: number;
}

interface HarviaCommandResponse {
	handled: boolean;
	failureReason?: string;
}

class HarviaFenix extends utils.Adapter {
	private client: AxiosInstance;
	private idToken = "";
	private dataBaseUrl = "";
	private deviceBaseUrl = "";
	private authUrl = "";
	private activeDeviceId = "";
	private loginPromise: Promise<boolean> | null = null;

	private isSendingCommand = false;
	private lastCommandTime = 0;
	private updateInterval: ioBroker.Timeout | undefined;
	private loginInterval: ioBroker.Interval | undefined;
	private lastEventTime: Record<string, number> = {}; // For debouncing

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: "harvia-fenix",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		// this.on('objectChange', this.onObjectChange.bind(this));
		// this.on('message', this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));

		this.client = axios.create({
			timeout: 20000,
			headers: {
				"User-Agent": `ioBroker.${this.name}/${this.version}`,
			},
		});
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	private async onReady(): Promise<void> {
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

	private async ensureObjects(): Promise<void> {
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
				role: "value",
				write: false,
				def: 0,
			},
			// In original script it was totalHours, we keep totalOperatingHours
			{
				id: "totalOperatingHours",
				type: "number",
				role: "value",
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
					type: s.type as ioBroker.CommonType,
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

	private async fetchConfig(): Promise<boolean> {
		try {
			const response = await this.client.get<HarviaEndpoints>(
				"https://api.harvia.io/endpoints",
			);
			this.log.debug(`Endpoints Response: ${JSON.stringify(response.data)}`);
			const ep = response.data.endpoints.RestApi;
			this.dataBaseUrl = ep.data.https;
			this.deviceBaseUrl = ep.device.https;
			this.authUrl = `${ep.generics.https}/auth/token`;
			this.log.info(
				`API configuration loaded: Data=${this.dataBaseUrl}, Device=${this.deviceBaseUrl}`,
			);
			return true;
		} catch (err) {
			this.log.error(
				`Error loading API configuration: ${err instanceof Error ? err.message : String(err)}`,
			);
			return false;
		}
	}

	private async login(): Promise<boolean> {
		if (this.loginPromise) {
			return this.loginPromise;
		}

		this.loginPromise = this.performLogin();
		try {
			return await this.loginPromise;
		} finally {
			this.loginPromise = null;
		}
	}

	private async performLogin(): Promise<boolean> {
		try {
			if (!this.authUrl && !(await this.fetchConfig())) {
				return false;
			}

			const response = await this.client.post<HarviaLoginResponse>(
				this.authUrl,
				{
					username: this.config.username,
					password: this.config.password,
					client_id: CLIENT_ID,
				},
			);
			this.idToken = response.data.idToken; // JWT-Token
			await this.setState("info.connection", true, true);
			return true;
		} catch (err) {
			this.log.error(
				`Login failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			await this.setState("info.connection", false, true);
			return false;
		}
	}

	private async startCloudConnection(): Promise<void> {
		if (await this.login()) {
			await this.discoverDevices();
			void this.updateStatus(); // Start first poll
			this.loginInterval = this.setInterval(
				() => void this.login(),
				50 * 60 * 1000,
			);
		} else {
			this.log.warn("Initial login failed. Retrying in 5 minutes...");
			this.updateInterval = this.setTimeout(
				() => this.startCloudConnection(),
				5 * 60 * 1000,
			);
		}
	}

	private async discoverDevices(): Promise<void> {
		try {
			if (!this.idToken || !this.deviceBaseUrl) {
				return;
			}

			const baseUrl = this.deviceBaseUrl.replace(/\/$/, "");
			// Try to retrieve the list of devices
			const url = baseUrl.endsWith("/devices") ? baseUrl : `${baseUrl}/devices`;

			this.log.info(`Searching for devices at: ${url}`);

			const response = await this.client.get<{ devices: HarviaDevice[] }>(url, {
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
					this.log.info(
						`Found device: ${d.name} (ID: ${actualId}, Type: ${d.type ?? "Fenix"})`,
					);

					// Use the configured ID if available, otherwise fall back to discovered ID
					if (!this.activeDeviceId && !this.config.deviceId && actualId) {
						this.log.warn(
							`Device ID not set in adapter configuration. Using found ID: ${actualId}`,
						);
						this.activeDeviceId = actualId;
					} else if (
						this.config.deviceId &&
						this.config.deviceId !== actualId
					) {
						this.log.info(
							`Configured Device ID (${this.config.deviceId}) does not match found ID (${actualId}). Please check settings.`,
						);
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
									await this.setState(
										"totalSessions",
										Math.round(Number.parseInt(a.value, 10)),
										true,
									);
									break;
								case "stats.totalBathingHours.C1": // In script it was totalBathingHours
									await this.setState(
										"totalBathingHours",
										Math.round(Number.parseFloat(a.value) * 100) / 100,
										true,
									);
									break;
								case "stats.totalOperatingHours.C1":
									await this.setState(
										"totalOperatingHours",
										Math.round(Number.parseFloat(a.value) * 100) / 100,
										true,
									);
									break;
								case "BT_MAC":
									this.log.debug(`Bluetooth MAC: ${a.value}`);
									break;
							}
						}
					}
				}
			} else {
				this.log.warn(
					"Login successful, but no devices found in Harvia account.",
				);
			}
		} catch (err) {
			this.log.error(
				`Error during device discovery: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	private async updateStatus(): Promise<void> {
		try {
			if (!this.idToken || !this.dataBaseUrl) {
				return;
			}

			const url = `${this.dataBaseUrl.replace(/\/$/, "")}/data/latest-data`; // Path from JS-script

			const deviceId = this.activeDeviceId || this.config.deviceId;
			this.log.debug(`Poll Status: ${url} (ID: ${deviceId})`);

			const response = await this.client.get<
				{ data?: HarviaStatusData } | HarviaStatusData
			>(url, {
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
			let p: HarviaStatusData | undefined;

			if (responseData && "data" in responseData && responseData.data) {
				p = responseData.data;
			} else if (
				responseData &&
				typeof responseData === "object" &&
				!("data" in responseData)
			) {
				p = responseData as HarviaStatusData;
			}

			if (p) {
				// LATENCY PROTECTION: If a command was sent less than LATENCY_MS ago,
				// ignore this update to prevent UI jumping.
				if (Date.now() - this.lastCommandTime < LATENCY_MS) {
					this.log.debug(
						`Polling ignored due to latency protection (${LATENCY_MS}ms). Last command ${Date.now() - this.lastCommandTime}ms ago.`,
					);
					return;
				}

				// NEW DEBUG LOGGING FOR HEATON
				if (p.online && p.heatOn !== undefined) {
					const actualHeat = p.heatState ?? p.heat;
					const currentHeatOnState = (await this.getStateAsync("heatOn"))?.val;
					const isHeatingExpected =
						actualHeat === 1 || actualHeat === true || actualHeat === "on";

					if (isHeatingExpected && !currentHeatOnState) {
						this.log.warn(
							`Expected heatOn=true, but ioBroker state is false. Raw data: ${JSON.stringify(p.heatOn)}`,
						);
					} else if (actualHeat === undefined) {
						this.log.debug(
							`Heat status undefined in API response, but device is online. Raw data: ${JSON.stringify(p)}`,
						);
					}
				}

				// NORMALIZATION: Harvia uses 'temp' or 'temperature' depending on model.
				const currentTemp = p.temperature ?? p.temp;
				if (currentTemp !== undefined) {
					await this.setState(
						"temp",
						Math.round(Number.parseFloat(currentTemp as string) * 10) / 10,
						true,
					);
				}

				const pPanelTemp = p.panelTemp ?? p.panelTemperature;
				if (pPanelTemp !== undefined) {
					await this.setState(
						"panelTemp",
						Math.round(Number.parseFloat(pPanelTemp as string) * 10) / 10,
						true,
					);
				}

				// Normalization of heater power (heaterPower vs power)
				let currentPower = p.heaterPower ?? p.power;
				if (currentPower !== undefined) {
					currentPower =
						Math.round(
							(Number.parseFloat(currentPower as string) / 1000) * 100,
						) / 100;
					await this.setState("heaterPower", currentPower, true);
				}

				if (p.totalBathingHours !== undefined) {
					await this.setState(
						"totalBathingHours",
						Math.round(Number.parseFloat(p.totalBathingHours as string) * 100) /
							100,
						true,
					);
				}
				if (p.totalSessions !== undefined) {
					await this.setState(
						"totalSessions",
						Math.round(Number.parseInt(p.totalSessions as string, 10)),
						true,
					);
				}
				if (p.totalHours !== undefined) {
					await this.setState(
						"totalOperatingHours",
						Math.round(Number.parseFloat(p.totalHours as string) * 100) / 100,
						true,
					);
				}

				const tTemp = p.targetTemperature ?? p.targetTemp;
				if (tTemp !== undefined) {
					await this.setState(
						"targetTemp",
						typeof tTemp === "string" ? Number.parseFloat(tTemp) : tTemp,
						true,
					);
				}

				// STATUS-FIX (Light/Heating): Robust check of state fields and base fields.
				// Some cloud versions omit fields on 'off' or use alternative names.
				const actualHeat = p.heatOn ?? p.heatState ?? p.heat;
				const actualLight = p.lightOn ?? p.lightState ?? p.light;

				// Conversion of 0/1 or "on"/"off" to boolean for ioBroker
				if (actualHeat !== undefined && actualHeat !== null) {
					await this.setState(
						"heatOn",
						actualHeat === 1 || actualHeat === true || actualHeat === "on",
						true,
					);
				}

				if (actualLight !== undefined && actualLight !== null) {
					await this.setState(
						"lightOn",
						actualLight === 1 || actualLight === true || actualLight === "on",
						true,
					);
				}

				// Remote control readiness (safety chain acknowledged on panel?)
				if (p.remoteControlState !== undefined) {
					await this.setState(
						"remoteControl",
						p.remoteControlState === 1,
						true,
					);
				}

				await this.setState("doorSafety", p.doorSafetyState === 1, true); // 1 = Safe/Closed
				await this.setState("online", true, true);
			} else {
				this.log.warn(
					`Unexpected data structure during status poll: ${JSON.stringify(response.data)}`,
				);
			}
		} catch (err: unknown) {
			if (isAxiosError(err)) {
				if (err.response?.status === 401) {
					void this.login();
				} else {
					this.log.error(
						`Status poll failed (${err.response?.status}): ${err.message}. Response Data: ${JSON.stringify(err.response?.data)}`,
					);
				}
			} else {
				this.log.error(
					`Status poll failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			// Avoid flapping: only set to offline if it's currently online
			const currentOnline = await this.getStateAsync("online");
			if (currentOnline?.val !== false) {
				await this.setState("online", false, true);
			}
		} finally {
			const interval = (this.config.pollInterval || 60) * 1000;
			this.updateInterval = this.setTimeout(
				() => this.updateStatus(),
				interval,
			);
		}
	}

	private async setSaunaState(
		stateName: string,
		value: string | number | boolean | null,
		isRetry = false,
	): Promise<void> {
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
				const payload: HarviaSaunaCommand = {
					deviceId,
					cabin: { id: "C1" },
					command: { type: commandType, state: stateStr },
				};

				const url = `${devicesUrl}/command`;

				const resp = await this.client.post<HarviaCommandResponse>(
					url,
					payload,
					{
						// Headers from JS-script and successful calls
						headers: {
							Authorization: `Bearer ${this.idToken.trim()}`, // .trim() from original JS-script
							"Content-Type": "application/json",
							"x-harvia-partner-id": PARTNER_ID,
							"x-harvia-app-id": CLIENT_ID,
						},
					},
				);

				if (resp.data?.handled) {
					this.log.info(`${commandType} -> ${stateStr}`);
					// CONFIRMATION: Set ack: true immediately to prevent UI "jumping"
					await this.setState(stateName, !!value, true);
					this.lastCommandTime = Date.now();

					if (stateName === "heatOn") {
						await this.setState("errorMsg", "", true);
					}
				} else {
					const reason = resp.data ? resp.data.failureReason : "Unknown";
					this.log.warn(`Cloud rejected command: ${reason}`);
					await this.setState("errorMsg", `Cloud error: ${reason}`, true);
				}
			} else if (stateName === "targetTemp") {
				const payload: HarviaSaunaCommand = {
					deviceId,
					cabin: { id: "C1" },
					temperature: Number.parseFloat(value as string),
				};
				const url = `${devicesUrl}/target`;

				await this.client.patch<HarviaCommandResponse>(url, payload, {
					headers: {
						Authorization: `Bearer ${this.idToken.trim()}`,
						"Content-Type": "application/json",
						"x-harvia-partner-id": PARTNER_ID,
						"x-harvia-app-id": CLIENT_ID,
					},
				});
				this.log.info(`Target temperature -> ${value}°C`);
				// Immediate confirmation in ioBroker
				await this.setState(
					"targetTemp",
					Number.parseFloat(value as string),
					true,
				);
				this.lastCommandTime = Date.now();
			}
		} catch (err: unknown) {
			let detail: string;
			if (isAxiosError(err) && err.response?.data) {
				detail = JSON.stringify(err.response.data);
			} else if (err instanceof Error) {
				detail = err.message;
			} else {
				detail = String(err);
			}

			// "Device unavailable" is a cloud lock effect during rapid clicking.
			// Log as debug to keep the info log clean.
			if (detail.includes("Device unavailable")) {
				this.log.debug("Cloud lock: Device busy, command discarded.");
			} else {
				this.log.error(`Control error: ${detail}`);
				const msg = err instanceof Error ? err.message : String(err);
				await this.setState("errorMsg", `Error: ${msg}`, true);
			}

			// RE-LOGIN LOGIC: If token became invalid during runtime
			// Automatic re-login on expired token (HTTP 401)
			if (isAxiosError(err) && err.response?.status === 401) {
				this.log.warn("Token expired during control, triggering re-login...");
				this.isSendingCommand = false; // Briefly release lock for login
				if (await this.login()) {
					// Repeat command once after successful login
					await this.setSaunaState(stateName, value, true);
				}
			}
		} finally {
			this.isSendingCommand = false;
		}
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 *
	 * @param callback - Callback to be called after shutdown logic
	 */
	private onUnload(callback: () => void): void {
		try {
			if (this.updateInterval) {
				this.clearTimeout(this.updateInterval);
			}
			if (this.loginInterval) {
				this.clearInterval(this.loginInterval);
			}
			callback();
		} catch {
			callback();
		}
	}

	// Internal helper function for debouncing ioBroker events (Race Condition protection)
	private shouldProcess(id: string): boolean {
		const now = Date.now();
		if (this.lastEventTime[id] && now - this.lastEventTime[id] < 1500) {
			return false; // Ignore events within 1500ms (VIS bouncing)
		}
		this.lastEventTime[id] = now;
		return true;
	}

	private async onStateChange(
		id: string,
		state: ioBroker.State | null | undefined,
	): Promise<void> {
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
				const val =
					state.val === true || state.val === "true" || state.val === 1;

				const isRemoteReady = (await this.getStateAsync("remoteControl"))?.val;
				if (val && !isRemoteReady) {
					this.log.warn("Remote start not ready!");
					await this.setState("heatOn", false, true);
					await this.setState(
						"errorMsg",
						"Remote start not ready at panel!",
						true,
					);
				} else {
					await this.setSaunaState("heatOn", val);
				}
			} else if (stateId === "lightOn" || stateId === "targetTemp") {
				if (!this.shouldProcess(id)) {
					return;
				}
				// Ensure type conversion
				let val: string | number | boolean | null = state.val;
				if (stateId === "targetTemp") {
					val = Number.parseFloat(state.val as string);
					if (
						Number.isNaN(val) ||
						(val as number) < MIN_TARGET_TEMP ||
						(val as number) > MAX_TARGET_TEMP
					) {
						this.log.warn(
							`Invalid target temperature (${state.val}°C) received. Allowed range: ${MIN_TARGET_TEMP}-${MAX_TARGET_TEMP}°C. Resetting to default (${MAX_TARGET_TEMP}°C).`,
						);
						await this.setState("targetTemp", MAX_TARGET_TEMP, true); // Reset to default or max
						await this.setState(
							"errorMsg",
							`Invalid target temperature: ${state.val}°C`,
							true,
						);
						return;
					}
				} else {
					val = state.val === true || state.val === "true" || state.val === 1;
				}
				await this.setSaunaState(stateId, val);
			}
		}
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) =>
		new HarviaFenix(options);
} else {
	// otherwise start the instance directly
	(() => new HarviaFenix())();
}
