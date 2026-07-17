import { Notice, Plugin } from 'obsidian';
import {
	StravaSyncSettings,
	DEFAULT_SETTINGS,
	SECRET_KEY_CLIENT_ID,
	SECRET_KEY_CLIENT_SECRET,
	SECRET_KEY_ACCESS_TOKEN,
	SECRET_KEY_REFRESH_TOKEN,
} from './types';
import { StravaAPI, TokenStorage } from './api';
import { DailyNoteManager } from './daily-note';
import { StravaSyncSettingTab } from './settings';
import { logger } from './logger';

// Constants
const STATUS_SUCCESS_CLEAR_MS = 5000;
const STATUS_ERROR_CLEAR_MS = 8000;
const AUTO_SYNC_STARTUP_DELAY_MS = 1000;

export default class StravaSyncPlugin extends Plugin {
	settings: StravaSyncSettings = DEFAULT_SETTINGS;
	private api: StravaAPI | null = null;
	private dailyNoteManager: DailyNoteManager | null = null;
	private autoSyncInterval: number | null = null;
	private statusBarItem: HTMLElement | null = null;
	private ribbonIconEl: HTMLElement | null = null;
	private isSyncing = false;

	/**
	 * Read a secret from Obsidian's SecretStorage.
	 * Empty values are treated as unset (SecretStorage has no delete API,
	 * so cleared secrets are stored as empty strings).
	 */
	getSecret(id: string): string | null {
		return this.app.secretStorage.getSecret(id) || null;
	}

	setSecret(id: string, value: string): void {
		this.app.secretStorage.setSecret(id, value);
	}

	private clearSecret(id: string): void {
		this.app.secretStorage.setSecret(id, '');
	}

	async onload(): Promise<void> {
		await this.loadSettings();

		// Migrate plaintext credentials to SecretStorage if needed
		await this.migrateToSecretStorage();

		// Initialize managers
		this.initializeApi();
		this.dailyNoteManager = new DailyNoteManager(this.app, this.settings);

		// Status bar
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar('idle');

		// Ribbon icon (activity icon)
		this.ribbonIconEl = this.addRibbonIcon('activity', 'Sync activities', () => {
			void this.syncActivities();
		});

		// Commands
		this.addCommand({
			id: 'sync-strava-activities',
			name: 'Sync activities to daily note',
			callback: () => {
				void this.syncActivities();
			},
		});

		this.addCommand({
			id: 'clear-activities-section',
			name: 'Clear activities section from daily note',
			callback: () => {
				void this.clearActivitiesSection();
			},
		});

		// Settings tab
		this.addSettingTab(new StravaSyncSettingTab(this.app, this));

		// Setup auto-sync after a short delay
		window.setTimeout(() => {
			this.setupAutoSync();
		}, AUTO_SYNC_STARTUP_DELAY_MS);
	}

	onunload(): void {
		this.clearAutoSync();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * Migrate plaintext credentials from data.json to SecretStorage.
	 * Handles users upgrading from versions that stored credentials in plaintext.
	 */
	private async migrateToSecretStorage(): Promise<void> {
		let needsSave = false;

		if (this.settings.clientId) {
			this.setSecret(SECRET_KEY_CLIENT_ID, this.settings.clientId);
			this.settings.clientIdSecretId = SECRET_KEY_CLIENT_ID;
			delete this.settings.clientId;
			needsSave = true;
		}

		if (this.settings.clientSecret) {
			this.setSecret(SECRET_KEY_CLIENT_SECRET, this.settings.clientSecret);
			this.settings.clientSecretSecretId = SECRET_KEY_CLIENT_SECRET;
			delete this.settings.clientSecret;
			needsSave = true;
		}

		if (this.settings.accessToken) {
			this.setSecret(SECRET_KEY_ACCESS_TOKEN, this.settings.accessToken);
			if (this.settings.refreshToken) {
				this.setSecret(SECRET_KEY_REFRESH_TOKEN, this.settings.refreshToken);
			}
			this.settings.isAuthenticated = true;
			delete this.settings.accessToken;
			delete this.settings.refreshToken;
			needsSave = true;
		}

		// Drop status flags left behind by older versions
		const legacy = this.settings as Record<string, unknown>;
		for (const key of ['clientIdConfigured', 'clientSecretConfigured']) {
			if (key in legacy) {
				delete legacy[key];
				needsSave = true;
			}
		}

		if (needsSave) {
			await this.saveData(this.settings);
			new Notice('Strava: migrated credentials to secure storage');
			logger.info('Credential migration complete');
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);

		// Note: API client is NOT re-initialized here because credentials
		// are stored in SecretStorage. Call initializeApi() explicitly when needed.

		// Update daily note manager settings
		if (this.dailyNoteManager) {
			this.dailyNoteManager.updateSettings(this.settings);
		}

		// Restart auto-sync with new settings
		this.setupAutoSync();
	}

	private initializeApi(): void {
		const { clientIdSecretId, clientSecretSecretId } = this.settings;
		if (!clientIdSecretId || !clientSecretSecretId) {
			this.api = null;
			return;
		}

		const clientId = this.getSecret(clientIdSecretId);
		const clientSecret = this.getSecret(clientSecretSecretId);

		if (!clientId || !clientSecret) {
			logger.warn('Client credential secrets configured but not found in secret storage');
			this.api = null;
			return;
		}

		const tokens: TokenStorage = {
			accessToken: this.getSecret(SECRET_KEY_ACCESS_TOKEN) || '',
			refreshToken: this.getSecret(SECRET_KEY_REFRESH_TOKEN) || '',
			expiresAt: this.settings.expiresAt,
		};

		this.api = new StravaAPI(
			clientId,
			clientSecret,
			tokens,
			async (newTokens) => {
				// Save refreshed tokens
				this.setSecret(SECRET_KEY_ACCESS_TOKEN, newTokens.accessToken);
				this.setSecret(SECRET_KEY_REFRESH_TOKEN, newTokens.refreshToken);
				// Expiry is not sensitive, keep in settings
				this.settings.expiresAt = newTokens.expiresAt;
				this.settings.isAuthenticated = true;
				await this.saveData(this.settings);
			}
		);
	}

	private updateStatusBar(status: 'idle' | 'syncing' | 'success' | 'error', message?: string): void {
		if (!this.statusBarItem) return;

		this.statusBarItem.empty();
		this.statusBarItem.removeClass('syncing', 'success', 'error');
		this.statusBarItem.addClass('strava-sync-status');

		let text = 'Strava: ';
		switch (status) {
			case 'idle':
				text += 'Idle';
				break;
			case 'syncing':
				text += 'Syncing...';
				this.statusBarItem.addClass('syncing');
				break;
			case 'success':
				text += message || 'Synced';
				this.statusBarItem.addClass('success');
				window.setTimeout(() => this.updateStatusBar('idle'), STATUS_SUCCESS_CLEAR_MS);
				break;
			case 'error':
				text += message || 'Error';
				this.statusBarItem.addClass('error');
				window.setTimeout(() => this.updateStatusBar('idle'), STATUS_ERROR_CLEAR_MS);
				break;
		}

		this.statusBarItem.setText(text);
	}

	private setupAutoSync(): void {
		this.clearAutoSync();

		if (this.settings.autoSyncEnabled && this.settings.autoSyncFrequency > 0 && this.isAuthenticated()) {
			this.autoSyncInterval = window.setInterval(() => {
				void this.syncActivities().catch((error: unknown) => {
					logger.error('Auto-sync failed', error);
					// Don't show notice for auto-sync failures - just log
				});
			}, this.settings.autoSyncFrequency);
		}
	}

	private clearAutoSync(): void {
		if (this.autoSyncInterval) {
			window.clearInterval(this.autoSyncInterval);
			this.autoSyncInterval = null;
		}
	}

	// OAuth flow methods
	isAuthenticated(): boolean {
		return this.settings.isAuthenticated;
	}

	startOAuthFlow(): void {
		// Make sure API is initialized with current credentials
		this.initializeApi();

		if (!this.api) {
			new Notice('Strava: please enter client ID and client secret first');
			return;
		}

		const authUrl = this.api.getAuthorizationUrl();
		window.open(authUrl);
		new Notice('Strava: opening authorization page. After authorizing, copy the code from the URL.');
	}

	// Exchange authorization code for tokens (called from settings UI)
	async exchangeAuthCode(code: string): Promise<void> {
		// Make sure API is initialized
		this.initializeApi();

		if (!this.api) {
			throw new Error('API not initialized');
		}

		this.updateStatusBar('syncing', 'Authorizing...');
		const tokens = await this.api.exchangeCode(code);

		// The token callback already saves to SecretStorage, but we need to
		// ensure the settings flag is saved
		this.settings.isAuthenticated = true;
		await this.saveData(this.settings);

		new Notice('Strava connected successfully!');
		this.updateStatusBar('success', 'Connected');

		// Start auto-sync now that we're connected
		this.setupAutoSync();
	}

	async disconnectStrava(): Promise<void> {
		// Clear tokens
		this.clearSecret(SECRET_KEY_ACCESS_TOKEN);
		this.clearSecret(SECRET_KEY_REFRESH_TOKEN);

		// Update settings
		this.settings.isAuthenticated = false;
		this.settings.expiresAt = 0;
		await this.saveData(this.settings);

		// Clear API and auto-sync
		this.api = null;
		this.clearAutoSync();

		new Notice('Strava disconnected');
		this.updateStatusBar('idle');
	}

	async testConnection(): Promise<{ success: boolean; error?: string; athlete?: string }> {
		if (!this.api) {
			return { success: false, error: 'API not initialized' };
		}

		return this.api.testConnection();
	}

	// Sync methods
	async syncActivities(): Promise<void> {
		if (this.isSyncing) {
			new Notice('Strava: sync already in progress');
			return;
		}

		if (!this.api) {
			new Notice('Strava: please configure API credentials');
			this.updateStatusBar('error', 'Not configured');
			return;
		}

		if (!this.isAuthenticated()) {
			new Notice('Strava: please authorize first');
			this.updateStatusBar('error', 'Not authorized');
			return;
		}

		if (!this.dailyNoteManager) {
			this.updateStatusBar('error', 'Internal error');
			return;
		}

		this.isSyncing = true;
		this.updateStatusBar('syncing');

		try {
			const today = new Date();
			let totalActivities = 0;
			let daysUpdated = 0;

			if (this.settings.historicalSyncDays > 0) {
				// Bulk fetch for historical sync (single API call!)
				const startDate = new Date();
				startDate.setDate(startDate.getDate() - this.settings.historicalSyncDays);

				const results = await this.api.syncDataBulk(startDate, today);

				// Update each day's note
				for (const [dateStr, result] of results) {
					const date = new Date(dateStr + 'T12:00:00'); // Noon to avoid timezone issues
					const success = await this.dailyNoteManager.updateDailyNote(result, date);
					if (success) {
						daysUpdated++;
						totalActivities += result.activities.length;
					}
				}
			} else {
				// Just sync today
				const result = await this.api.syncData(today);
				const success = await this.dailyNoteManager.updateDailyNote(result, today);
				if (success) {
					daysUpdated = 1;
					totalActivities = result.activities.length;
				}
			}

			if (daysUpdated > 0) {
				let message: string;
				if (this.settings.historicalSyncDays > 0) {
					message = `${totalActivities} activities across ${daysUpdated} days`;
				} else if (totalActivities > 0) {
					message = `${totalActivities} activities`;
				} else {
					message = 'No activities';
				}

				this.updateStatusBar('success', message);
				new Notice(`Strava: ${message}`);
			} else {
				this.updateStatusBar('error', 'No daily notes');
				new Notice('Strava: no daily notes found');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			this.updateStatusBar('error', 'Sync failed');
			new Notice(`Strava sync failed: ${message}`);
			logger.error('Sync error', error);
		} finally {
			this.isSyncing = false;
		}
	}

	async clearActivitiesSection(): Promise<boolean> {
		if (!this.dailyNoteManager) {
			return false;
		}

		const success = await this.dailyNoteManager.clearActivitiesSection();
		if (success) {
			new Notice('Strava: cleared activities section');
		} else {
			new Notice('Strava: no daily note found');
		}
		return success;
	}
}
