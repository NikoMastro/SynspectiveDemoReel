import type { ApiFailure } from '../interfaces';
import { API_BASE, BACKEND_HINT } from '../lib/api';

/**
 * The three states every panel can be in besides "has data".
 *
 * The error state is the one that matters: a console that just says "failed to
 * load" wastes the operator's time. This one names the service, the base URL,
 * the path and the status, which is enough to go and fix it.
 */

export function LoadingBlock({ what }: { what: string }): React.JSX.Element {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <div className="state__title">Loading {what}</div>
      <div className="state__detail">
        Waiting on <code>{API_BASE}</code>
      </div>
    </div>
  );
}

export function EmptyBlock({
  title,
  detail,
}: {
  title: string;
  detail: string;
}): React.JSX.Element {
  return (
    <div className="state">
      <div className="state__title">{title}</div>
      <div className="state__detail">{detail}</div>
    </div>
  );
}

export function ErrorBlock({
  what,
  failure,
  onRetry,
}: {
  what: string;
  failure: ApiFailure;
  onRetry?: () => void;
}): React.JSX.Element {
  // Status 0 means the request never got an answer, so the service is down
  // rather than unhappy. The two need different advice.
  const unreachable = failure.status === 0;

  return (
    <div className="state state--error" role="alert">
      <div className="state__title">Could not load {what}</div>
      <div className="state__detail">{failure.message}</div>
      <div className="state__detail">
        {unreachable ? 'No response from ' : `HTTP ${failure.status} from `}
        <code>
          {API_BASE}
          {failure.path}
        </code>
      </div>
      {unreachable && (
        <div className="state__detail">
          Start the backend: <code>go run ./cmd/scene-service</code> in{' '}
          <code>backend/</code>, then reload. Expected: {BACKEND_HINT}.
        </div>
      )}
      {onRetry && (
        <div>
          <button type="button" className="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
