import { describe, expect, it, vi } from 'vitest';
import { describeMethod } from './commands.js';
import { emit, formatTimestamp, program } from './runtime.js';

describe('describeMethod', () => {
  it('shows both raw and normalized values for a supported method', () => {
    expect(
      describeMethod({ status: 'supported', rawValue: '0x0', normalizedValue: '0' }),
    ).toBe('0x0 (0 normalized)');
  });

  it('says unsupported plainly rather than inventing a value', () => {
    expect(
      describeMethod({ status: 'unsupported', rawValue: null, normalizedValue: null }),
    ).toBe('unsupported by this endpoint');
  });

  it('surfaces the probe error so a failure is not read as absence', () => {
    expect(
      describeMethod({
        status: 'error',
        rawValue: null,
        normalizedValue: null,
        error: 'missing value for required argument 0',
      }),
    ).toBe('probe failed: missing value for required argument 0');
  });

  it('reports an error without a message without appending a stray colon', () => {
    expect(describeMethod({ status: 'error', rawValue: null, normalizedValue: null })).toBe(
      'probe failed',
    );
  });

  it('prints an unexpected status verbatim instead of claiming a value', () => {
    expect(describeMethod({ status: 'unknown', rawValue: '0x1', normalizedValue: '1' })).toBe(
      'unknown',
    );
  });
});

describe('formatTimestamp', () => {
  it('formats unix seconds as a UTC ISO string', () => {
    expect(formatTimestamp(1_791_620_453)).toBe('2026-10-10T08:20:53Z');
  });

  it('reports an absent timestamp as unknown rather than epoch', () => {
    expect(formatTimestamp(null)).toBe('unknown');
  });

  it('reports a non-numeric timestamp as unknown', () => {
    expect(formatTimestamp(Number.NaN)).toBe('unknown');
  });
});

describe('emit', () => {
  it('writes the formatted text when --json was not passed', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      emit({ a: 1 }, () => 'hello text');
      // Assert before mockRestore, which clears the recorded calls.
      expect(write).toHaveBeenCalledWith('hello text\n');
    } finally {
      write.mockRestore();
    }
  });

  it('writes pretty-printed JSON when --json was passed', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const previous = program.opts().json;
    program.setOptionValue('json', true);
    try {
      emit({ a: 1 }, () => 'should not appear');
      expect(write).toHaveBeenCalledWith(`${JSON.stringify({ a: 1 }, null, 2)}\n`);
    } finally {
      program.setOptionValue('json', previous);
      write.mockRestore();
    }
  });
});
