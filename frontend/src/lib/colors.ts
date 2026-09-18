/**
 * One colour scale for the whole console: the timeline bars, the ground tracks
 * and the legend all ask this module, so a satellite is the same colour
 * everywhere.
 *
 * Eight fixed hues, assigned in order and never cycled. They are the dark-mode
 * steps of a palette validated for colour-vision deficiency: as an ordered set
 * (the pairs a legend puts side by side) every gate passes. Across *all* 28
 * pairs it does not - #d55181 against #199e70 is deutan dE 1.6 - which is why
 * satellite identity in this UI is never colour alone: every bar has a hover
 * tooltip naming it, the legend is always on screen, and clicking a legend chip
 * isolates one satellite. See TESTING.md.
 */

/** Dark-surface categorical slots, in fixed assignment order. */
export const SERIES_HEX = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // yellow
  '#d55181', // magenta
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
] as const;

/** Used when a name is not in the scale's domain - grey, deliberately dull. */
export const UNKNOWN_HEX = '#8b93a1';

export type Rgb = [number, number, number];

/** '#3987e5' -> [57, 135, 229]. deck.gl wants channel arrays, CSS wants hex. */
export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface SatelliteColorScale {
  /** The satellite names this scale knows, in assignment order. */
  domain: string[];
  hex(satellite: string): string;
  rgb(satellite: string): Rgb;
}

/**
 * Build the scale from whatever satellites the backend returned. The domain is
 * sorted so that the colours do not move when the fetch order changes, and
 * slots are assigned by position in that sorted list - never by rank, count or
 * filter state, so filtering the fleet does not repaint the survivors.
 */
export function satelliteColorScale(satellites: string[]): SatelliteColorScale {
  const domain = [...new Set(satellites)].sort();
  const bySatellite = new Map<string, string>();
  domain.forEach((name, i) => {
    // Past eight satellites we stop inventing hues and fall back to grey,
    // rather than cycling and giving two satellites the same colour.
    bySatellite.set(name, SERIES_HEX[i] ?? UNKNOWN_HEX);
  });

  const hex = (satellite: string) => bySatellite.get(satellite) ?? UNKNOWN_HEX;
  return { domain, hex, rgb: (satellite) => hexToRgb(hex(satellite)) };
}
