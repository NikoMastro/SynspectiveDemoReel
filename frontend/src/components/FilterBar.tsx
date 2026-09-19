import type { SceneFilters } from '../interfaces';
import type { FilterOptions } from '../lib/filters';
import { countActiveFilters } from '../lib/filters';

/**
 * The four filters the job's planning workflow actually needs: which satellite,
 * which imaging mode, which pass direction, which side the radar looked.
 *
 * Options come from the catalog (see lib/filters.ts), so a filter can never
 * offer a value that would select nothing.
 */

interface Props {
  options: FilterOptions;
  filters: SceneFilters;
  onChange: (next: SceneFilters) => void;
  matching: number;
  total: number;
}

const FIELDS: { key: keyof SceneFilters; label: string; anyLabel: string }[] = [
  { key: 'satellite', label: 'Satellite', anyLabel: 'All satellites' },
  { key: 'imagingMode', label: 'Imaging mode', anyLabel: 'All modes' },
  { key: 'passDirection', label: 'Pass direction', anyLabel: 'Any pass' },
  { key: 'lookSide', label: 'Look side', anyLabel: 'Either side' },
];

export function FilterBar({
  options,
  filters,
  onChange,
  matching,
  total,
}: Props): React.JSX.Element {
  const active = countActiveFilters(filters);

  const set = (key: keyof SceneFilters, value: string) => {
    // The empty option means "no filter", which is null rather than ''.
    onChange({ ...filters, [key]: value === '' ? null : value });
  };

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Filters</h2>
        <span className="panel__note">
          {matching} of {total} scenes
        </span>
      </div>
      <div className="panel__body filters">
        {FIELDS.map((field) => (
          <div className="filters__field" key={field.key}>
            <label className="filters__label" htmlFor={`filter-${field.key}`}>
              {field.label}
            </label>
            <select
              id={`filter-${field.key}`}
              value={filters[field.key] ?? ''}
              onChange={(event) => set(field.key, event.target.value)}
            >
              <option value="">{field.anyLabel}</option>
              {options[field.key].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        ))}

        <button
          type="button"
          className="button"
          onClick={() =>
            onChange({ satellite: null, imagingMode: null, passDirection: null, lookSide: null })
          }
          disabled={active === 0}
        >
          Reset{active > 0 ? ` (${active})` : ''}
        </button>

        {matching === 0 && total > 0 && (
          <p className="filters__summary">
            No scene matches these four filters together. Reset, or widen one of them.
          </p>
        )}
      </div>
    </section>
  );
}
