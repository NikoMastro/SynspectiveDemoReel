/**
 * Camera arithmetic, kept out of MapPanel so it can be tested without a canvas.
 */
import { WebMercatorViewport } from '@deck.gl/core';
import type { Position2D, Quicklook } from '../interfaces';

export interface CameraTarget {
  longitude: number;
  latitude: number;
  zoom: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

/** Used when the canvas cannot be measured, which is the case in jsdom. */
export const FALLBACK_SIZE: CanvasSize = { width: 800, height: 600 };

/**
 * Zoom 15 is about 4 m per pixel at Mt. Aso's latitude. The quicklook has
 * 10 m pixels, so any closer and each one is a visible block - and the
 * basemap's own detail runs out at about the same point.
 */
export const MAX_FIT_ZOOM = 15;

/** Room around the footprint so its outline does not touch the panel edge. */
const PADDING_PX = 48;

/** [[west, south], [east, north]], or null for an empty ring. */
export function footprintBounds(
  footprint: Position2D[],
): [[number, number], [number, number]] | null {
  if (footprint.length === 0) return null;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of footprint) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}

/**
 * The camera that shows a whole footprint. A Sliding Spotlight scene is a few
 * kilometres across, so at the console's opening zoom a selected scene is a
 * dot; this is what "locate" moves the camera to.
 */
export function fitFootprint(footprint: Position2D[], size: CanvasSize): CameraTarget | null {
  const bounds = footprintBounds(footprint);
  if (bounds === null) return null;

  const { width, height } = size.width > 0 && size.height > 0 ? size : FALLBACK_SIZE;
  const viewport = new WebMercatorViewport({ width, height }).fitBounds(bounds, {
    padding: PADDING_PX,
    maxZoom: MAX_FIT_ZOOM,
    // A degenerate ring - one point repeated - would otherwise fit to an
    // infinite zoom. 0.01 degrees is about a kilometre.
    minExtent: 0.01,
  });
  return { longitude: viewport.longitude, latitude: viewport.latitude, zoom: viewport.zoom };
}

/**
 * Ground distance of one quicklook pixel in metres, at the image's middle
 * latitude. Shown on the sheet so the reader knows how far the preview is
 * from the product it was rendered from.
 */
export function quicklookResolutionM(quicklook: Quicklook): number {
  const [west, south, east, north] = quicklook.bounds;
  const midLatRad = ((south + north) / 2) * (Math.PI / 180);
  // Metres per degree of longitude at that latitude, on a sphere. The
  // ellipsoid changes the answer by under a percent, which no reader of a
  // rounded figure will notice.
  const metresPerDegree = 111_320 * Math.cos(midLatRad);
  return ((east - west) * metresPerDegree) / quicklook.widthPx;
}
