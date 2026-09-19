/**
 * The geometry behind the access-window timeline, kept out of the component.
 *
 * d3 is used for what d3 is genuinely good at - the time scale and its tick
 * selection - and React renders the SVG. That split means the bars are real DOM
 * nodes a test can query, instead of elements d3 imperatively appended.
 *
 * This is the chart notebook 04 draws in matplotlib: one row per target, one
 * bar per opportunity, coloured by satellite.
 */
import { scaleUtc } from 'd3-scale';
import { utcFormat } from 'd3-time-format';
import type { AccessWindow, TimeRange } from '../interfaces';

/**
 * A window lasts about 85 s. On a 3-day axis that is a fraction of a pixel, so
 * bars are drawn at a floor width to stay visible. Notebook 04 does exactly the
 * same thing and says so in its title: bar width is legibility, not duration.
 */
export const MIN_BAR_PX = 3;

export interface TimelineBar {
  window: AccessWindow;
  /** Row index - the target's position in `rows`. */
  row: number;
  x: number;
  width: number;
}

export interface TimelineLayout {
  rows: string[];
  bars: TimelineBar[];
  ticks: TimelineTick[];
  width: number;
  height: number;
  rowHeight: number;
  barHeight: number;
}

export interface TimelineTick {
  x: number;
  label: string;
  at: Date;
}

export interface TimelineInput {
  windows: AccessWindow[];
  /** Target names, in the order the rows should appear. */
  rows: string[];
  horizon: TimeRange;
  width: number;
  rowHeight: number;
  tickCount?: number;
}

/**
 * UTC everywhere. scaleUtc places its ticks on UTC boundaries and utcFormat
 * labels them in UTC, so the axis is identical on a laptop in Tokyo and one in
 * Paris. Mission planning has no local time.
 */
const formatTick = utcFormat('%b %d %H:%M');

/**
 * Turn windows into bar rectangles. Windows whose target is not in `rows` are
 * dropped rather than piled onto row 0 - a bar in the wrong row is worse than
 * no bar.
 */
export function layoutTimeline(input: TimelineInput): TimelineLayout {
  const { rows, rowHeight, width } = input;
  const scale = scaleUtc()
    .domain([input.horizon.from, input.horizon.to])
    .range([0, Math.max(width, 1)]);

  const rowIndex = new Map(rows.map((name, i) => [name, i]));
  const bars: TimelineBar[] = [];

  for (const window of input.windows) {
    const row = rowIndex.get(window.target);
    if (row === undefined) continue;
    const x = scale(window.startUtc);
    const rawWidth = scale(window.endUtc) - x;
    bars.push({ window, row, x, width: Math.max(rawWidth, MIN_BAR_PX) });
  }

  const ticks = scale.ticks(input.tickCount ?? 6).map((at) => ({
    at,
    x: scale(at),
    label: formatTick(at),
  }));

  return {
    rows,
    bars,
    ticks,
    width,
    height: rows.length * rowHeight,
    rowHeight,
    barHeight: Math.max(rowHeight - 10, 8),
  };
}

/** Row order: the targets the backend returned, then any extra the windows mention. */
export function timelineRows(windows: AccessWindow[], targetNames: string[]): string[] {
  const known = new Set(targetNames);
  const extra = [...new Set(windows.map((w) => w.target))].filter((t) => !known.has(t)).sort();
  return [...targetNames, ...extra];
}

/**
 * Convert two x pixel positions from a drag into a time range. The order the
 * user dragged in does not matter, and a range under `minPx` is treated as a
 * click (null) so a stray tap does not filter everything away.
 */
export function brushToRange(
  horizon: TimeRange,
  width: number,
  fromX: number,
  toX: number,
  minPx = 6,
): TimeRange | null {
  // A pointer event that carried no coordinate must not become an Invalid Date
  // range that then filters the whole timeline away.
  if (!Number.isFinite(fromX) || !Number.isFinite(toX)) return null;
  if (Math.abs(toX - fromX) < minPx) return null;
  const scale = scaleUtc()
    .domain([horizon.from, horizon.to])
    .range([0, Math.max(width, 1)]);
  const lo = Math.min(fromX, toX);
  const hi = Math.max(fromX, toX);
  return { from: scale.invert(lo), to: scale.invert(hi) };
}
