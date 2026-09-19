import { useMemo, useRef, useState } from 'react';
import type { AccessReport, AccessWindow, TimeRange } from '../interfaces';
import type { SatelliteColorScale } from '../lib/colors';
import { countWindowsBySatellite, windowsInRange } from '../lib/filters';
import { formatUtcShort } from '../lib/format';
import { brushToRange, layoutTimeline, timelineRows } from '../lib/timeline';
import { SatelliteLegend } from './SatelliteLegend';
import { CHART_MARGIN, TimelineChart } from './TimelineChart';
import { useElementWidth } from './useElementWidth';

/**
 * The planning timeline panel: the chart, the legend, and the brush that turns
 * a drag into a time range. The range is lifted to App, because the map sizes
 * its target markers by the opportunity count inside it - brushing the timeline
 * is how the two views talk to each other.
 */

const ROW_HEIGHT = 30;
const FALLBACK_WIDTH = 760;

// The row labels are drawn right-aligned against the gutter, so the gutter has
// to be as wide as the longest one. A fixed 96 px holds "Mt. Aso, JP" and clips
// "Longyearbyen, NO", which measures about 106 px at the 12 px the stylesheet
// sets. 6.7 px per character is that measurement divided by its length - close
// enough for a label, and it costs nothing, where measuring text properly means
// a canvas and a layout pass.
//
// The cap matters more than the estimate: on a 360 px phone an honest gutter for
// a long name would eat the plot, so a third of the host is the ceiling and the
// <title> on the label carries the full name when it is reached.
const LABEL_PX_PER_CHAR = 6.7;
const LABEL_PADDING = 14;
const MIN_GUTTER = 96;

function labelGutter(rows: string[], hostWidth: number): number {
  const widest = rows.reduce(
    (px, row) => Math.max(px, row.length * LABEL_PX_PER_CHAR + LABEL_PADDING),
    MIN_GUTTER,
  );
  return Math.min(widest, Math.max(hostWidth * 0.34, MIN_GUTTER));
}

interface Props {
  report: AccessReport;
  colors: SatelliteColorScale;
  highlighted: string | null;
  onHighlight: (satellite: string | null) => void;
  range: TimeRange | null;
  onRangeChange: (range: TimeRange | null) => void;
}

export function AccessTimeline({
  report,
  colors,
  highlighted,
  onHighlight,
  range,
  onRangeChange,
}: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const hostWidth = useElementWidth(hostRef, FALLBACK_WIDTH);
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const [picked, setPicked] = useState<AccessWindow | null>(null);

  // Memoised because a pointer drag re-renders this component on every move,
  // and laying out every window again for each frame is work the brush does not
  // need. Cheap today at 219 windows; not cheap once a sortable table and a
  // ticking countdown share the same render.
  const horizon: TimeRange = useMemo(
    () => ({
      from: report.horizon.startUtc,
      to: new Date(report.horizon.startUtc.getTime() + report.horizon.days * 86_400_000),
    }),
    [report.horizon],
  );

  const rows = useMemo(
    () => timelineRows(report.windows, report.targets.map((t) => t.name)),
    [report.windows, report.targets],
  );

  const gutter = labelGutter(rows, hostWidth);
  const plotWidth = Math.max(hostWidth - gutter - CHART_MARGIN.right, 120);

  const layout = useMemo(
    () => layoutTimeline({
      windows: report.windows,
      rows,
      horizon,
      width: plotWidth,
      rowHeight: ROW_HEIGHT,
    }),
    [report.windows, rows, horizon, plotWidth],
  );

  const inRange = useMemo(() => windowsInRange(report.windows, range), [report.windows, range]);
  const counts = useMemo(() => countWindowsBySatellite(inRange), [inRange]);

  /** Pixel x inside the plot area, from a pointer event anywhere on the host. */
  const localX = (event: React.PointerEvent<HTMLDivElement>): number =>
    event.clientX - event.currentTarget.getBoundingClientRect().left - gutter;

  const endDrag = (x: number) => {
    if (drag === null) return;
    setDrag(null);
    const next = brushToRange(horizon, plotWidth, drag.x0, x);
    // A drag shorter than the click threshold clears the range instead of
    // setting a meaningless one-pixel window.
    onRangeChange(next);
  };

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Access windows</h2>
        <span className="panel__note">
          {inRange.length} of {report.windows.length} opportunities
          {range ? ` · ${formatUtcShort(range.from)} – ${formatUtcShort(range.to)}` : ''}
          {' · '}
          off-nadir {report.assumptions.offNadirMinDeg}
          {'–'}
          {report.assumptions.offNadirMaxDeg}
          {'° (assumed)'}
        </span>
      </div>

      <div
        className="panel__body timeline"
        ref={hostRef}
        onPointerDown={(e) => {
          // Capture keeps the drag alive when the pointer leaves the panel.
          // It is an improvement, not a requirement - and jsdom does not
          // implement it - so a missing implementation must not break brushing.
          const host = e.currentTarget;
          if (typeof host.setPointerCapture === 'function') host.setPointerCapture(e.pointerId);
          setDrag({ x0: localX(e), x1: localX(e) });
        }}
        onPointerMove={(e) => {
          if (drag !== null) setDrag({ x0: drag.x0, x1: localX(e) });
        }}
        onPointerUp={(e) => endDrag(localX(e))}
        onPointerCancel={(e) => endDrag(localX(e))}
      >
        <TimelineChart
          layout={layout}
          marginLeft={gutter}
          colors={colors}
          highlighted={highlighted}
          selectedWindow={picked}
          brush={drag}
          onPickWindow={(w) => {
            setPicked(w);
            onHighlight(w.satellite);
          }}
        />
        <p className="timeline__hint">
          Drag across the chart to brush a time range; the map resizes its target markers to the
          opportunities inside it. Bar width is a legibility floor, not duration - a real window is
          around 85 s, well under a pixel on a {report.horizon.days}-day axis.
          {range && (
            <>
              {' '}
              <button type="button" className="button" onClick={() => onRangeChange(null)}>
                Clear range
              </button>
            </>
          )}
        </p>
      </div>

      <SatelliteLegend
        colors={colors}
        counts={counts}
        highlighted={highlighted}
        onHighlight={onHighlight}
      />
    </section>
  );
}
