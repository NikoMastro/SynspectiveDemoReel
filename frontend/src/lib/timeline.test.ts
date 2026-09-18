import { describe, expect, it } from 'vitest';
import { brushToRange, layoutTimeline, MIN_BAR_PX, timelineRows } from './timeline';
import { sampleAccess } from '../testFixtures';

const horizon = {
  from: new Date('2026-09-19T00:00:00Z'),
  to: new Date('2026-09-22T00:00:00Z'),
};

const base = {
  windows: sampleAccess.windows,
  rows: ['Mt. Aso, JP', 'Jakarta, ID'],
  horizon,
  width: 600,
  rowHeight: 30,
};

describe('layoutTimeline', () => {
  it('places each bar in its target row', () => {
    const layout = layoutTimeline(base);
    const aso = layout.bars.find((b) => b.window.target === 'Mt. Aso, JP');
    const jakarta = layout.bars.find((b) => b.window.target === 'Jakarta, ID');
    expect(aso?.row).toBe(0);
    expect(jakarta?.row).toBe(1);
  });

  it('drops a window whose target has no row instead of piling it onto row 0', () => {
    const layout = layoutTimeline(base);
    expect(layout.bars).toHaveLength(2);
    expect(layout.bars.some((b) => b.window.target === 'Nowhere, XX')).toBe(false);
  });

  it('maps the horizon onto the full plot width', () => {
    const layout = layoutTimeline({ ...base, windows: [] });
    expect(layout.width).toBe(600);
    expect(layout.ticks[0]?.x).toBeGreaterThanOrEqual(0);
    expect(layout.ticks.at(-1)?.x).toBeLessThanOrEqual(600);
  });

  it('positions a bar proportionally through the horizon', () => {
    // 2026-09-20T12:00Z is exactly halfway through a 3-day horizon.
    const layout = layoutTimeline(base);
    const aso = layout.bars.find((b) => b.window.target === 'Mt. Aso, JP');
    expect(aso?.x).toBeCloseTo(300, 6);
  });

  it('gives an 85 s window a floor width so it stays visible on a 3-day axis', () => {
    // 85 s of 3 days across 600 px is about 0.2 px - invisible without a floor.
    const layout = layoutTimeline(base);
    expect(layout.bars.every((b) => b.width >= MIN_BAR_PX)).toBe(true);
  });

  it('sizes the chart from the row count', () => {
    const layout = layoutTimeline(base);
    expect(layout.height).toBe(60);
    expect(layout.barHeight).toBe(20);
  });

  it('labels ticks in UTC and places them on UTC boundaries, whatever the machine timezone', () => {
    const layout = layoutTimeline({ ...base, windows: [], tickCount: 4 });
    expect(layout.ticks[0]?.label).toMatch(/^[A-Z][a-z]{2} \d{2} \d{2}:\d{2}$/);
    expect(layout.ticks.every((t) => t.at.getUTCMinutes() === 0)).toBe(true);
    expect(layout.ticks.some((t) => t.at.getUTCHours() === 0)).toBe(true);
  });
});

describe('timelineRows', () => {
  it('keeps the backend target order and appends anything extra the windows mention', () => {
    expect(timelineRows(sampleAccess.windows, ['Mt. Aso, JP', 'Jakarta, ID'])).toEqual([
      'Mt. Aso, JP',
      'Jakarta, ID',
      'Nowhere, XX',
    ]);
  });

  it('is just the target list when the windows add nothing', () => {
    expect(timelineRows([], ['Tokyo, JP'])).toEqual(['Tokyo, JP']);
  });
});

describe('brushToRange', () => {
  it('turns a drag into the time range it covers', () => {
    const range = brushToRange(horizon, 600, 0, 200);
    expect(range?.from.toISOString()).toBe('2026-09-19T00:00:00.000Z');
    expect(range?.to.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });

  it('does not care which direction the user dragged', () => {
    const forward = brushToRange(horizon, 600, 100, 400);
    const backward = brushToRange(horizon, 600, 400, 100);
    expect(backward).toEqual(forward);
  });

  it('treats a drag under the threshold as a click, so a tap does not filter everything out', () => {
    expect(brushToRange(horizon, 600, 300, 302)).toBeNull();
  });

  it('refuses a coordinate that is not a number instead of returning Invalid Dates', () => {
    expect(brushToRange(horizon, 600, Number.NaN, 400)).toBeNull();
    expect(brushToRange(horizon, 600, 100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
