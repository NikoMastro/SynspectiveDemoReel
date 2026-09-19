import type { ConsoleData } from '../interfaces';

/**
 * Title bar plus one pill that says, at a glance, whether the console is
 * actually talking to the backend. Anyone opening the deployed link should know
 * within a second whether they are looking at live data or an outage.
 */

type Health = 'loading' | 'ok' | 'degraded' | 'down';

/**
 * All four resources fine is "ok", all four failed is "down", a mix is
 * "degraded" - that is a real state and pretending otherwise would hide a
 * half-broken backend.
 */
export function backendHealth(data: ConsoleData): Health {
  const statuses = Object.values(data).map((r) => r.status);
  if (statuses.every((s) => s === 'error')) return 'down';
  if (statuses.some((s) => s === 'error')) return 'degraded';
  if (statuses.some((s) => s === 'loading')) return 'loading';
  return 'ok';
}

const LABEL: Record<Health, string> = {
  loading: 'Connecting',
  ok: 'Backend online',
  degraded: 'Backend degraded',
  down: 'Backend unreachable',
};

const MODIFIER: Record<Health, string> = {
  loading: '',
  ok: 'pill--ok',
  degraded: 'pill--warn',
  down: 'pill--error',
};

export function Masthead({ data }: { data: ConsoleData }): React.JSX.Element {
  const health = backendHealth(data);

  return (
    <header className="masthead">
      <h1 className="masthead__title">StriX Scene Explorer</h1>
      <p className="masthead__subtitle">
        Acquisition footprints, TLE-derived ground tracks and access windows for the StriX
        constellation. Orbits from public Celestrak elements; one real StriX-3 scene over Mt. Aso,
        the rest synthetic and labelled as such.
      </p>
      <span className={`pill ${MODIFIER[health]}`.trim()} data-testid="backend-health">
        <span className="pill__dot" aria-hidden="true" />
        {LABEL[health]}
      </span>
    </header>
  );
}
