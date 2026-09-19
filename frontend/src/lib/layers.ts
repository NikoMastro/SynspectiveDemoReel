/**
 * deck.gl layer factories.
 *
 * Every function here is pure: data in, a configured Layer out. Nothing touches
 * React state, a WebGL context or the DOM. That is deliberate and it is the
 * whole UI testing strategy for the map - a canvas has no DOM to assert on, but
 * a layer object has an id, a type, a data array and accessors that can be
 * called directly in a unit test. See TESTING.md.
 *
 * Colours come from a SatelliteColorScale passed in, never from a lookup made
 * here, so the map and the timeline cannot drift apart.
 */
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';

import type {
  GroundTrack,
  Position2D,
  Scene,
  SceneImagery,
  SubSatellitePoint,
  Target,
} from '../interfaces';
import type { SatelliteColorScale } from './colors';
import { hexToRgb } from './colors';
import { splitAtAntimeridian, trackPositions } from './tracks';

export type Rgba = [number, number, number, number];

/* Marks are drawn on OpenStreetMap raster, which is a light surface, so the
   high-contrast end of every pair is the dark one. Selection used to be white,
   which disappeared against the tiles the moment the console stopped being dark. */
const SELECTED: Rgba = [19, 28, 38, 255];
const OUTLINE_DARK: Rgba = [19, 28, 38, 255];
/* Targets are reference points, not a data series, so they take the neutral ink
   rather than a ninth hue that would compete with the eight satellites. */
const TARGET_FILL: Rgba = [43, 58, 74, 225];
const LABEL_INK: Rgba = [19, 28, 38, 255];
/* A light halo now: the label sits on tiles, and the halo is what separates it
   from them. */
const LABEL_HALO: Rgba = [255, 255, 255, 220];

function withAlpha(hex: string, alpha: number): Rgba {
  const [r, g, b] = hexToRgb(hex);
  return [r, g, b, alpha];
}

/** Dim anything that is not the highlighted satellite, instead of hiding it. */
function identityAlpha(satellite: string, highlighted: string | null, full: number): number {
  return highlighted === null || highlighted === satellite ? full : 50;
}

/**
 * Keyless raster basemap. OpenStreetMap tiles need no API key, which keeps the
 * whole demo runnable by anyone who clones it; the attribution the tile usage
 * policy requires is rendered in the map footer.
 */
export const BASEMAP_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const BASEMAP_ATTRIBUTION = '© OpenStreetMap contributors';

export function basemapLayer(): Layer {
  return new TileLayer<ImageBitmap>({
    id: 'basemap',
    data: BASEMAP_URL,
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    renderSubLayers: (props) => {
      // boundingBox is [[west, south], [east, north]]; BitmapLayer wants it flat.
      const box = props.tile.boundingBox as [[number, number], [number, number]];
      return new BitmapLayer({
        id: `${props.id}-bitmap`,
        image: props.data,
        bounds: [box[0][0], box[0][1], box[1][0], box[1][1]],
      });
    },
  });
}

export type ImageryOptions = SceneImagery & {
  /** 0..1, from the slider on the map. */
  opacity: number;
};

/**
 * The delivered product itself, draped inside its footprint. The PNG carries
 * alpha, so the corners of the raster's rectangle around the rotated swath
 * show the basemap through rather than black.
 */
export function quicklookLayer(options: ImageryOptions): Layer {
  return new BitmapLayer({
    id: 'scene-quicklook',
    image: options.url,
    bounds: options.quicklook.bounds,
    // The PNG is north-up in plain longitude/latitude (EPSG:4326), not Web
    // Mercator. Over 0.12 degrees of latitude the two differ by well under a
    // pixel, but it is the truth about the file and it costs one prop.
    _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
    opacity: options.opacity,
  });
}

export interface GroundTrackSegment {
  satellite: string;
  path: Position2D[];
}

/**
 * One path per continuous piece of track. The antimeridian split happens here,
 * before the layer is built, so the layer itself never has to know about it.
 */
export function groundTrackSegments(tracks: GroundTrack[]): GroundTrackSegment[] {
  return tracks.flatMap((track) =>
    splitAtAntimeridian(trackPositions(track)).map((path) => ({
      satellite: track.satellite,
      path,
    })),
  );
}

export interface GroundTrackOptions {
  tracks: GroundTrack[];
  colors: SatelliteColorScale;
  /** When set, every other satellite is dimmed rather than removed. */
  highlighted: string | null;
}

export function groundTrackLayer(options: GroundTrackOptions): Layer {
  const { colors, highlighted } = options;
  return new PathLayer<GroundTrackSegment>({
    id: 'ground-tracks',
    data: groundTrackSegments(options.tracks),
    widthUnits: 'pixels',
    widthMinPixels: 2,
    getWidth: 2,
    getPath: (d) => d.path,
    getColor: (d) => withAlpha(colors.hex(d.satellite), identityAlpha(d.satellite, highlighted, 230)),
    updateTriggers: { getColor: [highlighted, colors.domain.join()] },
  });
}

export interface SubSatelliteOptions {
  positions: SubSatellitePoint[];
  colors: SatelliteColorScale;
  highlighted: string | null;
}

export function subSatelliteLayer(options: SubSatelliteOptions): Layer {
  const { colors, highlighted } = options;
  return new ScatterplotLayer<SubSatellitePoint>({
    id: 'sub-satellite-points',
    data: options.positions,
    pickable: true,
    radiusUnits: 'pixels',
    getRadius: 7,
    radiusMinPixels: 7,
    stroked: true,
    lineWidthUnits: 'pixels',
    getLineWidth: 2,
    getLineColor: SELECTED,
    getPosition: (d) => [d.lonDeg, d.latDeg],
    getFillColor: (d) =>
      withAlpha(colors.hex(d.satellite), identityAlpha(d.satellite, highlighted, 255)),
    updateTriggers: { getFillColor: [highlighted, colors.domain.join()] },
  });
}

export function subSatelliteLabelLayer(options: SubSatelliteOptions): Layer {
  return new TextLayer<SubSatellitePoint>({
    id: 'sub-satellite-labels',
    data: options.positions,
    getPosition: (d) => [d.lonDeg, d.latDeg],
    // A clamped point is not "now" - say so on the map rather than in a footnote.
    getText: (d) => (d.clamped ? `${d.satellite} (track end)` : d.satellite),
    getSize: 11,
    sizeUnits: 'pixels',
    getPixelOffset: [0, -16],
    getColor: LABEL_INK,
    outlineColor: LABEL_HALO,
    outlineWidth: 3,
    fontSettings: { sdf: true },
  });
}

export interface FootprintOptions {
  scenes: Scene[];
  colors: SatelliteColorScale;
  selectedSceneId: string | null;
  /**
   * The scene whose imagery is drawn underneath, or null when none is. While a
   * picture is on screen every fill is dropped; the outlines stay and go on
   * carrying satellite identity.
   */
  imagedSceneId: string | null;
  onSelect: (sceneId: string) => void;
}

/**
 * Selection brightens the fill. Imagery removes every fill, not just the fill
 * of the scene being drawn.
 *
 * Clearing only the imaged scene's own fill was not enough, and the seed
 * catalog proves it: the synthetic STRIX-1 scene SYN-S1-20260830-09 covers 95%
 * of the Mt. Aso quicklook, so its translucent polygon washed another
 * satellite's hue across almost the whole radar image - the exact thing
 * dropping the fill was meant to prevent. Footprints overlap; that is normal
 * for a catalog, so the rule has to be about the picture rather than about one
 * polygon.
 */
function footprintFillAlpha(sceneId: string, selected: string | null, imaged: string | null): number {
  if (imaged !== null) return 0;
  return sceneId === selected ? 150 : 70;
}

/**
 * Scene footprints. The selected one gets a dark outline rather than a
 * different fill, so selection never competes with satellite identity.
 */
export function footprintLayer(options: FootprintOptions): Layer {
  const { colors, selectedSceneId, imagedSceneId } = options;
  return new PolygonLayer<Scene>({
    id: 'scene-footprints',
    data: options.scenes,
    pickable: true,
    filled: true,
    stroked: true,
    lineWidthUnits: 'pixels',
    getPolygon: (d) => d.footprint,
    getFillColor: (d) =>
      withAlpha(colors.hex(d.satellite), footprintFillAlpha(d.id, selectedSceneId, imagedSceneId)),
    getLineColor: (d) =>
      d.id === selectedSceneId ? SELECTED : withAlpha(colors.hex(d.satellite), 235),
    getLineWidth: (d) => (d.id === selectedSceneId ? 3 : 1.5),
    onClick: (info: PickingInfo<Scene>) => {
      if (info.object) options.onSelect(info.object.id);
      return true;
    },
    updateTriggers: {
      getFillColor: [selectedSceneId, imagedSceneId, colors.domain.join()],
      getLineColor: [selectedSceneId, colors.domain.join()],
      getLineWidth: [selectedSceneId],
    },
  });
}

/**
 * A Sliding Spotlight footprint is a few kilometres across - under a pixel at
 * world zoom. This dot keeps every scene findable however far out the camera
 * is, and it is the thing that is actually tappable on a phone.
 */
export function sceneCenterLayer(options: FootprintOptions): Layer {
  const { colors, selectedSceneId } = options;
  return new ScatterplotLayer<Scene>({
    id: 'scene-centers',
    data: options.scenes,
    pickable: true,
    radiusUnits: 'pixels',
    getRadius: (d) => (d.id === selectedSceneId ? 9 : 6),
    radiusMinPixels: 6,
    stroked: true,
    lineWidthUnits: 'pixels',
    getLineWidth: 1.5,
    getLineColor: (d) => (d.id === selectedSceneId ? SELECTED : OUTLINE_DARK),
    getPosition: (d) => [d.centerLonDeg, d.centerLatDeg],
    getFillColor: (d) => withAlpha(colors.hex(d.satellite), 235),
    onClick: (info: PickingInfo<Scene>) => {
      if (info.object) options.onSelect(info.object.id);
      return true;
    },
    updateTriggers: {
      getRadius: [selectedSceneId],
      getLineColor: [selectedSceneId],
      getFillColor: [colors.domain.join()],
    },
  });
}

export interface TargetOptions {
  targets: Target[];
  /** Opportunity count per target name, over the brushed timeline range. */
  windowCounts: Map<string, number>;
}

/** Radius grows with the square root of the count, so marker area reads linearly. */
export function targetRadiusPx(count: number): number {
  return 7 + Math.sqrt(Math.max(count, 0)) * 1.6;
}

export function targetLayer(options: TargetOptions): Layer {
  const { windowCounts } = options;
  return new ScatterplotLayer<Target>({
    id: 'targets',
    data: options.targets,
    pickable: true,
    radiusUnits: 'pixels',
    stroked: true,
    lineWidthUnits: 'pixels',
    getLineWidth: 2,
    getLineColor: OUTLINE_DARK,
    getPosition: (d) => [d.lonDeg, d.latDeg],
    getRadius: (d) => targetRadiusPx(windowCounts.get(d.name) ?? 0),
    getFillColor: TARGET_FILL,
    updateTriggers: { getRadius: [windowCounts] },
  });
}

export function targetLabelLayer(options: TargetOptions): Layer {
  return new TextLayer<Target>({
    id: 'target-labels',
    data: options.targets,
    getPosition: (d) => [d.lonDeg, d.latDeg],
    getText: (d) => d.name,
    getSize: 12,
    sizeUnits: 'pixels',
    getPixelOffset: [0, 20],
    getColor: LABEL_INK,
    outlineColor: LABEL_HALO,
    outlineWidth: 3,
    fontSettings: { sdf: true },
  });
}

export interface MapLayerInput {
  scenes: Scene[];
  tracks: GroundTrack[];
  subSatellite: SubSatellitePoint[];
  targets: Target[];
  windowCounts: Map<string, number>;
  colors: SatelliteColorScale;
  selectedSceneId: string | null;
  highlightedSatellite: string | null;
  /** The imagery to drape, or null when the selected scene has none or it is switched off. */
  imagery: ImageryOptions | null;
  onSelectScene: (sceneId: string) => void;
}

/**
 * The whole stack, bottom to top. deck.gl draws in array order, so the
 * quicklook sits directly on the basemap and the labels and the tappable scene
 * dots end up above the fills.
 */
export function buildMapLayers(input: MapLayerInput): Layer[] {
  const footprints: FootprintOptions = {
    scenes: input.scenes,
    colors: input.colors,
    selectedSceneId: input.selectedSceneId,
    imagedSceneId: input.imagery?.sceneId ?? null,
    onSelect: input.onSelectScene,
  };
  const targets: TargetOptions = {
    targets: input.targets,
    windowCounts: input.windowCounts,
  };
  const satellites: SubSatelliteOptions = {
    positions: input.subSatellite,
    colors: input.colors,
    highlighted: input.highlightedSatellite,
  };

  return [
    basemapLayer(),
    ...(input.imagery ? [quicklookLayer(input.imagery)] : []),
    groundTrackLayer({
      tracks: input.tracks,
      colors: input.colors,
      highlighted: input.highlightedSatellite,
    }),
    footprintLayer(footprints),
    targetLayer(targets),
    sceneCenterLayer(footprints),
    subSatelliteLayer(satellites),
    targetLabelLayer(targets),
    subSatelliteLabelLayer(satellites),
  ];
}
