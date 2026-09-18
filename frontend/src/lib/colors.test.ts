import { describe, expect, it } from 'vitest';
import { hexToRgb, satelliteColorScale, SERIES_HEX, UNKNOWN_HEX } from './colors';

describe('hexToRgb', () => {
  it('splits a hex triplet into deck.gl channel values', () => {
    expect(hexToRgb('#3987e5')).toEqual([57, 135, 229]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
  });
});

describe('satelliteColorScale', () => {
  it('assigns hues in fixed slot order over a sorted domain', () => {
    const scale = satelliteColorScale(['STRIX-5', 'STRIX-1', 'STRIX-3']);
    expect(scale.domain).toEqual(['STRIX-1', 'STRIX-3', 'STRIX-5']);
    expect(scale.hex('STRIX-1')).toBe(SERIES_HEX[0]);
    expect(scale.hex('STRIX-3')).toBe(SERIES_HEX[1]);
    expect(scale.hex('STRIX-5')).toBe(SERIES_HEX[2]);
  });

  it('does not depend on the order the backend returned the fleet in', () => {
    const a = satelliteColorScale(['STRIX-1', 'STRIX-2']);
    const b = satelliteColorScale(['STRIX-2', 'STRIX-1']);
    expect(b.hex('STRIX-1')).toBe(a.hex('STRIX-1'));
    expect(b.hex('STRIX-2')).toBe(a.hex('STRIX-2'));
  });

  it('de-duplicates a repeated name', () => {
    const scale = satelliteColorScale(['STRIX-1', 'STRIX-1']);
    expect(scale.domain).toEqual(['STRIX-1']);
  });

  it('never gives two satellites the same colour, even past eight', () => {
    const fleet = Array.from({ length: 10 }, (_, i) => `STRIX-${i + 1}`);
    const scale = satelliteColorScale(fleet);
    const assigned = fleet.map((n) => scale.hex(n));
    const coloured = assigned.filter((c) => c !== UNKNOWN_HEX);
    expect(new Set(coloured).size).toBe(coloured.length);
    // The ninth and tenth fall back to grey rather than reusing a hue.
    expect(scale.hex('STRIX-9')).toBe(UNKNOWN_HEX);
  });

  it('returns grey for a satellite outside its domain', () => {
    const scale = satelliteColorScale(['STRIX-1']);
    expect(scale.hex('STRIX-7')).toBe(UNKNOWN_HEX);
    expect(scale.rgb('STRIX-7')).toEqual(hexToRgb(UNKNOWN_HEX));
  });

  it('exposes eight distinct slots', () => {
    expect(new Set(SERIES_HEX).size).toBe(8);
  });
});
