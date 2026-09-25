/**
 * Runs `work` over `items` with at most `limit` in flight. Every item is attempted even
 * if one fails; the first failure is rethrown once all have settled.
 */
export async function forEachConcurrent<T>(
	items: readonly T[],
	limit: number,
	work: (item: T) => Promise<void>,
): Promise<void> {
	const errors: unknown[] = [];
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const item = items[next++];
			if (item === undefined) continue;
			try {
				await work(item);
			} catch (error) {
				errors.push(error);
			}
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	if (errors.length > 0) throw errors[0];
}
