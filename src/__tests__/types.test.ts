import { describe, it, expect } from 'vitest';
import {
	getActivityEmoji,
	getActivityCategory,
	aggregateMetrics,
	StravaActivity,
	ACTIVITY_EMOJI,
} from '../types';

describe('getActivityEmoji', () => {
	it('returns correct emoji for Run', () => {
		expect(getActivityEmoji('Run')).toBe('🏃');
	});

	it('returns correct emoji for Ride', () => {
		expect(getActivityEmoji('Ride')).toBe('🚴');
	});

	it('returns correct emoji for Swim', () => {
		expect(getActivityEmoji('Swim')).toBe('🏊');
	});

	it('returns correct emoji for Walk', () => {
		expect(getActivityEmoji('Walk')).toBe('🚶');
	});

	it('returns correct emoji for Hike', () => {
		expect(getActivityEmoji('Hike')).toBe('🥾');
	});

	it('returns default emoji for unknown activity type', () => {
		expect(getActivityEmoji('UnknownActivity')).toBe('🏃');
	});

	it('returns default emoji for empty string', () => {
		expect(getActivityEmoji('')).toBe('🏃');
	});

	it('returns correct emoji for all defined types', () => {
		for (const [type, emoji] of Object.entries(ACTIVITY_EMOJI)) {
			expect(getActivityEmoji(type)).toBe(emoji);
		}
	});
});

describe('getActivityCategory', () => {
	it('categorises Run as running', () => {
		expect(getActivityCategory('Run')).toBe('running');
	});

	it('categorises Trail Run as running', () => {
		expect(getActivityCategory('Trail Run')).toBe('running');
	});

	it('categorises VirtualRun as running', () => {
		expect(getActivityCategory('VirtualRun')).toBe('running');
	});

	it('categorises Walk as walking', () => {
		expect(getActivityCategory('Walk')).toBe('walking');
	});

	it('categorises Hike as walking', () => {
		expect(getActivityCategory('Hike')).toBe('walking');
	});

	it('categorises Ride as cycling', () => {
		expect(getActivityCategory('Ride')).toBe('cycling');
	});

	it('categorises VirtualRide as cycling', () => {
		expect(getActivityCategory('VirtualRide')).toBe('cycling');
	});

	it('categorises GravelRide as cycling', () => {
		expect(getActivityCategory('GravelRide')).toBe('cycling');
	});

	it('categorises MountainBikeRide as cycling', () => {
		expect(getActivityCategory('MountainBikeRide')).toBe('cycling');
	});

	it('categorises EBikeRide as cycling', () => {
		expect(getActivityCategory('EBikeRide')).toBe('cycling');
	});

	it('categorises Swim as swimming', () => {
		expect(getActivityCategory('Swim')).toBe('swimming');
	});

	it('categorises unknown types as other', () => {
		expect(getActivityCategory('Yoga')).toBe('other');
		expect(getActivityCategory('WeightTraining')).toBe('other');
		expect(getActivityCategory('UnknownActivity')).toBe('other');
	});
});

describe('aggregateMetrics', () => {
	const createActivity = (overrides: Partial<StravaActivity>): StravaActivity => ({
		id: 1,
		name: 'Test Activity',
		type: 'Run',
		sport_type: 'Run',
		distance: 5000, // 5km
		moving_time: 1800, // 30 minutes
		elapsed_time: 2000,
		total_elevation_gain: 50,
		start_date: '2024-01-01T10:00:00Z',
		start_date_local: '2024-01-01T10:00:00',
		timezone: 'Europe/London',
		average_speed: 2.78, // ~10 km/h
		max_speed: 3.5,
		...overrides,
	});

	it('returns zero metrics for empty array', () => {
		const metrics = aggregateMetrics([]);
		expect(metrics).toEqual({
			walking_distance_m: 0,
			running_distance_m: 0,
			cycling_distance_m: 0,
			swimming_distance_m: 0,
			active_time: 0,
		});
	});

	it('aggregates single running activity correctly', () => {
		const activities = [createActivity({ type: 'Run', distance: 5000, moving_time: 1800 })];
		const metrics = aggregateMetrics(activities);
		expect(metrics.running_distance_m).toBe(5000);
		expect(metrics.active_time).toBe(30); // 1800 seconds = 30 minutes
		expect(metrics.walking_distance_m).toBe(0);
		expect(metrics.cycling_distance_m).toBe(0);
		expect(metrics.swimming_distance_m).toBe(0);
	});

	it('aggregates single cycling activity correctly', () => {
		const activities = [createActivity({ type: 'Ride', distance: 20000, moving_time: 3600 })];
		const metrics = aggregateMetrics(activities);
		expect(metrics.cycling_distance_m).toBe(20000);
		expect(metrics.active_time).toBe(60);
		expect(metrics.running_distance_m).toBe(0);
	});

	it('aggregates single walking activity correctly', () => {
		const activities = [createActivity({ type: 'Walk', distance: 3000, moving_time: 2400 })];
		const metrics = aggregateMetrics(activities);
		expect(metrics.walking_distance_m).toBe(3000);
		expect(metrics.active_time).toBe(40);
	});

	it('aggregates single swimming activity correctly', () => {
		const activities = [createActivity({ type: 'Swim', distance: 1500, moving_time: 1800 })];
		const metrics = aggregateMetrics(activities);
		expect(metrics.swimming_distance_m).toBe(1500);
		expect(metrics.active_time).toBe(30);
	});

	it('sums multiple activities by category', () => {
		const activities = [
			createActivity({ type: 'Run', distance: 5000, moving_time: 1800 }),
			createActivity({ type: 'Run', distance: 10000, moving_time: 3600 }),
			createActivity({ type: 'Ride', distance: 20000, moving_time: 3600 }),
		];
		const metrics = aggregateMetrics(activities);
		expect(metrics.running_distance_m).toBe(15000);
		expect(metrics.cycling_distance_m).toBe(20000);
		expect(metrics.active_time).toBe(150); // 30 + 60 + 60 minutes
	});

	it('handles mixed activity types in one batch', () => {
		const activities = [
			createActivity({ type: 'Run', distance: 5000, moving_time: 1800 }),
			createActivity({ type: 'Walk', distance: 2000, moving_time: 1200 }),
			createActivity({ type: 'Ride', distance: 15000, moving_time: 2400 }),
			createActivity({ type: 'Swim', distance: 1000, moving_time: 1200 }),
			createActivity({ type: 'Yoga', distance: 0, moving_time: 3600 }), // 'other' category
		];
		const metrics = aggregateMetrics(activities);
		expect(metrics.running_distance_m).toBe(5000);
		expect(metrics.walking_distance_m).toBe(2000);
		expect(metrics.cycling_distance_m).toBe(15000);
		expect(metrics.swimming_distance_m).toBe(1000);
		expect(metrics.active_time).toBe(170); // 30 + 20 + 40 + 20 + 60 minutes
	});

	it('rounds distance to nearest metre', () => {
		const activities = [createActivity({ type: 'Run', distance: 5000.7, moving_time: 1800 })];
		const metrics = aggregateMetrics(activities);
		expect(metrics.running_distance_m).toBe(5001);
	});

	it('rounds active time to nearest minute', () => {
		const activities = [createActivity({ type: 'Run', distance: 5000, moving_time: 1850 })]; // 30.83 mins
		const metrics = aggregateMetrics(activities);
		expect(metrics.active_time).toBe(31);
	});
});
