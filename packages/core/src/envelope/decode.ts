import { z } from 'zod';
import {
  ENVELOPE_EPOCH_BYTES,
  ENVELOPE_GAS_LIMIT_BYTES,
  ENVELOPE_INNER_HASH_BYTES,
  ENVELOPE_MIN_LENGTH_BYTES,
  ENVELOPE_PREFIX_BYTES,
  ENVELOPE_PREFIX_HEX,
} from '../constants.js';

/**
 * Neo X Envelope Transaction decoder.
 *
 * An Envelope Transaction is how Neo X submits an Anti-MEV encrypted order. The
 * calldata is fixed layout, verified against the Neo X documentation and the
 * released protocol source:
 *
 *   offset 0  : 4 bytes  0xffffffff prefix
 *   offset 4  : 4 bytes  DKG epoch index, big endian
 *   offset 8  : 4 bytes  declared inner transaction gas limit, big endian
 *   offset 12 : 32 bytes inner transaction hash
 *   offset 44 : TPKE ciphertext, remaining bytes
 *
 * The recipient of a real Envelope Transaction is the GovReward system
 * contract. A standalone calldata payload still decodes on layout alone, so
 * this decoder reports the parsed fields and leaves the recipient check to the
 * caller.
 *
 * The ciphertext is never decrypted here. TPKE decryption requires the
 * threshold key material held by the consensus validators, which this
 * read-only tool does not have.
 */

const HEX_DATA_RE = /^0x([0-9a-fA-F]*)$/;

export type EnvelopeDecodeFailureReason =
  | 'invalid-hex'
  | 'too-short'
  | 'invalid-prefix';

export type EnvelopeDecodeResult =
  | {
      ok: true;
      data: EnvelopeFields;
    }
  | {
      ok: false;
      error: EnvelopeDecodeFailureReason;
      message: string;
    };

export interface EnvelopeFields {
  /** The 0xffffffff prefix, echoed back for confirmation. */
  prefix: string;
  /** DKG epoch index, decimal. */
  dkgEpoch: number;
  /** DKG epoch index as hex, as it appears in the payload. */
  dkgEpochHex: string;
  /** Declared inner transaction gas limit, decimal. */
  innerGasLimit: number;
  /** Declared inner transaction gas limit as hex. */
  innerGasLimitHex: string;
  /** 32-byte hash of the encrypted inner transaction. */
  innerTransactionHash: string;
  /** Byte length of the TPKE ciphertext. */
  ciphertextLength: number;
  /** TPKE ciphertext as hex, empty string when none is present. */
  ciphertextHex: string;
  /** Total payload length in bytes. */
  payloadLengthBytes: number;
  /** True when the ciphertext region is zero bytes long. */
  hasEmptyCiphertext: boolean;
}

/** Read a big-endian unsigned 32-bit word from a byte array. */
function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! << 24) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!
  ) >>> 0;
}

/** Check whether a payload opens with the Envelope prefix. */
export function hasEnvelopePrefix(hex: string): boolean {
  const bytes = hexToBytes(hex);
  if (!bytes || bytes.length < ENVELOPE_PREFIX_BYTES) return false;
  return bytes.slice(0, ENVELOPE_PREFIX_BYTES).every((byte, index) => {
    const prefixBytes = hexToBytes(ENVELOPE_PREFIX_HEX);
    return prefixBytes ? byte === prefixBytes[index] : false;
  });
}

export function hexToBytes(hex: string): Uint8Array | null {
  const match = HEX_DATA_RE.exec(hex.trim());
  if (!match) return null;
  const body = match[1] ?? '';
  if (body.length % 2 !== 0) return null;
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Decode Envelope Transaction calldata.
 *
 * Every failure mode is reported rather than thrown so the API can return a
 * precise message and the caller can distinguish malformed input from a payload
 * that simply is not an envelope.
 */
export function decodeEnvelope(hex: string): EnvelopeDecodeResult {
  const bytes = hexToBytes(hex);
  if (!bytes) {
    return {
      ok: false,
      error: 'invalid-hex',
      message: 'Input is not a valid even-length 0x-prefixed hex string',
    };
  }

  if (bytes.length < ENVELOPE_MIN_LENGTH_BYTES) {
    return {
      ok: false,
      error: 'too-short',
      message:
        `Payload is ${bytes.length} bytes. A Neo X Envelope Transaction needs at least ` +
        `${ENVELOPE_MIN_LENGTH_BYTES} bytes: 4 byte prefix, ${ENVELOPE_EPOCH_BYTES} byte DKG epoch, ` +
        `${ENVELOPE_GAS_LIMIT_BYTES} byte inner gas limit and ${ENVELOPE_INNER_HASH_BYTES} byte inner hash`,
    };
  }

  if (!hasEnvelopePrefix(hex)) {
    return {
      ok: false,
      error: 'invalid-prefix',
      message: `Payload does not start with the ${ENVELOPE_PREFIX_HEX} Envelope Transaction prefix`,
    };
  }

  const dkgEpoch = readUint32BE(bytes, ENVELOPE_PREFIX_BYTES);
  const innerGasLimit = readUint32BE(
    bytes,
    ENVELOPE_PREFIX_BYTES + ENVELOPE_EPOCH_BYTES,
  );
  const innerHashStart = ENVELOPE_PREFIX_BYTES + ENVELOPE_EPOCH_BYTES + ENVELOPE_GAS_LIMIT_BYTES;
  const innerTransactionHash = bytesToHex(bytes.slice(innerHashStart, innerHashStart + 32));
  const ciphertext = bytes.slice(innerHashStart + 32);

  return {
    ok: true,
    data: {
      prefix: ENVELOPE_PREFIX_HEX,
      dkgEpoch,
      dkgEpochHex: `0x${dkgEpoch.toString(16).padStart(8, '0')}`,
      innerGasLimit,
      innerGasLimitHex: `0x${innerGasLimit.toString(16).padStart(8, '0')}`,
      innerTransactionHash,
      ciphertextLength: ciphertext.length,
      ciphertextHex: ciphertext.length > 0 ? bytesToHex(ciphertext) : '',
      payloadLengthBytes: bytes.length,
      hasEmptyCiphertext: ciphertext.length === 0,
    },
  };
}

export const decodeEnvelopeRequestSchema = z.object({
  /** 0x-prefixed hex calldata. */
  data: z
    .string()
    .trim()
    .min(1, 'data is required')
    .regex(/^0x[0-9a-fA-F]+$/, 'data must be 0x-prefixed hex with an even number of digits'),
});
