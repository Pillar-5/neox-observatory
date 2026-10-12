import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, relativeTime } from '../lib/api';

/**
 * Anti-MEV policy page.
 *
 * Policy values are read from the connected node on each visit. Unsupported
 * methods are reported as unsupported with no substituted default, and the
 * decoder runs locally in the browser through the API without touching the
 * chain.
 */
export default function AntiMevPage() {
  const policy = useQuery({
    queryKey: ['antimev-policy'],
    queryFn: () => api.getAntiMevPolicy(),
    refetchInterval: 30_000,
  });
  const history = useQuery({
    queryKey: ['antimev-history'],
    queryFn: () => api.getAntiMevHistory({ limit: 50 }),
  });

  const [payload, setPayload] = useState('');
  const decode = useMutation({
    mutationFn: (value: string) => api.decodeEnvelope({ payload: value }),
  });

  function onDecode(event: FormEvent): void {
    event.preventDefault();
    const trimmed = payload.trim();
    if (trimmed) decode.mutate(trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`);
  }

  const chartData = (history.data?.observations ?? [])
    .slice()
    .reverse()
    .map((entry) => ({
      block: entry.blockNumber,
      envelopeFee: entry.envelopeFee !== null ? Number(entry.envelopeFee) : null,
      observedAt: entry.observedAt,
    }));

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Anti-MEV policy</h1>
        <p className="page-description">
          Neo X exposes Anti-MEV policy through JSON-RPC methods. Values below were read from the
          connected endpoint {policy.data ? ` ${relativeTime(policy.data.observedAt)}` : ''}.
        </p>
      </div>

      <div className="card">
        <h2 className="card-title">Current policy</h2>
        {policy.isLoading && (
          <p className="page-description">
            <span className="loading" aria-label="Loading" /> Querying the node
          </p>
        )}
        {policy.isError && (
          <div className="error-state" role="alert">
            <p>Could not query the Anti-MEV policy.</p>
            <p className="mt-2">
              {policy.error instanceof Error ? policy.error.message : 'Unknown error'}
            </p>
          </div>
        )}
        {policy.data && (
          <div>
            <table>
              <tbody>
                <tr>
                  <th scope="row">Observed at block</th>
                  <td>{policy.data.blockNumber}</td>
                </tr>
                <tr>
                  <th scope="row">eth_envelopeFee</th>
                  <td>
                    <MethodValue report={policy.data.envelopeFee} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">eth_maxEnvelopeGasLimit</th>
                  <td>
                    <MethodValue report={policy.data.maxEnvelopeGasLimit} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">eth_getCachedTransaction</th>
                  <td>
                    <MethodValue report={policy.data.cachedTransaction} />
                    <div className="stat-label">
                      Advanced method: requires a node configured for the Anti-MEV cache and
                      sender-signature parameters. The dashboard does not depend on it.
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="page-description mt-2">{policy.data.note}</p>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="card-title">Envelope fee history</h2>
        {chartData.length === 0 ? (
          <div className="empty-state">
            <p>No policy observations recorded yet.</p>
            <p>Observations are stored each time the policy endpoint is queried.</p>
          </div>
        ) : (
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="block" />
                <YAxis width={80} />
                <Tooltip />
                <Line
                  type="stepAfter"
                  dataKey="envelopeFee"
                  name="Envelope fee (wei)"
                  dot={false}
                  stroke="#2563eb"
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2">
        <div className="card">
          <h2 className="card-title">Envelope decoder</h2>
          <p className="page-description mb-2">
            Paste Envelope Transaction calldata. The decoder is deterministic: it checks the
            0xffffffff prefix, then reads the DKG epoch, declared inner gas limit, 32-byte inner
            transaction hash and remaining ciphertext bytes. It never contacts the chain and never
            attempts to decrypt the ciphertext.
          </p>
          <form onSubmit={onDecode} aria-label="Envelope decoder">
            <div className="form-group">
              <label className="form-label" htmlFor="envelope-payload">
                Calldata (0x hex)
              </label>
              <textarea
                id="envelope-payload"
                className="form-input monospace"
                rows={4}
                value={payload}
                onChange={(event) => setPayload(event.target.value)}
                spellCheck={false}
                placeholder="0xffffffff..."
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={decode.isPending}>
              {decode.isPending ? 'Decoding...' : 'Decode'}
            </button>
          </form>

          {decode.isError && (
            <div className="error-state mt-2" role="alert">
              <p>
                {decode.error instanceof Error ? decode.error.message : 'Decode failed'}
              </p>
            </div>
          )}

          {decode.data && (
            <table className="mt-2">
              <tbody>
                <tr>
                  <th scope="row">Prefix</th>
                  <td className="monospace">{decode.data.prefix}</td>
                </tr>
                <tr>
                  <th scope="row">DKG epoch</th>
                  <td>
                    {decode.data.dkgEpoch} <span className="monospace">({decode.data.dkgEpochHex})</span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Declared inner gas limit</th>
                  <td>
                    {decode.data.innerGasLimit}{' '}
                    <span className="monospace">({decode.data.innerGasLimitHex})</span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Inner transaction hash</th>
                  <td className="monospace">{decode.data.innerTransactionHash}</td>
                </tr>
                <tr>
                  <th scope="row">Ciphertext bytes</th>
                  <td>
                    {decode.data.ciphertextLength}
                    {decode.data.hasEmptyCiphertext && ' (empty)'}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Payload bytes</th>
                  <td>{decode.data.payloadLengthBytes}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2 className="card-title">How envelopes work</h2>
          <p className="page-description">
            An Envelope Transaction carries an encrypted inner transaction. Its calldata layout is:
          </p>
          <div className="code-block">
            {`offset 0   4 bytes   0xffffffff prefix
offset 4   4 bytes   DKG epoch index
offset 8   4 bytes   declared inner gas limit
offset 12  32 bytes  inner transaction hash
offset 44  remaining TPKE ciphertext`}
          </div>
          <p className="page-description mt-2">
            The recipient of an envelope transaction is the GovReward system contract
            0x1212000000000000000000000000000000000003. This decoder reports layout fields only.
            Decrypting the ciphertext requires the threshold key shares held by the consensus
            validators, which this tool does not hold.
          </p>
          <p className="page-description mt-2">
            Source: Neo X documentation, linked from the Data Sources page.
          </p>
        </div>
      </div>
    </div>
  );
}

function MethodValue({
  report,
}: {
  report: { status: string; rawValue: string | null; normalizedValue: string | null; error: string | null };
}) {
  if (report.status === 'supported') {
    return (
      <div>
        <span className="badge badge-success">supported</span>{' '}
        <span className="monospace">{report.rawValue}</span>
        {report.normalizedValue && report.normalizedValue !== report.rawValue && (
          <div className="stat-label">decimal: {report.normalizedValue}</div>
        )}
      </div>
    );
  }
  if (report.status === 'unsupported') {
    return (
      <div>
        <span className="badge badge-neutral">unsupported by this endpoint</span>
        <div className="stat-label">No fallback value is shown because none exists.</div>
      </div>
    );
  }
  if (report.status === 'error') {
    return (
      <div>
        <span className="badge badge-warning">temporary error</span>
        <div className="stat-label">{report.error}</div>
      </div>
    );
  }
  return <span className="badge badge-neutral">not checked</span>;
}
