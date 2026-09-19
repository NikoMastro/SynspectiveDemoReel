import type { AccessWindow } from '../interfaces';
import type { SatelliteColorScale } from '../lib/colors';
import { formatDeg, formatDuration, formatUtc } from '../lib/format';
import type { TimelineLayout } from '../lib/timeline';

/**
 * The SVG for the access-window timeline: one row per target, one bar per
 * opportunity, coloured by satellite. This is notebook 04's chart, live.
 *
 * React renders the elements and d3 only computed the scale, which is why every
 * bar is a real DOM node - queryable by a test, focusable by keyboard, and
 * labelled for a screen reader.
 */

// left is a default only. The gutter has to hold the longest target name, so
// AccessTimeline measures it and passes marginLeft; see the note there.
export const CHART_MARGIN = { top: 22, right: 12, bottom: 6, left: 96 };

interface Props {
  layout: TimelineLayout;
  /** Width of the row-label gutter, measured by AccessTimeline. */
  marginLeft: number;
  colors: SatelliteColorScale;
  highlighted: string | null;
  selectedWindow: AccessWindow | null;
  /** The live drag, drawn while the pointer is down. */
  brush: { x0: number; x1: number } | null;
  /** The committed range, drawn until it is cleared. */
  selection: { x0: number; x1: number } | null;
  onPickWindow: (window: AccessWindow) => void;
}

// barTitle builds a multi-line tooltip; the accessible name is the same text
// with the line breaks turned into commas, so a screen reader reads a sentence.
const NEWLINE = '\n';

function barTitle(w: AccessWindow): string {
  return (
    `${w.satellite} → ${w.target}\n` +
    `${formatUtc(w.startUtc)} for ${formatDuration(w.durationS)}\n` +
    `best off-nadir ${formatDeg(w.bestOffNadirDeg, 1)}, ${w.lookSide}-looking, ${w.passDirection}`
  );
}

export function TimelineChart({
  layout,
  marginLeft,
  colors,
  highlighted,
  selectedWindow,
  brush,
  selection,
  onPickWindow,
}: Props): React.JSX.Element {
  const height = CHART_MARGIN.top + layout.height + CHART_MARGIN.bottom;
  const inset = (layout.rowHeight - layout.barHeight) / 2;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${marginLeft + layout.width + CHART_MARGIN.right} ${height}`}
      preserveAspectRatio="none"
      // role="group", not role="img": an image is a leaf, and its children -
      // every bar's label - are dropped from the accessibility tree. The whole
      // point of rendering the bars as DOM is that they stay reachable.
      role="group"
      aria-label={`Access windows: ${layout.bars.length} opportunities across ${layout.rows.length} targets`}
    >
      <g transform={`translate(${marginLeft}, ${CHART_MARGIN.top})`}>
        {layout.rows.map((row, i) => (
          <g key={row}>
            <rect
              className="timeline__band"
              x={0}
              y={i * layout.rowHeight}
              width={layout.width}
              height={layout.rowHeight}
              opacity={i % 2 === 0 ? 0.55 : 0.25}
            />
            <text
              className="timeline__row-label"
              x={-10}
              y={i * layout.rowHeight + layout.rowHeight / 2}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {row}
              <title>{row}</title>
            </text>
          </g>
        ))}

        {layout.ticks.map((tick) => (
          <g key={tick.at.toISOString()}>
            <line
              className="timeline__grid"
              x1={tick.x}
              x2={tick.x}
              y1={0}
              y2={layout.height}
              strokeDasharray="2 3"
            />
            <text className="timeline__tick-label" x={tick.x} y={-8} textAnchor="middle">
              {tick.label}
            </text>
          </g>
        ))}

        {/* Drawn under the bars, and before the live drag, so a new brush reads
            on top of the range it is about to replace. */}
        {selection && (
          <rect
            className="timeline__selection"
            x={selection.x0}
            y={0}
            width={Math.max(selection.x1 - selection.x0, 1)}
            height={layout.height}
          />
        )}

        {brush && (
          <rect
            className="timeline__brush"
            x={Math.min(brush.x0, brush.x1)}
            y={0}
            width={Math.abs(brush.x1 - brush.x0)}
            height={layout.height}
          />
        )}

        {layout.bars.map((bar) => {
          const w = bar.window;
          const dimmed = highlighted !== null && highlighted !== w.satellite;
          const isSelected =
            selectedWindow !== null &&
            selectedWindow.satellite === w.satellite &&
            selectedWindow.target === w.target &&
            selectedWindow.startUtc.getTime() === w.startUtc.getTime();

          return (
            <rect
              key={`${w.satellite}|${w.target}|${w.startUtc.toISOString()}`}
              className="timeline__bar"
              data-testid="timeline-bar"
              data-satellite={w.satellite}
              x={bar.x}
              y={bar.row * layout.rowHeight + inset}
              width={bar.width}
              height={layout.barHeight}
              rx={1.5}
              fill={colors.hex(w.satellite)}
              opacity={dimmed ? 0.18 : 1}
              // Same token the map footprints use. This was #ffffff, which was
              // correct against a dark console and invisible the moment the
              // theme went light - the bars sit on --surface-2.
              stroke={isSelected ? 'var(--ink)' : 'none'}
              strokeWidth={isSelected ? 2 : 0}
              tabIndex={0}
              role="button"
              // The hover tooltip is what names the satellite when colour alone
              // is not enough (see lib/colors.ts). A native <title> reaches a
              // mouse and nothing else, so the same sentence is the accessible
              // name, and Enter or Space does what the click does.
              aria-label={barTitle(w).split(NEWLINE).join(', ')}
              onClick={() => onPickWindow(w)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPickWindow(w);
                }
              }}
            >
              <title>{barTitle(w)}</title>
            </rect>
          );
        })}
      </g>
    </svg>
  );
}
