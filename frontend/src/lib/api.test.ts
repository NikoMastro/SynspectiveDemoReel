/**
 * The API client against a mocked fetch, including the failure paths. The
 * success paths check the query string the backend contract expects; the
 * failure paths check that the UI is handed something it can act on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_BASE,
  ApiError,
  asApiFailure,
  fetchAccessWindows,
  fetchGroundTrack,
  fetchSatellites,
  fetchScenes,
} from './api';
import { wireAccess, wireAsoScene } from '../testFixtures';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchScenes', () => {
  it('maps the wire payload into camelCase domain scenes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ scenes: [wireAsoScene] }));

    const scenes = await fetchScenes();

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/scenes`, expect.anything());
    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.offNadirDeg).toBe(31.94);
    expect(scenes[0]?.acquiredUtc.toISOString()).toBe('2026-06-15T06:35:27.000Z');
  });

  it('treats a missing scenes array as an empty catalog rather than a crash', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await expect(fetchScenes()).resolves.toEqual([]);
  });
});

describe('fetchSatellites', () => {
  it('reads the satellites array', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        satellites: [
          {
            name: 'STRIX-3',
            norad_id: 59224,
            inclination_deg: 97.6725,
            orbit_family: 'near-polar',
            tle_epoch_utc: '2026-09-18T04:41:20Z',
          },
        ],
      }),
    );

    const satellites = await fetchSatellites();
    expect(satellites[0]?.noradId).toBe(59224);
    expect(satellites[0]?.orbitFamily).toBe('near-polar');
  });
});

describe('fetchGroundTrack', () => {
  it('builds the query the contract documents', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ satellite: 'STRIX-3', start_utc: '2026-09-19T00:00:00Z', step_s: 20, points: [] }),
    );

    await fetchGroundTrack({ sat: 'STRIX-3', minutes: 100, stepS: 20 });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/ground-track?sat=STRIX-3&minutes=100&step=20`,
      expect.anything(),
    );
  });
});

describe('fetchAccessWindows', () => {
  it('joins the target ids with commas and parses the horizon', async () => {
    fetchMock.mockResolvedValue(jsonResponse(wireAccess));

    const report = await fetchAccessWindows({ targetIds: ['aso', 'tokyo'], days: 3 });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/access-windows?targets=aso%2Ctokyo&days=3`,
      expect.anything(),
    );
    expect(report.horizon.days).toBe(3);
    expect(report.assumptions.offNadirMaxDeg).toBe(45);
    expect(report.windows[0]?.satellite).toBe('STRIX-5');
  });
});

describe('failure paths', () => {
  it('reports status 0 and actionable advice when the backend is not running', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await fetchScenes().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).path).toBe('/scenes');
    expect((error as ApiError).message).toContain('localhost:8080');
  });

  it('carries the HTTP status through when the backend answers with an error', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 503, statusText: 'Service Unavailable' }));

    const error = (await fetchScenes().catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(503);
    expect(error.message).toContain('503');
  });

  it('does not let an unparseable body surface as a JSON syntax error', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>nginx</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );

    const error = (await fetchScenes().catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toContain('not JSON');
  });
});

describe('asApiFailure', () => {
  it('passes an ApiError through unchanged', () => {
    const failure = asApiFailure(new ApiError({ message: 'x', path: '/scenes', status: 404 }), '/other');
    expect(failure).toEqual({ message: 'x', path: '/scenes', status: 404 });
  });

  it('wraps anything else with the path the caller knows', () => {
    expect(asApiFailure(new Error('odd'), '/satellites')).toEqual({
      message: 'odd',
      path: '/satellites',
      status: 0,
    });
    expect(asApiFailure('a string', '/satellites').message).toBe('Unknown error');
  });
});
