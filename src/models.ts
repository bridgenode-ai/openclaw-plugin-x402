/**
 * BridgeNode /v1/models client + price estimation helpers (no payment).
 */

export interface BridgeNodeModel {
	id: string;
	/** Price per token (USD). */
	pricing: { prompt: number; completion: number };
	context_window: number;
	max_output_tokens: number;
	vision: boolean;
}

export interface ModelsResponse {
	object: string;
	data: BridgeNodeModel[];
}

/** Rough token estimate: ~4 characters per token (USDC-billed tier). */
export function approxTokens(text: string): number {
	const chars = text.length;
	return Math.max(1, Math.ceil(chars / 4));
}

export function messagesTokenEstimate(
	messages: { role: string; content: string }[],
): number {
	return messages.reduce((sum, m) => sum + approxTokens(m.content), 0);
}

export async function fetchModels(
	baseUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<BridgeNodeModel[]> {
	const url = `${baseUrl.replace(/\/+$/, "")}/models`;
	const res = await fetchImpl(url, {
		headers: { accept: "application/json" },
	});
	if (!res.ok) {
		throw new Error(`BridgeNode /models failed: HTTP ${res.status}`);
	}
	const body = (await res.json()) as ModelsResponse;
	if (!Array.isArray(body?.data)) {
		throw new Error("BridgeNode /models: unexpected response shape");
	}
	return body.data;
}

export async function findModel(
	baseUrl: string,
	modelId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<BridgeNodeModel | undefined> {
	const models = await fetchModels(baseUrl, fetchImpl);
	return models.find((m) => m.id === modelId);
}

export interface PriceEstimateInput {
	promptTokens: number;
	outputTokens: number;
}

export interface PriceEstimateResult {
	model: string;
	free: boolean;
	promptTokens: number;
	outputTokens: number;
	promptPricePerToken: number;
	completionPricePerToken: number;
	/** Total USD, exact scheme: input + max output billed before processing. */
	estimatedUsdc: number;
	note: string;
}

export function estimatePrice(
	model: BridgeNodeModel,
	input: PriceEstimateInput,
): PriceEstimateResult {
	const promptTokens = Math.max(1, Math.round(input.promptTokens));
	const outputTokens = Math.max(1, Math.round(input.outputTokens));
	const promptPrice = model.pricing.prompt ?? 0;
	const completionPrice = model.pricing.completion ?? 0;
	const total = promptTokens * promptPrice + outputTokens * completionPrice;
	return {
		model: model.id,
		free: total === 0,
		promptTokens,
		outputTokens,
		promptPricePerToken: promptPrice,
		completionPricePerToken: completionPrice,
		estimatedUsdc: total,
		note: "BridgeNode exact scheme: the agent is billed prompt + max output tokens before processing.",
	};
}
