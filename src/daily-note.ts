import { App, TFile, normalizePath, Plugin } from 'obsidian';

// Type declarations for internal Obsidian plugin APIs
interface PeriodicNotesSettings {
	daily?: {
		enabled?: boolean;
		folder?: string;
		format?: string;
	};
}

interface PeriodicNotesPlugin extends Plugin {
	settings?: PeriodicNotesSettings;
}

interface DailyNotesPluginInstance {
	options?: {
		folder?: string;
		format?: string;
	};
}

interface InternalPlugin {
	enabled?: boolean;
	instance?: DailyNotesPluginInstance;
}

interface InternalPlugins {
	getPluginById?(id: string): InternalPlugin | undefined;
}

interface PluginsWithPeriodic {
	getPlugin?(id: string): PeriodicNotesPlugin | undefined;
}

interface AppWithInternals extends App {
	plugins?: PluginsWithPeriodic;
	internalPlugins?: InternalPlugins;
}
import {
	StravaSyncSettings,
	StravaActivity,
	SyncResult,
	FrontmatterMetrics,
	getActivityEmoji,
} from './types';
import { logger } from './logger';

export class DailyNoteManager {
	private app: App;
	private settings: StravaSyncSettings;

	constructor(app: App, settings: StravaSyncSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: StravaSyncSettings): void {
		this.settings = settings;
	}

	private formatDateWithPattern(date: Date, format: string): string {
		const year = date.getFullYear();
		const month = date.getMonth() + 1;
		const day = date.getDate();

		return format
			.replace('YYYY', String(year))
			.replace('MM', String(month).padStart(2, '0'))
			.replace('DD', String(day).padStart(2, '0'));
	}

	// Get daily notes folder and date format from various sources
	private getDailyNotesConfig(): { folder: string; format: string } {
		// 1. Use manual setting if configured
		if (this.settings.dailyNotesFolder) {
			return {
				folder: this.settings.dailyNotesFolder,
				format: 'YYYY-MM-DD',
			};
		}

		// 2. Try Periodic Notes plugin (community plugin)
		const appWithInternals = this.app as AppWithInternals;
		const periodicNotes = appWithInternals.plugins?.getPlugin?.('periodic-notes');
		if (periodicNotes?.settings?.daily?.enabled) {
			const dailySettings = periodicNotes.settings.daily;
			return {
				folder: dailySettings.folder || '',
				format: dailySettings.format || 'YYYY-MM-DD',
			};
		}

		// 3. Try Daily Notes core plugin
		const internalPlugins = appWithInternals.internalPlugins;
		const dailyNotesPlugin = internalPlugins?.getPluginById?.('daily-notes');
		if (dailyNotesPlugin?.enabled) {
			const dailyNotesSettings = dailyNotesPlugin.instance?.options || {};
			return {
				folder: dailyNotesSettings.folder || '',
				format: dailyNotesSettings.format || 'YYYY-MM-DD',
			};
		}

		// 4. Default fallback
		return {
			folder: '',
			format: 'YYYY-MM-DD',
		};
	}

	getDailyNoteForDate(date: Date): TFile | null {
		try {
			const config = this.getDailyNotesConfig();
			const formatted = this.formatDateWithPattern(date, config.format);

			// Try configured path first
			const expectedPath = config.folder
				? normalizePath(`${config.folder}/${formatted}.md`)
				: `${formatted}.md`;

			const dailyNote = this.app.vault.getAbstractFileByPath(expectedPath);
			if (dailyNote instanceof TFile) {
				return dailyNote;
			}

			// If manual folder is set, don't try fallbacks
			if (this.settings.dailyNotesFolder) {
				logger.debug('Daily note not found at configured path');
				return null;
			}

			// Fallback: search for common date formats and locations
			const formats = ['YYYY-MM-DD', 'DD-MM-YYYY', 'MM-DD-YYYY'];
			const folders = ['', 'Daily Notes', 'Notes/Daily Notes'];

			for (const folder of folders) {
				for (const format of formats) {
					const formatted = this.formatDateWithPattern(date, format);
					const path = folder ? normalizePath(`${folder}/${formatted}.md`) : `${formatted}.md`;
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						return file;
					}
				}
			}

			return null;
		} catch (error) {
			logger.error('Error getting daily note', error);
			return null;
		}
	}

	// Format duration as MM:SS or H:MM:SS
	private formatDuration(seconds: number): string {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = Math.floor(seconds % 60);

		if (hours > 0) {
			return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
		}
		return `${minutes}:${String(secs).padStart(2, '0')}`;
	}

	// Format pace as M:SS /km (for running/walking)
	private formatPace(speedMps: number): string {
		if (speedMps <= 0) return '-';
		const paceSecondsPerKm = 1000 / speedMps;
		const minutes = Math.floor(paceSecondsPerKm / 60);
		const seconds = Math.round(paceSecondsPerKm % 60);
		return `${minutes}:${String(seconds).padStart(2, '0')} /km`;
	}

	// Format speed as XX.X km/h (for cycling)
	private formatSpeed(speedMps: number): string {
		if (speedMps <= 0) return '-';
		const kmh = speedMps * 3.6;
		return `${kmh.toFixed(1)} km/h`;
	}

	// Format distance as X.X km
	private formatDistance(metres: number): string {
		return `${(metres / 1000).toFixed(1)} km`;
	}

	// Format a single activity line
	formatActivity(activity: StravaActivity): string {
		const emoji = getActivityEmoji(activity.type);
		const name = activity.name;
		const distance = this.formatDistance(activity.distance);
		const duration = this.formatDuration(activity.moving_time);
		const elevation = activity.total_elevation_gain;

		// Choose pace or speed based on activity type
		const cyclingTypes = ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide'];
		const paceOrSpeed = cyclingTypes.includes(activity.type)
			? this.formatSpeed(activity.average_speed)
			: this.formatPace(activity.average_speed);

		let line = `- ${emoji} **${name}** - ${distance} in ${duration} (${paceOrSpeed})`;

		// Add elevation if significant
		if (elevation > 10) {
			line += ` | +${Math.round(elevation)}m elevation`;
		}

		return line;
	}

	// Format the activities section content
	formatActivitiesSection(activities: StravaActivity[]): string {
		const lines: string[] = [this.settings.sectionHeader];

		if (activities.length === 0) {
			if (!this.settings.omitEmptySection) {
				lines.push('_No workouts today_');
			} else {
				return '';
			}
		} else {
			for (const activity of activities) {
				lines.push(this.formatActivity(activity));
			}
		}

		return lines.join('\n');
	}

	// Find the ### Health section and update/insert #### Activities under it
	private async updateActivitiesSectionInFile(
		dailyNote: TFile,
		sectionContent: string
	): Promise<void> {
		let content = await this.app.vault.read(dailyNote);
		const sectionHeaderText = this.settings.sectionHeader.replace(/^#+\s*/, '').trim();
		const sectionLevel = (this.settings.sectionHeader.match(/^#+/) || ['####'])[0].length;

		const fileCache = this.app.metadataCache.getFileCache(dailyNote);
		const headings = fileCache?.headings || [];

		// Find the Activities section
		const existingHeading = headings.find(heading =>
			heading.heading.trim() === sectionHeaderText
		);

		if (existingHeading) {
			// Found existing section, replace content
			const lines = content.split('\n');
			const sectionLineNum = existingHeading.position.start.line;

			// Find the end of this section (next heading of same or higher level, or end of file)
			let endLineNum = lines.length;
			for (const heading of headings) {
				if (heading.position.start.line > sectionLineNum && heading.level <= existingHeading.level) {
					endLineNum = heading.position.start.line;
					break;
				}
			}

			const beforeSection = lines.slice(0, sectionLineNum).join('\n');
			const afterSection = lines.slice(endLineNum).join('\n');

			if (sectionContent) {
				content = beforeSection + (beforeSection ? '\n' : '') + sectionContent + (afterSection ? '\n' : '') + afterSection;
			} else {
				// Remove section entirely if empty and omitEmptySection is true
				content = (beforeSection + afterSection).replace(/\n{3,}/g, '\n\n').trim();
			}
		} else if (sectionContent) {
			// Section not found, try to insert under ### Health
			const healthHeading = headings.find(heading =>
				heading.heading.trim() === 'Health' && heading.level === 3
			);

			if (healthHeading) {
				const lines = content.split('\n');
				const healthLineNum = healthHeading.position.start.line;

				// Find where to insert (right after ### Health line, or before next heading)
				let insertLineNum = healthLineNum + 1;

				// Skip any existing content until we hit another heading or #### Activities position
				for (let i = healthLineNum + 1; i < lines.length; i++) {
					const line = lines[i].trim();
					if (line.startsWith('#')) {
						// Found a heading - insert before it
						insertLineNum = i;
						break;
					}
					// Keep going if it's empty or content
					if (i === lines.length - 1) {
						insertLineNum = lines.length;
					}
				}

				const beforeInsert = lines.slice(0, insertLineNum).join('\n');
				const afterInsert = lines.slice(insertLineNum).join('\n');

				content = beforeInsert + (beforeInsert.endsWith('\n') ? '' : '\n') + sectionContent + (afterInsert ? '\n' + afterInsert : '');
			} else {
				// No Health section found, append to end
				content += '\n\n' + sectionContent;
			}
		}

		await this.app.vault.process(dailyNote, () => content);
	}

	// Update frontmatter with metrics
	private async updateFrontmatterMetrics(
		dailyNote: TFile,
		metrics: FrontmatterMetrics
	): Promise<void> {
		await this.app.fileManager.processFrontMatter(dailyNote, (frontmatter) => {
			// Only set metrics that have values > 0
			if (metrics.walking_distance_m > 0) {
				frontmatter.walking_distance_m = metrics.walking_distance_m;
			} else {
				delete frontmatter.walking_distance_m;
			}

			if (metrics.running_distance_m > 0) {
				frontmatter.running_distance_m = metrics.running_distance_m;
			} else {
				delete frontmatter.running_distance_m;
			}

			if (metrics.cycling_distance_m > 0) {
				frontmatter.cycling_distance_m = metrics.cycling_distance_m;
			} else {
				delete frontmatter.cycling_distance_m;
			}

			if (metrics.swimming_distance_m > 0) {
				frontmatter.swimming_distance_m = metrics.swimming_distance_m;
			} else {
				delete frontmatter.swimming_distance_m;
			}

			// Update active_time - this might be set by other sources too
			// Only update if we have activities, otherwise leave it alone
			if (metrics.active_time > 0) {
				// If there's existing active_time, only replace if our value is higher
				// (in case Garmin already set it)
				const existingActiveTime = frontmatter.active_time || 0;
				if (metrics.active_time > existingActiveTime) {
					frontmatter.active_time = metrics.active_time;
				}
			}
		});
	}

	// Main update method
	async updateDailyNote(result: SyncResult, date?: Date): Promise<boolean> {
		try {
			const targetDate = date || new Date();
			const dailyNote = this.getDailyNoteForDate(targetDate);

			if (!dailyNote) {
				logger.debug('No daily note found for date');
				return false;
			}

			// Update the activities section
			const sectionContent = this.formatActivitiesSection(result.activities);
			await this.updateActivitiesSectionInFile(dailyNote, sectionContent);

			// Update frontmatter metrics
			await this.updateFrontmatterMetrics(dailyNote, result.metrics);

			logger.debug(`Updated daily note with ${result.activities.length} activities`);
			return true;
		} catch (error) {
			logger.error('Error updating daily note', error);
			return false;
		}
	}

	// Clear the activities section
	async clearActivitiesSection(): Promise<boolean> {
		try {
			const dailyNote = this.getDailyNoteForDate(new Date());
			if (!dailyNote) {
				return false;
			}

			await this.updateActivitiesSectionInFile(dailyNote, '');
			return true;
		} catch (error) {
			logger.error('Error clearing activities section', error);
			return false;
		}
	}
}
