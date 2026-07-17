// Mock for obsidian module used in tests
// Only provides minimal stubs needed for importing modules

export function requestUrl(): Promise<unknown> {
	throw new Error('requestUrl should not be called in tests');
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export class TFile {
	path = '';
	name = '';
	basename = '';
	extension = '';
}

export class TFolder {
	path = '';
	name = '';
}

export class SecretStorage {
	private secrets = new Map<string, string>();

	setSecret(id: string, secret: string): void {
		this.secrets.set(id, secret);
	}

	getSecret(id: string): string | null {
		return this.secrets.has(id) ? (this.secrets.get(id) as string) : null;
	}

	listSecrets(): string[] {
		return Array.from(this.secrets.keys());
	}
}

export class BaseComponent {}

export class SecretComponent extends BaseComponent {
	constructor(_app: App, _containerEl: unknown) {
		super();
	}
	setValue(): this {
		return this;
	}
	onChange(): this {
		return this;
	}
}

export class App {
	secretStorage = new SecretStorage();
	vault = {
		read: () => Promise.resolve(''),
		process: () => Promise.resolve(),
		getAbstractFileByPath: () => null,
		getMarkdownFiles: () => [],
		create: () => Promise.resolve(new TFile()),
		createFolder: () => Promise.resolve(),
	};
	fileManager = {
		processFrontMatter: () => Promise.resolve(),
	};
	metadataCache = {
		getFileCache: () => null,
	};
}

export class Plugin {
	app = new App();
	manifest = {
		id: '',
		name: '',
		version: '',
	};
	loadData = () => Promise.resolve({});
	saveData = () => Promise.resolve();
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl = {
		empty: () => {},
		createEl: () => ({}),
	};

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
	}
}

export class Setting {
	constructor() {}
	setName = () => this;
	setDesc = () => this;
	addText = () => this;
	addButton = () => this;
	addToggle = () => this;
	addDropdown = () => this;
	addComponent = () => this;
}

export class Notice {
	constructor() {}
}
