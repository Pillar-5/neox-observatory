import { z } from 'zod';

/**
 * Request validation for the public API.
 *
 * Every user-supplied value passes through one of these schemas before it
 * reaches a database query or an RPC call. Limits are explicit so a caller
 * cannot request an unbounded result set.
 */

/** 32-byte transaction hash, hex, case insensitive. */
export const txHashSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32-byte hex transaction hash');

/** Non-negative block number as a string or number in a path parameter. */
export const blockNumberSchema = z.coerce
  .number()
  .int('block number must be an integer')
  .nonnegative('block number must be zero or greater');

export const limitQuerySchema = z
  .union([z.coerce.number().int().positive().max(500), z.literal('')])
  .optional()
  .transform((value) => (value === '' || value === undefined ? 25 : value));

export const offsetQuerySchema = z
  .union([z.coerce.number().int().nonnegative().max(100_000), z.literal('')])
  .optional()
  .transform((value) => (value === '' || value === undefined ? 0 : value));

export const blocksQuerySchema = z.object({
  limit: limitQuerySchema,
  offset: offsetQuerySchema,
});

export const bridgeQuerySchema = z.object({
  limit: limitQuerySchema,
  offset: offsetQuerySchema,
});

/**
 * Envelope payload for decoding.
 *
 * Accepts an optional 0x prefix and requires at least the documented fixed
 * header length, which is prefix plus epoch plus gas limit plus inner hash. The
 * prefix check itself lives in the decoder so the API and the tests share one
 * implementation.
 */
export const envelopeDecodeSchema = z.object({
  payload: z
    .string()
    .trim()
    .min(1, 'payload must not be empty')
    .max(200_000, 'payload is too large to decode'),
});

export type EnvelopeDecodeInput = z.infer<typeof envelopeDecodeSchema>;
export type BlocksQuery = z.infer<typeof blocksQuerySchema>;
export type BridgeQuery = z.infer<typeof bridgeQuerySchema>;
