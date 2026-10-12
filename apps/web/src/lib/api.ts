import { createNeoXObservatoryClient, type NeoXObservatoryClient } from '@neox-observatory/sdk';

/**
 * Shared API client for the dashboard.
 *
 * The base URL comes from VITE_API_URL when set, and falls back to the same
 * origin, which works in development through the Vite proxy and in production
 * when the API and dashboard share a host.
 */
const baseUrl = import.meta.env.VITE_API_URL ?? '';

export const api: NeoXObservatoryClient = createNeoXObservatoryClient({ baseUrl });

/** "42 seconds ago" style relative time for last-updated labels. */
export function relativeTime(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return 'never';
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Format a unix-seconds timestamp as an ISO string. */
export function formatBlockTime(unixSeconds: number | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined) return 'unknown';
  return new Date(unixSeconds * 1000).toISOString().replace('.000Z', 'Z');
}

/** Truncate a long hex value for table display, keeping both ends. */
export function shortHex(value: string | null | undefined, chars = 10): string {
  if (!value) return '-';
  if (value.length <= chars * 2) return value;
  return `${value.slice(0, chars)}...${value.slice(-chars)}`;
}
