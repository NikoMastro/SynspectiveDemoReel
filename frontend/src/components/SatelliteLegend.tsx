import type { SatelliteColorScale } from '../lib/colors';

/**
 * The legend is not decoration here, it is the disambiguation mechanism.
 *
 * Eight satellites is the limit of a categorical palette: the hues separate
 * cleanly side by side, but across all 28 possible pairs two of them are close
 * under deuteranopia. So identity is never carried by colour alone - the legend
 * is always on screen, every timeline bar has a tooltip naming its satellite,
 * and clicking a chip isolates one satellite across the map and the timeline at
 * once. Clicking it again clears the isolation.
 */

interface Props {
  colors: SatelliteColorScale;
  counts: Map<string, number>;
  highlighted: string | null;
  onHighlight: (satellite: string | null) => void;
}

export function SatelliteLegend({
  colors,
  counts,
  highlighted,
  onHighlight,
}: Props): React.JSX.Element {
  return (
    <div className="legend" role="group" aria-label="Satellites">
      {colors.domain.map((satellite) => {
        const isOn = highlighted === satellite;
        return (
          <button
            key={satellite}
            type="button"
            className="legend__chip"
            aria-pressed={isOn}
            onClick={() => onHighlight(isOn ? null : satellite)}
          >
            <span
              className="legend__swatch"
              style={{ background: colors.hex(satellite) }}
              aria-hidden="true"
            />
            {satellite}
            <span className="legend__count">{counts.get(satellite) ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
