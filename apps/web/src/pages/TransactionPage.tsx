import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import type { TransactionSummary } from '@neox-observatory/sdk';
import { api, shortHex } from '../lib/api';

/**
 * Transaction inspection.
 *
 * The lookup prefers the local index and falls back to a live RPC read, and the
 * response says which source served it. Envelope detection on the live path is
 * an interpretation of the recipient and calldata, not a chain-provided flag.
 */
export default function TransactionPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const hash = searchParams.get('hash') ?? '';
  const [input, setInput] = useState(hash);

  const tx = useQuery({
    queryKey: ['transaction', hash],
    queryFn: () => api.getTransaction(hash),
    enabled: /^0x[0-9a-fA-F]{64}$/.test(hash),
    retry: false,
  });

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = input.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
      setSearchParams({ hash: trimmed });
    }
  }

  const invalid = hash !== '' && !/^0x[0-9a-fA-F]{64}$/.test(hash);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Transaction</h1>
        <p className="page-description">
          Look up a Neo X transaction by hash. Reads from the local index first, then the RPC
          endpoint.
        </p>
      </div>

      <div className="card">
        <form onSubmit={onSubmit} aria-label="Transaction search">
          <div className="form-group">
            <label className="form-label" htmlFor="tx-hash">
              Transaction hash
            </label>
            <input
              id="tx-hash"
              className="form-input monospace"
              placeholder="0x..."
              value={input}
              onChange={(event) => setInput(event.target.value)}
              spellCheck={false}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Look up
          </button>
        </form>
        {invalid && (
          <p className="mt-2" role="alert" style={{ color: '#991b1b' }}>
            A transaction hash is a 0x-prefixed 32-byte hex string.
          </p>
        )}
      </div>

      {tx.isLoading && (
        <p className="page-description">
          <span className="loading" aria-label="Loading" /> Looking up transaction
        </p>
      )}

      {tx.isError && (
        <div className="error-state" role="alert">
          <p>Lookup failed.</p>
          <p className="mt-2">{tx.error instanceof Error ? tx.error.message : 'Unknown error'}</p>
        </div>
      )}

      {tx.data && (
        <div className="card">
          <h2 className="card-title">
            Transaction <span className="monospace">{shortHex(tx.data.transaction.hash, 12)}</span>
          </h2>
          <SourceBadge source={tx.data.source} />
          <TransactionDetails data={tx.data} />
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <p className="mb-2">
      Source:{' '}
      <span className={`badge ${source === 'indexed' ? 'badge-success' : 'badge-info'}`}>
        {source === 'indexed' ? 'local index' : 'live RPC read'}
      </span>
    </p>
  );
}

function TransactionDetails({ data }: { data: Awaited<ReturnType<typeof api.getTransaction>> }) {
  const tx = data.transaction;
  return (
    <table>
      <tbody>
        <tr>
          <th scope="row">Hash</th>
          <td className="monospace">{tx.hash}</td>
        </tr>
        <tr>
          <th scope="row">Block</th>
          <td>{tx.blockNumber ?? 'unknown'}</td>
        </tr>
        <tr>
          <th scope="row">From</th>
          <td className="monospace">{tx.from ?? 'unknown'}</td>
        </tr>
        <tr>
          <th scope="row">To</th>
          <td className="monospace">{tx.to ?? 'contract creation'}</td>
        </tr>
        <tr>
          <th scope="row">Value (wei)</th>
          <td>{tx.value ?? '0'}</td>
        </tr>
        <tr>
          <th scope="row">Nonce</th>
          <td>{tx.nonce ?? 'unknown'}</td>
        </tr>
        <tr>
          <th scope="row">Status</th>
          <td>
            {tx.status === null ? (
              <span className="badge badge-neutral">unknown</span>
            ) : tx.status === 1 ? (
              <span className="badge badge-success">success</span>
            ) : (
              <span className="badge badge-error">failed</span>
            )}
          </td>
        </tr>
        <tr>
          <th scope="row">Gas limit</th>
          <td>{tx.gasLimit ?? 'unknown'}</td>
        </tr>
        <tr>
          <th scope="row">Gas used</th>
          <td>{tx.gasUsed ?? 'not available'}</td>
        </tr>
        <tr>
          <th scope="row">Gas price (wei)</th>
          <td>{tx.gasPrice ?? 'not available'}</td>
        </tr>
        <tr>
          <th scope="row">Envelope</th>
          <td>
            {tx.isEnvelope ? (
              <EnvelopeDetails envelope={tx.envelope} />
            ) : (
              <span className="badge badge-neutral">not an envelope transaction</span>
            )}
          </td>
        </tr>
        {tx.input && tx.input !== '0x' && (
          <tr>
            <th scope="row">Input data</th>
            <td>
              <div className="code-block">{tx.input}</div>
            </td>
          </tr>
        )}
        {data.explorerUrl && (
          <tr>
            <th scope="row">Explorer</th>
            <td>
              <a href={data.explorerUrl} target="_blank" rel="noreferrer">
                {data.explorerUrl}
              </a>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function EnvelopeDetails({ envelope }: { envelope: TransactionSummary['envelope'] }) {
  if (!envelope) {
    return <span className="badge badge-warning">envelope flag set but details missing</span>;
  }
  return (
    <div>
      <span className="badge badge-info">
        decoded from GovReward recipient and 0xffffffff calldata prefix
      </span>
      <table className="mt-2">
        <tbody>
          <tr>
            <th scope="row">DKG epoch</th>
            <td>{envelope.dkgEpoch}</td>
          </tr>
          <tr>
            <th scope="row">Declared inner gas limit</th>
            <td>{envelope.innerGasLimit}</td>
          </tr>
          <tr>
            <th scope="row">Inner transaction hash</th>
            <td className="monospace">{envelope.innerTransactionHash}</td>
          </tr>
          <tr>
            <th scope="row">Ciphertext length (bytes)</th>
            <td>{envelope.ciphertextLength}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


