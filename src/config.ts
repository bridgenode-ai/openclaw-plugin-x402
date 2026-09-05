/**
 * Plugin configuration resolution.
 *
 * Every value can come from the plugin config (Gateway config) or from the
 * process environment (BRIDGENODE_* / SOLANA_*). Secrets must never be
 * hard-coded: prefer env vars or OpenClaw SecretRefs.
 */

import {
	BRIDGENODE_BASE_URL_DEFAULT,
	BRIDGENODE_PAYTO_DEFAULT,
	parseMaxUsdcPerTx,
	validateBaseUrl,
	type X402Config,
} from "./x402.js";

/** OpenClaw configSchema-compatible shape (all optional; defaults + env). */
export interface BridgeNodePluginConfig {
	baseUrl?: string;
	rpcUrl?: string;
	payTo?: string;
	maxUsdcPerTx?: string;
	walletPrivateKey?: string;
}

function env(key: string): string | undefined {
	const v = process.env[key];
	return v === undefined || v === "" ? undefined : v;
}

/**
 * Resolve the effective X402Config from plugin config + environment.
 * `walletPrivateKey`/SOLANA_PRIVATE_KEY is required — throws otherwise.
 */
export function resolveConfig(
	config: BridgeNodePluginConfig,
): X402Config {
	const privateKey =
		config.walletPrivateKey ?? env("SOLANA_PRIVATE_KEY");
	if (!privateKey) {
		throw new Error(
			"BridgeNode: wallet private key is required — set plugin config walletPrivateKey (SecretRef) or env SOLANA_PRIVATE_KEY",
		);
	}
	const rawBase =
		config.baseUrl ?? env("BRIDGENODE_BASE_URL") ?? BRIDGENODE_BASE_URL_DEFAULT;
	const baseUrl = validateBaseUrl(rawBase);
	return {
		privateKey,
		rpcUrl: config.rpcUrl ?? env("SOLANA_RPC_URL") ?? "https://api.mainnet-beta.solana.com",
		baseUrl,
		maxUsdcPerTx: parseMaxUsdcPerTx(
			config.maxUsdcPerTx ?? env("BRIDGENODE_MAX_USDC_PER_TX"),
		),
		payTo: config.payTo ?? env("BRIDGENODE_PAY_TO") ?? BRIDGENODE_PAYTO_DEFAULT,
	};
}
