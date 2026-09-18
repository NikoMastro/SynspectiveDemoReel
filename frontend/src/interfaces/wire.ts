/**
 * The JSON exactly as the Go backend sends it: snake_case, flat, no optional
 * trickery. Nothing in this file is renamed or reshaped - if the Go struct tag
 * says `off_nadir_deg`, this file says `off_nadir_deg`.
 *
 * Keeping the wire shape separate from the shape the components use means a
 * backend rename breaks in exactly one place (lib/mapping.ts) instead of
 * everywhere, and the diff against the Go structs stays readable.
 */

export interface WireHealth {
  status: string;
  service: string;
  version: string;
}

/** A closed footprint ring, [longitude, latitude] pairs in WGS84 degrees. */
export type WireRing = [number, number][];

export interface WireScene {
  id: string;
  satellite: string;
  /** true for catalog filler generated from the Format Manual field list. */
  synthetic: boolean;
  acquired_utc: string;
  product_level: string;
  imaging_mode: string;
  radar_band: string;
  radar_center_frequency_ghz: number;
  polarization: string;
  look_side: string;
  pass_direction: string;
  platform_heading_deg: number;
  incidence_angle_deg: number;
  incidence_near_deg: number;
  incidence_far_deg: number;
  off_nadir_deg: number;
  /** null when the delivered metadata does not state it - see the Mt. Aso scene. */
  nesz_db: number | null;
  orbit_source: string;
  center_lat_deg: number;
  center_lon_deg: number;
  scene_center_utc?: string;
  footprint: WireRing;
}

export interface WireScenesResponse {
  scenes: WireScene[];
}

export interface WireSatellite {
  name: string;
  norad_id: number;
  inclination_deg: number;
  /** "near-polar" or "mid-inclination" - the two orbit families in the fleet. */
  orbit_family: string;
  tle_epoch_utc: string;
}

export interface WireSatellitesResponse {
  satellites: WireSatellite[];
}

export interface WireTrackPoint {
  time_utc: string;
  lat_deg: number;
  lon_deg: number;
  alt_km: number;
}

export interface WireGroundTrack {
  satellite: string;
  start_utc: string;
  step_s: number;
  points: WireTrackPoint[];
}

export interface WireTarget {
  id: string;
  name: string;
  lat_deg: number;
  lon_deg: number;
}

export interface WireAccessWindow {
  satellite: string;
  target: string;
  start_utc: string;
  end_utc: string;
  duration_s: number;
  best_off_nadir_deg: number;
  look_side: string;
  pass_direction: string;
}

export interface WireAccessAssumptions {
  off_nadir_min_deg: number;
  off_nadir_max_deg: number;
  earth_model: string;
  frame: string;
  note: string;
}

export interface WireAccessHorizon {
  start_utc: string;
  days: number;
  coarse_step_s: number;
}

export interface WireAccessResponse {
  horizon: WireAccessHorizon;
  assumptions: WireAccessAssumptions;
  targets: WireTarget[];
  windows: WireAccessWindow[];
}
