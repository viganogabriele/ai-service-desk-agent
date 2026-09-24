import type { JiraOption } from "./jira-client";

// Order matters: "highest"/"lowest" must be checked before "high"/"low".
const RANK_WORDS: ReadonlyArray<readonly [number, readonly string[]]> = [
	[0, ["highest", "critical", "extensive", "widespread", "major"]],
	[4, ["lowest", "no direct", "none", "information", "informational"]],
	[1, ["high", "significant", "large"]],
	[2, ["medium", "moderate", "limited"]],
	[3, ["low", "minor", "localized", "localised"]],
];

const RANK_PATTERNS = RANK_WORDS.map(
	([r, words]) => [r, words.map((w) => new RegExp(`\\b${w}\\b`))] as const,
);

const LEVELS = ["Highest", "High", "Medium", "Low", "Lowest"] as const;

/** 0 = most severe ... 4 = least severe. null if unrecognised. */
export function rank(label: string | null | undefined): number | null {
	const s = (label ?? "").toLowerCase();
	for (const [r, patterns] of RANK_PATTERNS) {
		if (patterns.some((p) => p.test(s))) return r;
	}
	return null;
}

export function optionLabel(option: JiraOption | null | undefined): string {
	return option?.value ?? option?.name ?? "";
}

/** "Significant / Large" -> "High", "Critical" -> "Highest". */
export function toChallengeLevel(label: string | null): string | null {
	const r = rank(label);
	if (r === null) return label;
	return LEVELS[r] ?? label;
}

/**
 * Find the Jira option for `value`: exact label first, then same severity
 * rank, then the nearest rank.
 */
export function matchOption(
	value: string | null | undefined,
	allowed: readonly JiraOption[] | undefined,
): JiraOption | null {
	if (!value || !allowed || allowed.length === 0) return null;
	const v = value.trim().toLowerCase();
	const exact = allowed.find((o) => optionLabel(o).trim().toLowerCase() === v);
	if (exact) return exact;

	const target = rank(value);
	if (target === null) return null;
	let best: { distance: number; option: JiraOption } | null = null;
	for (const option of allowed) {
		const r = rank(optionLabel(option));
		if (r === null) continue;
		const distance = Math.abs(r - target);
		if (!best || distance < best.distance) best = { distance, option };
	}
	return best?.option ?? null;
}
