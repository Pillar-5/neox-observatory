import { describe, expect, it } from 'vitest';
import {
  detectEnvelope,
  hexToDecimalStringOrNull,
  hexToNumberOrNull,
  normalizeBlock,
  normalizeReceipt,
} from './normalize.js';

describe('hexToNumberOrNull', () => {
  it('parses JSON-RPC hex quantities into numbers', () => {
    expect(hexToNumberOrNull('0x0')).toBe(0);
    expect(hexToNumberOrNull('0x1a')).toBe(26);
    expect(hexToNumberOrNull('0x7973c7')).toBe(7_959_495);
  });

  it('returns null for absent values', () => {
    expect(hexToNumberOrNull(null)).toBeNull();
    expect(hexToNumberOrNull(undefined)).toBeNull();
    expect(hexToNumberOrNull('')).toBeNull();
  });

  it('passes decimal input through so already-normalized rows are unchanged', () => {
    expect(hexToNumberOrNull(42)).toBe(42);
    expect(hexToNumberOrNull('42')).toBe(42);
  });

  it('returns null for values that are not numbers at all', () => {
    expect(hexToNumberOrNull('not-a-number')).toBeNull();
    expect(hexToNumberOrNull('0x')).toBeNull();
  });

  it('throws rather than truncating a quantity beyond the safe integer range', () => {
    // 2^53 is the first integer a double cannot represent exactly.
    expect(() => hexToNumberOrNull('0x20000000000000')).toThrow(/safe integer/);
  });
});

describe('hexToDecimalStringOrNull', () => {
  it('converts hex quantities to decimal strings', () => {
    expect(hexToDecimalStringOrNull('0x0')).toBe('0');
    expect(hexToDecimalStringOrNull('0x9502f9000')).toBe('40000000000');
  });

  it('keeps wei precision that a Number would lose', () => {
    // 2^64 + 1: the double nearest to it rounds to ...616, losing the final 1.
    expect(Number(BigInt('0x10000000000000001'))).toBe(18_446_744_073_709_551_616);
    expect(hexToDecimalStringOrNull('0x10000000000000001')).toBe('18446744073709551617');
  });

  it('returns null for absent values', () => {
    expect(hexToDecimalStringOrNull(null)).toBeNull();
    expect(hexToDecimalStringOrNull(undefined)).toBeNull();
    expect(hexToDecimalStringOrNull('')).toBeNull();
  });

  it('leaves decimal strings alone', () => {
    expect(hexToDecimalStringOrNull('40000000000')).toBe('40000000000');
  });
});

describe('normalizeReceipt', () => {
  it('returns an unobserved receipt when the transaction has none', () => {
    expect(normalizeReceipt(null)).toEqual({
      status: null,
      gasUsed: null,
      effectiveGasPrice: null,
      logs: [],
    });
  });

  it('keeps status as the raw 0/1 the chain reports', () => {
    const normalized = normalizeReceipt({ status: 1, gasUsed: 21_000n, gasPrice: 40_000_000_000n });
    expect(normalized.status).toBe(1);
    expect(normalized.gasUsed).toBe('21000');
    expect(normalized.effectiveGasPrice).toBe('40000000000');
  });

  it('reports a failed transaction as status 0, not as a missing receipt', () => {
    expect(normalizeReceipt({ status: 0, gasUsed: 1n }).status).toBe(0);
  });
});

describe('normalizeBlock', () => {
  it('converts bigint fields to decimal strings and counts transactions', () => {
    const summary = normalizeBlock({
      number: 12,
      hash: '0xabc',
      parentHash: '0xdef',
      timestamp: 1_700_000_000,
      transactions: ['0x1', '0x2'],
      gasUsed: 21_000n,
      gasLimit: 30_000_000n,
      baseFeePerGas: null,
    });

    expect(summary).toMatchObject({
      number: 12,
      hash: '0xabc',
      parentHash: '0xdef',
      timestamp: 1_700_000_000,
      transactionCount: 2,
      gasUsed: '21000',
      gasLimit: '30000000',
      baseFeePerGas: null,
    });
    expect(summary.observedAt).toMatch(/^\d{4}-/);
  });

  it('does not emit BigInt, which JSON.stringify cannot serialize', () => {
    const summary = normalizeBlock({
      number: 1,
      hash: '0x1',
      parentHash: '0x0',
      timestamp: 1,
      transactions: [],
      gasUsed: 1n,
      gasLimit: 1n,
      baseFeePerGas: 1n,
    });
    expect(() => JSON.stringify(summary)).not.toThrow();
  });
});

describe('detectEnvelope', () => {
  const GOV_REWARD = '0x1212000000000000000000000000000000000003';
  const OTHER = '0x1111111111111111111111111111111111111111';

  it('marks a GovReward transaction with the envelope prefix as an envelope', () => {
    // 4 byte prefix + 4 epoch + 4 gas limit + 32 inner hash = 44 bytes minimum.
    const payload = `0xffffffff${'00'.repeat(40)}`;
    const result = detectEnvelope(GOV_REWARD, payload);
    expect(result.isEnvelope).toBe(true);
    expect(result.decoded?.ok).toBe(true);
  });

  it('does not treat the prefix alone as proof when the recipient differs', () => {
    const payload = `0xffffffff${'00'.repeat(40)}`;
    const result = detectEnvelope(OTHER, payload);
    expect(result.isEnvelope).toBe(false);
  });

  it('ignores an ordinary transaction sent to GovReward', () => {
    const result = detectEnvelope(GOV_REWARD, '0x70a08231');
    expect(result.isEnvelope).toBe(false);
  });

  it('returns no verdict when either field is missing', () => {
    expect(detectEnvelope(null, '0xffffffff').isEnvelope).toBe(false);
    expect(detectEnvelope(GOV_REWARD, null).isEnvelope).toBe(false);
    expect(detectEnvelope(GOV_REWARD, '0x').isEnvelope).toBe(false);
  });
});
