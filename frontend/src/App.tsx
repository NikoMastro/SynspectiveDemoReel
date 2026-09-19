import { useMemo, useState } from 'react';
import type { SceneFilters, TimeRange } from './interfaces';
import { satelliteColorScale } from './lib/colors';
import { applyFilters, countWindowsByTarget, filterOptions, NO_FILTERS, windowsInRange } from './lib/filters';
import { subSatellitePoints } from './lib/tracks';
import { AccessTimeline } from './components/AccessTimeline';
import { FilterBar } from './components/FilterBar';
import { MapPanel } from './components/MapPanel';
import { Masthead } from './components/Masthead';
import { ScenePanel } from './components/ScenePanel';
import { EmptyBlock, ErrorBlock, LoadingBlock } from './components/StatusBlock';
import { useConsoleData } from './components/useConsoleData';

/**
 * Composition only: state, layout, wiring. Every decision of substance lives in
 * lib/ (pure) or in components/ (presentation), so this file can be read top to
 * bottom as a summary of what the console is.
 */
export default function App(): React.JSX.Element {
  const [reloadKey, setReloadKey] = useState(0);
  const data = useConsoleData(reloadKey);

  const [filters, setFilters] = useState<SceneFilters>(NO_FILTERS);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRange | null>(null);

  // Frozen once per mount. The ground tracks cover a fixed 100-minute window,
  // so a clock that ticked would only make the markers drift off the end of it.
  const [now] = useState(() => new Date());

  const scenes = data.scenes.data ?? [];
  const satellites = data.satellites.data ?? [];
  const tracks = data.tracks.data ?? [];
  const access = data.access.data;

  const visibleScenes = useMemo(() => applyFilters(scenes, filters), [scenes, filters]);
  const options = useMemo(() => filterOptions(scenes), [scenes]);

  // The colour domain is the fleet, not the filtered subset, so filtering never
  // repaints the satellites that survive.
  const colors = useMemo(
    () => satelliteColorScale(satellites.map((s) => s.name)),
    [satellites],
  );

  const visibleTracks = useMemo(
    () => (filters.satellite === null ? tracks : tracks.filter((t) => t.satellite === filters.satellite)),
    [tracks, filters.satellite],
  );

  const subSatellite = useMemo(() => subSatellitePoints(visibleTracks, now), [visibleTracks, now]);

  const windowCounts = useMemo(
    () => countWindowsByTarget(windowsInRange(access?.windows ?? [], range)),
    [access, range],
  );

  const selectedScene = visibleScenes.find((s) => s.id === selectedSceneId) ?? null;

  const mapOverlay = (() => {
    if (data.scenes.status === 'error' && data.scenes.error) {
      return <ErrorBlock what="the map data" failure={data.scenes.error} onRetry={() => setReloadKey((k) => k + 1)} />;
    }
    if (data.scenes.status === 'loading' || data.tracks.status === 'loading') {
      return <LoadingBlock what="scenes and ground tracks" />;
    }
    if (visibleScenes.length === 0 && visibleTracks.length === 0) {
      return <EmptyBlock title="Nothing to draw" detail="No scenes and no ground tracks match the current filters." />;
    }
    return null;
  })();

  // The ground tracks come from flightdyn-service and the scenes do not, so one
  // can fail while the other answers. That is a banner rather than the overlay
  // above: the footprints are still real and still worth drawing, but a map
  // silently missing every ground track reads as "no passes" instead of "the
  // service is down".
  const mapBanner =
    data.tracks.status === 'error' && data.tracks.error ? (
      <ErrorBlock
        what="the ground tracks"
        failure={data.tracks.error}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    ) : null;

  return (
    <div className="console">
      <div className="console__header">
        <Masthead data={data} />
      </div>

      <div className="console__filters">
        <FilterBar
          options={options}
          filters={filters}
          onChange={setFilters}
          matching={visibleScenes.length}
          total={scenes.length}
        />
      </div>

      <MapPanel
        scenes={visibleScenes}
        tracks={visibleTracks}
        subSatellite={subSatellite}
        targets={access?.targets ?? []}
        windowCounts={windowCounts}
        colors={colors}
        selectedSceneId={selectedSceneId}
        highlightedSatellite={highlighted}
        onSelectScene={setSelectedSceneId}
        {...(mapOverlay ? { overlay: mapOverlay } : {})}
        {...(mapBanner ? { banner: mapBanner } : {})}
      />

      <ScenePanel
        catalog={data.scenes}
        scenes={visibleScenes}
        selected={selectedScene}
        onSelect={setSelectedSceneId}
        onRetry={() => setReloadKey((k) => k + 1)}
      />

      <div className="console__timeline">
        {data.access.status === 'loading' && (
          <section className="panel">
            <div className="panel__body">
              <LoadingBlock what="access windows" />
            </div>
          </section>
        )}

        {data.access.status === 'error' && data.access.error && (
          <section className="panel">
            <div className="panel__body">
              <ErrorBlock
                what="access windows"
                failure={data.access.error}
                onRetry={() => setReloadKey((k) => k + 1)}
              />
            </div>
          </section>
        )}

        {access && (
          <AccessTimeline
            report={access}
            colors={colors}
            highlighted={highlighted}
            onHighlight={setHighlighted}
            range={range}
            onRangeChange={setRange}
          />
        )}
      </div>
    </div>
  );
}
