# StriX Scene Explorer — frontend

The operator console: a Deck.gl map of acquisition footprints, ground tracks
and targets, a D3-scaled timeline of access windows, and a SAR product sheet
for the selected scene. React 19, TypeScript in `strict` mode, Vite.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
```

The dev server proxies `/api` to `http://localhost:8080`, so start the Go
`scene-service` alongside it. With the backend down the console still loads and
says so: each panel shows which path failed, on which port, and what to start.

```sh
npm run build      # production bundle into dist/
npm run typecheck  # tsc --noEmit
npm test -- --run  # vitest
```

`VITE_API_BASE` overrides the API base URL for a deployed build. It defaults to
`/api/v1`, which is what the proxy expects. See `.env.example`.

## Folders

| Folder | Holds |
| --- | --- |
| `src/interfaces/` | TypeScript types only. `wire.ts` is the backend's JSON exactly as it arrives (snake_case); `domain.ts` is the camelCase shape the components use, with timestamps already parsed; `ui.ts` is filter, selection and loading state. No logic. |
| `src/lib/` | Everything that is not React. The API client, the wire-to-domain mapping, formatters, the satellite colour scale, the filter and track derivations, the timeline geometry, and the Deck.gl **layer factories** as pure functions. This is where the testable decisions live. |
| `src/components/` | Every UI component, each one focused and small, plus the two hooks. The page imports them; none of them talks to `fetch` except through `lib/api.ts`. |
| `src/App.tsx` | Composition only — state, layout, wiring. It should read as a summary of the console. |

The rule that keeps this honest: `lib/` never imports React, and `components/`
never decides anything a pure function could decide. That is what makes the map
testable without a WebGL context — see [TESTING.md](./TESTING.md).

## Backend contract

One base URL, in `lib/api.ts`. Field names are snake_case on the wire and
camelCase in the app; the mapping is in `lib/mapping.ts` and nowhere else.

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/healthz` | `{status, service, version}` |
| `GET /api/v1/scenes` | `{scenes: [Scene]}` |
| `GET /api/v1/scenes/{id}` | one `Scene` |
| `GET /api/v1/scenes/{id}/quicklook.png` | the delivered product's rendered preview, PNG. The URL is built by `quicklookUrl()` in `lib/api.ts` and loaded once, by the map's `BitmapLayer`; `Scene.quicklook` says where it sits and is null for a synthetic scene |
| `GET /api/v1/satellites` | `{satellites: [{name, norad_id, inclination_deg, orbit_family, tle_epoch_utc}]}` |
| `GET /api/v1/ground-track?sat=&minutes=&step=` | `{satellite, start_utc, step_s, points: [{time_utc, lat_deg, lon_deg, alt_km}]}` |
| `GET /api/v1/access-windows?targets=&days=` | `{horizon, assumptions, targets, windows}` — the shape of `fixtures/access_windows.json` |

`Scene` carries the field names the delivered StriX product and the Synspective
SAR Data Product Format Manual use, read off the real product in notebook 01:
`imaging_mode`, `polarization`, `look_side`, `pass_direction`,
`platform_heading_deg`, `incidence_angle_deg`, `incidence_near_deg`,
`incidence_far_deg`, `off_nadir_deg`, `nesz_db`, `orbit_source`, plus
`synthetic`, which the panel always shows as a badge, and `quicklook`, which
is the preview's WGS84 edges and dB stretch, or null.

## Choices worth defending

**The map's current-position markers are honest about staleness.** The backend
propagates a fixed 100-minute arc; `subSatellitePoint` picks the nearest point
to now and, if now falls outside the arc, clamps and sets `clamped`. The map
then labels that marker `(track end)` rather than presenting a stale position
as current.

**Bar width on the timeline is a legibility floor, not duration.** An access
window is about 85 s; on a 3-day axis that is a fifth of a pixel. Notebook 04
makes the same compromise and says so in its title, and the panel says so under
the chart.

**The basemap needs no API key.** A Deck.gl `TileLayer` over OpenStreetMap
raster tiles, attributed in the map footer. Anyone who clones this can run it.

**The radar image is drawn where it was taken, and the console opens on it.** A
Sliding Spotlight scene is a few kilometres across, a dot at the opening zoom.
Picking a scene from the list flies the camera to its footprint
(`lib/viewport.ts` fits the bounds, a `FlyToInterpolator` moves it, and
`prefers-reduced-motion` turns the flight into a cut). The console does that
once by itself on load, for the one delivered scene: eleven of the twelve seed
scenes are synthetic, and asking a visitor to find the real one in a list spends
the only moment their attention is guaranteed.

The quicklook is a `BitmapLayer` between the basemap and the vector layers, read
as plain longitude/latitude because that is what the PNG is. While it is on
screen the footprint polygons lose both their fill and their outline: a
translucent fill tints the greys the image exists to show, and an outline is a
black line drawn across the terrain marking a boundary the image already has,
since the valid pixels and the footprint come from the same raster. The
polygons stay pickable and the scene dots stay drawn, so nothing becomes
unreachable. It opens at 65% opacity rather than fully opaque, because the point
of draping it on a basemap is to read the two together.

**The picture appears once.** The product sheet used to show the same image
again, which is a second megabyte-sized decode of something already on screen
two hundred pixels to the left. What the sheet keeps instead is the pair of
numbers the picture alone cannot carry: which gamma0 values were rendered black
and white, and how coarse the rendering is against the delivered product. The
image's credit moved with it, so the map's attribution names the StriX-3 sample
product whenever a radar image is drawn.

**The camera is controlled, and that has one trap in it.** `viewState` plus
`onViewStateChange` is what lets "Locate on map" move a camera the operator has
already panned, which `initialViewState` cannot do. The cost is that deck.gl
reports every interpolated frame of a fly-to back through that handler, and
storing one re-renders with a view state carrying no transition props — which
deck.gl reads as the caller taking the camera elsewhere, so it cancels its own
flight. `interactionState.inTransition` is how it tells you a frame is its own,
and dropping those is the whole fix. Before it, picking a scene flew the map
about two times in three.

**The colour scale is fixed, ordered, and never cycled.** Eight satellites,
eight validated dark-surface hues assigned over a sorted domain, so filtering
the fleet never repaints the survivors. Past eight, a ninth satellite goes grey
rather than reusing a hue. Identity is never colour alone — see TESTING.md.

**Light, and responsive by construction.** One CSS Grid with two breakpoints:
one column on a phone, map and panel side by side from 1100px, timeline across
the bottom. Touch targets are 44px, the palette is CSS custom properties, and
there is no horizontal page scroll at any width.

## Known limits

- The production bundle is about 1.2 MB (350 kB gzipped), nearly all Deck.gl
  and luma.gl. Code-splitting the map behind a dynamic import would fix it and
  has not been done.
- No end-to-end test yet. Playwright is on the repository's build list.
