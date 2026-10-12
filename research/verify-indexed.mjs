import { createNeoXObservatoryClient } from '../packages/sdk/dist/index.js';
import { DatabaseSync } from 'node:sqlite';

const client = createNeoXObservatoryClient({ baseUrl: 'http://localhost:3100' });
const db = new DatabaseSync('data/neox-observatory.db');

let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: api=${actual} expected=${expected}`);
}

const row = db
  .prepare(
    'SELECT hash, block_number, nonce, value, gas_limit, gas_price, type, input FROM transactions ORDER BY block_number DESC LIMIT 1',
  )
  .get();
db.close();

console.log(`--- indexed transaction ${row.hash} ---`);
const lookup = await client.getTransaction(row.hash);
check('source', lookup.source, 'indexed');
const tx = lookup.transaction;
check('tx.blockNumber', tx.blockNumber, row.block_number);
check('tx.nonce', tx.nonce, row.nonce);
check('tx.type', tx.type, row.type);
check('tx.value', tx.value, row.value);
check('tx.gasLimit', tx.gasLimit, row.gas_limit);
check('tx.gasPrice', tx.gasPrice, row.gas_price);
check('tx.input', tx.input, row.input);
check('receipt.status is 1', lookup.receipt?.status, 1);
check('receipt.gasUsed present', typeof lookup.receipt?.gasUsed, 'string');
check('top-level explorerUrl', typeof lookup.explorerUrl, 'string');

console.log(failures ? `RESULT: ${failures} FAILURES` : 'RESULT: ALL PASS');
process.exitCode = failures ? 1 : 0;
