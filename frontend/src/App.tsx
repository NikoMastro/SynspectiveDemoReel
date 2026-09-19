import { useMemo, useState } from 'react';
import type { LocateRequest, Scene, SceneFilters, SceneImagery, TimeRange } from './interfaces';
import { quicklookUrl } from './lib/api';
import { satelliteColorScale } from './lib/colors';
import {
  applyFilters,
  countWindowsByTarget,
  filterOptions,
  filterWindows,
  hasSceneOnlyFilter,
  NO_FILTERS,
  windowsInRange,
} from './lib/filters';
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

  // The filters narrow the opportunities too, not only the catalog. A satellite
  // filter that repainted the map and left every bar in the timeline made the
  // two halves look like they were showing different things.
  const filteredAccess = useMemo(
    () => (access === null ? null : { ...access, windows: filterWindows(access.windows, filters) }),
    [access, filters],
  );

  const windowCounts = useMemo(
    () => countWindowsByTarget(windowsInRange(filteredAccess?.windows ?? [], range)),
    [filteredAccess, range],
  );

  // Resolved against the whole catalog, not the filtered subset: a filter that
  // excludes the selected scene should say so, not silently drop the sheet the
  // user was reading.
  const selectedScene = scenes.find((s) => s.id === selectedSceneId) ?? null;

  // Bringing the map to a scene. Picking from the list does it on its own: the
  // list is how an operator goes to a scene, and a Sliding Spotlight footprint
  // is a dot at the opening zoom. Clicking a footprint on the map does not -
  // the camera is already there, and yanking it would be rude. The sheet's
  // button covers coming back after panning away.
  const [locate, setLocate] = useState<LocateRequest | null>(null);
  const locateScene = (scene: Scene) =>
    setLocate((previous) => ({ footprint: scene.footprint, key: (previous?.key ?? 0) + 1 }));
  const selectFromList = (id: string) => {
    setSelectedSceneId(id);
    const scene = scenes.find((s) => s.id === id);
    if (scene) locateScene(scene);
  };

  // What the map drapes: the selected scene's quicklook, when it has one and
  // the filters have not excluded it. The sheet keeps showing the picture for
  // an excluded scene, because that is the scene being read; the map must not,
  // because it has already dropped that scene's footprint and an image floating
  // with no outline around it belongs to nothing on screen.
  const selectedIsVisible =
    selectedScene !== null && visibleScenes.some((s) => s.id === selectedScene.id);

  const imagery: SceneImagery | null =
    selectedScene?.quicklook && selectedIsVisible
      ? {
          sceneId: selectedScene.id,
          quicklook: selectedScene.quicklook,
          url: quicklookUrl(selectedScene.id),
        }
      : null;

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
    <>
      {/* Outside the grid so the grid itself can be <main>. A landmark that
          contained the page header would not be the main content. */}
      <div className="console__masthead">
        <Masthead data={data} />
      </div>

      <main className="console">
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
        targets={filteredAccess?.targets ?? []}
        windowCounts={windowCounts}
        colors={colors}
        selectedSceneId={selectedSceneId}
        highlightedSatellite={highlighted}
        imagery={imagery}
        locate={locate}
        onSelectScene={setSelectedSceneId}
        {...(mapOverlay ? { overlay: mapOverlay } : {})}
        {...(mapBanner ? { banner: mapBanner } : {})}
      />

      <ScenePanel
        catalog={data.scenes}
        scenes={visibleScenes}
        selected={selectedScene}
        onSelect={selectFromList}
        onLocate={() => {
          if (selectedScene) locateScene(selectedScene);
        }}
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

        {filteredAccess && (
          <AccessTimeline
            report={filteredAccess}
            totalWindows={access?.windows.length ?? 0}
            sceneOnlyFilter={hasSceneOnlyFilter(filters)}
            colors={colors}
            highlighted={highlighted}
            onHighlight={setHighlighted}
            range={range}
            onRangeChange={setRange}
          />
        )}
        </div>
      </main>
    </>
  );
}
