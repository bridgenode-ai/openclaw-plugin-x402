/**
 * Pure-logic tests (no wallet, no network): fail-closed parsing/pinning and
 * price math. Payment/E2E coverage lives in the elizaOS plugin repository
 * (live-spend proven); full OpenClaw metadata validation runs in CI via
 * `openclaw plugins validate`.
 */

import { describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config.js";
import { BRIDGENODE_ALLOWED_HOST, parseMaxUsdcPerTx, validateBaseUrl } from "../src/x402.js";
import { approxTokens, estimatePrice, type BridgeNodeModel } from "../src/models.js";

describe("validateBaseUrl (origin pin)", () => {
	it("accepts https://bridgenode.cc and paths", () => {
		expect(validateBaseUrl("https://bridgenode.cc/v1")).toBe("https://bridgenode.cc/v1");
		expect(validateBaseUrl("https://bridgenode.cc")).toBe("https://bridgenode.cc");
	});
	it("rejects non-HTTPS schemes", () => {
		expect(() => validateBaseUrl("http://bridgenode.cc/v1")).toThrow(/HTTPS/);
		expect(() => validateBaseUrl("ftp://bridgenode.cc")).toThrow(/HTTPS/);
	});
	it("rejects other hosts and subdomains", () => {
		expect(() => validateBaseUrl("https://evil.com/v1")).toThrow(
			BRIDGENODE_ALLOWED_HOST,
		);
		expect(() => validateBaseUrl("https://bridgenode.cc.evil.com/v1")).toThrow(
			BRIDGENODE_ALLOWED_HOST,
		);
	});
	it("rejects malformed URLs", () => {
		expect(() => validateBaseUrl("not a url")).toThrow(/valid absolute URL/);
	});
});

describe("parseMaxUsdcPerTx (spend cap)", () => {
	it("defaults to $1 when unset or blank", () => {
		expect(parseMaxUsdcPerTx(undefined)).toBe(1);
		expect(parseMaxUsdcPerTx("")).toBe(1);
	});
	it("disables the cap only on the exact canonical 0", () => {
		expect(parseMaxUsdcPerTx("0")).toBe(0);
	});
	it("rejects wrapped zeros and negatives fail-closed", () => {
		for (const bad of [" 0 ", "+0", "-0", "00", "0.0", "0e999", "1e-324"]) {
			expect(() => parseMaxUsdcPerTx(bad), `should reject "${bad}"`).toThrow();
		}
		expect(() => parseMaxUsdcPerTx("-1")).toThrow();
	});
	it("accepts sane caps", () => {
		expect(parseMaxUsdcPerTx("2")).toBe(2);
		expect(parseMaxUsdcPerTx("0.5")).toBe(0.5);
	});
});

describe("config resolution", () => {
	it("throws without a wallet key", () => {
		expect(() => resolveConfig({})).toThrow(/private key is required/);
	});
	it("applies defaults and pins", () => {
		const cfg = resolveConfig({ walletPrivateKey: "x" });
		expect(cfg.baseUrl).toBe("https://bridgenode.cc/v1");
		expect(cfg.payTo).toMatch(/^BHMDv3ri3/);
		expect(cfg.maxUsdcPerTx).toBe(1);
	});
	it("honours explicit config", () => {
		const cfg = resolveConfig({
			walletPrivateKey: "x",
			baseUrl: "https://bridgenode.cc/custom",
			maxUsdcPerTx: "0",
			payTo: "abc",
		});
		expect(cfg.baseUrl).toBe("https://bridgenode.cc/custom");
		expect(cfg.maxUsdcPerTx).toBe(0);
		expect(cfg.payTo).toBe("abc");
	});
});

describe("price math (exact scheme)", () => {
	const model: BridgeNodeModel = {
		id: "test-model",
		pricing: { prompt: 2.574e-7, completion: 7.722e-7 },
		context_window: 131072,
		max_output_tokens: 32768,
		vision: false,
	};
	it("bills prompt + output tokens before processing", () => {
		const est = estimatePrice(model, { promptTokens: 1000, outputTokens: 500 });
		expect(est.estimatedUsdc).toBeCloseTo(1000 * 2.574e-7 + 500 * 7.722e-7, 12);
		expect(est.free).toBe(false);
	});
	it("flags free models", () => {
		const est = estimatePrice(
			{ ...model, pricing: { prompt: 0, completion: 0 } },
			{ promptTokens: 100, outputTokens: 100 },
		);
		expect(est.estimatedUsdc).toBe(0);
		expect(est.free).toBe(true);
	});
	it("approximates tokens from characters", () => {
		expect(approxTokens("hello world")).toBeGreaterThanOrEqual(1);
		expect(approxTokens("")).toBe(1);
	});
});
