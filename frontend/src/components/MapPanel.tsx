import { useState } from 'react';
import DeckGL from '@deck.gl/react';
import { MapView } from '@deck.gl/core';
import type { MapViewState, PickingInfo } from '@deck.gl/core';
import type { Scene, SubSatellitePoint, Target } from '../interfaces';
import { formatDeg, formatKm, formatUtc } from '../lib/format';
import { BASEMAP_ATTRIBUTION, buildMapLayers } from '../lib/layers';
import type { MapLayerInput } from '../lib/layers';

/**
 * The deck.gl map. This component is deliberately thin: it owns the camera and
 * the tooltip, and hands everything else to buildMapLayers in lib/, which is
 * where the layers are actually decided and where they are tested.
 */

/**
 * repeat: true draws every layer in each copy of the world.
 *
 * Without it deck.gl renders a mark only at its canonical longitude, so zooming
 * out far enough to see more than one world width made the ground tracks,
 * footprints and target markers appear and disappear depending on which copy
 * the viewport happened to be over - and marks near the antimeridian landed on
 * the wrong side. The basemap tiles repeat either way, which is what made the
 * mismatch look like the marks were in the wrong place.
 */
const MAP_VIEW = new MapView({ repeat: true });

/** Kyushu, framed on the Mt. Aso scene the real product covers. */
export const INITIAL_VIEW: MapViewState = {
  longitude: 131.09,
  latitude: 32.89,
  zoom: 3.4,
  pitch: 0,
  bearing: 0,
};

type Props = MapLayerInput & {
  /** Covers the canvas when there is nothing to draw or the map data failed. */
  overlay?: React.ReactNode;
  /** Sits over the top of the canvas when one feed failed but the rest drew. */
  banner?: React.ReactNode;
};

function tooltipText(object: unknown): string | null {
  if (object === null || typeof object !== 'object') return null;

  if ('footprint' in object) {
    const s = object as Scene;
    return `${s.satellite} · ${s.imagingMode}\n${formatUtc(s.acquiredUtc)}\noff-nadir ${formatDeg(s.offNadirDeg)} · ${s.lookSide}-looking${s.synthetic ? '\nSYNTHETIC' : ''}`;
  }
  if ('altKm' in object) {
    const p = object as SubSatellitePoint;
    return `${p.satellite}\n${formatUtc(p.timeUtc)}\nalt ${formatKm(p.altKm)}${p.clamped ? '\n(track end, not current)' : ''}`;
  }
  if ('latDeg' in object) {
    const t = object as Target;
    return `${t.name}\n${t.latDeg.toFixed(3)}, ${t.lonDeg.toFixed(3)}`;
  }
  return null;
}

export function MapPanel({ overlay, banner, ...layerInput }: Props): React.JSX.Element {
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null);

  return (
    <section className="panel console__map" aria-label="Map">
      <div className="map">
        {/* The canvas itself is a WebGL surface with nothing inside it to read,
            so this is the only description of the left half of the console a
            screen reader ever gets. */}
        <p className="visually-hidden">
          {layerInput.scenes.length} scene footprints, {layerInput.tracks.length} ground tracks and{' '}
          {layerInput.targets.length} targets. The scene list in the metadata panel is the keyboard
          equivalent of clicking a footprint.
        </p>
        <div className="map__canvas">
          <DeckGL
            views={MAP_VIEW}
            initialViewState={INITIAL_VIEW}
            controller={{ dragRotate: false }}
            layers={buildMapLayers(layerInput)}
            onHover={(info: PickingInfo) => {
              const text = info.object ? tooltipText(info.object) : null;
              setHover(text === null ? null : { text, x: info.x, y: info.y });
            }}
          />
        </div>

        {hover && (
          <div className="map__tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            {hover.text.split('\n').map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        )}

        {banner && <div className="map__banner">{banner}</div>}
        <div className="map__attribution">{BASEMAP_ATTRIBUTION}</div>
        {overlay && <div className="map__overlay">{overlay}</div>}
      </div>
    </section>
  );
}
