# @bridgenode/openclaw-plugin-x402

OpenClaw tool plugin for **pay-per-request LLM inference** via [x402] on Solana
USDC. OpenAI-compatible chat completions — **no API keys, no accounts**; the
agent pays from its own Solana USDC wallet and BridgeNode sponsors gas fees.

Licensed **MIT-0** (no attribution required). Built for agents, by
[BridgeNode](https://bridgenode.cc).

## Tools

| Tool | Payment | Purpose |
|---|---|---|
| `list_models` | free | Live model list with per-token prices and context limits |
| `get_price_estimate` | free | USD cost estimate before paying (exact scheme) |
| `chat_completions` | x402 | Pay-per-request chat completion (402 → sign → retry) |

## Requirements

- Node 22.22.3+, Node 24.15+, or Node 25.9+
- OpenClaw `>= 2026.5.17`

## Install

From a checkout:

```bash
openclaw plugins install ./openclaw-plugin-x402
```

From ClawHub (once published):

```bash
openclaw plugins install clawhub:bridgenode-ai/openclaw-plugin-x402
```

Then configure the wallet in the plugin entry (Gateway config) or via
environment variables:

```bash
export SOLANA_PRIVATE_KEY=<base58 agent wallet key>   # required
export BRIDGENODE_MAX_USDC_PER_TX=1                    # optional, default $1
export BRIDGENODE_BASE_URL=https://bridgenode.cc/v1    # optional (origin-pinned)
```

The wallet needs a USDC ATA on Solana mainnet (the first transfer creates it
automatically). BridgeNode pays transaction fees.

## Security model (fail-closed)

- **Payment pins:** only Solana-mainnet USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)
  paid to the configured BridgeNode wallet (`BRIDGENODE_PAY_TO`, default
  `BHMDv3ri3LBEZjEzJgDZeUiguVX7LmsCstTXbM3dL8rN`) is ever signed. Any other
  network, asset, or recipient → nothing is signed.
- **Origin pin:** `BRIDGENODE_BASE_URL` must be HTTPS on exactly
  `bridgenode.cc`; validated before any fetch is created.
- **Spend cap:** `BRIDGENODE_MAX_USDC_PER_TX` defaults to `1` USDC per
  transaction; exactly `"0"` disables it; malformed values fail closed.
- **Replay-safe:** a payment failure is terminal — retrying the same request
  never double-charges or re-runs for free (same signature → same transaction).

## Key handling

The agent wallet private key is the only secret this plugin uses. It is read
**only** from the plugin configuration (use a SecretRef) or from the process
environment (`SOLANA_PRIVATE_KEY`). It is never hard-coded in source, never
logged, and never transmitted anywhere: only the signed Solana transaction
leaves the host, and BridgeNode never sees the key. Treat it like any signing
key — keep it out of shell history and chat logs, and rotate it freely; the
plugin only ever signs Solana-mainnet USDC to the pinned BridgeNode wallet,
bounded by the spend cap.

## Compatibility

The plugin declares `pluginApi >= 2026.5.17` and is built with OpenClaw
`2026.9.1` (see `openclaw.compat` / `openclaw.build` in `package.json`).
Confirm your OpenClaw build satisfies the range before enabling the plugin
(`openclaw plugins validate` reports mismatches). New OpenClaw releases may
change the plugin SDK — re-validate and bump after host upgrades.

## Development

```bash
npm install
npm run plugin:validate   # build + generate manifest + validate
npm test                  # pure-logic unit tests
```

CI runs `build`, `plugins build --check`, `plugins validate`, and `npm test`
on every push.

## Related

- BridgeNode service: https://bridgenode.cc/v1/models
- ElizaOS plugin: [`@bridgenode/plugin-x402`](https://github.com/bridgenode-ai/elizaos-plugin-x402)
- x402 protocol: https://docs.x402.org

[x402]: https://docs.x402.org
