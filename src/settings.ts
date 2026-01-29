import { App, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import StravaSyncPlugin from './main';
import { SECRET_KEY_CLIENT_ID, SECRET_KEY_CLIENT_SECRET } from './types';
import { logger } from './logger';

// Validation helpers
const MAX_HISTORICAL_DAYS = 90;

function validateNonNegativeInt(value: string, max?: number): number | null {
	const num = parseInt(value, 10);
	if (isNaN(num) || num < 0) return null;
	if (max !== undefined && num > max) return null;
	return num;
}

function validateSectionHeader(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	if (!trimmed.startsWith('#')) return null;
	return trimmed;
}

export class StravaSyncSettingTab extends PluginSettingTab {
	plugin: StravaSyncPlugin;
	private connectionStatusEl: HTMLElement | null = null;

	constructor(app: App, plugin: StravaSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('strava-sync-settings');

		containerEl.createEl('h2', { text: 'Strava Activity Sync Settings' });

		// OAuth Configuration
		containerEl.createEl('h3', { text: 'Strava API Configuration' });

		containerEl.createEl('p', {
			text: 'Create an API application at ',
			cls: 'setting-item-description',
		}).createEl('a', {
			text: 'strava.com/settings/api',
			href: 'https://www.strava.com/settings/api',
		});

		// Client ID - stored in SecretStorage
		const clientIdSetting = new Setting(containerEl)
			.setName('Client ID')
			.setDesc(`Your Strava API Client ID (stored securely) ${this.plugin.settings.clientIdConfigured ? '✓' : ''}`);

		clientIdSetting.addText(text => {
			text
				.setPlaceholder('Enter new Client ID to update')
				.onChange(() => {});
			return text;
		});

		clientIdSetting.addButton(button => button
			.setButtonText('Save')
			.onClick(async () => {
				const inputEl = clientIdSetting.controlEl.querySelector('input') as HTMLInputElement;
				const value = inputEl?.value?.trim();
				if (!value) return;

				try {
					await this.plugin.setSecret(SECRET_KEY_CLIENT_ID, value);
					this.plugin.settings.clientIdConfigured = true;
					await this.plugin.saveSettings();
					inputEl.value = '';
					this.display(); // Refresh
					logger.info('Client ID saved');
				} catch (error) {
					logger.error('Failed to save Client ID', error);
				}
			}));

		// Client Secret - stored in SecretStorage
		const clientSecretSetting = new Setting(containerEl)
			.setName('Client Secret')
			.setDesc(`Your Strava API Client Secret (stored securely) ${this.plugin.settings.clientSecretConfigured ? '✓' : ''}`);

		clientSecretSetting.addText(text => {
			text
				.setPlaceholder('Enter new Client Secret to update');
			text.inputEl.setAttribute('type', 'password');
			return text;
		});

		clientSecretSetting.addButton(button => button
			.setButtonText('Save')
			.onClick(async () => {
				const inputEl = clientSecretSetting.controlEl.querySelector('input') as HTMLInputElement;
				const value = inputEl?.value?.trim();
				if (!value) return;

				try {
					await this.plugin.setSecret(SECRET_KEY_CLIENT_SECRET, value);
					this.plugin.settings.clientSecretConfigured = true;
					await this.plugin.saveSettings();
					inputEl.value = '';
					this.display(); // Refresh
					logger.info('Client Secret saved');
				} catch (error) {
					logger.error('Failed to save Client Secret', error);
				}
			}));

		// Authorization
		containerEl.createEl('h3', { text: 'Authorization' });

		// Connection status display
		this.connectionStatusEl = containerEl.createDiv('connection-status');
		this.updateConnectionStatus();

		if (this.plugin.isAuthenticated()) {
			// Already connected - show disconnect and test buttons
			const connectedSetting = new Setting(containerEl)
				.setName('Connected to Strava')
				.setDesc('Your Strava account is linked');

			connectedSetting.addButton(button => button
				.setButtonText('Test Connection')
				.onClick(async () => {
					button.setButtonText('Testing...');
					button.setDisabled(true);

					const result = await this.plugin.testConnection();
					if (result.success) {
						this.connectionStatusEl?.setText(`Connected as: ${result.athlete}`);
						this.connectionStatusEl?.removeClass('error');
						this.connectionStatusEl?.addClass('success');
					} else {
						this.connectionStatusEl?.setText(`Error: ${result.error}`);
						this.connectionStatusEl?.removeClass('success');
						this.connectionStatusEl?.addClass('error');
					}

					button.setButtonText('Test Connection');
					button.setDisabled(false);
				}));

			connectedSetting.addButton(button => button
				.setButtonText('Disconnect')
				.onClick(async () => {
					await this.plugin.disconnectStrava();
					this.display(); // Refresh the settings page
				}));
		} else {
			// Not connected - show auth flow
			containerEl.createEl('p', {
				text: 'Make sure your Strava API app has "Authorization Callback Domain" set to: localhost',
				cls: 'setting-item-description',
			});

			// Step 1: Open auth URL
			new Setting(containerEl)
				.setName('Step 1: Authorize')
				.setDesc('Click to open Strava authorization page. After authorizing, the page will fail to load - this is expected.')
				.addButton(button => button
					.setButtonText('Open Strava Auth')
					.setCta()
					.onClick(async () => {
						if (!this.plugin.settings.clientIdConfigured || !this.plugin.settings.clientSecretConfigured) {
							this.connectionStatusEl?.setText('Please enter Client ID and Client Secret first');
							this.connectionStatusEl?.addClass('error');
							return;
						}

						await this.plugin.startOAuthFlow();
					}));

			// Step 2: Paste the code
			let codeInput = '';
			const codeSetting = new Setting(containerEl)
				.setName('Step 2: Paste Authorization Code')
				.setDesc('Copy the "code" parameter from the failed URL (e.g., http://localhost?code=XXXXX) and paste it here')
				.addText(text => text
					.setPlaceholder('Paste code here')
					.onChange(value => {
						codeInput = value.trim();
					}))
				.addButton(button => button
					.setButtonText('Connect')
					.setCta()
					.onClick(async () => {
						if (!codeInput) {
							this.connectionStatusEl?.setText('Please paste the authorization code');
							this.connectionStatusEl?.addClass('error');
							return;
						}

						button.setButtonText('Connecting...');
						button.setDisabled(true);

						try {
							await this.plugin.exchangeAuthCode(codeInput);
							this.display(); // Refresh to show connected state
						} catch (error) {
							const msg = error instanceof Error ? error.message : 'Unknown error';
							this.connectionStatusEl?.setText(`Auth failed: ${msg}`);
							this.connectionStatusEl?.addClass('error');
							button.setButtonText('Connect');
							button.setDisabled(false);
						}
					}));
		}

		// Daily Note Display
		containerEl.createEl('h3', { text: 'Daily Note Display' });

		new Setting(containerEl)
			.setName('Daily Notes Folder')
			.setDesc('Path to your daily notes folder (leave empty to auto-detect from Periodic Notes or Daily Notes plugin)')
			.addText(text => text
				.setPlaceholder('e.g., Notes/Daily Notes')
				.setValue(this.plugin.settings.dailyNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotesFolder = value.trim() ? normalizePath(value.trim()) : '';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Section Header')
			.setDesc('The markdown header to use for the activities section (must start with #)')
			.addText(text => text
				.setPlaceholder('#### Activities')
				.setValue(this.plugin.settings.sectionHeader)
				.onChange(async (value) => {
					const validated = validateSectionHeader(value);
					if (validated !== null) {
						this.plugin.settings.sectionHeader = validated;
						await this.plugin.saveSettings();
					} else if (value.trim() === '') {
						// Allow clearing to reset to default
						this.plugin.settings.sectionHeader = '#### Activities';
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Omit Empty Section')
			.setDesc('Hide the activities section when there are no workouts')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.omitEmptySection)
				.onChange(async (value) => {
					this.plugin.settings.omitEmptySection = value;
					await this.plugin.saveSettings();
				}));

		// Auto-sync
		containerEl.createEl('h3', { text: 'Auto-Sync' });

		new Setting(containerEl)
			.setName('Enable Auto-Sync')
			.setDesc('Automatically sync at regular intervals')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSyncEnabled)
				.onChange(async (value) => {
					this.plugin.settings.autoSyncEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync Frequency')
			.setDesc('How often to automatically sync')
			.addDropdown(dropdown => dropdown
				.addOption('300000', '5 minutes')
				.addOption('600000', '10 minutes')
				.addOption('1800000', '30 minutes')
				.addOption('3600000', '1 hour')
				.setValue(String(this.plugin.settings.autoSyncFrequency))
				.onChange(async (value) => {
					this.plugin.settings.autoSyncFrequency = parseInt(value, 10);
					await this.plugin.saveSettings();
				}));

		// Historical Sync
		containerEl.createEl('h3', { text: 'Historical Sync' });

		new Setting(containerEl)
			.setName('Historical Days')
			.setDesc(`Sync activities from the last N days (0 = today only, max ${MAX_HISTORICAL_DAYS})`)
			.addText(text => text
				.setPlaceholder('0')
				.setValue(String(this.plugin.settings.historicalSyncDays))
				.onChange(async (value) => {
					const validated = validateNonNegativeInt(value, MAX_HISTORICAL_DAYS);
					if (validated !== null) {
						this.plugin.settings.historicalSyncDays = validated;
						await this.plugin.saveSettings();
					}
					// Invalid input silently ignored - field reverts on re-open
				}));

		// Manual Sync
		containerEl.createEl('h3', { text: 'Sync' });

		new Setting(containerEl)
			.setName('Sync Activities')
			.setDesc('Fetch activities from Strava and update daily notes')
			.addButton(button => button
				.setButtonText('Sync Now')
				.setCta()
				.onClick(async () => {
					if (!this.plugin.isAuthenticated()) {
						this.connectionStatusEl?.setText('Please authorize with Strava first');
						this.connectionStatusEl?.addClass('error');
						return;
					}

					button.setButtonText('Syncing...');
					button.setDisabled(true);

					await this.plugin.syncActivities();

					button.setButtonText('Sync Now');
					button.setDisabled(false);
				}));

		new Setting(containerEl)
			.setName('Clear Activities Section')
			.setDesc("Remove the activities section from today's daily note")
			.addButton(button => button
				.setButtonText('Clear')
				.onClick(async () => {
					button.setButtonText('Clearing...');
					button.setDisabled(true);

					const success = await this.plugin.clearActivitiesSection();
					button.setButtonText(success ? 'Cleared!' : 'No daily note');

					setTimeout(() => {
						button.setButtonText('Clear');
						button.setDisabled(false);
					}, 2000);
				}));
	}

	private updateConnectionStatus(): void {
		if (!this.connectionStatusEl) return;

		this.connectionStatusEl.empty();
		this.connectionStatusEl.removeClass('success', 'error', 'pending');

		if (!this.plugin.settings.clientIdConfigured || !this.plugin.settings.clientSecretConfigured) {
			this.connectionStatusEl.setText('Enter API credentials above');
			this.connectionStatusEl.addClass('pending');
		} else if (this.plugin.isAuthenticated()) {
			const expiresAt = new Date(this.plugin.settings.expiresAt * 1000);
			this.connectionStatusEl.setText(`Connected (token expires: ${expiresAt.toLocaleString()})`);
			this.connectionStatusEl.addClass('success');
		} else {
			this.connectionStatusEl.setText('Not connected - click "Authorize with Strava"');
			this.connectionStatusEl.addClass('pending');
		}
	}
}
