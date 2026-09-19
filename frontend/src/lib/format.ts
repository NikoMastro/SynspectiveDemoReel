/**
 * Display formatting, kept out of the components so it can be unit-tested and
 * so every angle in the UI is rounded the same way.
 *
 * Everything operational is shown in UTC. Mission planning has no local time.
 */

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** 2026-06-15T06:35:27Z -> "2026-06-15 06:35:27Z" */
export function formatUtc(d: Date): string {
  if (Number.isNaN(d.getTime())) return '--';
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
  );
}

/** Short axis/tooltip form: "Jun 15 06:35Z" */
export function formatUtcShort(d: Date): string {
  if (Number.isNaN(d.getTime())) return '--';
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${month} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

export function formatDeg(value: number, digits = 2): string {
  return Number.isFinite(value) ? `${value.toFixed(digits)}\u00B0` : '--';
}

/** A range of angles across the scene, e.g. near and far incidence. */
export function formatDegRange(near: number, far: number, digits = 2): string {
  if (!Number.isFinite(near) || !Number.isFinite(far)) return '--';
  return `${near.toFixed(digits)}\u2013${far.toFixed(digits)}\u00B0`;
}

/**
 * A typical access window is about 85 s, and an operator compares those in
 * seconds, not as "1m 25s". So seconds up to two minutes, minutes above.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 120) return `${seconds.toFixed(1)} s`;
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}m ${pad(whole % 60)}s`;
}

// null is not a gap in the data pipeline, it is the delivered product not
// stating a noise floor - which is the case for the real Mt. Aso scene. It
// renders the same as a missing value, and deliberately not as 0 dB.
export function formatDb(value: number | null, digits = 1): string {
  return value !== null && Number.isFinite(value) ? `${value.toFixed(digits)} dB` : '--';
}

export function formatGhz(value: number, digits = 2): string {
  return Number.isFinite(value) ? `${value.toFixed(digits)} GHz` : '--';
}

/** Geodetic position with hemisphere letters, the way a product sheet writes it. */
export function formatLatLon(latDeg: number, lonDeg: number, digits = 4): string {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return '--';
  const lat = `${Math.abs(latDeg).toFixed(digits)}\u00B0 ${latDeg >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(lonDeg).toFixed(digits)}\u00B0 ${lonDeg >= 0 ? 'E' : 'W'}`;
  return `${lat}  ${lon}`;
}

export function formatKm(value: number, digits = 1): string {
  return Number.isFinite(value) ? `${value.toFixed(digits)} km` : '--';
}

/** "--" for anything the backend left empty, so the panel never renders a blank cell. */
export function orDash(value: string | null | undefined): string {
  return value && value.trim() !== '' ? value : '--';
}
