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
import { wireAccess, wireAsoScene, wireSyntheticScene } from './testFixtures';

vi.mock('@deck.gl/react', () => ({
  default: () => <div data-testid="deck-canvas" />,
}));

const wireSatellites = {
  satellites: [
    {
      name: 'STRIX-3',
      norad_id: 59224,
      inclination_deg: 97.6725,
      orbit_family: 'near-polar',
      tle_epoch_utc: '2026-09-18T04:41:20Z',
    },
    {
      name: 'STRIX-5',
      norad_id: 65971,
      inclination_deg: 41.9271,
      orbit_family: 'mid-inclination',
      tle_epoch_utc: '2026-09-17T08:48:24Z',
    },
  ],
};

const wireTrack = (sat: string) => ({
  satellite: sat,
  start_utc: '2026-09-19T00:00:00Z',
  step_s: 20,
  points: [
    { time_utc: '2026-09-19T00:00:00Z', lat_deg: 30, lon_deg: 130, alt_km: 505 },
    { time_utc: '2026-09-19T00:00:20Z', lat_deg: 31, lon_deg: 131, alt_km: 505 },
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
    expect(screen.getByText('No scene selected')).toBeInTheDocument();
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
  });

  // Every footprint is also a row in the metadata panel, which is the only
  // route to the product sheet that does not go through a WebGL canvas.
  it('selects a scene from the panel list, with no canvas involved', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByText('No scene selected')).toBeInTheDocument());

    const list = within(screen.getByRole('list', { name: /Scenes matching/ }));
    await user.click(list.getAllByRole('button')[0]!);

    expect(screen.getByText('ObservationMode')).toBeInTheDocument();
    expect(screen.queryByText('No scene selected')).not.toBeInTheDocument();
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
