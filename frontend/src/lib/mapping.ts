/**
 * The one place the backend's snake_case JSON becomes the camelCase shapes the
 * components use. Every conversion is an explicit field assignment - no generic
 * key-rewriting helper - so a missing or renamed Go field shows up as a
 * TypeScript error here rather than as `undefined` somewhere in a render.
 */
import type {
  AccessReport,
  AccessWindow,
  GroundTrack,
  Position2D,
  Satellite,
  Scene,
  Target,
  TrackPoint,
  WireAccessResponse,
  WireAccessWindow,
  WireGroundTrack,
  WireSatellite,
  WireScene,
  WireTarget,
  WireTrackPoint,
} from '../interfaces';

export function toScene(w: WireScene): Scene {
  return {
    id: w.id,
    satellite: w.satellite,
    synthetic: w.synthetic,
    acquiredUtc: new Date(w.acquired_utc),
    productLevel: w.product_level,
    imagingMode: w.imaging_mode,
    radarBand: w.radar_band,
    radarCenterFrequencyGhz: w.radar_center_frequency_ghz,
    polarization: w.polarization,
    lookSide: w.look_side,
    passDirection: w.pass_direction,
    platformHeadingDeg: w.platform_heading_deg,
    incidenceAngleDeg: w.incidence_angle_deg,
    incidenceNearDeg: w.incidence_near_deg,
    incidenceFarDeg: w.incidence_far_deg,
    offNadirDeg: w.off_nadir_deg,
    neszDb: w.nesz_db,
    orbitSource: w.orbit_source,
    centerLatDeg: w.center_lat_deg,
    centerLonDeg: w.center_lon_deg,
    footprint: (w.footprint ?? []).map(([lon, lat]) => [lon, lat] as Position2D),
  };
}

export function toSatellite(w: WireSatellite): Satellite {
  return {
    name: w.name,
    noradId: w.norad_id,
    inclinationDeg: w.inclination_deg,
    orbitFamily: w.orbit_family,
    tleEpochUtc: new Date(w.tle_epoch_utc),
  };
}

export function toTrackPoint(w: WireTrackPoint): TrackPoint {
  return {
    timeUtc: new Date(w.time_utc),
    latDeg: w.lat_deg,
    lonDeg: w.lon_deg,
    altKm: w.alt_km,
  };
}

export function toGroundTrack(w: WireGroundTrack): GroundTrack {
  return {
    satellite: w.satellite,
    startUtc: new Date(w.start_utc),
    stepS: w.step_s,
    points: w.points.map(toTrackPoint),
  };
}

export function toTarget(w: WireTarget): Target {
  return { id: w.id, name: w.name, latDeg: w.lat_deg, lonDeg: w.lon_deg };
}

export function toAccessWindow(w: WireAccessWindow): AccessWindow {
  return {
    satellite: w.satellite,
    target: w.target,
    startUtc: new Date(w.start_utc),
    endUtc: new Date(w.end_utc),
    durationS: w.duration_s,
    bestOffNadirDeg: w.best_off_nadir_deg,
    lookSide: w.look_side,
    passDirection: w.pass_direction,
  };
}

export function toAccessReport(w: WireAccessResponse): AccessReport {
  return {
    horizon: {
      startUtc: new Date(w.horizon.start_utc),
      days: w.horizon.days,
      coarseStepS: w.horizon.coarse_step_s,
    },
    assumptions: {
      offNadirMinDeg: w.assumptions.off_nadir_min_deg,
      offNadirMaxDeg: w.assumptions.off_nadir_max_deg,
      earthModel: w.assumptions.earth_model,
      frame: w.assumptions.frame,
      note: w.assumptions.note,
    },
    targets: w.targets.map(toTarget),
    windows: w.windows.map(toAccessWindow),
  };
}
