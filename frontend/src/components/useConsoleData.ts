import { useEffect, useState } from 'react';
import type { AccessReport, ConsoleData, GroundTrack, Loadable, Satellite, Scene } from '../interfaces';
import {
  asApiFailure,
  fetchAccessWindows,
  fetchGroundTrack,
  fetchSatellites,
  fetchScenes,
} from '../lib/api';

/**
 * Loads the four things the console needs, and keeps each one's status
 * separate. A failing access-window computation must not blank the map, and a
 * failing catalog must not hide the ground tracks - so one Loadable per
 * resource rather than one global "loading" flag.
 */

/** Matches the horizon notebook 04 computes, so the two can be compared directly. */
export const DEFAULT_TARGET_IDS = ['aso', 'tokyo', 'jakarta', 'longyearbyen'];
export const HORIZON_DAYS = 3;

/** 100 minutes at a 20 s step - a little over one orbit, as in notebook 03. */
export const TRACK_MINUTES = 100;
export const TRACK_STEP_S = 20;

const loading = <T,>(): Loadable<T> => ({ status: 'loading', data: null, error: null });
const ready = <T,>(data: T): Loadable<T> => ({ status: 'ready', data, error: null });

const failed = <T,>(error: unknown, path: string): Loadable<T> => ({
  status: 'error',
  data: null,
  error: asApiFailure(error, path),
});

const INITIAL: ConsoleData = {
  scenes: loading<Scene[]>(),
  satellites: loading<Satellite[]>(),
  tracks: loading<GroundTrack[]>(),
  access: loading<AccessReport>(),
};

export function useConsoleData(reloadKey: number): ConsoleData {
  const [data, setData] = useState<ConsoleData>(INITIAL);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setData(INITIAL);

    // Aborting is not a failure: React runs effect cleanup on unmount and in
    // StrictMode's double-invoke, and neither should paint an error banner.
    const settle = <K extends keyof ConsoleData>(key: K, value: ConsoleData[K]) => {
      if (!signal.aborted) setData((current) => ({ ...current, [key]: value }));
    };

    fetchScenes(signal)
      .then((scenes) => settle('scenes', ready(scenes)))
      .catch((e: unknown) => settle('scenes', failed<Scene[]>(e, '/scenes')));

    fetchAccessWindows({ targetIds: DEFAULT_TARGET_IDS, days: HORIZON_DAYS }, signal)
      .then((report) => settle('access', ready(report)))
      .catch((e: unknown) => settle('access', failed<AccessReport>(e, '/access-windows')));

    fetchSatellites(signal)
      .then(async (satellites) => {
        settle('satellites', ready(satellites));

        // The ground-track failure is caught in here, not by the outer catch.
        // These are two resources from two services: /satellites is the fleet,
        // /ground-track comes from flightdyn-service. Letting one catch cover
        // both meant a single failed track wiped the satellite list as well,
        // and with it the colour scale - every satellite went grey and the
        // legend emptied, while the scenes were still on screen.
        try {
          // One request per satellite, in parallel. The endpoint is
          // per-satellite by contract, and eight small requests is cheaper
          // than teaching the backend a batch mode nobody else needs.
          const tracks = await Promise.all(
            satellites.map((s) =>
              fetchGroundTrack(
                { sat: s.name, minutes: TRACK_MINUTES, stepS: TRACK_STEP_S },
                signal,
              ),
            ),
          );
          settle('tracks', ready(tracks));
        } catch (e: unknown) {
          settle('tracks', failed<GroundTrack[]>(e, '/ground-track'));
        }
      })
      .catch((e: unknown) => {
        // Only reached when /satellites itself failed. Without the fleet there
        // is nothing to request a track for, so both are down together.
        settle('satellites', failed<Satellite[]>(e, '/satellites'));
        settle('tracks', failed<GroundTrack[]>(e, '/ground-track'));
      });

    return () => controller.abort();
  }, [reloadKey]);

  return data;
}
