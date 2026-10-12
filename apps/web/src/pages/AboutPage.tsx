/**
 * Data Sources page.
 *
 * Explains what the dashboard queries, which contracts it watches, which RPC
 * methods it uses, and where that information comes from. Every claim on this
 * page maps to a real API route or a line in docs/sources.md.
 */
export default function AboutPage() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Data sources</h1>
        <p className="page-description">
          What this tool reads, how often, from where, and what it does not do.
        </p>
      </div>

      <div className="card">
        <h2 className="card-title">What is queried</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Source</th>
              <th scope="col">How often</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Block head, timestamps, gas price, chain ID</td>
              <td>Configured Neo X JSON-RPC endpoint</td>
              <td>Every page load and every indexer poll</td>
            </tr>
            <tr>
              <td>Recent blocks and transactions</td>
              <td>Same RPC endpoint, stored in local SQLite</td>
              <td>Background indexer, bounded batches with checkpoints</td>
            </tr>
            <tr>
              <td>Anti-MEV policy</td>
              <td>eth_envelopeFee and eth_maxEnvelopeGasLimit on the node</td>
              <td>On demand, each observation timestamped and stored</td>
            </tr>
            <tr>
              <td>Bridge messages</td>
              <td>MessageSend and Execution events from MessageBridge logs</td>
              <td>Background scan over a bounded recent range</td>
            </tr>
            <tr>
              <td>Account-abstraction configuration</td>
              <td>eth_getCode on GovPaymaster and EntryPoint addresses</td>
              <td>At startup</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="card-title">Contracts monitored</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Contract</th>
              <th scope="col">Address</th>
              <th scope="col">Checked by</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>GovReward (envelope recipient)</td>
              <td className="monospace">0x1212000000000000000000000000000000000003</td>
              <td>Indexer recipients; decoder prefix check</td>
            </tr>
            <tr>
              <td>MessageBridge</td>
              <td className="monospace">0x1212000000000000000000000000000000000009</td>
              <td>eth_getCode at startup; event logs while indexing</td>
            </tr>
            <tr>
              <td>ExecutionManager</td>
              <td className="monospace">0x85776439bbE26A3B6F91baB0fb8Ef3fDc769f385</td>
              <td>eth_getCode at startup; event logs while indexing</td>
            </tr>
            <tr>
              <td>GovPaymaster</td>
              <td className="monospace">0x121200000000000000000000000000000000000a</td>
              <td>eth_getCode at startup; event indexing disabled pending a verified ABI</td>
            </tr>
            <tr>
              <td>ERC-4337 EntryPoint v0.9</td>
              <td className="monospace">0x433709009B8330FDa32311DF1C2AFA402eD8D009</td>
              <td>eth_getCode at startup</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="card-title">Collection timestamps</h2>
        <p className="page-description">
          Every label that says Last updated or observed at is the timestamp of the underlying
          RPC call or database read. Policy observations carry the block number at which they
          were read. Nothing on this dashboard is generated data.
        </p>
      </div>

      <div className="card">
        <h2 className="card-title">Limitations</h2>
        <ul className="page-description" style={{ paddingLeft: '1.25rem' }}>
          <li>
            Only the recent window from INDEXER_START_BLOCK is indexed. This is not an archival
            explorer.
          </li>
          <li>
            eth_getCachedTransaction needs a node configured for the Anti-MEV cache. Public
            endpoints generally do not support it, and the dashboard does not depend on it.
          </li>
          <li>
            Envelope decoding reports layout fields only. TPKE ciphertext cannot be decrypted by
            this tool.
          </li>
          <li>
            Bridge destination correlation on Neo N3 is partial. A message without an observed
            execution is shown as destination execution not observed.
          </li>
          <li>
            Sponsorship indexing is disabled until the GovPaymaster event model can be verified
            from a public artifact. Bytecode presence is verified and reported.
          </li>
        </ul>
      </div>

      <div className="card">
        <h2 className="card-title">Source links</h2>
        <ul className="page-description" style={{ paddingLeft: '1.25rem' }}>
          <li>
            <a href="https://docs.neox.io" target="_blank" rel="noreferrer">
              Neo X documentation
            </a>{' '}
            : Anti-MEV methods, envelope layout, chain configuration
          </li>
          <li>
            <a href="https://github.com/bane-labs" target="_blank" rel="noreferrer">
              Bane Labs public repositories
            </a>{' '}
            : bridge contract ABIs and deployment addresses
          </li>
          <li>
            <a href="https://xexplorer.neo.org" target="_blank" rel="noreferrer">
              Neo X explorer
            </a>{' '}
            : independent reference for blocks and transactions
          </li>
        </ul>
      </div>
    </div>
  );
}
