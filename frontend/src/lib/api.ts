/**
 * The only module that knows the backend exists.
 *
 * Every call goes through `getJson`, which turns any failure - network refused,
 * non-2xx, unparseable body - into one ApiFailure carrying the path and status.
 * That is what lets the error banner name the service and the port instead of
 * showing a generic "something went wrong".
 */
import type {
  AccessReport,
  ApiFailure,
  GroundTrack,
  Satellite,
  Scene,
  WireAccessResponse,
  WireGroundTrack,
  WireSatellitesResponse,
  WireScenesResponse,
} from '../interfaces';
import { toAccessReport, toGroundTrack, toSatellite, toScene } from './mapping';

/**
 * Base URL in exactly one place. In dev it stays relative and Vite proxies /api
 * to localhost:8080; a deployed build sets VITE_API_BASE to the Cloud Run URL.
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/v1';

/** Shown in the error banner so a failure is actionable, not just visible. */
export const BACKEND_HINT = 'scene-service on http://localhost:8080';

export class ApiError extends Error implements ApiFailure {
  readonly path: string;
  readonly status: number;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiError';
    this.path = failure.path;
    this.status = failure.status;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    // fetch only rejects when the request never got an HTTP answer, which in
    // practice means the backend is not running. Status 0 marks that case.
    throw new ApiError({
      message: `Cannot reach ${BACKEND_HINT}. Is it running?`,
      path,
      status: 0,
    });
  }

  if (!response.ok) {
    throw new ApiError({
      message: `${BACKEND_HINT} answered ${response.status} ${response.statusText}`.trim(),
      path,
      status: response.status,
    });
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError({
      message: `${BACKEND_HINT} returned a body that is not JSON`,
      path,
      status: response.status,
    });
  }
}

export async function fetchScenes(signal?: AbortSignal): Promise<Scene[]> {
  const body = await getJson<WireScenesResponse>('/scenes', signal);
  return (body.scenes ?? []).map(toScene);
}

export async function fetchSatellites(signal?: AbortSignal): Promise<Satellite[]> {
  const body = await getJson<WireSatellitesResponse>('/satellites', signal);
  return (body.satellites ?? []).map(toSatellite);
}

export interface GroundTrackQuery {
  sat: string;
  minutes: number;
  stepS: number;
}

export async function fetchGroundTrack(
  query: GroundTrackQuery,
  signal?: AbortSignal,
): Promise<GroundTrack> {
  const search = new URLSearchParams({
    sat: query.sat,
    minutes: String(query.minutes),
    step: String(query.stepS),
  });
  const body = await getJson<WireGroundTrack>(`/ground-track?${search}`, signal);
  return toGroundTrack(body);
}

export interface AccessQuery {
  targetIds: string[];
  days: number;
}

export async function fetchAccessWindows(
  query: AccessQuery,
  signal?: AbortSignal,
): Promise<AccessReport> {
  const search = new URLSearchParams({
    targets: query.targetIds.join(','),
    days: String(query.days),
  });
  const body = await getJson<WireAccessResponse>(`/access-windows?${search}`, signal);
  return toAccessReport(body);
}

/** Narrows an unknown thrown value into something the banner can render. */
export function asApiFailure(error: unknown, path: string): ApiFailure {
  if (error instanceof ApiError) {
    return { message: error.message, path: error.path, status: error.status };
  }
  return {
    message: error instanceof Error ? error.message : 'Unknown error',
    path,
    status: 0,
  };
}
