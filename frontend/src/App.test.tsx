/**
 * Two whole-console tests: the backend answering, and the backend not running.
 *
 * `@deck.gl/react` is replaced by a stub, because mounting the real component
 * would need a WebGL context jsdom does not have - and because nothing this
 * test cares about lives inside the canvas. What the canvas would draw is
 * covered by lib/layers.test.ts. See TESTING.md.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { WireGroundTrack, WireSatellitesResponse } from './interfaces';
import { wireAccess, wireAsoScene, wireSyntheticScene } from './testFixtures';

vi.mock('@deck.gl/react', () => ({
  default: () => <div data-testid="deck-canvas" />,
}));

const wireSatellites: WireSatellitesResponse = {
  count: 2,
  satellites: [
    {
      name: 'STRIX-3',
      norad_id: 59224,
      inclination_deg: 97.6725,
      orbit_family: 'near-polar',
      tle_epoch_utc: '2026-09-18T04:41:20Z',
      raan_deg: 238.3792,
      eccentricity: 0.0014712,
      period_minutes: 94.7,
      mean_altitude_km: 504,
      tle_line1: '1 59224U 24047A   26261.19537414  .00006259  00000+0  28783-3 0  9992',
      tle_line2: '2 59224  97.6725 238.3792 0014712  98.1271 262.1634 15.20624473138872',
    },
    {
      name: 'STRIX-5',
      norad_id: 65971,
      inclination_deg: 41.9271,
      orbit_family: 'mid-inclination',
      tle_epoch_utc: '2026-09-17T08:48:24Z',
      raan_deg: 136.0223,
      eccentricity: 0.0037288,
      period_minutes: 95.68,
      mean_altitude_km: 551.5,
      tle_line1: '1 65971U 25229A   26260.36695047  .00003165  00000+0  22945-3 0  9993',
      tle_line2: '2 65971  41.9271 136.0223 0037288 296.5900  63.1108 15.04994457 50866',
    },
  ],
};

const wireTrack = (sat: string): WireGroundTrack => ({
  satellite: sat,
  start_utc: '2026-09-19T00:00:00Z',
  step_s: 20,
  minutes: 100,
  points: [
    { time_utc: '2026-09-19T00:00:00Z', lat_deg: 30, lon_deg: 130, alt_km: 505, speed_km_s: 7.6 },
    { time_utc: '2026-09-19T00:00:20Z', lat_deg: 31, lon_deg: 131, alt_km: 505, speed_km_s: 7.6 },
  ],
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/scenes')) return Promise.resolve(json({ scenes: [wireAsoScene, wireSyntheticScene] }));
      if (url.includes('/satellites')) return Promise.resolve(json(wireSatellites));
      if (url.includes('/ground-track')) {
        return Promise.resolve(json(wireTrack(new URL(url, 'http://x').searchParams.get('sat') ?? '')));
      }
      if (url.includes('/access-windows')) return Promise.resolve(json(wireAccess));
      return Promise.reject(new TypeError('unexpected request'));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App with the backend up', () => {
  it('assembles the console: map, filters, timeline and panel', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('backend-health')).toHaveTextContent('Backend online'));

    expect(screen.getByTestId('deck-canvas')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 scenes')).toBeInTheDocument();
    expect(screen.getAllByTestId('timeline-bar')).toHaveLength(wireAccess.windows.length);
  });

  // This is a demo, and eleven of the twelve seed scenes are synthetic. The one
  // real acquisition is what a visitor should be looking at in the first second,
  // not something they have to go and find in a list.
  it('opens on the delivered product, already drawn, rather than on an empty sheet', async () => {
    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('scene-provenance')).toHaveTextContent('Delivered product'),
    );

    expect(screen.getByText(wireAsoScene.id)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Radar image' })).toBeInTheDocument();
    expect(screen.queryByText('No scene selected')).not.toBeInTheDocument();
  });

  // Landmarks are how a screen reader user skips past the header to the thing
  // they came for. Without <main> the whole console is one undifferentiated
  // region and the only way in is to read from the top every time.
  it('exposes the console as a main landmark, with the header outside it', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('backend-health')).toBeInTheDocument());

    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    // The banner is the page header and must not be inside the main content.
    expect(main).not.toContainElement(screen.getByRole('banner'));
    // The parts someone navigates to are in it.
    expect(within(main).getByTestId('deck-canvas')).toBeInTheDocument();
  });

  // The filters used to narrow the catalog and the map while leaving every bar
  // in the timeline, so the two halves of the console showed different data.
  it('narrows the access-window timeline when a satellite is filtered', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() =>
      expect(screen.getAllByTestId('timeline-bar')).toHaveLength(wireAccess.windows.length),
    );

    await user.selectOptions(screen.getByLabelText('Satellite'), 'STRIX-3');

    const expected = wireAccess.windows.filter((w) => w.satellite === 'STRIX-3').length;
    expect(screen.getAllByTestId('timeline-bar')).toHaveLength(expected);
    expect(screen.getByText(new RegExp(`filtered from ${wireAccess.windows.length}`))).toBeInTheDocument();
  });

  it('links to the repository, so the console is not a dead end', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('backend-health')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: /Source and notebooks/ });
    expect(link).toHaveAttribute('href', 'https://github.com/NikoMastro/SynspectiveDemoReel');
  });

  it('offers only the satellites the backend actually returned', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Satellite')).toBeInTheDocument());

    expect(screen.getByRole('option', { name: 'STRIX-3' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'STRIX-5' })).toBeInTheDocument();
  });
});

describe('App with one feed down', () => {
  // flightdyn-service answers the ground tracks and scene-service answers the
  // catalog, so one can fail on its own. A map with footprints and no track at
  // all reads as "no passes", which is the wrong conclusion.
  it('names the ground tracks as the thing that failed, without hiding the footprints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/ground-track')) return Promise.reject(new TypeError('Failed to fetch'));
        if (url.includes('/scenes')) return Promise.resolve(json({ scenes: [wireAsoScene, wireSyntheticScene] }));
        if (url.includes('/satellites')) return Promise.resolve(json(wireSatellites));
        if (url.includes('/access-windows')) return Promise.resolve(json(wireAccess));
        return Promise.reject(new TypeError('unexpected request'));
      }),
    );
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/Could not load the ground tracks/)).toBeInTheDocument(),
    );
    // A banner, not the full-cover overlay: the footprints are still real.
    expect(screen.getByText('2 of 2 scenes')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to draw')).not.toBeInTheDocument();

    // The fleet came back fine - only the tracks did not. One catch used to
    // cover both, so a failed track also marked /satellites as failed, and the
    // colour scale is built from that list. The legend emptied and every
    // satellite went grey, which reads as the constellation having vanished
    // rather than one endpoint having failed.
    //
    // Asserting the legend rather than the satellite filter matters: the filter
    // options are derived from the scenes, so they survive this failure either
    // way and would make the test pass with the bug still in place.
    const legend = within(screen.getByRole('group', { name: 'Satellites' }));
    expect(legend.getByRole('button', { name: /STRIX-3/ })).toBeInTheDocument();
    expect(legend.getByRole('button', { name: /STRIX-5/ })).toBeInTheDocument();
  });

  // Every footprint is also a row in the metadata panel, which is the only
  // route to the product sheet that does not go through a WebGL canvas.
  it('selects a scene from the panel list, with no canvas involved', async () => {
    const user = userEvent.setup();
    render(<App />);

    // The console opens on the delivered scene, so the assertion is that the
    // list moves the sheet off it, not that the sheet appears at all.
    await waitFor(() => expect(screen.getByText(wireAsoScene.id)).toBeInTheDocument());

    const list = within(screen.getByRole('list', { name: /Scenes matching/ }));
    await user.click(list.getByRole('button', { name: /STRIX-5/ }));

    expect(screen.getByText(wireSyntheticScene.id)).toBeInTheDocument();
    expect(screen.queryByText(wireAsoScene.id)).not.toBeInTheDocument();
  });

  // The first row is the delivered product, so picking it is what turns the
  // imagery on: the map grows its controls and the sheet shows the picture.
  // The synthetic scene, picked next, takes both away again rather than
  // leaving the last real image on screen under the wrong metadata.
  it('draws the radar image for the delivered scene and not for a synthetic one', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Opens on the delivered scene, so the image is already on the map.
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Radar image' })).toBeInTheDocument());
    expect(screen.getByText('Quicklook stretch').nextElementSibling).toHaveTextContent('dB');

    const list = within(screen.getByRole('list', { name: /Scenes matching/ }));
    await user.click(list.getByRole('button', { name: /STRIX-5/ }));

    expect(screen.queryByRole('checkbox', { name: 'Radar image' })).not.toBeInTheDocument();
    expect(screen.getByText('Quicklook stretch').nextElementSibling).toHaveTextContent('--');
  });

  // A filter that excludes the selected scene already drops its footprint from
  // the map. The image has to go with it: a picture floating with no outline
  // around it belongs to nothing on screen. The sheet is the other way round -
  // that is still the scene being read, so it keeps the picture and says the
  // filters have excluded it.
  it('stops draping a scene the filters exclude, while the sheet keeps showing it', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Radar image' })).toBeInTheDocument());

    // The real scene is Sliding Spotlight; this leaves only the synthetic one.
    await user.selectOptions(screen.getByLabelText('Imaging mode'), 'Stripmap');

    expect(screen.queryByRole('checkbox', { name: 'Radar image' })).not.toBeInTheDocument();
    // The sheet is still the excluded scene's, and says so.
    expect(screen.getByText(wireAsoScene.id)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('outside the current filters');
  });
});

describe('App with the backend down', () => {
  it('says which service is unreachable and how to start it', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('backend-health')).toHaveTextContent('Backend unreachable'),
    );

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]).toHaveTextContent('localhost:8080');
    expect(alerts[0]).toHaveTextContent('go run ./cmd/scene-service');
  });
});
