import { describe, it, expect } from 'vitest';
import StravaSyncPlugin from '../main';
import {
	SECRET_KEY_CLIENT_ID,
	SECRET_KEY_CLIENT_SECRET,
	SECRET_KEY_ACCESS_TOKEN,
	SECRET_KEY_REFRESH_TOKEN,
} from '../types';

function makePlugin(data: Record<string, unknown> = {}) {
	const plugin = new StravaSyncPlugin();
	let saved: Record<string, unknown> | null = null;
	plugin.loadData = () => Promise.resolve(data);
	plugin.saveData = (d: unknown) => {
		saved = d as Record<string, unknown>;
		return Promise.resolve();
	};
	return { plugin, getSaved: () => saved };
}

describe('secret storage', () => {
	it('getSecret returns null for missing or empty secrets', () => {
		const { plugin } = makePlugin();
		expect(plugin.getSecret('missing')).toBeNull();
		plugin.setSecret('empty-one', '');
		expect(plugin.getSecret('empty-one')).toBeNull();
		plugin.setSecret('real-one', 'value');
		expect(plugin.getSecret('real-one')).toBe('value');
	});

	it('migrates plaintext credentials into secret storage and strips them from data.json', async () => {
		const legacy = {
			clientId: 'id123',
			clientSecret: 'sec456',
			accessToken: 'at789',
			refreshToken: 'rt012',
			clientIdConfigured: true,
			clientSecretConfigured: true,
			isAuthenticated: true,
			expiresAt: 1234,
		};
		const { plugin, getSaved } = makePlugin(legacy);
		await plugin.loadSettings();
		await plugin['migrateToSecretStorage']();

		expect(plugin.app.secretStorage.getSecret(SECRET_KEY_CLIENT_ID)).toBe('id123');
		expect(plugin.app.secretStorage.getSecret(SECRET_KEY_CLIENT_SECRET)).toBe('sec456');
		expect(plugin.app.secretStorage.getSecret(SECRET_KEY_ACCESS_TOKEN)).toBe('at789');
		expect(plugin.app.secretStorage.getSecret(SECRET_KEY_REFRESH_TOKEN)).toBe('rt012');

		expect(plugin.settings.clientIdSecretId).toBe(SECRET_KEY_CLIENT_ID);
		expect(plugin.settings.clientSecretSecretId).toBe(SECRET_KEY_CLIENT_SECRET);
		expect(plugin.settings.isAuthenticated).toBe(true);
		expect(plugin.settings.expiresAt).toBe(1234);

		const saved = getSaved();
		expect(saved).not.toBeNull();
		expect(saved?.clientId).toBeUndefined();
		expect(saved?.clientSecret).toBeUndefined();
		expect(saved?.accessToken).toBeUndefined();
		expect(saved?.refreshToken).toBeUndefined();
	});

	it('does nothing on a clean install with no plaintext credentials', async () => {
		const { plugin, getSaved } = makePlugin();
		await plugin.loadSettings();
		await plugin['migrateToSecretStorage']();
		expect(getSaved()).toBeNull();
		expect(plugin.app.secretStorage.listSecrets()).toEqual([]);
	});

	it('disconnectStrava clears token secrets and auth state', async () => {
		const { plugin } = makePlugin({ isAuthenticated: true, expiresAt: 999 });
		await plugin.loadSettings();
		plugin.setSecret(SECRET_KEY_ACCESS_TOKEN, 'at');
		plugin.setSecret(SECRET_KEY_REFRESH_TOKEN, 'rt');

		await plugin.disconnectStrava();

		expect(plugin.getSecret(SECRET_KEY_ACCESS_TOKEN)).toBeNull();
		expect(plugin.getSecret(SECRET_KEY_REFRESH_TOKEN)).toBeNull();
		expect(plugin.settings.isAuthenticated).toBe(false);
		expect(plugin.settings.expiresAt).toBe(0);
	});

	it('initializeApi builds the API client from stored secret ids', async () => {
		const { plugin } = makePlugin({
			clientIdSecretId: SECRET_KEY_CLIENT_ID,
			clientSecretSecretId: SECRET_KEY_CLIENT_SECRET,
			isAuthenticated: true,
			expiresAt: 1,
		});
		await plugin.loadSettings();
		plugin.app.secretStorage.setSecret(SECRET_KEY_CLIENT_ID, 'id');
		plugin.app.secretStorage.setSecret(SECRET_KEY_CLIENT_SECRET, 'sec');

		plugin['initializeApi']();
		expect(plugin['api']).not.toBeNull();
	});

	it('initializeApi leaves api null when no secret ids configured', async () => {
		const { plugin } = makePlugin();
		await plugin.loadSettings();
		plugin['initializeApi']();
		expect(plugin['api']).toBeNull();
	});
});
