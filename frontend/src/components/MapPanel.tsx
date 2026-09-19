import { useEffect, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { FlyToInterpolator, MapView } from '@deck.gl/core';
import type { MapViewState, PickingInfo } from '@deck.gl/core';
import type { LocateRequest, Scene, SceneImagery, SubSatellitePoint, Target } from '../interfaces';
import { formatDeg, formatKm, formatUtc } from '../lib/format';
import { BASEMAP_ATTRIBUTION, buildMapLayers } from '../lib/layers';
import type { MapLayerInput } from '../lib/layers';
import { fitFootprint } from '../lib/viewport';

/**
 * The deck.gl map. This component is deliberately thin: it owns the camera,
 * the tooltip and the two imagery controls, and hands everything else to
 * buildMapLayers in lib/, which is where the layers are actually decided and
 * where they are tested.
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

/** Long enough to read as travel rather than a cut, short enough not to be waited for. */
const FLY_MS = 900;

type Props = Omit<MapLayerInput, 'imagery'> & {
  /**
   * The selected scene's imagery, or null when it has none. The panel decides
   * whether it is drawn and how opaque: those are viewing choices, not data.
   */
  imagery: SceneImagery | null;
  /** Set to bring the camera to a footprint; a new key brings it again. */
  locate: LocateRequest | null;
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

/** Honours the OS setting the stylesheet already honours for CSS transitions. */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function MapPanel({
  overlay,
  banner,
  imagery,
  locate,
  ...layerInput
}: Props): React.JSX.Element {
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null);

  // Controlled rather than initialViewState. "Locate" has to move a camera the
  // operator has already panned, and deck.gl re-reads initialViewState only
  // when the object changes - which a second request for the same scene, after
  // panning away, would not be.
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW);
  const [showImagery, setShowImagery] = useState(true);
  const [opacityPct, setOpacityPct] = useState(100);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!locate) return;
    const canvas = canvasRef.current;
    const target = fitFootprint(locate.footprint, {
      width: canvas?.clientWidth ?? 0,
      height: canvas?.clientHeight ?? 0,
    });
    if (!target) return;

    setViewState({
      ...target,
      pitch: 0,
      bearing: 0,
      transitionDuration: prefersReducedMotion() ? 0 : FLY_MS,
      transitionInterpolator: new FlyToInterpolator(),
    });
  }, [locate]);

  const layers = buildMapLayers({
    ...layerInput,
    imagery: imagery && showImagery ? { ...imagery, opacity: opacityPct / 100 } : null,
  });

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
          {imagery && ' The selected scene’s radar image is drawn inside its footprint.'}
        </p>
        <div className="map__canvas" ref={canvasRef}>
          <DeckGL
            views={MAP_VIEW}
            viewState={viewState}
            onViewStateChange={(params) => setViewState(params.viewState as MapViewState)}
            controller={{ dragRotate: false }}
            layers={layers}
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

        {imagery && (
          <div className="map__controls" role="group" aria-label="Radar imagery">
            <label className="map__control">
              <input
                type="checkbox"
                checked={showImagery}
                onChange={(event) => setShowImagery(event.target.checked)}
              />
              Radar image
            </label>
            <label className="map__control">
              <span>Opacity</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={opacityPct}
                disabled={!showImagery}
                onChange={(event) => setOpacityPct(Number(event.target.value))}
              />
            </label>
          </div>
        )}

        {banner && <div className="map__banner">{banner}</div>}
        <div className="map__attribution">{BASEMAP_ATTRIBUTION}</div>
        {overlay && <div className="map__overlay">{overlay}</div>}
      </div>
    </section>
  );
}
