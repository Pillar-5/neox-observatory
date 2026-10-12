import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, formatBlockTime, shortHex } from '../lib/api';

/**
 * Recent indexed blocks.
 *
 * The list is served from the local index, so an empty state means the indexer
 * has not run yet rather than that the chain has no blocks.
 */
export default function BlocksPage() {
  const blocks = useQuery({
    queryKey: ['blocks'],
    queryFn: () => api.getBlocks({ limit: 25 }),
    refetchInterval: 15_000,
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Blocks</h1>
        <p className="page-description">
          Latest indexed blocks, newest first. Loaded from the local index maintained by the
          background indexer.
        </p>
      </div>

      {blocks.isLoading && (
        <p className="page-description">
          <span className="loading" aria-label="Loading" /> Loading indexed blocks
        </p>
      )}

      {blocks.isError && (
        <div className="error-state" role="alert">
          <p>Could not load blocks.</p>
          <p className="mt-2">
            {blocks.error instanceof Error ? blocks.error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {blocks.data && blocks.data.blocks.length === 0 && (
        <div className="empty-state">
          <p>No indexed blocks yet.</p>
          <p>The indexer records recent blocks on startup. Try again shortly.</p>
        </div>
      )}

      {blocks.data && blocks.data.blocks.length > 0 && (
        <div className="card table-container">
          <table>
            <thead>
              <tr>
                <th scope="col">Height</th>
                <th scope="col">Timestamp</th>
                <th scope="col">Transactions</th>
                <th scope="col">Hash</th>
              </tr>
            </thead>
            <tbody>
              {blocks.data.blocks.map((block) => (
                <tr key={block.hash}>
                  <td>
                    <Link to={`/blocks/${block.number}`}>{block.number}</Link>
                  </td>
                  <td>{formatBlockTime(block.timestamp)}</td>
                  <td>{block.transactionCount}</td>
                  <td className="monospace">{shortHex(block.hash, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
