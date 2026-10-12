import { useQuery } from '@tanstack/react-query';
import { api, formatBlockTime, relativeTime } from '../lib/api';

export default function OverviewPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.getHealth() });
  const network = useQuery({ queryKey: ['network'], queryFn: () => api.getNetwork() });
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api.getCapabilities(),
  });

  if (network.isLoading || health.isLoading) {
    return (
      <div className="page-header">
        <h1 className="page-title">Overview</h1>
        <p className="page-description">
          <span className="loading" aria-label="Loading" /> Loading network status
        </p>
      </div>
    );
  }

  if (network.isError || !network.data) {
    return (
      <div className="page-header">
        <h1 className="page-title">Overview</h1>
        <div className="error-state" role="alert">
          <p>Could not reach the NeoX Observatory API.</p>
          <p className="mt-2">
            {network.error instanceof Error ? network.error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  const net = network.data;
  const caps = capabilities.data;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Overview</h1>
        <p className="page-description">
          Last updated {relativeTime(net.collectedAt)}
          {!net.rpcHealthy && ' (RPC degraded)'}
        </p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Network</div>
          <div className="stat-value">{net.configuredNetwork}</div>
          <div className="stat-label">
            chain ID {net.chainId}
            {!net.chainIdMatches && (
              <span className="badge badge-error" style={{ marginLeft: '0.5rem' }}>
                expected {net.expectedChainId}
              </span>
            )}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Latest block</div>
          <div className="stat-value">{net.latestBlockNumber ?? 'unavailable'}</div>
          <div className="stat-label">{formatBlockTime(net.latestBlockTimestamp)}</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Gas price</div>
          <div className="stat-value">{net.gasPriceGwei ?? 'unavailable'}</div>
          <div className="stat-label">gwei (eth_gasPrice)</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">RPC health</div>
          <div className="stat-value">{net.rpcHealthy ? 'healthy' : 'degraded'}</div>
          <div className="stat-label">{net.rpcError ?? 'last call succeeded'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2">
        <div className="card">
          <h2 className="card-title">Anti-MEV policy</h2>
          {caps ? (
            <table>
              <tbody>
                <tr>
                  <th scope="row">eth_envelopeFee</th>
                  <td>
                    <StatusBadge status={caps.antiMev.envelopeFee} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">eth_maxEnvelopeGasLimit</th>
                  <td>
                    <StatusBadge status={caps.antiMev.maxEnvelopeGasLimit} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">eth_getCachedTransaction</th>
                  <td>
                    <StatusBadge status={caps.antiMev.cachedTransaction} />
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="page-description">Capability report not loaded yet.</p>
          )}
          <p className="page-description mt-2">
            Envelope fee (last observation): {net.lastObservation?.envelopeFee ?? 'not observed yet'}
          </p>
        </div>

        <div className="card">
          <h2 className="card-title">Contract configuration</h2>
          {caps ? (
            <table>
              <tbody>
                <tr>
                  <th scope="row">MessageBridge</th>
                  <td>
                    <span
                      className={`badge ${caps.bridge.messageBridgeVerified ? 'badge-success' : 'badge-warning'}`}
                    >
                      {caps.bridge.messageBridgeVerified ? 'bytecode verified' : 'not verified'}
                    </span>
                    <div className="monospace mt-1">{caps.bridge.messageBridgeAddress}</div>
                  </td>
                </tr>
                <tr>
                  <th scope="row">ExecutionManager</th>
                  <td>
                    <span
                      className={`badge ${caps.bridge.executionManagerVerified ? 'badge-success' : 'badge-warning'}`}
                    >
                      {caps.bridge.executionManagerVerified ? 'bytecode verified' : 'not verified'}
                    </span>
                    <div className="monospace mt-1">{caps.bridge.executionManagerAddress}</div>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Account abstraction</th>
                  <td>
                    <span
                      className={`badge ${caps.accountAbstraction.configured ? 'badge-success' : 'badge-neutral'}`}
                    >
                      {caps.accountAbstraction.configured
                        ? 'GovPaymaster bytecode verified'
                        : 'not configured'}
                    </span>
                    <div className="stat-label mt-1">
                      sponsorship indexing: {caps.accountAbstraction.sponsorshipIndexing}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="page-description">Capability report not loaded yet.</p>
          )}
        </div>
      </div>

      {health.data && (
        <div className="card mt-4">
          <h2 className="card-title">Index statistics</h2>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Indexed blocks</div>
              <div className="stat-value">{health.data.indexedBlocks}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Indexed transactions</div>
              <div className="stat-value">{health.data.indexedTransactions}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Bridge messages observed</div>
              <div className="stat-value">{health.data.bridgeMessages}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'supported') {
    return <span className="badge badge-success">supported</span>;
  }
  if (status === 'unsupported') {
    return <span className="badge badge-neutral">unsupported by this endpoint</span>;
  }
  if (status === 'error') {
    return <span className="badge badge-warning">temporary error</span>;
  }
  return <span className="badge badge-neutral">not checked</span>;
}
