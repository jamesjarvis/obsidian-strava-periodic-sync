import { App, PluginSettingTab, SecretComponent, Setting, normalizePath } from 'obsidian';
import StravaSyncPlugin from './main';

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

		// OAuth Configuration
		new Setting(containerEl).setName('Strava API configuration').setHeading();

		containerEl.createEl('p', {
			text: 'Create an API application at ',
			cls: 'setting-item-description',
		}).createEl('a', {
			text: 'strava.com/settings/api',
			href: 'https://www.strava.com/settings/api',
		});

		// Client ID - stored in Obsidian's secret storage
		new Setting(containerEl)
			.setName('Client ID')
			.setDesc('Secret holding your Strava API client ID')
			.addComponent(el => new SecretComponent(this.app, el)
				.setValue(this.plugin.settings.clientIdSecretId)
				.onChange(value => {
					this.plugin.settings.clientIdSecretId = value;
					void this.plugin.saveSettings().then(() => this.updateConnectionStatus());
				}));

		// Client secret - stored in Obsidian's secret storage
		new Setting(containerEl)
			.setName('Client secret')
			.setDesc('Secret holding your Strava API client secret')
			.addComponent(el => new SecretComponent(this.app, el)
				.setValue(this.plugin.settings.clientSecretSecretId)
				.onChange(value => {
					this.plugin.settings.clientSecretSecretId = value;
					void this.plugin.saveSettings().then(() => this.updateConnectionStatus());
				}));

		// Authorization
		new Setting(containerEl).setName('Authorization').setHeading();

		// Connection status display
		this.connectionStatusEl = containerEl.createDiv('connection-status');
		this.updateConnectionStatus();

		if (this.plugin.isAuthenticated()) {
			// Already connected - show disconnect and test buttons
			const connectedSetting = new Setting(containerEl)
				.setName('Strava connected')
				.setDesc('Strava account is linked');

			connectedSetting.addButton(button => button
				.setButtonText('Test connection')
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

					button.setButtonText('Test connection');
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
				text: 'Ensure your API application has "authorization callback domain" set to localhost',
				cls: 'setting-item-description',
			});

			// Step 1: Open auth URL
			new Setting(containerEl)
				.setName('Step 1: authorize')
				.setDesc('Opens the authorization page. After authorizing, the page will fail to load (this is expected).')
				.addButton(button => button
					.setButtonText('Authorize')
					.setCta()
					.onClick(() => {
						if (!this.plugin.settings.clientIdSecretId || !this.plugin.settings.clientSecretSecretId) {
							this.connectionStatusEl?.setText('Please enter client ID and client secret first');
							this.connectionStatusEl?.addClass('error');
							return;
						}

						this.plugin.startOAuthFlow();
					}));

			// Step 2: Paste the code
			let codeInput = '';
			new Setting(containerEl)
				.setName('Step 2: paste authorization code')
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
		new Setting(containerEl).setName('Daily note display').setHeading();

		new Setting(containerEl)
			.setName('Daily notes folder')
			.setDesc('Auto-detects from periodic notes or daily notes plugin if empty')
			.addText(text => text
				.setPlaceholder('e.g., Notes/Daily Notes')
				.setValue(this.plugin.settings.dailyNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotesFolder = value.trim() ? normalizePath(value.trim()) : '';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Section header')
			.setDesc('Markdown header for the activities section (must start with #)')
			.addText(text => text
				.setPlaceholder('#### activities')
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
			.setName('Omit empty section')
			.setDesc('Hide the activities section when there are no workouts')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.omitEmptySection)
				.onChange(async (value) => {
					this.plugin.settings.omitEmptySection = value;
					await this.plugin.saveSettings();
				}));

		// Auto-sync
		new Setting(containerEl).setName('Auto-sync').setHeading();

		new Setting(containerEl)
			.setName('Enable auto-sync')
			.setDesc('Automatically sync at regular intervals')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSyncEnabled)
				.onChange(async (value) => {
					this.plugin.settings.autoSyncEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync frequency')
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
		new Setting(containerEl).setName('Historical sync').setHeading();

		new Setting(containerEl)
			.setName('Historical days')
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
		new Setting(containerEl).setName('Sync').setHeading();

		new Setting(containerEl)
			.setName('Sync activities')
			.setDesc('Fetch activities and update daily notes')
			.addButton(button => button
				.setButtonText('Sync now')
				.setCta()
				.onClick(async () => {
					if (!this.plugin.isAuthenticated()) {
						this.connectionStatusEl?.setText('Please authorize first');
						this.connectionStatusEl?.addClass('error');
						return;
					}

					button.setButtonText('Syncing...');
					button.setDisabled(true);

					await this.plugin.syncActivities();

					button.setButtonText('Sync now');
					button.setDisabled(false);
				}));

		new Setting(containerEl)
			.setName('Clear activities section')
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

		if (!this.plugin.settings.clientIdSecretId || !this.plugin.settings.clientSecretSecretId) {
			this.connectionStatusEl.setText('Enter API credentials above');
			this.connectionStatusEl.addClass('pending');
		} else if (this.plugin.isAuthenticated()) {
			const expiresAt = new Date(this.plugin.settings.expiresAt * 1000);
			this.connectionStatusEl.setText(`Connected (token expires: ${expiresAt.toLocaleString()})`);
			this.connectionStatusEl.addClass('success');
		} else {
			this.connectionStatusEl.setText('Not connected - complete authorization above');
			this.connectionStatusEl.addClass('pending');
		}
	}
}
