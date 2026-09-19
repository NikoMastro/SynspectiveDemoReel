import { describe, expect, it } from 'vitest';
import {
  formatDb,
  formatDeg,
  formatDegRange,
  formatDuration,
  formatGhz,
  formatKm,
  formatLatLon,
  formatUtc,
  formatUtcShort,
  orDash,
} from './format';

describe('formatUtc', () => {
  it('always prints UTC, whatever the machine timezone is', () => {
    expect(formatUtc(new Date('2026-06-15T06:35:27Z'))).toBe('2026-06-15 06:35:27Z');
  });

  it('pads single digits so timestamps line up in a column', () => {
    expect(formatUtc(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02 03:04:05Z');
  });

  it('does not render an invalid date as "NaN-NaN-NaN"', () => {
    expect(formatUtc(new Date('not a date'))).toBe('--');
  });

  it('has a short form for axis ticks', () => {
    expect(formatUtcShort(new Date('2026-06-15T06:35:27Z'))).toBe('Jun 15 06:35Z');
  });
});

describe('angles', () => {
  it('formats a single angle with a degree sign', () => {
    expect(formatDeg(31.9432)).toBe('31.94°');
    expect(formatDeg(31.9432, 1)).toBe('31.9°');
  });

  it('formats near-far as one range, the way a product sheet writes it', () => {
    expect(formatDegRange(34.34, 35.25)).toBe('34.34–35.25°');
  });

  it('degrades to a dash rather than printing NaN', () => {
    expect(formatDeg(Number.NaN)).toBe('--');
    expect(formatDegRange(Number.NaN, 1)).toBe('--');
  });
});

describe('formatDuration', () => {
  it('keeps sub-minute windows in seconds, which is what an access window is', () => {
    expect(formatDuration(82.407)).toBe('82.4 s');
  });

  it('switches to minutes and seconds past two minutes', () => {
    expect(formatDuration(125)).toBe('2m 05s');
    expect(formatDuration(119.9)).toBe('119.9 s');
  });

  it('rejects a negative duration', () => {
    expect(formatDuration(-1)).toBe('--');
  });
});

describe('other units', () => {
  it('formats NESZ in dB with its sign', () => {
    expect(formatDb(-23.456)).toBe('-23.5 dB');
  });

  it('formats the radar centre frequency in GHz', () => {
    expect(formatGhz(9.65)).toBe('9.65 GHz');
  });

  it('formats an altitude in km', () => {
    expect(formatKm(504.6)).toBe('504.6 km');
  });
});

describe('formatLatLon', () => {
  it('uses hemisphere letters instead of signs', () => {
    expect(formatLatLon(32.887635, 131.092252)).toBe('32.8876° N  131.0923° E');
  });

  it('handles the southern and western hemispheres', () => {
    expect(formatLatLon(-6.2088, -45.5)).toBe('6.2088° S  45.5000° W');
  });
});

describe('orDash', () => {
  it('never lets a blank field render as an empty cell', () => {
    expect(orDash(undefined)).toBe('--');
    expect(orDash('')).toBe('--');
    expect(orDash('   ')).toBe('--');
    expect(orDash('Sliding Spotlight')).toBe('Sliding Spotlight');
  });
});
