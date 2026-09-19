import type {
  AccessReport,
  GroundTrack,
  Position2D,
  Quicklook,
  Satellite,
  Scene,
} from './domain';

/**
 * A request to bring the map to a footprint. The key makes a repeat request
 * for the same scene a new object, so the camera moves again after the
 * operator has panned away from it.
 */
export interface LocateRequest {
  footprint: Position2D[];
  key: number;
}

/** The selected scene's imagery, when it has any: what the map needs to drape it. */
export interface SceneImagery {
  sceneId: string;
  quicklook: Quicklook;
  /** URL of the PNG, built by lib/api.ts. */
  url: string;
}

/** The four filters in the toolbar. `null` means "no filter on this field". */
export interface SceneFilters {
  satellite: string | null;
  imagingMode: string | null;
  passDirection: string | null;
  lookSide: string | null;
}

/** A half-open time range [from, to), produced by brushing the timeline. */
export interface TimeRange {
  from: Date;
  to: Date;
}

/**
 * One remote resource: never loading and errored at the same time, and `data`
 * is only present once it has actually arrived. Components branch on this
 * instead of juggling three loose booleans.
 */
export interface Loadable<T> {
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  error: ApiFailure | null;
}

/** What the UI needs in order to tell the operator which service is down. */
export interface ApiFailure {
  message: string;
  /** The path that failed, e.g. "/scenes". */
  path: string;
  /** HTTP status, or 0 when the request never reached the server. */
  status: number;
}

export interface ConsoleData {
  scenes: Loadable<Scene[]>;
  satellites: Loadable<Satellite[]>;
  tracks: Loadable<GroundTrack[]>;
  access: Loadable<AccessReport>;
}
