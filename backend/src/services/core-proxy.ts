// Core endpoints that belong to the ingestion/sync layer (CORE_API.md §2),
// i.e. to this backend. The UI must not reach them through the proxy.
const INGESTION: ReadonlyArray<readonly [string, RegExp]> = [
	["POST", /^\/tickets\/?$/],
	["POST", /^\/batches\/?$/],
	["POST", /^\/tickets\/[^/]+\/closure\/?$/],
];

export function isIngestion(method: string, path: string): boolean {
	return INGESTION.some(([m, pattern]) => m === method && pattern.test(path));
}
