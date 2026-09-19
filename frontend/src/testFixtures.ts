/**
 * Sample data for the tests. Test-only - nothing in the app imports this.
 *
 * The values are taken from the repository fixtures so the tests exercise
 * realistic shapes: the Mt. Aso scene is the one the notebooks read out of the
 * delivered StriX-3 product, and the access windows are the first rows of
 * fixtures/access_windows.json.
 */
import type {
  AccessReport,
  GroundTrack,
  Satellite,
  Scene,
  WireAccessResponse,
  WireScene,
} from './interfaces';
import { toAccessReport, toScene } from './lib/mapping';

export const wireAsoScene: WireScene = {
  id: 'STRIX3-20260615T063527Z-SL1',
  satellite: 'STRIX-3',
  synthetic: false,
  acquired_utc: '2026-06-15T06:35:27Z',
  product_level: 'ORT',
  imaging_mode: 'Sliding Spotlight',
  radar_band: 'X',
  radar_center_frequency_ghz: 9.65,
  polarization: 'VV',
  look_side: 'Left',
  pass_direction: 'Ascending',
  platform_heading_deg: 347.74,
  incidence_angle_deg: 34.76,
  incidence_near_deg: 34.34,
  incidence_far_deg: 35.25,
  off_nadir_deg: 31.94,
  nesz_db: -23.5,
  orbit_source: 'Precise',
  center_lat_deg: 32.887635,
  center_lon_deg: 131.092252,
  footprint: [
    [131.06, 32.86],
    [131.13, 32.86],
    [131.13, 32.92],
    [131.06, 32.92],
    [131.06, 32.86],
  ],
  duration_s: 1.41,
  map_projection: 'UTM zone 52N / WGS84',
  resolution_azimuth_m: 0.8,
  resolution_range_m: 0.44,
};

export const wireSyntheticScene: WireScene = {
  ...wireAsoScene,
  id: 'STRIX5-20260901T011200Z-SM1',
  satellite: 'STRIX-5',
  synthetic: true,
  acquired_utc: '2026-09-01T01:12:00Z',
  imaging_mode: 'Stripmap',
  look_side: 'Right',
  pass_direction: 'Descending',
  off_nadir_deg: 28.1,
  nesz_db: -21.2,
  orbit_source: 'Predicted',
  center_lat_deg: -6.2088,
  center_lon_deg: 106.8456,
  duration_s: 3.2,
  map_projection: 'UTM zone 48S / WGS84',
  resolution_azimuth_m: 1.0,
  resolution_range_m: 1.0,
};

export const asoScene: Scene = toScene(wireAsoScene);
export const syntheticScene: Scene = toScene(wireSyntheticScene);
export const sampleScenes: Scene[] = [asoScene, syntheticScene];

export const sampleSatellites: Satellite[] = [
  {
    name: 'STRIX-3',
    noradId: 59224,
    inclinationDeg: 97.6725,
    orbitFamily: 'near-polar',
    tleEpochUtc: new Date('2026-09-18T04:41:20Z'),
    raanDeg: 238.3792,
    eccentricity: 0.0014712,
    periodMinutes: 94.7,
    meanAltitudeKm: 504.0,
    tleLine1: '1 59224U 24047A   26261.19537414  .00006259  00000+0  28783-3 0  9992',
    tleLine2: '2 59224  97.6725 238.3792 0014712  98.1271 262.1634 15.20624473138872',
  },
  {
    name: 'STRIX-5',
    noradId: 65971,
    inclinationDeg: 41.9271,
    orbitFamily: 'mid-inclination',
    tleEpochUtc: new Date('2026-09-17T08:48:24Z'),
    raanDeg: 136.0223,
    eccentricity: 0.0037288,
    periodMinutes: 95.68,
    meanAltitudeKm: 551.5,
    tleLine1: '1 65971U 25229A   26260.36695047  .00003165  00000+0  22945-3 0  9993',
    tleLine2: '2 65971  41.9271 136.0223 0037288 296.5900  63.1108 15.04994457 50866',
  },
];

const trackPoint = (minutes: number, lonDeg: number, latDeg: number) => ({
  timeUtc: new Date(Date.UTC(2026, 8, 19, 0, minutes, 0)),
  latDeg,
  lonDeg,
  altKm: 505,
  speedKmS: 7.61,
});

/** Two points, no antimeridian crossing. */
export const straightTrack: GroundTrack = {
  satellite: 'STRIX-3',
  startUtc: new Date('2026-09-19T00:00:00Z'),
  stepS: 20,
  minutes: 100,
  points: [trackPoint(0, 130, 30), trackPoint(1, 135, 34), trackPoint(2, 140, 38)],
};

/** Crosses the antimeridian between the second and third point. */
export const wrappingTrack: GroundTrack = {
  satellite: 'STRIX-5',
  startUtc: new Date('2026-09-19T00:00:00Z'),
  stepS: 20,
  minutes: 100,
  points: [trackPoint(0, 175, 10), trackPoint(1, 179, 12), trackPoint(2, -178, 14)],
};

export const wireAccess: WireAccessResponse = {
  horizon: { start_utc: '2026-09-19T00:00:00Z', days: 3, coarse_step_s: 20 },
  assumptions: {
    off_nadir_min_deg: 20,
    off_nadir_max_deg: 45,
    earth_model: 'WGS84 ellipsoid, target height 0 m',
    frame: 'SGP4 TEME rotated to ECEF by IAU-1982 GMST',
    note: 'Steering envelope is ASSUMED.',
  },
  targets: [
    { id: 'aso', name: 'Mt. Aso, JP', lat_deg: 32.887635, lon_deg: 131.092252 },
    { id: 'jakarta', name: 'Jakarta, ID', lat_deg: -6.2088, lon_deg: 106.8456 },
  ],
  windows: [
    {
      satellite: 'STRIX-5',
      target: 'Jakarta, ID',
      target_id: 'jakarta',
      start_utc: '2026-09-19T00:33:08.539737Z',
      end_utc: '2026-09-19T00:34:30.946495Z',
      duration_s: 82.407,
      best_off_nadir_deg: 41.579,
      best_at_utc: '2026-09-19T00:33:49Z',
      look_side: 'Left',
      pass_direction: 'Ascending',
    },
    {
      satellite: 'STRIX-3',
      target: 'Mt. Aso, JP',
      target_id: 'aso',
      start_utc: '2026-09-20T12:00:00Z',
      end_utc: '2026-09-20T12:01:25Z',
      duration_s: 85,
      best_off_nadir_deg: 31.9,
      best_at_utc: '2026-09-20T12:00:42Z',
      look_side: 'Right',
      pass_direction: 'Descending',
    },
    {
      satellite: 'STRIX-3',
      target: 'Nowhere, XX',
      target_id: 'nowhere',
      start_utc: '2026-09-21T06:00:00Z',
      end_utc: '2026-09-21T06:01:00Z',
      duration_s: 60,
      best_off_nadir_deg: 22,
      best_at_utc: '2026-09-21T06:00:30Z',
      look_side: 'Left',
      pass_direction: 'Ascending',
    },
  ],
};

export const sampleAccess: AccessReport = toAccessReport(wireAccess);
