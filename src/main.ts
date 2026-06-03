/*
 * Created with @iobroker/create-adapter v3.1.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from '@iobroker/adapter-core';
import axios, { AxiosInstance } from 'axios';

// Harvia API Konstanten
const CLIENT_ID = '24emhb2mm0v4sscqhbdev86b2v';
const PARTNER_ID = 'ORG/prod:0:6656:0';
const LATENCY_MS = 5000;

class HarviaFenix extends utils.Adapter {
	private client: AxiosInstance;
	private idToken: string = '';
	private dataBaseUrl: string = '';
	private deviceBaseUrl: string = '';
	private authUrl: string = '';

	private isLoggingIn: boolean = false;
	private isSendingCommand: boolean = false;
	private lastCommandTime: number = 0;
	private updateInterval: ioBroker.Timeout | undefined;
	private loginInterval: ioBroker.Interval | undefined;

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: 'harvia-fenix',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		// this.on('objectChange', this.onObjectChange.bind(this));
		// this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));

		this.client = axios.create({
			timeout: 20000,
			headers: {
				'User-Agent': 'ioBroker.harvia-fenix/0.0.1'
			}
		});
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	private async onReady(): Promise<void> {
		// Reset status states
		await this.setState('info.connection', false, true);

		// Create necessary state objects
		await this.ensureObjects();

		// Subscribe to writable states
		this.subscribeStates('heatOn');
		this.subscribeStates('lightOn');
		this.subscribeStates('targetTemp');

		// Start connection logic
		await this.startCloudConnection();
	}

	private async ensureObjects(): Promise<void> {
		const states = [
			{ id: 'online', type: 'boolean', role: 'indicator.reachable', def: false },
			{ id: 'heatOn', type: 'boolean', role: 'switch.power', def: false },
			{ id: 'lightOn', type: 'boolean', role: 'switch.light', def: false },
			{ id: 'temp', type: 'number', role: 'value.temperature', unit: '°C', def: 0 },
			{ id: 'targetTemp', type: 'number', role: 'level.temperature', unit: '°C', def: 90 },
			{ id: 'heaterPower', type: 'number', role: 'value.power', unit: 'W', def: 0 },
			{ id: 'doorSafety', type: 'boolean', role: 'indicator.safety', def: false },
			{ id: 'remoteControl', type: 'boolean', role: 'indicator.state', def: false },
			{ id: 'errorMsg', type: 'string', role: 'text', def: '' },
			{ id: 'panelTemp', type: 'number', role: 'value.temperature', unit: '°C', def: 0 },
			{ id: 'totalSessions', type: 'number', role: 'value', def: 0 },
			{ id: 'totalOperatingHours', type: 'number', role: 'value', unit: 'h', def: 0 }
		];

		for (const s of states) {
			await this.setObjectNotExistsAsync(s.id, {
				type: 'state',
				common: { name: s.id, type: s.type as any, role: s.role, unit: s.unit, read: true, write: true },
				native: {},
			});
		}
	}

	private async fetchConfig(): Promise<boolean> {
		try {
			const response = await this.client.get('https://api.harvia.io/endpoints');
			this.log.debug(`Endpoints Response: ${JSON.stringify(response.data)}`);
			const ep = response.data.endpoints.RestApi;
			this.dataBaseUrl = ep.data.https;
			this.deviceBaseUrl = ep.device.https;
			this.authUrl = `${ep.generics.https}/auth/token`;
			this.log.info(`API Konfiguration geladen: Data=${this.dataBaseUrl}, Device=${this.deviceBaseUrl}`);
			return true;
		} catch (err: any) {
			this.log.error(`Fehler beim Laden der API-Konfiguration: ${err.message}`);
			return false;
		}
	}

	private async login(): Promise<boolean> {
		if (this.isLoggingIn) return false;
		this.isLoggingIn = true;

		try {
			if (!this.authUrl && !(await this.fetchConfig())) return false;

			const response = await this.client.post(this.authUrl, {
				username: this.config.username,
				password: this.config.password,
				client_id: CLIENT_ID
			});
			this.idToken = response.data.idToken;
			await this.setState('info.connection', true, true);
			return true;
		} catch (err: any) {
			this.log.error(`Login fehlgeschlagen: ${err.message}`);
			return false;
		} finally {
			this.isLoggingIn = false;
		}
	}

	private async startCloudConnection(): Promise<void> {
		if (await this.login()) {
			await this.discoverDevices();
			this.updateStatus();
			this.loginInterval = this.setInterval(() => this.login(), 50 * 60 * 1000);
		} else {
			this.log.warn('Erster Login fehlgeschlagen. Versuche es in 5 Minuten erneut...');
			this.updateInterval = this.setTimeout(() => this.startCloudConnection(), 5 * 60 * 1000);
		}
	}

	private async discoverDevices(): Promise<void> {
		try {
			if (!this.idToken || !this.deviceBaseUrl) return;

			const baseUrl = this.deviceBaseUrl.replace(/\/$/, '');
			// Wir versuchen die Liste der Geräte abzurufen
			const url = baseUrl.endsWith('/devices') ? baseUrl : `${baseUrl}/devices`;

			this.log.info(`Suche nach Geräten unter: ${url}`);

			const response = await this.client.get(url, {
				headers: {
					'Authorization': `Bearer ${this.idToken}`,
					'x-harvia-partner-id': PARTNER_ID
				}
			});

			const devices = response.data?.devices || [];
			if (devices.length > 0) {
				this.log.info(`Harvia Cloud: ${devices.length} Gerät(e) gefunden.`);
				for (const d of devices) {
					const actualId = d.deviceId || d.id || d.name;
					this.log.info(`Verarbeite Gerät: ${d.name} (Typ: ${d.type || 'Fenix'})`);

					// Statische Attribute direkt beim Start auslesen
					if (Array.isArray(d.attr)) {
						for (const a of d.attr) {
							switch (a.key) {
								case 'connected':
									await this.setState('online', a.value === 'true', true);
									break;
								case 'stats.totalSessions.C1':
									await this.setState('totalSessions', parseInt(a.value), true);
									break;
								case 'stats.totalOperatingHours.C1':
									await this.setState('totalOperatingHours', parseFloat(a.value), true);
									break;
								case 'BT_MAC':
									this.log.debug(`Bluetooth MAC: ${a.value}`);
									break;
							}
						}
					}
				}
			} else {
				this.log.warn('Login erfolgreich, aber keine Geräte im Harvia-Account gefunden.');
			}
		} catch (err: any) {
			this.log.error(`Fehler bei der Gerätesuche: ${err.message}`);
		}
	}

	private async updateStatus(): Promise<void> {
		try {
			if (!this.idToken || !this.dataBaseUrl) return;

			const baseUrl = this.dataBaseUrl.replace(/\/$/, '');
			// Wir nutzen /latest-data, da /data/latest-data einen 404 lieferte.
			const url = `${baseUrl}/latest-data`;

			this.log.debug(`Poll Status: ${url} (ID: ${this.config.deviceId})`);

			const response = await this.client.get(url, {
				params: { deviceId: this.config.deviceId },
				headers: {
					'Authorization': `Bearer ${this.idToken}`,
					'x-harvia-partner-id': PARTNER_ID,
					'Accept': 'application/json',
					'x-harvia-app-id': CLIENT_ID
				}
			});

			this.log.debug(`Poll Response: ${JSON.stringify(response.data)}`);

			const p = response.data?.data;
			if (p && (Date.now() - this.lastCommandTime > LATENCY_MS)) {
				const currentTemp = p.temperature !== undefined ? p.temperature : p.temp;
				if (currentTemp !== undefined) await this.setState('temp', parseFloat(currentTemp), true);

				const actualHeat = p.heatState !== undefined ? p.heatState : p.heat;
				await this.setState('heatOn', !!(actualHeat === 1 || actualHeat === true || actualHeat === 'on'), true);

				const actualLight = p.lightState !== undefined ? p.lightState : p.light;
				await this.setState('lightOn', !!(actualLight === 1 || actualLight === true || actualLight === 'on'), true);

				if (p.targetTemperature !== undefined) await this.setState('targetTemp', parseFloat(p.targetTemperature), true);

				await this.setState('doorSafety', p.doorSafetyState === 1, true);
				await this.setState('remoteControl', p.remoteControlState === 1, true);
				await this.setState('online', true, true);

				if (p.heaterPower !== undefined) await this.setState('heaterPower', parseFloat(p.heaterPower), true);
				if (p.panelTemperature !== undefined) await this.setState('panelTemp', parseFloat(p.panelTemperature), true);
				if (p.totalSessions !== undefined) await this.setState('totalSessions', parseInt(p.totalSessions), true);
				if (p.totalOperatingHours !== undefined) await this.setState('totalOperatingHours', parseFloat(p.totalOperatingHours), true);
			}
		} catch (err: any) {
			if (err.response?.status === 401) {
				this.login();
			} else {
				this.log.debug(`Status-Abruf fehlgeschlagen (${err.response?.status}): ${err.message}`);
				await this.setState('online', false, true);
			}
		} finally {
			this.updateInterval = this.setTimeout(() => this.updateStatus(), 60 * 1000);
		}
	}

	private async setSaunaState(stateName: string, value: any): Promise<void> {
		if (!this.idToken || !this.deviceBaseUrl) return;
		if (this.isSendingCommand) return;

		const baseUrl = this.deviceBaseUrl.replace(/\/$/, '');
		const devicesUrl = baseUrl.endsWith('/devices') ? baseUrl : `${baseUrl}/devices`;

		this.isSendingCommand = true;
		try {
			if (stateName === 'heatOn' || stateName === 'lightOn') {
				const commandType = stateName === 'heatOn' ? 'SAUNA' : 'LIGHTS';
				const stateStr = value ? 'on' : 'off';
				const payload = { deviceId: this.config.deviceId, cabin: { id: 'C1' }, command: { type: commandType, state: stateStr } };

				const url = `${devicesUrl}/command`;

				const resp = await this.client.post(url, payload, {
					headers: {
						'Authorization': `Bearer ${this.idToken}`,
						'Content-Type': 'application/json',
						'x-harvia-partner-id': PARTNER_ID,
						'x-harvia-app-id': CLIENT_ID
					}
				});

				if (resp.data?.handled) {
					this.log.info(`${commandType} -> ${stateStr}`);
					await this.setState(stateName, !!value, true);
					this.lastCommandTime = Date.now();
				}
			} else if (stateName === 'targetTemp') {
				const payload = { deviceId: this.config.deviceId, cabin: { id: 'C1' }, temperature: parseFloat(value) };
				const url = `${devicesUrl}/target`;

				await this.client.patch(url, payload, {
					headers: {
						'Authorization': `Bearer ${this.idToken}`,
						'Content-Type': 'application/json',
						'x-harvia-partner-id': PARTNER_ID,
						'x-harvia-app-id': CLIENT_ID
					}
				});
				await this.setState('targetTemp', parseFloat(value), true);
				this.lastCommandTime = Date.now();
			}
		} catch (err: any) {
			this.log.error(`Steuerungsfehler: ${err.message}`);
		} finally {
			this.isSendingCommand = false;
		}
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 */
	private onUnload(callback: () => void): void {
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
	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		if (state && !state.ack) {
			const stateId = id.split('.').pop();

			if (stateId === 'heatOn') {
				const isRemoteReady = (await this.getStateAsync('remoteControl'))?.val;
				if (state.val && !isRemoteReady) {
					this.log.warn('Fernstart nicht bereit!');
					await this.setState('heatOn', false, true);
					await this.setState('errorMsg', 'Fernstart am Panel nicht bereit!', true);
				} else {
					await this.setSaunaState('heatOn', state.val);
				}
			} else if (stateId === 'lightOn' || stateId === 'targetTemp') {
				await this.setSaunaState(stateId, state.val);
			}
		}
	}
}
if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new HarviaFenix(options);
} else {
	// otherwise start the instance directly
	(() => new HarviaFenix())();
}
