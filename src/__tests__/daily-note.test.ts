import { describe, it, expect } from 'vitest';
import {
	formatDuration,
	formatPace,
	formatSpeed,
	formatDistance,
	formatActivityLine,
	CYCLING_TYPES,
} from '../daily-note';
import { StravaActivity } from '../types';

describe('formatDuration', () => {
	it('formats seconds under a minute correctly', () => {
		expect(formatDuration(45)).toBe('0:45');
	});

	it('formats minutes under an hour correctly', () => {
		expect(formatDuration(600)).toBe('10:00');
		expect(formatDuration(1234)).toBe('20:34');
	});

	it('formats hours correctly', () => {
		expect(formatDuration(3600)).toBe('1:00:00');
		expect(formatDuration(3661)).toBe('1:01:01');
		expect(formatDuration(7384)).toBe('2:03:04');
	});

	it('pads minutes and seconds with zeros', () => {
		expect(formatDuration(61)).toBe('1:01');
		expect(formatDuration(3665)).toBe('1:01:05');
	});

	it('handles zero seconds', () => {
		expect(formatDuration(0)).toBe('0:00');
	});
});

describe('formatPace', () => {
	it('returns dash for zero speed', () => {
		expect(formatPace(0)).toBe('-');
	});

	it('returns dash for negative speed', () => {
		expect(formatPace(-1)).toBe('-');
	});

	it('calculates pace correctly for 10 km/h (2.78 m/s)', () => {
		// 10 km/h = 6:00 /km, 2.78 m/s → 1000/2.78 = 359.7s → rounds to 6:00
		const pace = formatPace(2.78);
		expect(pace).toBe('6:00 /km');
	});

	it('calculates pace correctly for 12 km/h (3.33 m/s)', () => {
		// 12 km/h = 5:00 /km
		const pace = formatPace(3.333);
		expect(pace).toBe('5:00 /km');
	});

	it('calculates pace correctly for 6 km/h (1.67 m/s)', () => {
		// 6 km/h = 10:00 /km, 1.667 m/s → 1000/1.667 = 599.9s → rounds to 10:00
		const pace = formatPace(1.667);
		expect(pace).toBe('10:00 /km');
	});

	it('calculates pace correctly for faster speeds', () => {
		// 15 km/h = 4:00 /km
		const pace = formatPace(4.167);
		expect(pace).toBe('4:00 /km');
	});
});

describe('formatSpeed', () => {
	it('returns dash for zero speed', () => {
		expect(formatSpeed(0)).toBe('-');
	});

	it('returns dash for negative speed', () => {
		expect(formatSpeed(-1)).toBe('-');
	});

	it('converts m/s to km/h correctly', () => {
		// 10 m/s = 36 km/h
		expect(formatSpeed(10)).toBe('36.0 km/h');
	});

	it('formats speed with one decimal place', () => {
		// 8.33 m/s ≈ 30 km/h
		expect(formatSpeed(8.333)).toBe('30.0 km/h');
	});

	it('handles typical cycling speed', () => {
		// 25 km/h = 6.94 m/s
		expect(formatSpeed(6.944)).toBe('25.0 km/h');
	});
});

describe('formatDistance', () => {
	it('converts metres to km with one decimal place', () => {
		expect(formatDistance(1000)).toBe('1.0 km');
		expect(formatDistance(5000)).toBe('5.0 km');
		expect(formatDistance(10500)).toBe('10.5 km');
	});

	it('handles sub-kilometre distances', () => {
		expect(formatDistance(500)).toBe('0.5 km');
		expect(formatDistance(100)).toBe('0.1 km');
	});

	it('rounds to one decimal place', () => {
		expect(formatDistance(1234)).toBe('1.2 km');
		expect(formatDistance(1250)).toBe('1.3 km'); // Rounds up
		expect(formatDistance(1249)).toBe('1.2 km');
	});

	it('handles zero distance', () => {
		expect(formatDistance(0)).toBe('0.0 km');
	});
});

describe('CYCLING_TYPES', () => {
	it('includes standard ride types', () => {
		expect(CYCLING_TYPES).toContain('Ride');
		expect(CYCLING_TYPES).toContain('VirtualRide');
		expect(CYCLING_TYPES).toContain('GravelRide');
		expect(CYCLING_TYPES).toContain('MountainBikeRide');
		expect(CYCLING_TYPES).toContain('EBikeRide');
	});

	it('does not include non-cycling types', () => {
		expect(CYCLING_TYPES).not.toContain('Run');
		expect(CYCLING_TYPES).not.toContain('Walk');
		expect(CYCLING_TYPES).not.toContain('Swim');
	});
});

describe('formatActivityLine', () => {
	const createActivity = (overrides: Partial<StravaActivity>): StravaActivity => ({
		id: 1,
		name: 'Morning Run',
		type: 'Run',
		sport_type: 'Run',
		distance: 5000,
		moving_time: 1800,
		elapsed_time: 2000,
		total_elevation_gain: 50,
		start_date: '2024-01-01T10:00:00Z',
		start_date_local: '2024-01-01T10:00:00',
		timezone: 'Europe/London',
		average_speed: 2.78,
		max_speed: 3.5,
		...overrides,
	});

	it('formats running activity with pace', () => {
		const activity = createActivity({
			type: 'Run',
			name: 'Morning Run',
			distance: 5000,
			moving_time: 1800,
			average_speed: 2.78, // ~10 km/h
			total_elevation_gain: 5, // Below threshold
		});
		const line = formatActivityLine(activity);
		expect(line).toContain('🏃');
		expect(line).toContain('**Morning Run**');
		expect(line).toContain('5.0 km');
		expect(line).toContain('30:00');
		expect(line).toContain('/km');
		expect(line).not.toContain('elevation');
	});

	it('formats cycling activity with speed', () => {
		const activity = createActivity({
			type: 'Ride',
			name: 'Evening Ride',
			distance: 20000,
			moving_time: 3600,
			average_speed: 5.56, // 20 km/h
			total_elevation_gain: 5,
		});
		const line = formatActivityLine(activity);
		expect(line).toContain('🚴');
		expect(line).toContain('**Evening Ride**');
		expect(line).toContain('20.0 km');
		expect(line).toContain('1:00:00');
		expect(line).toContain('km/h');
		expect(line).not.toContain('/km');
	});

	it('includes elevation when above threshold', () => {
		const activity = createActivity({
			total_elevation_gain: 150,
		});
		const line = formatActivityLine(activity);
		expect(line).toContain('+150m elevation');
	});

	it('omits elevation when at or below threshold (10m)', () => {
		const activity = createActivity({
			total_elevation_gain: 10,
		});
		const line = formatActivityLine(activity);
		expect(line).not.toContain('elevation');
	});

	it('shows dash for zero speed', () => {
		const activity = createActivity({
			average_speed: 0,
		});
		const line = formatActivityLine(activity);
		expect(line).toContain('(-)');
	});

	it('uses correct emoji for activity type', () => {
		expect(formatActivityLine(createActivity({ type: 'Run' }))).toContain('🏃');
		expect(formatActivityLine(createActivity({ type: 'Ride' }))).toContain('🚴');
		expect(formatActivityLine(createActivity({ type: 'Swim' }))).toContain('🏊');
		expect(formatActivityLine(createActivity({ type: 'Walk' }))).toContain('🚶');
		expect(formatActivityLine(createActivity({ type: 'Hike' }))).toContain('🥾');
	});

	it('formats as markdown bullet point', () => {
		const activity = createActivity({});
		const line = formatActivityLine(activity);
		expect(line).toMatch(/^- /);
	});

	it('rounds elevation to nearest metre', () => {
		const activity = createActivity({
			total_elevation_gain: 123.7,
		});
		const line = formatActivityLine(activity);
		expect(line).toContain('+124m elevation');
	});
});
