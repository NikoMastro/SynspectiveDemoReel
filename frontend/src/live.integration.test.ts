/**
 * The only test that talks to the real Go backend.
 *
 * Everything else in this suite mocks `fetch`, which proves the client handles
 * a shape but not that the backend sends it. This one closes that gap: it runs
 * the actual API client against running services and checks that the JSON
 * decodes, that every timestamp parses, and that the numbers are the ones the
 * notebooks produced.
 *
 * It is opt-in because it needs two processes running, and a test that fails
 * when you forget to start a server is a test people learn to ignore:
 *
 *     cd backend && go run ./cmd/flightdyn-service   # :8081
 *     cd backend && go run ./cmd/scene-service       # :8080
 *     cd frontend && LIVE_BACKEND=1 VITE_API_BASE=http://localhost:8080/api/v1  *                      npm test -- --run src/live.integration.test.ts
 *
 * VITE_API_BASE is not optional here. In the browser the client uses the
 * relative /api/v1, which Vite's dev server proxies to :8080; under vitest
 * there is no dev server and no proxy, so the relative path resolves against
 * jsdom's own origin and every request fails to connect. Pointing the client
 * straight at scene-service is what makes the test reach the real backend.
 *
 * Without LIVE_BACKEND set it skips, so `npm test` stays green offline.
 */
import { describe, expect, it } from 'vitest';
import { fetchAccessWindows, fetchGroundTrack, fetchSatellites, fetchScenes } from './lib/api';

/** The same targets and span notebook 04 swept, though not the same start. */
const TARGET_IDS = ['aso', 'tokyo', 'jakarta', 'longyearbyen'];
const HORIZON_DAYS = 3;

/** What notebook 04 found over its own three days, in fixtures/access_windows.json. */
const NOTEBOOK_WINDOW_COUNT = 219;

describe.skipIf(!process.env.LIVE_BACKEND)('against a running backend', () => {
  it('serves the catalog with exactly one real scene', async () => {
    const scenes = await fetchScenes();
    expect(scenes.length).toBeGreaterThan(1);

    const real = scenes.filter((s) => !s.synthetic);
    expect(real).toHaveLength(1);

    // The delivered StriX-3 metadata, as read off the product in notebook 01.
    const aso = real[0]!;
    expect(aso.offNadirDeg).toBe(31.94);
    expect(aso.platformHeadingDeg).toBe(347.74);
    expect(aso.incidenceAngleDeg).toBe(34.76);
    expect(aso.acquiredUtc.toISOString()).toBe('2026-06-15T06:35:27.000Z');
    expect(aso.footprint.length).toBeGreaterThanOrEqual(4);

    // The product does not state a noise floor, and the backend must not
    // invent one. The sheet renders this as "--".
    expect(aso.neszDb).toBeNull();
  });

  it('serves the eight StriX with their orbit families', async () => {
    const satellites = await fetchSatellites();
    expect(satellites).toHaveLength(8);

    for (const s of satellites) {
      expect(Number.isFinite(s.inclinationDeg)).toBe(true);
      expect(['near-polar', 'mid-inclination']).toContain(s.orbitFamily);
      expect(Number.isNaN(s.tleEpochUtc.getTime())).toBe(false);
    }
  });

  it('propagates a ground track a little over one orbit', async () => {
    const track = await fetchGroundTrack({ sat: 'STRIX-3', minutes: 100, stepS: 20 });

    expect(track.satellite).toBe('STRIX-3');
    expect(track.points).toHaveLength(100 * 60 / 20 + 1);

    for (const p of track.points) {
      expect(Number.isNaN(p.timeUtc.getTime())).toBe(false);
      expect(p.altKm).toBeGreaterThan(400);
      expect(p.altKm).toBeLessThan(700);
    }
  });

  it('computes access windows with their assumptions attached', async () => {
    const report = await fetchAccessWindows({ targetIds: TARGET_IDS, days: HORIZON_DAYS });

    expect(report.targets).toHaveLength(TARGET_IDS.length);
    expect(report.horizon.days).toBe(HORIZON_DAYS);
    expect(report.horizon.coarseStepS).toBe(20);

    // The assumption travels with the answer, and the console prints it.
    expect(report.assumptions.offNadirMinDeg).toBe(20);
    expect(report.assumptions.offNadirMaxDeg).toBe(45);
    expect(report.assumptions.note).toMatch(/ASSUMED/);
    expect(report.assumptions.earthModel).toMatch(/WGS84/);

    for (const w of report.windows) {
      expect(w.endUtc.getTime()).toBeGreaterThan(w.startUtc.getTime());
      expect(['Left', 'Right']).toContain(w.lookSide);
      expect(['Ascending', 'Descending']).toContain(w.passDirection);
      expect(report.targets.map((t) => t.name)).toContain(w.target);
    }

    // A band, not an equality, and the reason matters. The client does not
    // send a start time, so the backend sweeps the three days from *now* —
    // which is a different three days from the notebook's, and a different
    // three days contains a slightly different number of opportunities. Over
    // this constellation and these four targets the count sits near 219
    // whatever the start, so this is a sanity band: it catches an empty
    // response or a runaway one, not an off-by-one.
    //
    // The exact comparison belongs where the start time can be pinned, and it
    // is done there: backend's TestAccessWindowsReproduceTheWholeFixture sweeps
    // the notebook's own horizon and asserts all 219 windows, pair for pair.
    expect(report.windows.length).toBeGreaterThan(NOTEBOOK_WINDOW_COUNT - 25);
    expect(report.windows.length).toBeLessThan(NOTEBOOK_WINDOW_COUNT + 25);
  });

  // The regression this guards against is silent: interfaces/wire.ts once
  // declared only the fields the UI happened to render, so everything else was
  // fetched, paid for, and dropped on the floor by the mapper. Nothing failed -
  // the values were simply never there. Asserting the mapped objects rather
  // than the JSON is deliberate: it proves lib/mapping.ts admits each field,
  // not merely that the backend sent it.
  it('maps every field the backend sends, not just the ones drawn today', async () => {
    const [scenes, satellites, report] = await Promise.all([
      fetchScenes(),
      fetchSatellites(),
      fetchAccessWindows({ targetIds: ['aso'], days: 1 }),
    ]);

    const scene = scenes[0];
    expect(scene).toBeDefined();
    expect(scene?.durationS).toBeGreaterThan(0);
    expect(scene?.mapProjection).toBeTruthy();
    expect(scene?.resolutionAzimuthM).toBeGreaterThan(0);
    expect(scene?.resolutionRangeM).toBeGreaterThan(0);

    // The orbital elements are what lets a target explain its own reachability.
    const satellite = satellites[0];
    expect(satellite).toBeDefined();
    expect(satellite?.raanDeg).toBeGreaterThanOrEqual(0);
    expect(satellite?.periodMinutes).toBeGreaterThan(80);
    expect(satellite?.meanAltitudeKm).toBeGreaterThan(300);
    expect(satellite?.tleLine1).toMatch(/^1 /);
    expect(satellite?.tleLine2).toMatch(/^2 /);
    expect(['near-polar', 'mid-inclination']).toContain(satellite?.orbitFamily);

    const window = report.windows[0];
    expect(window).toBeDefined();
    expect(window?.targetId).toBeTruthy();
    // best_at_utc has to fall inside its own window, or it is not the instant
    // worth tasking.
    expect(window?.bestAtUtc.getTime()).toBeGreaterThanOrEqual(window!.startUtc.getTime());
    expect(window?.bestAtUtc.getTime()).toBeLessThanOrEqual(window!.endUtc.getTime());
  });
});
