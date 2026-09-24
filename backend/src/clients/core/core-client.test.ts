import { describe, expect, it } from "vitest";
import { coreContentHash, coreIdempotencyKey } from "./core-client";

// Computed with the Core's own function: `from api.core import content_hash`.
const FIELDS = {
	Summary: 'Café "down"\nnow',
	Description: "x\ty",
	Assignee: null,
	"Affected Business or IT Services": ["Tax Reporting"],
	"All Comments": [],
	Status: "open",
};
const CORE_HASH =
	"0ccf28128e72d49ed5e5c84e6dfb7546ca5dfedb415d4dff12458e1f2288d873";

describe("Core idempotency key", () => {
	it("hashes fields exactly like the Core", () => {
		expect(coreContentHash(FIELDS)).toBe(CORE_HASH);
	});

	it("does not depend on key order", () => {
		const reversed = Object.fromEntries(Object.entries(FIELDS).reverse());
		expect(coreContentHash(reversed)).toBe(CORE_HASH);
	});

	it("is the external key immediately followed by the hash", () => {
		expect(coreIdempotencyKey("SUP-1", FIELDS)).toBe(`SUP-1${CORE_HASH}`);
	});
});
