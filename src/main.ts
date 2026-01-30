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
	private hasSecretStorage = false;

	/**
	 * Check if SecretStorage API is available (Obsidian 1.10.0+).
	 */
	private checkSecretStorageAvailable(): boolean {
		return !!(
			this.app.secretStorage &&
			typeof this.app.secretStorage.get === 'function' &&
			typeof this.app.secretStorage.set === 'function'
		);
	}

	/**
	 * Get a secret value - uses SecretStorage if available, falls back to settings.
	 */
	async getSecret(key: string): Promise<string | null> {
		if (this.hasSecretStorage) {
			return await this.app.secretStorage.get(key) || null;
		}
		// Fallback: check if we have it stored in settings (legacy)
		if (key === SECRET_KEY_CLIENT_ID && this.settings.clientId) {
			return this.settings.clientId;
		}
		if (key === SECRET_KEY_CLIENT_SECRET && this.settings.clientSecret) {
			return this.settings.clientSecret;
		}
		if (key === SECRET_KEY_ACCESS_TOKEN && this.settings.accessToken) {
			return this.settings.accessToken;
		}
		if (key === SECRET_KEY_REFRESH_TOKEN && this.settings.refreshToken) {
			return this.settings.refreshToken;
		}
		return null;
	}

	/**
	 * Set a secret value - uses SecretStorage if available, falls back to settings.
	 */
	async setSecret(key: string, value: string): Promise<void> {
		if (this.hasSecretStorage) {
			await this.app.secretStorage.set(key, value);
		} else {
			// Fallback: store in settings (plaintext - not ideal but functional)
			if (key === SECRET_KEY_CLIENT_ID) {
				this.settings.clientId = value;
			} else if (key === SECRET_KEY_CLIENT_SECRET) {
				this.settings.clientSecret = value;
			} else if (key === SECRET_KEY_ACCESS_TOKEN) {
				this.settings.accessToken = value;
			} else if (key === SECRET_KEY_REFRESH_TOKEN) {
				this.settings.refreshToken = value;
			}
			await this.saveData(this.settings);
		}
	}

	/**
	 * Delete a secret value.
	 */
	async deleteSecret(key: string): Promise<void> {
		if (this.hasSecretStorage) {
			await this.app.secretStorage.delete(key);
		} else {
			// Fallback: clear from settings
			if (key === SECRET_KEY_CLIENT_ID) {
				delete this.settings.clientId;
			} else if (key === SECRET_KEY_CLIENT_SECRET) {
				delete this.settings.clientSecret;
			} else if (key === SECRET_KEY_ACCESS_TOKEN) {
				delete this.settings.accessToken;
			} else if (key === SECRET_KEY_REFRESH_TOKEN) {
				delete this.settings.refreshToken;
			}
			await this.saveData(this.settings);
		}
	}

	async onload(): Promise<void> {
		await this.loadSettings();

		// Check if SecretStorage is available (Obsidian 1.10.0+)
		this.hasSecretStorage = this.checkSecretStorageAvailable();
		if (!this.hasSecretStorage) {
			logger.info('SecretStorage not available (requires Obsidian 1.10.0+), using fallback storage');
		}

		// Migrate plaintext credentials to SecretStorage if needed
		await this.migrateToSecretStorage();

		// Initialize managers
		await this.initializeApi();
		this.dailyNoteManager = new DailyNoteManager(this.app, this.settings);

		// Status bar
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar('idle');

		// Ribbon icon (activity icon)
		this.ribbonIconEl = this.addRibbonIcon('activity', 'Sync Strava activities', () => {
			void this.syncActivities();
		});

		// Commands
		this.addCommand({
			id: 'sync-strava-activities',
			name: 'Sync Strava activities to daily note',
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
	 * This handles users upgrading from older versions.
	 * If SecretStorage isn't available, just mark credentials as configured.
	 */
	private async migrateToSecretStorage(): Promise<void> {
		let needsSave = false;

		// Migrate client ID
		if (this.settings.clientId && !this.settings.clientIdConfigured) {
			if (this.hasSecretStorage) {
				logger.info('Migrating client ID to SecretStorage...');
				try {
					await this.app.secretStorage.set(SECRET_KEY_CLIENT_ID, this.settings.clientId);
					this.settings.clientIdConfigured = true;
					delete this.settings.clientId;
					needsSave = true;
				} catch (error) {
					logger.error('Failed to migrate client ID', error);
				}
			} else {
				// SecretStorage not available - keep using plaintext but mark as configured
				this.settings.clientIdConfigured = true;
				needsSave = true;
			}
		}

		// Migrate client secret
		if (this.settings.clientSecret && !this.settings.clientSecretConfigured) {
			if (this.hasSecretStorage) {
				logger.info('Migrating client secret to SecretStorage...');
				try {
					await this.app.secretStorage.set(SECRET_KEY_CLIENT_SECRET, this.settings.clientSecret);
					this.settings.clientSecretConfigured = true;
					delete this.settings.clientSecret;
					needsSave = true;
				} catch (error) {
					logger.error('Failed to migrate client secret', error);
				}
			} else {
				this.settings.clientSecretConfigured = true;
				needsSave = true;
			}
		}

		// Migrate access token
		if (this.settings.accessToken && !this.settings.isAuthenticated) {
			if (this.hasSecretStorage) {
				logger.info('Migrating OAuth tokens to SecretStorage...');
				try {
					await this.app.secretStorage.set(SECRET_KEY_ACCESS_TOKEN, this.settings.accessToken);
					if (this.settings.refreshToken) {
						await this.app.secretStorage.set(SECRET_KEY_REFRESH_TOKEN, this.settings.refreshToken);
					}
					this.settings.isAuthenticated = true;
					delete this.settings.accessToken;
					delete this.settings.refreshToken;
					needsSave = true;
				} catch (error) {
					logger.error('Failed to migrate OAuth tokens', error);
				}
			} else {
				this.settings.isAuthenticated = true;
				needsSave = true;
			}
		}

		if (needsSave) {
			await this.saveData(this.settings);
			if (this.hasSecretStorage) {
				new Notice('Strava: migrated credentials to secure storage');
			}
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

	private async initializeApi(): Promise<void> {
		if (!this.settings.clientIdConfigured || !this.settings.clientSecretConfigured) {
			this.api = null;
			return;
		}

		const clientId = await this.getSecret(SECRET_KEY_CLIENT_ID);
		const clientSecret = await this.getSecret(SECRET_KEY_CLIENT_SECRET);

		if (!clientId || !clientSecret) {
			logger.warn('Client credentials marked as configured but not found');
			this.api = null;
			return;
		}

		// Get tokens
		const accessToken = await this.getSecret(SECRET_KEY_ACCESS_TOKEN);
		const refreshToken = await this.getSecret(SECRET_KEY_REFRESH_TOKEN);

		const tokens: TokenStorage = {
			accessToken: accessToken || '',
			refreshToken: refreshToken || '',
			expiresAt: this.settings.expiresAt,
		};

		this.api = new StravaAPI(
			clientId,
			clientSecret,
			tokens,
			async (newTokens) => {
				// Save refreshed tokens
				await this.setSecret(SECRET_KEY_ACCESS_TOKEN, newTokens.accessToken);
				await this.setSecret(SECRET_KEY_REFRESH_TOKEN, newTokens.refreshToken);
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

	async startOAuthFlow(): Promise<void> {
		// Make sure API is initialized with current credentials
		await this.initializeApi();

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
		await this.initializeApi();

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
		await this.deleteSecret(SECRET_KEY_ACCESS_TOKEN);
		await this.deleteSecret(SECRET_KEY_REFRESH_TOKEN);

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
