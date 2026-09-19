import type { Loadable, Scene } from '../interfaces';
import { formatUtc } from '../lib/format';
import { SceneSheet } from './SceneSheet';
import { EmptyBlock, ErrorBlock, LoadingBlock } from './StatusBlock';

/**
 * The right-hand column: whichever of the four states the catalog is in, plus
 * the product sheet once a scene is selected. Keeping the branching here is
 * what lets App.tsx stay a wiring diagram.
 *
 * The list above the sheet is not a convenience. Clicking a footprint means
 * hitting a polygon inside a WebGL canvas, which is unreachable by keyboard,
 * invisible to a screen reader, and a lottery with a thumb on a phone. The list
 * is the same selection by ordinary DOM, so the product sheet - the part that
 * shows the Format Manual was read - can always be reached.
 */

interface Props {
  catalog: Loadable<Scene[]>;
  /** The scenes left after the filters: what the list offers and the map draws. */
  scenes: Scene[];
  selected: Scene | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

export function ScenePanel({
  catalog,
  scenes,
  selected,
  onSelect,
  onRetry,
}: Props): React.JSX.Element {
  return (
    <section className="panel console__panel">
      <div className="panel__head">
        <h2 className="panel__title">Scene metadata</h2>
        {selected && <span className="panel__note">{selected.satellite}</span>}
      </div>
      <div className="panel__body">
        {catalog.status === 'loading' && <LoadingBlock what="the scene catalog" />}

        {catalog.status === 'error' && catalog.error && (
          <ErrorBlock what="the scene catalog" failure={catalog.error} onRetry={onRetry} />
        )}

        {catalog.status === 'ready' && scenes.length === 0 && (
          <EmptyBlock
            title="No scenes match"
            detail="Every scene was filtered out. Reset a filter to get the catalog back."
          />
        )}

        {catalog.status === 'ready' && scenes.length > 0 && (
          <ul className="scene-list" aria-label="Scenes matching the filters">
            {scenes.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="scene-list__item"
                  aria-current={s.id === selected?.id ? 'true' : undefined}
                  onClick={() => onSelect(s.id)}
                >
                  <span className="scene-list__sat">
                    {s.satellite}
                    {s.synthetic && <span className="scene-list__tag">synthetic</span>}
                  </span>
                  <span>{formatUtc(s.acquiredUtc)}</span>
                  <span>
                    {s.imagingMode} · {s.lookSide}-looking
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {catalog.status === 'ready' && selected === null && scenes.length > 0 && (
          <EmptyBlock
            title="No scene selected"
            detail={`Pick one of the ${scenes.length} scenes above, or click its footprint on the map, to read its product sheet.`}
          />
        )}

        {selected && <SceneSheet scene={selected} />}
      </div>
    </section>
  );
}
