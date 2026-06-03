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

		// 2. CLEAN START: Alle Status-Werte beim Start auf 'false' setzen
		await this.setState('online', false, true);
		await this.setState('heatOn', false, true);
		await this.setState('lightOn', false, true);
		await this.setState('doorSafety', false, true);
		await this.setState('remoteControl', false, true);
		await this.setState('errorMsg', '', true);

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
			{ id: 'totalBathingHours', type: 'number', role: 'value.number', unit: 'h', def: 0 },
			{ id: 'totalSessions', type: 'number', role: 'value', def: 0 },
			// Im Skript war es totalHours, wir behalten totalOperatingHours
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
		// RACE-CONDITION-SCHUTZ:
		// Falls gerade ein Login-Prozess läuft, warten wir bis zu 5 Sekunden, ob er fertig wird.
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
			if (!this.authUrl && !(await this.fetchConfig())) return false;

			const response = await this.client.post(this.authUrl, {
				username: this.config.username,
				password: this.config.password,
				client_id: CLIENT_ID
			});
			this.idToken = response.data.idToken; // JWT-Token
			await this.setState('info.connection', true, true);
			return true;
		} catch (err: any) {
			this.log.error(`Login fehlgeschlagen: ${err.message}`);
			await this.setState('info.connection', false, true);
			return false;
		} finally {
			this.isLoggingIn = false;
		}
	}

	private async startCloudConnection(): Promise<void> {
		if (await this.login()) {
			await this.discoverDevices();
			this.updateStatus(); // Ersten Poll starten
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
					this.log.info(`Gerät gefunden: ${d.name} (ID: ${actualId}, Typ: ${d.type || 'Fenix'})`);

					// Wenn die konfigurierte Device-ID nicht gesetzt ist, verwenden wir die erste gefundene
					if (!this.config.deviceId && actualId) {
						this.log.warn(`Device ID in Adapter-Konfiguration nicht gesetzt. Verwende gefundene ID: ${actualId}`);
						// Hier könnten wir die Konfiguration aktualisieren, aber das ist komplexer
						// und erfordert einen Adapter-Neustart. Besser ist es, den Benutzer zu informieren.
						// Für den aktuellen Lauf verwenden wir die gefundene ID.
						this.config.deviceId = actualId;
					} else if (this.config.deviceId !== actualId) {
						this.log.warn(`Konfigurierte Device ID (${this.config.deviceId}) stimmt nicht mit gefundener ID (${actualId}) überein. Bitte prüfen Sie die Einstellungen.`);
					}

					// Statische Attribute direkt beim Start auslesen
					if (Array.isArray(d.attr)) {
						for (const a of d.attr) {
							// Sicherstellen, dass der Wert existiert, bevor wir ihn parsen
							if (a.value === undefined || a.value === null) {
								continue;
							}

							switch (a.key) {
								case 'connected':
									await this.setState('online', a.value === 'true', true);
									break;
								case 'stats.totalSessions.C1':
									await this.setState('totalSessions', parseInt(a.value), true);
									break;
								case 'stats.totalBathingHours.C1': // Im Skript war es totalBathingHours
									await this.setState('totalBathingHours', parseFloat(a.value), true);
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

			const url = `${this.dataBaseUrl.replace(/\/$/, '')}/data/latest-data`; // Der Pfad aus dem JS-Skript

			this.log.debug(`Poll Status: ${url} (ID: ${this.config.deviceId})`);

			const response = await this.client.get(url, {
				params: { deviceId: this.config.deviceId },
				headers: {
					// Header aus dem JS-Skript und den erfolgreichen Aufrufen
					'Accept': 'application/json',
					'x-harvia-app-id': CLIENT_ID,
					'x-harvia-partner-id': PARTNER_ID,
					'Authorization': `Bearer ${this.idToken}`,
				}
			});

			if (response.data) {
				this.log.debug(`Poll Response: ${JSON.stringify(response.data)}`);
			}

			const p = response.data?.data || response.data; // Daten können direkt oder in .data liegen

			if (p && typeof p === 'object') {
				// LATENZ-SCHUTZ: Wenn wir vor weniger als LATENCY_MS einen Befehl gesendet haben,
				// ignorieren wir dieses Update, um UI-Springen zu verhindern.
				if (Date.now() - this.lastCommandTime < LATENCY_MS) {
					this.log.debug(`Polling ignoriert wegen Latency-Schutz (${LATENCY_MS}ms). Letzter Befehl vor ${Date.now() - this.lastCommandTime}ms.`);
					return;
				}

				// DEBUG-LOG: Einmalig aktivieren, um alle verfügbaren API-Felder im Log zu sehen
				// if (p.heatState === 1 || p.heat === 'on') {
				//     this.log.debug(`[Harvia] API Rohdaten bei Heizung AN: ${JSON.stringify(p)}`);
				// }

				// --&gt; NEUES DEBUG-LOGGING FÜR HEATON &lt;--
				if (p.online) {
					const actualHeat = p.heatState !== undefined ? p.heatState : p.heat;
					const currentHeatOnState = (await this.getStateAsync('heatOn'))?.val;
					const isHeatingExpected = (actualHeat === 1 || actualHeat === true || actualHeat === 'on');

					if (isHeatingExpected && !currentHeatOnState) {
						this.log.warn(`Erwartet heatOn=true, aber ioBroker-Status ist false. Rohdaten: ${JSON.stringify(p)}`);
					} else if (actualHeat === undefined) {
						this.log.warn(`Heat-Status in API-Antwort undefiniert, aber online. Rohdaten: ${JSON.stringify(p)}`);
					}
				}

				// NORMALISIERUNG: Harvia nutzt je nach Modell 'temp' oder 'temperature'.
				const currentTemp = p.temperature !== undefined ? p.temperature : p.temp;
				if (currentTemp !== undefined) await this.setState('temp', parseFloat(currentTemp), true);

				const pPanelTemp = p.panelTemp !== undefined ? p.panelTemp : p.panelTemperature;
				if (pPanelTemp !== undefined) await this.setState('panelTemp', parseFloat(pPanelTemp), true);

				// Normalisierung der Heizleistung (heaterPower vs power)
				const currentPower = p.heaterPower !== undefined ? p.heaterPower : p.power;
				if (currentPower !== undefined) await this.setState('heaterPower', parseFloat(currentPower), true);

				if (p.totalBathingHours !== undefined) await this.setState('totalBathingHours', parseFloat(p.totalBathingHours), true);
				if (p.totalSessions !== undefined) await this.setState('totalSessions', parseInt(p.totalSessions), true);
				if (p.totalHours !== undefined) await this.setState('totalOperatingHours', parseFloat(p.totalHours), true);

				const tTemp = p.targetTemperature !== undefined ? p.targetTemperature : p.targetTemp;
				if (tTemp !== undefined) await this.setState('targetTemp', parseFloat(tTemp), true);

				// STATUS-FIX (Licht/Heizung): Robuste Abfrage durch Prüfung von State-Feldern und Basis-Feldern.
				// Manche Cloud-Versionen lassen Felder bei 'off' komplett weg oder nutzen alternative Namen.
				const actualHeat = p.heatOn !== undefined ? p.heatOn : (p.heatState !== undefined ? p.heatState : p.heat);
				const actualLight = p.lightOn !== undefined ? p.lightOn : (p.lightState !== undefined ? p.lightState : p.light);

				// Umrechnung von 0/1 oder "on"/"off" in echtes Boolean für ioBroker
				if (actualHeat !== undefined && actualHeat !== null) {
					await this.setState('heatOn', !!(actualHeat === 1 || actualHeat === true || actualHeat === 'on'), true);
				}

				if (actualLight !== undefined && actualLight !== null) {
					await this.setState('lightOn', !!(actualLight === 1 || actualLight === true || actualLight === 'on'), true);
				}

				// Fernstart-Bereitschaft (Wurde die Sicherheitskette am Panel quittiert?)
				if (p.remoteControlState !== undefined) {
					await this.setState('remoteControl', p.remoteControlState === 1, true);
				}

				await this.setState('doorSafety', p.doorSafetyState === 1, true); // 1 = Sicher/Zu
				await this.setState('online', true, true);
			} else if (!p || typeof p !== 'object') {
				this.log.warn(`Unerwartete Datenstruktur beim Status-Abruf: ${JSON.stringify(response.data)}`);
			}
		} catch (err: any) {
			if (err.response?.status === 401) {
				this.login();
			} else {
				this.log.error(`Status-Abruf fehlgeschlagen (${err.response?.status}): ${err.message}. Response Data: ${JSON.stringify(err.response?.data)}`);
				await this.setState('online', false, true);
			}
		} finally {
			this.updateInterval = this.setTimeout(() => this.updateStatus(), 60 * 1000);
		}
	}

	private async setSaunaState(stateName: string, value: any, isRetry: boolean = false): Promise<void> {
		if (!this.idToken || !this.deviceBaseUrl) return;
		// Lock-Check: Nur blockieren, wenn es kein interner Retry ist
		if (this.isSendingCommand && !isRetry) return;
		// RACE-CONDITION-SCHUTZ:
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
					// Header aus dem JS-Skript und den erfolgreichen Aufrufen
					headers: {
						'Authorization': `Bearer ${this.idToken.trim()}`, // .trim() aus JS-Skript
						'Content-Type': 'application/json',
						'x-harvia-partner-id': PARTNER_ID,
						'x-harvia-app-id': CLIENT_ID
					}
				});

				if (resp.data && resp.data.handled) {
					this.log.info(`${commandType} -> ${stateStr}`);
					// BESTÄTIGUNG: Wir setzen ack: true sofort, damit die UI nicht "springt"
					await this.setState(stateName, !!value, true);
					this.lastCommandTime = Date.now();

					if (stateName === 'heatOn') await this.setState('errorMsg', '', true);
				} else {
					const reason = resp.data ? resp.data.failureReason : 'Unbekannt';
					this.log.warn(`Cloud lehnt Befehl ab: ${reason}`);
					await this.setState('errorMsg', `Cloud-Fehler: ${reason}`, true);
				}
			} else if (stateName === 'targetTemp') {
				const payload = {
					deviceId: this.config.deviceId,
					cabin: { id: 'C1' },
					temperature: parseFloat(value) // Muss zwingend eine Zahl sein
				};
				const url = `${devicesUrl}/target`;

				await this.client.patch(url, payload, {
					headers: {
						'Authorization': `Bearer ${this.idToken.trim()}`, // .trim() aus JS-Skript
						'Content-Type': 'application/json',
						'x-harvia-partner-id': PARTNER_ID,
						'x-harvia-app-id': CLIENT_ID
					}
				});
				this.log.info(`Temp-Soll -> ${value}°C`);
				// Sofortige Bestätigung im ioBroker
				await this.setState('targetTemp', parseFloat(value), true);
				this.lastCommandTime = Date.now();
			}
		} catch (err: any) {
			const detail = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;

			// "Device unavailable" ist ein Cloud-Sperr-Effekt bei schnellen Klicks.
			// Wir loggen das nur noch als Debug, um das Info-Log sauber zu halten.
			if (detail.includes('Device unavailable')) {
				this.log.debug(`Cloud-Sperre: Gerät belegt, Befehl wird verworfen.`);
			} else {
				this.log.error(`Fehler bei der Steuerung: ${detail}`);
				await this.setState('errorMsg', `Fehler: ${err.message}`, true);
			}

			// RE-LOGIN LOGIK: Falls der Token während der Laufzeit ungültig wurde
			// Automatischer Re-Login bei abgelaufenem Token (HTTP 401)
			if (err.response && err.response.status === 401) {
				this.log.warn('Token abgelaufen bei Steuerung, löse Re-Login aus...');
				this.isSendingCommand = false; // Lock kurz lösen für den Login
				if (await this.login()) {
					// Nach erfolgreichem Login Befehl einmal wiederholen
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
	private lastEventTime: { [id: string]: number } = {}; // Für Entprellung

	private wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

	// Interne Hilfsfunktion zur Entprellung von ioBroker-Events (Race Condition Schutz)
	private shouldProcess(id: string): boolean {
		const now = Date.now();
		if (this.lastEventTime[id] && (now - this.lastEventTime[id] < 1500)) {
			return false; // Ignoriere Events innerhalb von 1500ms (VIS-Prellen)
		}
		this.lastEventTime[id] = now;
		return true;
	}

	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		if (state && !state.ack) {
			const stateId = id.split('.').pop();
			if (stateId === 'heatOn') {
				if (!this.shouldProcess(id)) return;
				// Konvertierung sicherstellen (VIS sendet oft Strings)
				const val = state.val === true || state.val === 'true' || state.val === 1;

				const isRemoteReady = (await this.getStateAsync('remoteControl'))?.val;
				if (val && !isRemoteReady) {
					this.log.warn('Fernstart nicht bereit!');
					await this.setState('heatOn', false, true);
					await this.setState('errorMsg', 'Fernstart am Panel nicht bereit!', true);
				} else {
					await this.setSaunaState('heatOn', val);
				}
			} else if (stateId === 'lightOn' || stateId === 'targetTemp') {
				if (!this.shouldProcess(id)) return;
				// Konvertierung sicherstellen (VIS sendet oft Strings)
				const val = state.val === true || state.val === 'true' || state.val === 1 || typeof state.val === 'number' ? state.val : false;
				await this.setSaunaState(stateId, val);
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
