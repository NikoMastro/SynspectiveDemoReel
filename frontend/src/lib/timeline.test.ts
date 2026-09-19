import { describe, expect, it } from 'vitest';
import {
  brushToRange,
  layoutTimeline,
  MIN_BAR_PX,
  rangeToPixels,
  timelineRows,
} from './timeline';
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

describe('rangeToPixels', () => {
  const horizon = {
    from: new Date('2026-09-19T00:00:00Z'),
    to: new Date('2026-09-22T00:00:00Z'),
  };

  it('is null when nothing is selected', () => {
    expect(rangeToPixels(horizon, 600, null)).toBeNull();
  });

  it('places a range where the scale puts it', () => {
    // The middle day of three, so exactly the middle third of the width.
    const got = rangeToPixels(horizon, 600, {
      from: new Date('2026-09-20T00:00:00Z'),
      to: new Date('2026-09-21T00:00:00Z'),
    });
    expect(got?.x0).toBeCloseTo(200, 6);
    expect(got?.x1).toBeCloseTo(400, 6);
  });

  it('round-trips a brush back to the pixels it came from', () => {
    // The pair only means anything if they are inverses: the band drawn after a
    // brush has to sit where the drag was.
    const range = brushToRange(horizon, 600, 120, 330);
    expect(range).not.toBeNull();
    const back = rangeToPixels(horizon, 600, range);
    expect(back?.x0).toBeCloseTo(120, 6);
    expect(back?.x1).toBeCloseTo(330, 6);
  });

  it('orders the edges, so a right-to-left drag still draws', () => {
    const got = rangeToPixels(horizon, 600, {
      from: new Date('2026-09-21T00:00:00Z'),
      to: new Date('2026-09-20T00:00:00Z'),
    });
    expect(got!.x0).toBeLessThan(got!.x1);
  });
});
