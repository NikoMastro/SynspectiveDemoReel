/**
 * The biggest part of the suite, and the answer to "how do you test a WebGL
 * canvas?".
 *
 * You do not. You test the thing that decides what the canvas shows. Every
 * factory in lib/layers.ts is a pure function, so a test can build a layer with
 * no GL context at all and then assert on its id, its type, how much data it
 * carries, and what its accessors return for a given row. That covers the
 * failures that actually happen - wrong data bound, wrong colour, a ground
 * track drawn straight across the map at the antimeridian - none of which a DOM
 * assertion could ever see.
 */
import { describe, expect, it, vi } from 'vitest';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import type { Layer } from '@deck.gl/core';
import { satelliteColorScale } from './colors';
import {
  BASEMAP_URL,
  basemapLayer,
  buildMapLayers,
  footprintLayer,
  groundTrackLayer,
  groundTrackSegments,
  quicklookLayer,
  sceneCenterLayer,
  subSatelliteLabelLayer,
  subSatelliteLayer,
  targetLabelLayer,
  targetLayer,
  targetRadiusPx,
} from './layers';
import { subSatellitePoints } from './tracks';
import {
  asoScene,
  sampleAccess,
  sampleScenes,
  straightTrack,
  syntheticScene,
  wrappingTrack,
} from '../testFixtures';

const colors = satelliteColorScale(['STRIX-3', 'STRIX-5']);
const noop = () => {};

const asoQuicklook = asoScene.quicklook;
if (asoQuicklook === null) throw new Error('the Aso fixture must carry a quicklook');
const asoImagery = {
  sceneId: asoScene.id,
  quicklook: asoQuicklook,
  url: '/api/v1/scenes/STRIX3-20260615T063527Z-SL1/quicklook.png',
};

/**
 * The factories return the base `Layer` type, so the app can never depend on a
 * particular deck.gl class. That type erases the concrete prop shape, so the
 * tests reach the accessors through one cast kept here rather than sprinkled
 * through every assertion.
 */
function props(layer: Layer): Record<string, unknown> {
  return layer.props as unknown as Record<string, unknown>;
}

/** deck.gl accessors may be a function or a constant; tests only pass functions. */
function call<T, R>(accessor: unknown, datum: T): R {
  if (typeof accessor !== 'function') throw new Error('expected an accessor function');
  return (accessor as (d: T) => R)(datum);
}

describe('basemapLayer', () => {
  it('is a keyless OSM tile layer', () => {
    const layer = basemapLayer();
    expect(layer.id).toBe('basemap');
    expect(layer.constructor.name).toBe('TileLayer');
    expect(props(layer).data).toBe(BASEMAP_URL);
    expect(BASEMAP_URL).not.toMatch(/key=|token=|apikey/i);
  });
});

describe('groundTrackSegments', () => {
  it('keeps a non-wrapping track as one path', () => {
    const segments = groundTrackSegments([straightTrack]);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.satellite).toBe('STRIX-3');
    expect(segments[0]?.path).toHaveLength(3);
  });

  it('splits a track that crosses the antimeridian', () => {
    // Without the split, deck.gl would draw a line from +179 to -178 straight
    // back across the whole map.
    const segments = groundTrackSegments([wrappingTrack]);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.path).toEqual([
      [175, 10],
      [179, 12],
    ]);
  });
});

describe('groundTrackLayer', () => {
  it('binds one path per continuous segment and colours it by satellite', () => {
    const layer = groundTrackLayer({
      tracks: [straightTrack, wrappingTrack],
      colors,
      highlighted: null,
    });

    expect(layer.id).toBe('ground-tracks');
    expect(layer.constructor.name).toBe('PathLayer');
    expect(props(layer).data).toHaveLength(2);

    const segment = { satellite: 'STRIX-3', path: [] };
    expect(call(props(layer).getColor, segment)).toEqual([...colors.rgb('STRIX-3'), 230]);
  });

  it('dims the satellites that are not highlighted instead of dropping them', () => {
    const layer = groundTrackLayer({ tracks: [straightTrack, wrappingTrack], colors, highlighted: 'STRIX-3' });

    expect(props(layer).data).toHaveLength(2);
    expect(call<{ satellite: string }, number[]>(props(layer).getColor, { satellite: 'STRIX-3' })[3]).toBe(230);
    expect(call<{ satellite: string }, number[]>(props(layer).getColor, { satellite: 'STRIX-5' })[3]).toBe(50);
  });
});

describe('quicklookLayer', () => {
  it('drapes the PNG over its WGS84 edges, read as longitude and latitude', () => {
    const layer = quicklookLayer({ ...asoImagery, opacity: 0.8 });

    expect(layer.id).toBe('scene-quicklook');
    expect(layer.constructor.name).toBe('BitmapLayer');
    // `image` is an async prop: given a URL, deck.gl fetches it and exposes
    // the decoded texture as props.image, which is null until then. The URL
    // it was handed is kept under a well-known symbol.
    const original = props(layer)[Symbol.for('asyncPropOriginal') as unknown as string] as { image?: string };
    expect(original.image).toBe(asoImagery.url);
    expect(props(layer).bounds).toEqual(asoQuicklook.bounds);
    // The file is equirectangular, not Web Mercator. Left at the default the
    // image would be stretched by the Mercator factor - invisible over 0.12
    // degrees of latitude, and wrong.
    expect(props(layer)._imageCoordinateSystem).toBe(COORDINATE_SYSTEM.LNGLAT);
    expect(props(layer).opacity).toBe(0.8);
  });
});

describe('footprintLayer', () => {
  const options = {
    scenes: sampleScenes,
    colors,
    selectedSceneId: asoScene.id,
    imagedSceneId: null,
    onSelect: noop,
  };

  it('binds every scene and reads the footprint ring', () => {
    const layer = footprintLayer(options);
    expect(layer.id).toBe('scene-footprints');
    expect(layer.constructor.name).toBe('PolygonLayer');
    expect(props(layer).data).toHaveLength(2);
    expect(call(props(layer).getPolygon, asoScene)).toEqual(asoScene.footprint);
  });

  // The assertion is that selection reads as selection, not that it is any
  // particular colour: this used to expect white, which was correct against a
  // dark console and invisible the moment the theme went light over light map
  // tiles. What has to hold is that the outline differs from the satellite's
  // own hue and is dark enough to separate from the basemap.
  it('outlines the selected scene distinctly from its own satellite colour', () => {
    const layer = footprintLayer(options);
    const selected = call(props(layer).getLineColor, asoScene) as number[];
    const unselected = call(props(layer).getLineColor, syntheticScene);

    expect(selected).not.toEqual([...colors.rgb('STRIX-3'), 235]);
    expect(unselected).toEqual([...colors.rgb('STRIX-5'), 235]);

    // Dark enough to hold against OpenStreetMap raster, which is a light surface.
    const [r, g, b] = selected as [number, number, number];
    expect((r + g + b) / 3).toBeLessThan(80);
  });

  // A tinted fill over the radar image would shift every grey towards the
  // satellite's colour, and the whole point of the image is its greys.
  //
  // Clearing only the imaged scene's own fill was not enough, and this is the
  // regression that proved it: footprints overlap, and the synthetic STRIX-1
  // scene in the seed catalog covers 95% of the Mt. Aso quicklook. Its
  // translucent polygon washed a second satellite's hue across almost the whole
  // picture. So the assertion is about every scene, not about the imaged one.
  it('drops every fill while imagery is drawn, so no other scene can tint it', () => {
    const layer = footprintLayer({ ...options, imagedSceneId: asoScene.id });

    expect(call<typeof asoScene, number[]>(props(layer).getFillColor, asoScene)[3]).toBe(0);
    expect(call<typeof asoScene, number[]>(props(layer).getFillColor, syntheticScene)[3]).toBe(0);

    // The outlines stay, so identity survives the fill going away.
    expect(call<typeof asoScene, number[]>(props(layer).getLineColor, asoScene)[3]).toBe(255);
    expect(call<typeof asoScene, number[]>(props(layer).getLineColor, syntheticScene)[3]).toBe(235);
  });

  it('keeps the fills when there is no imagery to protect', () => {
    const layer = footprintLayer({ ...options, imagedSceneId: null });

    expect(call<typeof asoScene, number[]>(props(layer).getFillColor, asoScene)[3]).toBe(150);
    expect(call<typeof asoScene, number[]>(props(layer).getFillColor, syntheticScene)[3]).toBe(70);
  });

  it('calls onSelect with the clicked scene id', () => {
    const onSelect = vi.fn();
    const layer = footprintLayer({ ...options, onSelect });
    call(props(layer).onClick, { object: syntheticScene, index: 1 });
    expect(onSelect).toHaveBeenCalledWith(syntheticScene.id);
  });

  it('ignores a click that hit no object', () => {
    const onSelect = vi.fn();
    const layer = footprintLayer({ ...options, onSelect });
    call(props(layer).onClick, { object: null, index: -1 });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('sceneCenterLayer', () => {
  it('positions each dot at the scene centre, longitude first', () => {
    const layer = sceneCenterLayer({
      scenes: sampleScenes,
      colors,
      selectedSceneId: null,
      imagedSceneId: null,
      onSelect: noop,
    });

    expect(layer.id).toBe('scene-centers');
    expect(call(props(layer).getPosition, asoScene)).toEqual([131.092252, 32.887635]);
    expect(call<typeof asoScene, number>(props(layer).getRadius, asoScene)).toBe(6);
  });
});

describe('targetLayer', () => {
  it('sizes each marker by the opportunity count in the brushed range', () => {
    const counts = new Map([['Mt. Aso, JP', 9]]);
    const layer = targetLayer({ targets: sampleAccess.targets, windowCounts: counts });

    expect(layer.id).toBe('targets');
    expect(props(layer).data).toHaveLength(2);
    expect(call<{ name: string }, number>(props(layer).getRadius, { name: 'Mt. Aso, JP' })).toBeCloseTo(targetRadiusPx(9));
    // A target with no opportunities still gets the base radius, not zero.
    expect(call<{ name: string }, number>(props(layer).getRadius, { name: 'Jakarta, ID' })).toBe(targetRadiusPx(0));
  });

  it('labels every target', () => {
    const layer = targetLabelLayer({ targets: sampleAccess.targets, windowCounts: new Map() });
    expect(layer.id).toBe('target-labels');
    expect(call(props(layer).getText, sampleAccess.targets[0])).toBe('Mt. Aso, JP');
  });
});

describe('subSatelliteLayer', () => {
  const positions = subSatellitePoints([straightTrack], new Date('2026-09-19T00:01:00Z'));

  it('draws one marker per satellite at the nearest propagated point', () => {
    const layer = subSatelliteLayer({ positions, colors, highlighted: null });
    expect(layer.id).toBe('sub-satellite-points');
    expect(props(layer).data).toHaveLength(1);
    expect(call(props(layer).getPosition, positions[0])).toEqual([135, 34]);
  });

  it('says on the label when the point had to be clamped to the track end', () => {
    const stale = subSatellitePoints([straightTrack], new Date('2027-01-01T00:00:00Z'));
    const layer = subSatelliteLabelLayer({ positions: stale, colors, highlighted: null });
    expect(call(props(layer).getText, stale[0])).toBe('STRIX-3 (track end)');
  });
});

describe('buildMapLayers', () => {
  const input = {
    scenes: sampleScenes,
    tracks: [straightTrack, wrappingTrack],
    subSatellite: subSatellitePoints([straightTrack], new Date('2026-09-19T00:00:00Z')),
    targets: sampleAccess.targets,
    windowCounts: new Map<string, number>(),
    colors,
    selectedSceneId: null,
    highlightedSatellite: null,
    imagery: null,
    onSelectScene: noop,
  };
  const layers = buildMapLayers(input);

  it('stacks the layers in draw order, basemap first', () => {
    expect(layers.map((l) => l.id)).toEqual([
      'basemap',
      'ground-tracks',
      'scene-footprints',
      'targets',
      'scene-centers',
      'sub-satellite-points',
      'target-labels',
      'sub-satellite-labels',
    ]);
  });

  // Directly on the basemap and under everything else: the tracks, the
  // footprint outline and the scene dot all have to stay readable over it.
  it('slots the quicklook between the basemap and the vector layers', () => {
    const withImagery = buildMapLayers({
      ...input,
      selectedSceneId: asoScene.id,
      imagery: { ...asoImagery, opacity: 1 },
    });

    expect(withImagery.map((l) => l.id).slice(0, 3)).toEqual([
      'basemap',
      'scene-quicklook',
      'ground-tracks',
    ]);
    // And the footprint layer knows which scene is under the image.
    const footprints = withImagery.find((l) => l.id === 'scene-footprints');
    expect(call<typeof asoScene, number[]>(props(footprints!).getFillColor, asoScene)[3]).toBe(0);
  });

  it('gives every layer a unique id, which deck.gl requires', () => {
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length);
  });
});
