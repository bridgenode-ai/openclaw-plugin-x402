/**
 * x402 helpers — adapted from @bridgenode/plugin-x402 (elizaOS, 0.1.6,
 * live-spend proven) and kept framework-agnostic.
 *
 * Fail-closed payment pins: this plugin never signs anything but
 * Solana-mainnet USDC paid to the configured BridgeNode wallet:
 *   - PaymentPolicy: network === SOLANA_MAINNET_CAIP2 AND asset ===
 *     USDC_MAINNET_ADDRESS AND payTo === configured payTo; anything else
 *     (USDT/USDG/PYUSD/CASH, another network, another recipient) throws.
 *   - Origin pin: BRIDGENODE_BASE_URL must be HTTPS on exactly
 *     bridgenode.cc (validated at config resolution, before any fetch).
 * Spend cap (default $1) applies per payment; only an exact canonical "0"
 * disables it.
 */

import {
	createKeyPairSignerFromBytes,
	getBase58Encoder,
	type KeyPairSigner,
} from "@solana/kit";
import { x402Client, type PaymentPolicy } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { wrapFetchWithPayment } from "@x402/fetch";
import {
	ExactSvmScheme,
	SOLANA_MAINNET_CAIP2,
	USDC_MAINNET_ADDRESS,
} from "@x402/svm";

/** BridgeNode USDC receiving wallet (Solana mainnet). */
export const BRIDGENODE_PAYTO_DEFAULT =
	"BHMDv3ri3LBEZjEzJgDZeUiguVX7LmsCstTXbM3dL8rN";

/** Allowed BRIDGENODE_BASE_URL host — exact match, no subdomains. */
export const BRIDGENODE_ALLOWED_HOST = "bridgenode.cc";

/** Default BridgeNode OpenAI-compatible base URL. */
export const BRIDGENODE_BASE_URL_DEFAULT = "https://bridgenode.cc/v1";

export interface X402Config {
	privateKey: string;
	rpcUrl: string;
	baseUrl: string;
	maxUsdcPerTx: number;
	payTo: string;
}

/**
 * Convert a base58 Solana private key into a @solana/kit KeyPairSigner.
 */
export async function createSignerFromPrivateKey(
	privateKeyBase58: string,
): Promise<KeyPairSigner> {
	const bytes = getBase58Encoder().encode(privateKeyBase58);
	return createKeyPairSignerFromBytes(bytes);
}

/**
 * Origin pin: base URL must be HTTPS on exactly `bridgenode.cc`. Throws
 * before any fetch is created on non-HTTPS schemes or other hosts.
 */
export function validateBaseUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(
			`BRIDGENODE_BASE_URL must be a valid absolute URL (got "${raw}")`,
		);
	}
	if (url.protocol !== "https:") {
		throw new Error(
			`BRIDGENODE_BASE_URL must use HTTPS (got "${url.protocol}//${url.host}")`,
		);
	}
	if (url.hostname !== BRIDGENODE_ALLOWED_HOST) {
		throw new Error(
			`BRIDGENODE_BASE_URL host must be exactly ${BRIDGENODE_ALLOWED_HOST} (got "${url.hostname}")`,
		);
	}
	return raw;
}

/**
 * Parse BRIDGENODE_MAX_USDC_PER_TX fail-closed.
 * - unset/blank → default $1 (cap stays ON)
 * - exact canonical "0" (untrimmed) → disables the cap
 * - wrapped zeros, negatives, non-finite, non-canonical zeros → throw
 */
export function parseMaxUsdcPerTx(raw: string | undefined): number {
	const rawString = raw === undefined || raw === null ? "" : String(raw);
	if (rawString === "0") {
		return 0;
	}
	const value = rawString.trim();
	if (value === "") {
		return 1;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(
			`BRIDGENODE_MAX_USDC_PER_TX must be a finite number (got "${raw}")`,
		);
	}
	if (parsed <= 0) {
		throw new Error(
			`BRIDGENODE_MAX_USDC_PER_TX must be > 0 (or exactly "0" to disable), got "${raw}"`,
		);
	}
	return parsed;
}

/**
 * Fail-closed payment policy: only Solana-mainnet USDC paid to the
 * configured BridgeNode wallet may be signed.
 */
export function createUsdcPaymentPolicy(payTo: string): PaymentPolicy {
	return (
		_version: number,
		requirements: PaymentRequirements[],
	): PaymentRequirements[] => {
		for (const req of requirements) {
			const violations: string[] = [];
			if (req.network !== SOLANA_MAINNET_CAIP2) {
				violations.push(
					`network=${req.network} (expected ${SOLANA_MAINNET_CAIP2})`,
				);
			}
			if (req.asset !== USDC_MAINNET_ADDRESS) {
				violations.push(
					`asset=${req.asset} (expected USDC ${USDC_MAINNET_ADDRESS})`,
				);
			}
			if (req.payTo !== payTo) {
				violations.push(`payTo=${req.payTo} (expected ${payTo})`);
			}
			if (violations.length > 0) {
				throw new Error(
					`x402 payment rejected (fail-closed): ${violations.join("; ")}`,
				);
			}
		}
		return requirements;
	};
}

/**
 * Build a fetch wrapper that automatically pays x402 402 challenges:
 * 402 → sign → retry with PAYMENT-SIGNATURE. Spend cap per payment (default
 * $1, user configurable); only Solana-mainnet USDC to the configured
 * BridgeNode wallet is ever signed.
 */
export async function createX402Fetch(config: X402Config): Promise<typeof fetch> {
	const signer = await createSignerFromPrivateKey(config.privateKey);
	const scheme = new ExactSvmScheme(signer, { rpcUrl: config.rpcUrl });
	const spendControls =
		config.maxUsdcPerTx > 0
			? { maxAmountPerPayment: String(config.maxUsdcPerTx) }
			: false;
	const client = x402Client.fromConfig({
		schemes: [{ network: SOLANA_MAINNET_CAIP2, client: scheme }],
		spendControls,
		policies: [createUsdcPaymentPolicy(config.payTo)],
	});
	return wrapFetchWithPayment(fetch, client);
}
