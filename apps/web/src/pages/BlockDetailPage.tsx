import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, formatBlockTime, shortHex } from '../lib/api';

/** One indexed block with its transactions. */
export default function BlockDetailPage() {
  const params = useParams<{ number: string }>();
  const number = Number.parseInt(params.number ?? '', 10);

  const block = useQuery({
    queryKey: ['block', number],
    queryFn: () => api.getBlock(number),
    enabled: Number.isInteger(number) && number >= 0,
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Block {Number.isInteger(number) ? number : 'invalid'}</h1>
        <p className="page-description">
          <Link to="/blocks">&larr; back to blocks</Link>
        </p>
      </div>

      {block.isLoading && (
        <p className="page-description">
          <span className="loading" aria-label="Loading" /> Loading block
        </p>
      )}

      {block.isError && (
        <div className="error-state" role="alert">
          <p>Could not load block {params.number}.</p>
          <p className="mt-2">
            {block.error instanceof Error ? block.error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {block.data && (
        <div>
          <div className="card">
            <h2 className="card-title">Block</h2>
            <table>
              <tbody>
                <tr>
                  <th scope="row">Height</th>
                  <td>{block.data.block.number}</td>
                </tr>
                <tr>
                  <th scope="row">Hash</th>
                  <td className="monospace">{block.data.block.hash}</td>
                </tr>
                <tr>
                  <th scope="row">Parent hash</th>
                  <td className="monospace">{block.data.block.parentHash}</td>
                </tr>
                <tr>
                  <th scope="row">Timestamp</th>
                  <td>{formatBlockTime(block.data.block.timestamp)}</td>
                </tr>
                <tr>
                  <th scope="row">Transactions</th>
                  <td>{block.data.block.transactionCount}</td>
                </tr>
                <tr>
                  <th scope="row">Gas used</th>
                  <td>{block.data.block.gasUsed ?? 'unknown'}</td>
                </tr>
                <tr>
                  <th scope="row">Observed at</th>
                  <td>{block.data.block.observedAt}</td>
                </tr>
                {block.data.block.explorerUrl && (
                  <tr>
                    <th scope="row">Explorer</th>
                    <td>
                      <a href={block.data.block.explorerUrl} target="_blank" rel="noreferrer">
                        {block.data.block.explorerUrl}
                      </a>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card table-container">
            <h2 className="card-title">Transactions</h2>
            {block.data.transactions.length === 0 ? (
              <div className="empty-state">
                <p>This block contained no transactions.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Hash</th>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {block.data.transactions.map((tx) => (
                    <tr key={tx.hash}>
                      <td>{tx.transactionIndex}</td>
                      <td>
                        <Link to={`/transaction?hash=${tx.hash}`} className="monospace">
                          {shortHex(tx.hash, 8)}
                        </Link>
                      </td>
                      <td className="monospace">{shortHex(tx.from, 6)}</td>
                      <td className="monospace">
                        {tx.isEnvelope ? (
                          <span className="badge badge-info" title="Envelope Transaction">
                            envelope
                          </span>
                        ) : (
                          shortHex(tx.to, 6)
                        )}
                      </td>
                      <td>
                        <StatusCell status={tx.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusCell({ status }: { status: number | null }) {
  if (status === null) return <span className="badge badge-neutral">unknown</span>;
  if (status === 1) return <span className="badge badge-success">success</span>;
  return <span className="badge badge-error">failed</span>;
}
