import { describe, expect, it } from 'vitest';
import { createNeoXObservatoryClient, NeoXObservatoryApiError } from './client.js';

/** Build a fetch stub that records the call and replays a canned response. */
function stubFetch(
  body: unknown,
  init: { status?: number; emptyBody?: boolean } = {},
): { fetchImpl: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, requestInit?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString();
    calls.push({ url: href, init: requestInit });
    const text = init.emptyBody ? '' : JSON.stringify(body);
    return {
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      text: async () => text,
    } as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('createNeoXObservatoryClient', () => {
  it('requests the documented route with an accept header', async () => {
    const { fetchImpl, calls } = stubFetch({ status: 'ok' });
    const client = createNeoXObservatoryClient({ baseUrl: 'http://localhost:3100', fetchImpl });

    await client.getHealth();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://localhost:3100/api/health');
    expect(calls[0]!.init?.headers).toMatchObject({ accept: 'application/json' });
  });

  it('trims trailing slashes so a base URL with one does not double up', async () => {
    const { fetchImpl, calls } = stubFetch({ total: 0, blocks: [] });
    const client = createNeoXObservatoryClient({ baseUrl: 'http://localhost:3100/', fetchImpl });

    await client.getBlocks();

    expect(calls[0]!.url).toBe('http://localhost:3100/api/blocks');
  });

  it('serializes list params as a query string', async () => {
    const { fetchImpl, calls } = stubFetch({ total: 0, blocks: [] });
    const client = createNeoXObservatoryClient({ baseUrl: 'http://x', fetchImpl });

    await client.getBlocks({ limit: 5, offset: 10 });

    expect(calls[0]!.url).toBe('http://x/api/blocks?limit=5&offset=10');
  });

  it('omits the query string entirely when no params are given', async () => {
    const { fetchImpl, calls } = stubFetch({ total: 0, blocks: [] });
    const client = createNeoXObservatoryClient({ baseUrl: 'http://x', fetchImpl });

    await client.getAntiMevHistory();

    expect(calls[0]!.url).toBe('http://x/api/antimev/history');
  });

  it('encodes a transaction hash path segment verbatim', async () => {
    const { fetchImpl, calls } = stubFetch({ source: 'live' });
    const client = createNeoXObservatoryClient({ baseUrl: 'http://x', fetchImpl });

    await client.getTransaction('0xabc');

    expect(calls[0]!.url).toBe('http://x/api/transactions/0xabc');
  });

  it('raises NeoXObservatoryApiError with the machine-readable code', async () => {
    const { fetchImpl } = stubFetch(
      { error: { code: 'transaction_not_found', message: 'Transaction 0x1 not found' } },
      { status: 404 },
    );
    const client = createNeoXObservatoryClient({ baseUrl: 'http://x', fetchImpl });

    const error = await client.getTransaction('0x1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NeoXObservatoryApiError);
    const apiError = error as NeoXObservatoryApiError;
    expect(apiError.statusCode).toBe(404);
    expect(apiError.code).toBe('transaction_not_found');
    expect(apiError.message).toBe('Transaction 0x1 not found');
  });

  it('falls back to unknown_error when the body carries no code', async () => {
    const { fetchImpl } = stubFetch('boom', { status: 500 });
    const client = createNeoXObservatoryClient({ baseUrl: 'http://x', fetchImpl });

    const error = await client.getNetwork().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NeoXObservatoryApiError);
    expect((error as NeoXObservatoryApiError).code).toBe('unknown_error');
    expect((error as NeoXObservatoryApiError).statusCode).toBe(500);
  });

  it('sends decodeEnvelope as a JSON POST', async () => {
    const { fetchImpl, calls } = stubFetch({ decoded: true });
    const client = createNeoXObservatoryClient({ baseUrl: 'http://x', fetchImpl });

    await client.decodeEnvelope({ payload: '0xffffffff' });

    expect(calls[0]!.url).toBe('http://x/api/antimev/decode');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ payload: '0xffffffff' }));
  });

  it('treats an empty response body as an empty object rather than throwing', async () => {
    const { fetchImpl } = stubFetch(null, { emptyBody: true });
    const client = createNeoXObservatoryClient({ baseUrl: 'http://x', fetchImpl });

    await expect(client.getHealth()).resolves.toEqual({});
  });

  it('reports a timeout as an explicit message instead of a raw abort', async () => {
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      // Honour the abort signal the client installs.
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }) as typeof fetch;

    const client = createNeoXObservatoryClient({
      baseUrl: 'http://x',
      timeoutMs: 5,
      fetchImpl,
    });

    await expect(client.getHealth()).rejects.toThrow(
      'Request to /api/health timed out after 5ms',
    );
  });
});
