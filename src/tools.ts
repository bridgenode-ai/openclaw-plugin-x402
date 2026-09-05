/**
 * Tool implementations — list_models, get_price_estimate, chat_completions
 * (paid via x402: 402 → sign → retry happens transparently in the fetch
 * wrapper from src/x402.ts).
 */

import { createX402Fetch } from "./x402.js";
import type { BridgeNodePluginConfig } from "./config.js";
import { resolveConfig } from "./config.js";
import {
	estimatePrice,
	fetchModels,
	findModel,
	messagesTokenEstimate,
	approxTokens,
} from "./models.js";

interface ChatMessage {
	role: string;
	content: string;
}

interface CompletionChoice {
	message?: { content?: string };
	finish_reason?: string;
}

interface CompletionBody {
	choices?: CompletionChoice[];
	usage?: { prompt_tokens?: number; completion_tokens?: number };
	model?: string;
}

// Cache one paying fetch per private key (avoids re-deriving signers).
const fetchCache = new Map<string, Promise<typeof fetch>>();

function payingFetch(config: BridgeNodePluginConfig): Promise<typeof fetch> {
	const key = config.walletPrivateKey ?? "env";
	let cached = fetchCache.get(key);
	if (!cached) {
		cached = createX402Fetch(resolveConfig(config));
		fetchCache.set(key, cached);
	}
	return cached;
}

function cleanBase(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

export async function listModelsTool(config: BridgeNodePluginConfig): Promise<unknown> {
	try {
		const cfg = resolveConfig(config);
		const models = await fetchModels(cfg.baseUrl);
		return {
			ok: true,
			count: models.length,
			models: models.map((m) => ({
				id: m.id,
				free: m.pricing.prompt === 0 && m.pricing.completion === 0,
				promptPricePerMToken: m.pricing.prompt * 1_000_000,
				completionPricePerMToken: m.pricing.completion * 1_000_000,
				contextWindow: m.context_window,
				maxOutputTokens: m.max_output_tokens,
				vision: m.vision,
			})),
			note: "Prices per 1M tokens. Chat completions are paid per request via x402 (Solana USDC); list_models and price estimates are free.",
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function getPriceEstimateTool(
	config: BridgeNodePluginConfig,
	params: {
		model: string;
		messages?: ChatMessage[];
		max_output_tokens?: number;
	},
): Promise<unknown> {
	try {
		const cfg = resolveConfig(config);
		const model = await findModel(cfg.baseUrl, params.model);
		if (!model) {
			return {
				ok: false,
				error: `Model "${params.model}" not found — call list_models first.`,
			};
		}
		const promptTokens = messagesTokenEstimate(params.messages ?? []);
		const outputTokens = Math.min(
			params.max_output_tokens ?? Math.min(model.max_output_tokens, 1024),
			model.max_output_tokens,
		);
		return {
			ok: true,
			...estimatePrice(model, { promptTokens, outputTokens }),
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function chatCompletionsTool(
	config: BridgeNodePluginConfig,
	params: {
		model: string;
		messages: ChatMessage[];
		max_tokens?: number;
		temperature?: number;
	},
): Promise<unknown> {
	try {
		const cfg = resolveConfig(config);
		const fetchImpl = await payingFetch(config);
		const url = `${cleanBase(cfg.baseUrl)}/chat/completions`;
		const body: Record<string, unknown> = {
			model: params.model,
			messages: params.messages,
			stream: false,
		};
		if (params.max_tokens !== undefined) {
			body.max_tokens = params.max_tokens;
		}
		if (params.temperature !== undefined) {
			body.temperature = params.temperature;
		}
		// Price estimate first: informs the agent before it pays (exact scheme).
		const modelEntry = await findModel(cfg.baseUrl, params.model);
		let priceNote: string | undefined;
		if (modelEntry) {
			const est = estimatePrice(modelEntry, {
				promptTokens: messagesTokenEstimate(params.messages),
				outputTokens: Math.min(
					params.max_tokens ?? Math.min(modelEntry.max_output_tokens, 1024),
					modelEntry.max_output_tokens,
				),
			});
			priceNote = est.free
				? "Free model — no payment required."
				: `Expected charge ≈ $${est.estimatedUsdc.toFixed(6)} (${est.promptTokens} prompt + ${est.outputTokens} max output tokens; exact scheme).`;
		}
		const res = await fetchImpl(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`BridgeNode chat/completions failed: HTTP ${res.status} ${text.slice(0, 300)}`);
		}
		const data = (await res.json()) as CompletionBody;
		const content = data.choices?.[0]?.message?.content;
		if (typeof content !== "string") {
			return {
				ok: false,
				error: "BridgeNode returned no completion content.",
				model: data.model ?? params.model,
			};
		}
		return {
			ok: true,
			model: data.model ?? params.model,
			content,
			finishReason: data.choices?.[0]?.finish_reason,
			usage: data.usage,
			priceNote,
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			hint: "A payment failure (e.g. insufficient USDC ATA balance or spend cap) is terminal — no new transaction is created on retry of the same signature.",
		};
	}
}

export { approxTokens };
