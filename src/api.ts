import { requestUrl } from 'obsidian';
import { logger } from './logger';
import {
	StravaTokenResponse,
	StravaActivity,
	SyncResult,
	aggregateMetrics,
} from './types';

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
const STRAVA_AUTH_BASE = 'https://www.strava.com/oauth';

// Token refresh buffer: refresh 5 minutes before expiry
const TOKEN_REFRESH_BUFFER_SECONDS = 300;

// Rate limiting: Strava allows 100 requests per 15 minutes
// We'll add a delay between requests to stay safe
const MIN_REQUEST_INTERVAL_MS = 1000; // 1 second between requests

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30000;
const REQUEST_TIMEOUT_MS = 30000;

export interface TokenStorage {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

export class StravaAPI {
	private clientId: string;
	private clientSecret: string;
	private tokenStorage: TokenStorage;
	private onTokenRefresh: (tokens: TokenStorage) => Promise<void>;
	private lastRequestTime = 0;

	constructor(
		clientId: string,
		clientSecret: string,
		tokens: TokenStorage,
		onTokenRefresh: (tokens: TokenStorage) => Promise<void>
	) {
		this.clientId = clientId;
		this.clientSecret = clientSecret;
		this.tokenStorage = tokens;
		this.onTokenRefresh = onTokenRefresh;
	}

	private async delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Add jitter to prevent thundering herd.
	 * Adds ±25% variation to the base delay.
	 */
	private addJitter(baseMs: number): number {
		const jitterFactor = 0.75 + Math.random() * 0.5;
		return Math.round(baseMs * jitterFactor);
	}

	/**
	 * Calculate backoff with exponential increase and jitter.
	 * Uses the exported calculateBackoff function with instance jitter method.
	 */
	private calculateBackoff(attempt: number, retryAfterHeader?: string): number {
		return calculateBackoff(attempt, retryAfterHeader, this.addJitter.bind(this));
	}

	private async rateLimit(): Promise<void> {
		const now = Date.now();
		const timeSinceLastRequest = now - this.lastRequestTime;
		if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
			await this.delay(MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest);
		}
		this.lastRequestTime = Date.now();
	}

	updateCredentials(clientId: string, clientSecret: string): void {
		this.clientId = clientId;
		this.clientSecret = clientSecret;
	}

	updateTokens(tokens: TokenStorage): void {
		this.tokenStorage = tokens;
	}

	// Generate the OAuth authorization URL
	// Uses localhost redirect - user must copy the code from the URL manually
	getAuthorizationUrl(): string {
		const params = new URLSearchParams({
			client_id: this.clientId,
			redirect_uri: 'http://localhost',
			response_type: 'code',
			scope: 'activity:read_all',
		});

		return `${STRAVA_AUTH_BASE}/authorize?${params.toString()}`;
	}

	// Exchange authorization code for tokens
	async exchangeCode(code: string): Promise<TokenStorage> {
		const response = await requestUrl({
			url: `${STRAVA_AUTH_BASE}/token`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				client_id: this.clientId,
				client_secret: this.clientSecret,
				code: code,
				grant_type: 'authorization_code',
			}).toString(),
			timeout: REQUEST_TIMEOUT_MS,
		});

		const data = response.json as StravaTokenResponse;

		const tokens: TokenStorage = {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: data.expires_at,
		};

		this.tokenStorage = tokens;
		await this.onTokenRefresh(tokens);

		return tokens;
	}

	// Refresh the access token
	async refreshAccessToken(): Promise<TokenStorage> {
		if (!this.tokenStorage.refreshToken) {
			throw new Error('No refresh token available');
		}

		const response = await requestUrl({
			url: `${STRAVA_AUTH_BASE}/token`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				client_id: this.clientId,
				client_secret: this.clientSecret,
				grant_type: 'refresh_token',
				refresh_token: this.tokenStorage.refreshToken,
			}).toString(),
			timeout: REQUEST_TIMEOUT_MS,
		});

		const data = response.json as StravaTokenResponse;

		const tokens: TokenStorage = {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: data.expires_at,
		};

		this.tokenStorage = tokens;
		await this.onTokenRefresh(tokens);

		return tokens;
	}

	// Check if token is expired or expiring soon
	private isTokenExpired(): boolean {
		const now = Math.floor(Date.now() / 1000);
		return this.tokenStorage.expiresAt <= now + TOKEN_REFRESH_BUFFER_SECONDS;
	}

	// Ensure we have a valid access token
	private async ensureValidToken(): Promise<void> {
		if (!this.tokenStorage.accessToken) {
			throw new Error('Not authenticated with Strava');
		}

		if (this.isTokenExpired()) {
			await this.refreshAccessToken();
		}
	}

	// Make an authenticated API request with rate limiting, retry logic, and exponential backoff
	private async request<T>(endpoint: string): Promise<T> {
		const url = `${STRAVA_API_BASE}${endpoint}`;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				await this.ensureValidToken();
				await this.rateLimit();

				const response = await requestUrl({
					url,
					method: 'GET',
					headers: {
						'Authorization': `Bearer ${this.tokenStorage.accessToken}`,
					},
					throw: false,
					timeout: REQUEST_TIMEOUT_MS,
				});

				// Success
				if (response.status >= 200 && response.status < 300) {
					return response.json as T;
				}

				// Handle 401 - token might have been revoked
				if (response.status === 401) {
					await this.refreshAccessToken();
					// Don't count this as a retry attempt, just retry with new token
					continue;
				}

				// Handle 429 - rate limited
				if (response.status === 429) {
					const retryAfter = response.headers?.['retry-after'];
					const backoffMs = this.calculateBackoff(attempt, retryAfter);
					logger.debug(`Rate limited (429), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
					await this.delay(backoffMs);
					continue;
				}

				// Server errors (5xx) - retry with backoff
				if (response.status >= 500) {
					const backoffMs = this.calculateBackoff(attempt);
					logger.debug(`Server error (${response.status}), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
					await this.delay(backoffMs);
					continue;
				}

				// Client errors (4xx except 401, 429) - don't retry, throw immediately
				throw new Error(`Strava API error: ${response.status}`);

			} catch (error) {
				// Network errors - retry with backoff
				if (error instanceof Error && !error.message.includes('Strava API error')) {
					lastError = error;
					const backoffMs = this.calculateBackoff(attempt);
					logger.debug(`Network error, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
					await this.delay(backoffMs);
					continue;
				}
				throw error;
			}
		}

		throw lastError || new Error(`Max retries (${MAX_RETRIES}) exceeded for: ${url}`);
	}

	// Test the connection by fetching athlete info
	async testConnection(): Promise<{ success: boolean; error?: string; athlete?: string }> {
		try {
			await this.ensureValidToken();

			const response = await requestUrl({
				url: `${STRAVA_API_BASE}/athlete`,
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${this.tokenStorage.accessToken}`,
				},
				throw: false,
				timeout: REQUEST_TIMEOUT_MS,
			});

			if (response.status === 200) {
				const athlete = response.json;
				return {
					success: true,
					athlete: `${athlete.firstname} ${athlete.lastname}`,
				};
			}

			return { success: false, error: `HTTP ${response.status}` };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	// Get activities for a date range (bulk fetch to avoid rate limits)
	// Returns activities grouped by date string (YYYY-MM-DD)
	async getActivitiesForDateRange(startDate: Date, endDate: Date): Promise<Map<string, StravaActivity[]>> {
		const start = new Date(startDate);
		start.setHours(0, 0, 0, 0);
		const end = new Date(endDate);
		end.setHours(23, 59, 59, 999);

		const after = Math.floor(start.getTime() / 1000);
		const before = Math.floor(end.getTime() / 1000);

		// Fetch up to 200 activities (Strava max per page)
		const endpoint = `/athlete/activities?after=${after}&before=${before}&per_page=200`;
		const activities = await this.request<StravaActivity[]>(endpoint);

		// Group activities by date
		const byDate = new Map<string, StravaActivity[]>();
		for (const activity of activities) {
			const dateStr = activity.start_date_local.split('T')[0];
			const existing = byDate.get(dateStr) || [];
			existing.push(activity);
			byDate.set(dateStr, existing);
		}

		return byDate;
	}

	// Get activities for a specific date
	async getActivitiesForDate(date: Date): Promise<StravaActivity[]> {
		const dateStr = formatDateForComparison(date);
		const byDate = await this.getActivitiesForDateRange(date, date);
		return byDate.get(dateStr) || [];
	}

	// Sync data for a specific date
	async syncData(date: Date): Promise<SyncResult> {
		const activities = await this.getActivitiesForDate(date);
		const metrics = aggregateMetrics(activities);

		return {
			date: formatDateForComparison(date),
			activities,
			metrics,
		};
	}

	// Sync data for multiple dates (bulk fetch)
	async syncDataBulk(startDate: Date, endDate: Date): Promise<Map<string, SyncResult>> {
		const activitiesByDate = await this.getActivitiesForDateRange(startDate, endDate);
		const results = new Map<string, SyncResult>();

		// Create results for each date in the range, even if no activities
		const current = new Date(startDate);
		current.setHours(0, 0, 0, 0);
		const end = new Date(endDate);
		end.setHours(0, 0, 0, 0);

		while (current <= end) {
			const dateStr = formatDateForComparison(current);
			const activities = activitiesByDate.get(dateStr) || [];
			const metrics = aggregateMetrics(activities);
			results.set(dateStr, { date: dateStr, activities, metrics });
			current.setDate(current.getDate() + 1);
		}

		return results;
	}

	// Check if authenticated (has valid tokens)
	isAuthenticated(): boolean {
		return !!(this.tokenStorage.accessToken && this.tokenStorage.refreshToken);
	}
}

// Exported for testing
export const BACKOFF_CONFIG = {
	MAX_RETRIES,
	INITIAL_BACKOFF_MS,
	MAX_BACKOFF_MS,
} as const;

/**
 * Calculate backoff delay with exponential increase and optional jitter.
 * Exported for testing.
 */
export function calculateBackoff(
	attempt: number,
	retryAfterHeader?: string,
	addJitter: (ms: number) => number = (ms) => {
		const jitterFactor = 0.75 + Math.random() * 0.5;
		return Math.round(ms * jitterFactor);
	}
): number {
	// If server tells us how long to wait, respect that (with some jitter)
	if (retryAfterHeader) {
		const retryAfterSeconds = parseInt(retryAfterHeader, 10);
		if (!isNaN(retryAfterSeconds)) {
			return addJitter(retryAfterSeconds * 1000);
		}
	}

	// Exponential backoff: 500ms, 1s, 2s, 4s, 8s... capped at MAX_BACKOFF_MS
	const exponentialMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
	const cappedMs = Math.min(exponentialMs, MAX_BACKOFF_MS);
	return addJitter(cappedMs);
}

// Helper: format date as YYYY-MM-DD
function formatDateForComparison(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}
