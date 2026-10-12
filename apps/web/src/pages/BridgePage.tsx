import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, relativeTime, shortHex } from '../lib/api';

/**
 * Message Bridge page.
 *
 * Shows only events the indexer actually observed on Neo X. A message whose
 * destination execution has not been observed is reported in a partial state
 * rather than presented as complete, because Neo N3 destination correlation
 * needs a separate Neo N3 data source.
 */
export default function BridgePage() {
  const messages = useQuery({
    queryKey: ['bridge-messages'],
    queryFn: () => api.getBridgeMessages({ limit: 25 }),
    refetchInterval: 30_000,
  });

  const configuration = messages.data?.configuration;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Message Bridge</h1>
        <p className="page-description">
          Neo X to Neo N3 Message Bridge activity observed from MessageBridge and ExecutionManager
          events on the Neo X side.
        </p>
      </div>

      {configuration && (
        <div className="card">
          <h2 className="card-title">Configuration</h2>
          <table>
            <tbody>
              <tr>
                <th scope="row">MessageBridge</th>
                <td>
                  <span
                    className={`badge ${configuration.messageBridgeVerified ? 'badge-success' : 'badge-warning'}`}
                  >
                    {configuration.messageBridgeVerified ? 'bytecode verified' : 'not verified'}
                  </span>{' '}
                  <span className="monospace">{configuration.messageBridgeAddress}</span>
                </td>
              </tr>
              <tr>
                <th scope="row">ExecutionManager</th>
                <td>
                  <span
                    className={`badge ${configuration.executionManagerVerified ? 'badge-success' : 'badge-warning'}`}
                  >
                    {configuration.executionManagerVerified ? 'bytecode verified' : 'not verified'}
                  </span>{' '}
                  <span className="monospace">{configuration.executionManagerAddress}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="page-description mt-2">
            Verification reads deployed bytecode with eth_getCode at startup. An unverified
            contract means the address returned no bytecode on this endpoint.
          </p>
        </div>
      )}

      <div className="card table-container">
        <h2 className="card-title">Observed messages</h2>

        {messages.isLoading && (
          <p className="page-description">
            <span className="loading" aria-label="Loading" /> Loading bridge messages
          </p>
        )}

        {messages.isError && (
          <div className="error-state" role="alert">
            <p>Could not load bridge messages.</p>
            <p className="mt-2">
              {messages.error instanceof Error ? messages.error.message : 'Unknown error'}
            </p>
          </div>
        )}

        {messages.data && messages.data.messages.length === 0 && (
          <div className="empty-state">
            <p>No bridge messages observed in the indexed range.</p>
            <p>
              MessageSend and Execution events from the bridge contracts are recorded as the
              indexer scans recent blocks. This can also mean the bridge was idle during the
              scanned range.
            </p>
          </div>
        )}

        {messages.data && messages.data.messages.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Message ID</th>
                <th scope="col">State</th>
                <th scope="col">Source block</th>
                <th scope="col">Source transaction</th>
                <th scope="col">Latency</th>
                <th scope="col">Destination execution</th>
              </tr>
            </thead>
            <tbody>
              {messages.data.messages.map((message) => (
                <tr key={message.id}>
                  <td>
                    <Link to={`/bridge?message=${message.id}`}>{message.id}</Link>
                  </td>
                  <td>
                    <StateBadge state={message.state} />
                  </td>
                  <td>{message.sourceBlockNumber ?? 'not observed'}</td>
                  <td className="monospace">
                    {message.sourceTxHash ? (
                      <a
                        href={message.sourceExplorerUrl ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortHex(message.sourceTxHash, 8)}
                      </a>
                    ) : (
                      'not observed'
                    )}
                  </td>
                  <td>
                    {message.latencySeconds !== null
                      ? `${message.latencySeconds}s`
                      : 'not calculable'}
                  </td>
                  <td className="monospace">
                    {message.executionTxHash
                      ? shortHex(message.executionTxHash, 8)
                      : 'destination execution not observed'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <MessageDetail />
    </div>
  );
}


function StateBadge({ state }: { state: string }) {
  if (state === 'message_observed') {
    return <span className="badge badge-info">message observed</span>;
  }
  if (state === 'execution_observed') {
    return <span className="badge badge-success">execution observed</span>;
  }
  if (state === 'execution_failed') {
    return <span className="badge badge-error">execution failed</span>;
  }
  return <span className="badge badge-neutral">{state}</span>;
}

/** Detail card rendered when a message id is present in the URL. */
function MessageDetail() {
  const [searchParams, setSearchParams] = useSearchParams();
  const id = searchParams.get('message') ?? '';

  const message = useQuery({
    queryKey: ['bridge-message', id],
    queryFn: () => api.getBridgeMessage(id),
    enabled: id !== '',
    retry: false,
  });

  if (id === '') return null;

  const detail = message.data?.message;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <h2 className="card-title" style={{ marginBottom: 0 }}>
          Message {id}
        </h2>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.delete('message');
            setSearchParams(next, { replace: true });
          }}
        >
          Close
        </button>
      </div>

      {message.isLoading && (
        <p className="page-description">
          <span className="loading" aria-label="Loading" /> Loading message
        </p>
      )}

      {message.isError && (
        <div className="error-state" role="alert">
          <p>
            {message.error instanceof Error
              ? message.error.message
              : `Message ${id} was not found in the observed range`}
          </p>
        </div>
      )}

      {detail && (
        <table>
          <tbody>
            <tr>
              <th scope="row">State</th>
              <td>
                <StateBadge state={detail.state} />
              </td>
            </tr>
            <tr>
              <th scope="row">Direction</th>
              <td>{describeDirection(detail.direction)}</td>
            </tr>
            <tr>
              <th scope="row">Source transaction</th>
              <td className="monospace">{detail.sourceTxHash ?? 'not observed'}</td>
            </tr>
            <tr>
              <th scope="row">Source block</th>
              <td>{detail.sourceBlockNumber ?? 'not observed'}</td>
            </tr>
            <tr>
              <th scope="row">Source address</th>
              <td className="monospace">{detail.sourceAddress ?? 'not observed'}</td>
            </tr>
            <tr>
              <th scope="row">Payload length (bytes)</th>
              <td>{detail.payloadLength ?? 'not observed'}</td>
            </tr>
            <tr>
              <th scope="row">Execution transaction</th>
              <td className="monospace">
                {detail.executionTxHash ?? 'destination execution not observed'}
              </td>
            </tr>
            <tr>
              <th scope="row">Latency</th>
              <td>
                {detail.latencySeconds !== null
                  ? `${detail.latencySeconds}s`
                  : 'not calculable until both sides are observed'}
              </td>
            </tr>
            <tr>
              <th scope="row">Message observed</th>
              <td>{relativeTime(detail.sourceObservedAt)}</td>
            </tr>
            <tr>
              <th scope="row">Execution observed</th>
              <td>
                {detail.executionObservedAt
                  ? relativeTime(detail.executionObservedAt)
                  : 'not observed'}
              </td>
            </tr>
            {detail.errorMessage && (
              <tr>
                <th scope="row">Error</th>
                <td>{detail.errorMessage}</td>
              </tr>
            )}
            {detail.sourceExplorerUrl && (
              <tr>
                <th scope="row">Source explorer</th>
                <td>
                  <a href={detail.sourceExplorerUrl} target="_blank" rel="noreferrer">
                    {detail.sourceExplorerUrl}
                  </a>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function describeDirection(direction: string): string {
  if (direction === 'neox_to_neo') return 'Neo X to Neo N3 (MessageSend observed)';
  if (direction === 'neo_to_neox') return 'Neo N3 to Neo X (Execution observed on Neo X)';
  return direction;
}
