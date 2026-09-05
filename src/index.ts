/**
 * @bridgenode/openclaw-plugin-x402 — OpenClaw tool plugin for pay-per-request
 * LLM inference via x402 on Solana USDC.
 *
 * Tools mirror the BridgeNode MCP server surface: list_models,
 * get_price_estimate, chat_completions. Payments are signed by the agent's
 * own wallet (fail-closed: Solana-mainnet USDC to the configured BridgeNode
 * wallet only, spend cap default $1, origin pinned to bridgenode.cc).
 */

import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import {
	chatCompletionsTool,
	getPriceEstimateTool,
	listModelsTool,
} from "./tools.js";

export default defineToolPlugin({
	id: "bridgenode",
	name: "BridgeNode",
	description:
		"Pay-per-request AI inference via x402 on Solana USDC — OpenAI-compatible chat completions. No API keys, no accounts; BridgeNode sponsors gas fees.",
	configSchema: Type.Object({
		baseUrl: Type.Optional(
			Type.String({ description: "BridgeNode OpenAI-compatible base URL (default https://bridgenode.cc/v1; HTTPS + bridgenode.cc only)." }),
		),
		rpcUrl: Type.Optional(
			Type.String({ description: "Solana RPC URL used for payment settlement (default https://api.mainnet-beta.solana.com)." }),
		),
		payTo: Type.Optional(
			Type.String({ description: "BridgeNode USDC receiving wallet (recipient pin)." }),
		),
		maxUsdcPerTx: Type.Optional(
			Type.String({ description: 'Max USDC per transaction (default "1"; exactly "0" disables the cap).' }),
		),
		walletPrivateKey: Type.Optional(
			Type.String({ description: "Agent Solana wallet private key (base58) — prefer env SOLANA_PRIVATE_KEY or a SecretRef." }),
		),
	}),
	tools: (tool) => [
		tool({
			name: "list_models",
			label: "List Models",
			description:
				"List models available on BridgeNode with live per-token prices and context limits. Free, no payment required.",
			parameters: Type.Object({}),
			execute: async (_params, config) => listModelsTool(config),
		}),
		tool({
			name: "get_price_estimate",
			label: "Get Price Estimate",
			description:
				"Estimate the USD cost of a chat completion before paying (exact scheme: prompt + max output tokens billed). Free, no payment required.",
			parameters: Type.Object({
				model: Type.String({ description: "Model id — see list_models." }),
				messages: Type.Optional(
					Type.Array(
						Type.Object({
							role: Type.String(),
							content: Type.String(),
						}),
					),
				),
				max_output_tokens: Type.Optional(
					Type.Integer({ description: "Upper bound of completion tokens to bill for." }),
				),
			}),
			execute: async (params, config) => getPriceEstimateTool(config, params),
		}),
		tool({
			name: "chat_completions",
			label: "Chat Completions",
			description:
				"Run a pay-per-request chat completion on BridgeNode. The agent is billed from its own Solana USDC wallet via x402 — no API key, no account. BridgeNode sponsors gas.",
			parameters: Type.Object({
				model: Type.String({ description: "Model id — see list_models." }),
				messages: Type.Array(
					Type.Object({
						role: Type.String({ description: "system, user, or assistant." }),
						content: Type.String(),
					}),
				),
				max_tokens: Type.Optional(
					Type.Integer({ description: "Maximum completion tokens (billed)." }),
				),
				temperature: Type.Optional(
					Type.Number({ description: "Sampling temperature." }),
				),
			}),
			execute: async (params, config) => chatCompletionsTool(config, params),
		}),
	],
});
