// Secret storage keys
export const SECRET_KEY_CLIENT_ID = 'strava-client-id';
export const SECRET_KEY_CLIENT_SECRET = 'strava-client-secret';
export const SECRET_KEY_ACCESS_TOKEN = 'strava-access-token';
export const SECRET_KEY_REFRESH_TOKEN = 'strava-refresh-token';

// Plugin settings
export interface StravaSyncSettings {
	// DEPRECATED: Only used for migration to SecretStorage
	clientId?: string;
	clientSecret?: string;
	accessToken?: string;
	refreshToken?: string;

	// Status flags for SecretStorage
	clientIdConfigured: boolean;
	clientSecretConfigured: boolean;
	isAuthenticated: boolean;

	// Token expiry (not sensitive, kept in settings)
	expiresAt: number; // Unix timestamp

	// Daily notes location
	dailyNotesFolder: string; // Empty = auto-detect from Daily Notes / Periodic Notes plugin

	// Display settings
	sectionHeader: string;
	omitEmptySection: boolean;

	// Sync settings
	autoSyncEnabled: boolean;
	autoSyncFrequency: number; // milliseconds
	historicalSyncDays: number;
}

export const DEFAULT_SETTINGS: StravaSyncSettings = {
	clientIdConfigured: false,
	clientSecretConfigured: false,
	isAuthenticated: false,
	expiresAt: 0,
	dailyNotesFolder: '', // Empty = auto-detect
	sectionHeader: '#### Activities',
	omitEmptySection: false,
	autoSyncEnabled: true,
	autoSyncFrequency: 300000, // 5 minutes
	historicalSyncDays: 0,
};

// Strava API types
export interface StravaTokenResponse {
	token_type: string;
	expires_at: number;
	expires_in: number;
	refresh_token: string;
	access_token: string;
	athlete?: StravaAthlete;
}

export interface StravaAthlete {
	id: number;
	username: string;
	firstname: string;
	lastname: string;
}

export interface StravaActivity {
	id: number;
	name: string;
	type: string; // Run, Ride, Swim, Walk, Hike, WeightTraining, Yoga, etc.
	sport_type: string;
	distance: number; // metres
	moving_time: number; // seconds
	elapsed_time: number; // seconds
	total_elevation_gain: number; // metres
	start_date: string; // ISO timestamp (UTC)
	start_date_local: string; // ISO timestamp (local)
	timezone: string;
	average_speed: number; // m/s
	max_speed: number; // m/s
	average_heartrate?: number;
	max_heartrate?: number;
	suffer_score?: number;
}

// Activity type mappings
export type ActivityCategory = 'running' | 'walking' | 'cycling' | 'swimming' | 'other';

export const ACTIVITY_EMOJI: Record<string, string> = {
	'Run': '🏃',
	'Trail Run': '🏃',
	'VirtualRun': '🏃',
	'Ride': '🚴',
	'VirtualRide': '🚴',
	'GravelRide': '🚴',
	'MountainBikeRide': '🚴',
	'EBikeRide': '🚴',
	'Swim': '🏊',
	'Walk': '🚶',
	'Hike': '🥾',
	'WeightTraining': '🏋️',
	'Yoga': '🧘',
	'Workout': '💪',
	'Rowing': '🚣',
	'Kayaking': '🛶',
	'Skiing': '⛷️',
	'Snowboard': '🏂',
	'Golf': '🏌️',
	'Soccer': '⚽',
	'Tennis': '🎾',
};

export function getActivityEmoji(type: string): string {
	return ACTIVITY_EMOJI[type] || '🏃';
}

export function getActivityCategory(type: string): ActivityCategory {
	const runTypes = ['Run', 'Trail Run', 'VirtualRun'];
	const walkTypes = ['Walk', 'Hike'];
	const cycleTypes = ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide'];
	const swimTypes = ['Swim'];

	if (runTypes.includes(type)) return 'running';
	if (walkTypes.includes(type)) return 'walking';
	if (cycleTypes.includes(type)) return 'cycling';
	if (swimTypes.includes(type)) return 'swimming';
	return 'other';
}

// Sync result
export interface SyncResult {
	date: string; // YYYY-MM-DD
	activities: StravaActivity[];
	metrics: FrontmatterMetrics;
}

// Frontmatter metrics to update
export interface FrontmatterMetrics {
	walking_distance_m: number;
	running_distance_m: number;
	cycling_distance_m: number;
	swimming_distance_m: number;
	active_time: number; // minutes
}

export function aggregateMetrics(activities: StravaActivity[]): FrontmatterMetrics {
	const metrics: FrontmatterMetrics = {
		walking_distance_m: 0,
		running_distance_m: 0,
		cycling_distance_m: 0,
		swimming_distance_m: 0,
		active_time: 0,
	};

	for (const activity of activities) {
		const category = getActivityCategory(activity.type);
		const distanceM = Math.round(activity.distance);
		const durationMin = Math.round(activity.moving_time / 60);

		switch (category) {
			case 'running':
				metrics.running_distance_m += distanceM;
				break;
			case 'walking':
				metrics.walking_distance_m += distanceM;
				break;
			case 'cycling':
				metrics.cycling_distance_m += distanceM;
				break;
			case 'swimming':
				metrics.swimming_distance_m += distanceM;
				break;
		}

		metrics.active_time += durationMin;
	}

	return metrics;
}
