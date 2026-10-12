# NeoX Observatory - Protocol Sources

This document records every protocol-specific address, ABI, RPC method, chain ID, or contract constant used by the project, with its verified source.

## Network Configuration

### Neo X MainNet
- **Chain ID**: `0xba93` (47763 decimal)
- **RPC Endpoints**:
  - `https://mainnet-1.rpc.banelabs.org`
  - `https://mainnet-2.rpc.banelabs.org`
  - `https://mainnet-3.rpc.banelabs.org`
  - `https://mainnet-5.rpc.banelabs.org` (Anti-MEV only)
- **WSS Endpoints**:
  - `wss://mainnet.wss1.banelabs.org`
  - `wss://mainnet.wss2.banelabs.org`
  - `wss://mainnet.wss3.banelabs.org`
- **Block Explorer**: `https://neoxscan.ngd.network`, `https://xexplorer.neo.org`
- **Currency**: GAS
- **Source**: https://xdocs.ngd.network/development/networks (checked 2025-10-08)
- **Verified via RPC**: `eth_chainId` returns `0xba93`

### Neo X TestNet (T4)
- **Chain ID**: `0xba9304` (12227332 decimal)
- **RPC Endpoints**:
  - `https://neoxt4seed1.ngd.network`
  - `https://neoxt4seed2.ngd.network`
  - `https://neoxt4seed3.ngd.network`
  - `https://neoxt4seed5.ngd.network` (Anti-MEV only)
- **WSS Endpoints**:
  - `wss://neoxt4wss1.ngd.network`
  - `wss://neoxt4wss2.ngd.network`
  - `wss://neoxt4wss3.ngd.network`
- **Block Explorer**: `https://neoxt4scan.ngd.network`, `https://xt4scan.ngd.network`
- **Currency**: GAS
- **Source**: https://xdocs.ngd.network/development/networks (checked 2025-10-08)
- **Verified via RPC**: `eth_chainId` returns `0xba9304`

### Neo N3 TestNet (for bridge correlation)
- **RPC**: `https://n3t5wish.ngd.network` (faucet)
- **Source**: https://xdocs.ngd.network/development/networks

## Neo X JSON-RPC Methods

| Method | Status | Notes |
|--------|--------|-------|
| `eth_chainId` | ✅ Supported | Returns chain ID (0xba93 mainnet, 0xba9304 testnet) |
| `eth_hashrate` | ✅ Supported | Returns `0x0` |
| `eth_coinbase` | ✅ Supported | Returns GovReward address |
| `eth_gasPrice` | ✅ Supported | Returns max of network gas price and minimum allowed |
| `eth_maxPriorityFeePerGas` | ✅ Supported | Returns estimated priority fee |
| `eth_envelopeFee` | ✅ Supported | Returns minimum additional gas tip for anti-MEV (verified: returns `0x0` on tested endpoints) |
| `eth_maxEnvelopeGasLimit` | ❌ Unsupported on public endpoints | Returns `-32601` "method does not exist/is not available" on all tested public endpoints |
| `eth_getCachedTransaction` | ⚠️ Advanced | Requires node with `--txpool.amevcache` and sender signature; not available on public endpoints |
| `eth_getBlobSidecars` | ✅ Supported | Returns blob data |
| `eth_getBlobSidecarByTxHash` | ✅ Supported | Returns blob data by tx hash |

**Source**: https://xdocs.ngd.network/development/json-rpc-api.md (checked 2025-10-08)
**Verified**: Tested against mainnet-1/2/3/5 and neoxt4seed1 endpoints on 2025-10-08
## Neo X System Contract Addresses

All addresses are genesis-allocated (not deployed by transaction). Verified via `eth_getCode` on mainnet-5 and neoxt4seed1.

| Address | Contract | Purpose | Mainnet Verified | Testnet Verified |
|---------|----------|---------|------------------|------------------|
| `0x1212000000000000000000000000000000000000` | GovProxyAdmin | Controls upgrades of system contracts | ✅ | ✅ |
| `0x1212000000000000000000000000000000000001` | Governance | Consensus node election, reward distribution | ✅ | ✅ |
| `0x1212000000000000000000000000000000000002` | Policy | Network policy parameters | ✅ | ✅ |
| `0x1212000000000000000000000000000000000003` | **GovReward** | Receives Envelope transactions; burns gas for inner tx execution | ✅ | ✅ |
| `0x1212000000000000000000000000000000000004` | TokenBridge | Token bridging between N3 and Neo X | ✅ | ✅ |
| `0x1212000000000000000000000000000000000005` | BridgeManagement | Bridge configuration management | ✅ | ✅ |
| `0x1212000000000000000000000000000000000006` | Treasury | Governance treasury | ✅ | ✅ |
| `0x1212000000000000000000000000000000000007` | CommitteeMultiSig | Consensus committee multisig | ✅ | ✅ |
| `0x1212000000000000000000000000000000000008` | KeyManagement | DKG for anti-MEV | ✅ | ✅ |
| `0x1212000000000000000000000000000000000009` | **MessageBridge** | Cross-chain message passing (N3 ↔ Neo X) | ✅ | ✅ |
| `0x121200000000000000000000000000000000000A` | **GovPaymaster** | ERC-4337 paymaster for gasless transactions | ✅ | ✅ |

**Source**: https://xdocs.ngd.network/governance/neo-x-system-contracts (checked 2025-10-08)
**Release tag**: bridge-evm-contracts commit a70b698 "Release MessageBridge/ExecutionManager 1.0.0"
**Verified**: `eth_getCode` returns non-empty bytecode for all on both networks
## Additional Contracts (Non-System)

| Address | Contract | Network | Verified |
|---------|----------|---------|----------|
| `0x85776439bbE26A3B6F91baB0fb8Ef3fDc769f385` | **ExecutionManager** | Mainnet & Testnet | ✅ |
| `0x433709009B8330FDa32311DF1C2AFA402eD8D009` | EntryPoint v0.9 | Mainnet & Testnet | ✅ |

**Source**: https://xdocs.ngd.network/development/networks (Deployed Contracts section) and https://xdocs.ngd.network/development/gasless-service
**Verified**: `eth_getCode` returns non-empty bytecode on both networks

## Envelope Transaction Format

From Neo X documentation:

```
Envelope Transaction data field structure:
┌─────────────┬────────────┬────────────────┬────────────────────────┬──────────────┐
│ 4-byte      │ 4-byte     │ 4-byte         │ 32-byte                │ remaining    │
│ prefix      │ DKG epoch  │ inner gaslimit │ inner secret tx hash   │ TPKE cipher  │
│ 0xffffffff  │ (big-endian)│ (big-endian)   │ (32 bytes)             │ text         │
└─────────────┴────────────┴────────────────┴────────────────────────┴──────────────┘
```

**Rules**:
- Recipient (`to`) MUST be GovReward: `0x1212000000000000000000000000000000000003`
- Sender must match inner secret transaction sender
- Nonce must match inner secret transaction nonce
- Gas tip must exceed minGasTipCap + envelopeFee
- Calls GovReward fallback() which burns gas based on declared gaslimit

**Source**: https://xdocs.ngd.network/security/anti-mev-protection/constructing-envelope-transactions (checked 2025-10-08)
## Anti-MEV RPC Methods

### `eth_envelopeFee`
- Returns minimum additional gas tip (in wei) for envelope transactions
- Verified: returns `0x0` on all tested public endpoints
- **Source**: https://xdocs.ngd.network/development/json-rpc-api.md

### `eth_maxEnvelopeGasLimit`
- Returns maximum gaslimit an Envelope can declare
- **Status**: Returns `-32601` (method not found) on ALL public endpoints tested
- Only available on nodes configured with Anti-MEV cache (`--txpool.amevcache`)
- Public dashboards MUST NOT depend on this method

### `eth_getCachedTransaction`
- Returns cached signed secret transaction
- Requires: sender signature parameter, node with `--txpool.amevcache`
- **Status**: Advanced capability only; not for public dashboard use

## Message Bridge

### Contracts (from bridge-evm-contracts release-artifacts v1.0.0)

| Contract | Address | Artifact |
|----------|---------|----------|
| MessageBridge | `0x1212000000000000000000000000000000000009` | release-artifacts/message-bridge/1.0.0/MessageBridge-solc0.8.25-shanghai.json |
| ExecutionManager | `0x85776439bbE26A3B6F91baB0fb8Ef3fDc769f385` | release-artifacts/execution-manager/1.0.0/ExecutionManager-solc0.8.25-shanghai.json |
| BridgeManagement | `0x1212000000000000000000000000000000000005` | release-artifacts/bridge-management/1.0.0/BridgeManagementImpl-solc0.8.25-shanghai.json |

**Source Repository**: https://github.com/bane-labs/bridge-evm-contracts
**Release Commit**: a70b698 "Release MessageBridge/ExecutionManager 1.0.0" (2025)
**License**: Apache-2.0

### MessageBridge ABI (key events for indexing)

| Event | Parameters |
|-------|------------|
| `MessageSend` | `nonce` (uint256), `sender` (address), `encodedMetadata` (bytes), `message` (bytes), `messageHash` (bytes32), `newEvmToNeoRoot` (bytes32) |
| `Store` | `nonce` (uint256), `metadata` (bytes) |
| `Execution` | `nonce` (uint256), `result` (tuple: success bool, returnData bytes) |
| `NeoToEvmRootUpdate` | `nonce` (uint256), `neoToEvmRoot` (bytes32) |
| `EvmToNeoState` | `nonce` (uint256), `root` (bytes32) |

**Full ABI**: Extracted from release-artifacts/message-bridge/1.0.0/MessageBridge-solc0.8.25-shanghai.json (17 events, 41 functions)

### ExecutionManager ABI (key events)

| Event | Parameters |
|-------|------------|
| `RoleGranted` | `role` (bytes32), `account` (address), `sender` (address) |
| `RoleRevoked` | `role` (bytes32), `account` (address), `sender` (address) |
| `RoleAdminChanged` | `role` (bytes32), `previousAdminRole` (bytes32), `newAdminRole` (bytes32) |

**Key Functions**: `executeMessage(nonce, rawMessage, refundAddress)`, `executingNonce()`, `hasRole(role, account)`, `BRIDGE_ROLE()`

## GovPaymaster / Account Abstraction

### Configuration
- **GovPaymaster**: `0x121200000000000000000000000000000000000A` (system contract)
- **EntryPoint v0.9**: `0x433709009B8330FDa32311DF1C2AFA402eD8D009` (canonical address)
- **Bundler RPC (Mainnet)**: `https://mainnet.bundler.banelabs.org`
- **Bundler RPC (Testnet)**: `https://neoxt4bundler.banelabs.org`

### Sponsorship Rules
- 10% of block reward goes to GovPaymaster
- Up to 0.4 GAS per block for sponsorship
- Priority fee capped at 20% above network minimum
- Works ONLY with EntryPoint v0.9

**Source**: https://xdocs.ngd.network/development/gasless-service (checked 2025-10-08)
**Verified**: Both contracts have deployed bytecode on Mainnet and Testnet

## ERC-4337 EntryPoint Deployments (Canonical)

| Version | Address | Notes |
|---------|---------|-------|
| v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | Canonical |
| v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Canonical |
| v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` | Canonical |
| v0.9 | `0x433709009B8330FDa32311DF1C2AFA402eD8D009` | **Used by GovPaymaster** |

**Source**: https://xdocs.ngd.network/development/networks (Account Abstraction section)

## Verification Summary (2025-10-08)

All values above were verified by:
1. Reading official documentation at xdocs.ngd.network
2. Checking bridge-evm-contracts repository at commit a70b698
3. Making live RPC calls to public Neo X endpoints
4. Verifying `eth_getCode` returns non-empty bytecode for all contract addresses
5. Confirming `eth_chainId` matches documented values

**No values were copied from third-party blogs or unverified sources.**