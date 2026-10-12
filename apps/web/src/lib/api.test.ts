import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBlockTime, relativeTime, shortHex } from './api.js';

describe('relativeTime', () => {
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);

  beforeEach(() => {
    // The helper reads the real clock, so pin it to make ages deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says just now for a timestamp inside the same second', () => {
    expect(relativeTime(new Date(now).toISOString())).toBe('just now');
  });

  it('counts seconds below a minute', () => {
    expect(relativeTime(new Date(now - 42_000).toISOString())).toBe('42 seconds ago');
  });

  it('switches to minutes at sixty seconds', () => {
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString())).toBe('5 minutes ago');
  });

  it('uses the singular for one unit', () => {
    expect(relativeTime(new Date(now - 60_000).toISOString())).toBe('1 minute ago');
    expect(relativeTime(new Date(now - 3_600_000).toISOString())).toBe('1 hour ago');
    expect(relativeTime(new Date(now - 86_400_000).toISOString())).toBe('1 day ago');
  });

  it('reports a missing timestamp as never rather than a bogus age', () => {
    expect(relativeTime(null)).toBe('never');
    expect(relativeTime(undefined)).toBe('never');
    expect(relativeTime('')).toBe('never');
  });

  it('reports an unparseable timestamp as unknown', () => {
    expect(relativeTime('not a date')).toBe('unknown');
  });

  it('never reports a negative age for a timestamp in the future', () => {
    expect(relativeTime(new Date(now + 60_000).toISOString())).toBe('just now');
  });
});

describe('formatBlockTime', () => {
  it('formats unix seconds as an ISO string', () => {
    expect(formatBlockTime(1_791_620_453)).toBe('2026-10-10T08:20:53Z');
  });

  it('reports an absent timestamp as unknown instead of 1970', () => {
    expect(formatBlockTime(null)).toBe('unknown');
    expect(formatBlockTime(undefined)).toBe('unknown');
  });
});

describe('shortHex', () => {
  it('keeps both ends of a long hash', () => {
    const hash = `0x${'ab'.repeat(32)}`;
    const short = shortHex(hash);
    expect(short).toBe('0xabababab...ababababab');
    expect(short.length).toBeLessThan(hash.length);
  });

  it('leaves a short value alone', () => {
    expect(shortHex('0xdead')).toBe('0xdead');
  });

  it('renders a dash for an absent value', () => {
    expect(shortHex(null)).toBe('-');
    expect(shortHex('')).toBe('-');
  });

  it('honours a custom width', () => {
    expect(shortHex(`0x${'cd'.repeat(16)}`, 4)).toBe('0xcd...cdcd');
  });
});
