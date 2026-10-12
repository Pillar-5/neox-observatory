import { createNeoXObservatoryClient } from '../packages/sdk/dist/index.js';

const client = createNeoXObservatoryClient({ baseUrl: 'http://localhost:3100' });

/** Assert a live/API value matches what the same field says on-chain. */
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: api=${actual} expected=${expected}`);
  if (!ok) process.exitCode = 1;
}

const rpc = (method, params = []) =>
  fetch('https://mainnet-1.rpc.banelabs.org', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
    .then((r) => r.json())
    .then((j) => j.result);

const blocks = await client.getBlocks({ limit: 1 });
const head = await rpc('eth_blockNumber');

console.log('--- health ---');
const health = await client.getHealth();
check('health.status', health.status, 'ok');
check('health.chainId', health.chainId, 47763);
check('health.rpcHealthy', health.rpcHealthy, true);

console.log('--- network ---');
const network = await client.getNetwork();
check('network.chainIdMatches', network.chainIdMatches, true);
check('network.chainIdHex', network.chainIdHex, '0xba93');
check('network.latestBlockNumber vs chain head', network.latestBlockNumber, parseInt(head, 16));
check(
  'network.latestBlockNumber is a number',
  typeof network.latestBlockNumber,
  'number',
);

console.log('--- blocks ---');
check('blocks returned', blocks.blocks.length > 0, true);
const block = await client.getBlock(blocks.blocks[0].number);
check('block detail number matches list', block.block.number, blocks.blocks[0].number);
check('block.number is a number', typeof block.block.number, 'number');
check('block.timestamp is a number', typeof block.block.timestamp, 'number');

console.log('--- capabilities ---');
const caps = await client.getCapabilities();
check('capabilities.configuredNetwork', caps.configuredNetwork, 'mainnet');
check('capabilities.chainId', caps.chainId, 47763);
check('capabilities.chainIdMatches', caps.chainIdMatches, true);
// antiMev values are status strings, which is what the dashboard and CLI read.
check('eth_envelopeFee status', caps.antiMev.envelopeFee, 'supported');
check('maxEnvelopeGasLimit status is a string', typeof caps.antiMev.maxEnvelopeGasLimit, 'string');
check('cachedTransaction status is a string', typeof caps.antiMev.cachedTransaction, 'string');
check('antiMev.overall present', typeof caps.antiMev.overall, 'string');
// bridge carries the flat address/verified fields the CLI reads.
check(
  'bridge.messageBridgeAddress',
  caps.bridge.messageBridgeAddress,
  '0x1212000000000000000000000000000000000009',
);
check('bridge.messageBridgeVerified', caps.bridge.messageBridgeVerified, true);
check('bridge.executionManagerVerified', caps.bridge.executionManagerVerified, true);
check('bridge.checks is an array', Array.isArray(caps.bridge.checks), true);
// Every contract with bytecode was verified against the live node.
const unverified = caps.bridge.checks.filter((c) => !c.hasBytecode);
check('all bridge/AA contracts have bytecode', unverified.length, 0);
check('aa.entryPointVersion', caps.accountAbstraction.entryPointVersion, '0.9');
check('aa configured', caps.accountAbstraction.configured, true);

console.log('--- live transaction vs chain ---');
// Find a recent non-empty block and compare every field against raw JSON-RPC.
const headNum = parseInt(head, 16);
let hash = null;
for (let i = 0; i < 60 && !hash; i++) {
  const b = await rpc('eth_getBlockByNumber', ['0x' + (headNum - i).toString(16), true]);
  if (b?.transactions?.length) hash = b.transactions[0].hash;
}
if (!hash) {
  console.log('SKIP no non-empty block found in recent 60');
} else {
  const raw = await rpc('eth_getTransactionByHash', [hash]);
  const lookup = await client.getTransaction(hash);
  const tx = lookup.transaction;

  console.log(`lookup source=${lookup.source} hash=${hash}`);
  check('tx.hash', tx.hash, raw.hash);
  check('tx.blockNumber', tx.blockNumber, parseInt(raw.blockNumber, 16));
  check('tx.nonce', tx.nonce, parseInt(raw.nonce, 16));
  check('tx.type', tx.type, parseInt(raw.type, 16));
  check('tx.gasLimit', tx.gasLimit, BigInt(raw.gas).toString(10));
  check('tx.value', tx.value, BigInt(raw.value).toString(10));
  check('tx.gasPrice', tx.gasPrice, BigInt(raw.gasPrice).toString(10));
  check('tx.input', tx.input, raw.input);
  check('tx.from', tx.from.toLowerCase(), raw.from.toLowerCase());
  check('no hex leaked into blockNumber', String(tx.blockNumber).startsWith('0x'), 'false');
  check('top-level explorerUrl present', typeof lookup.explorerUrl, 'string');
  check('tx.explorerUrl present', typeof tx.explorerUrl, 'string');
}

console.log(process.exitCode ? 'RESULT: FAILURES' : 'RESULT: ALL PASS');
