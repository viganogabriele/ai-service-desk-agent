export type AdfNode = {
	type: string;
	text?: string;
	content?: AdfNode[];
};

export type AdfDoc = { type: "doc"; version: 1; content: AdfNode[] };

/** Plain text -> Atlassian Document Format. Blank lines separate paragraphs. */
export function adf(text: string): AdfDoc {
	const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
	const bodyParagraphs = paragraphs.length > 0 ? paragraphs : [" "];
	const content: AdfNode[] = bodyParagraphs.map((paragraph) => {
		const lines = paragraph.split("\n");
		const inline: AdfNode[] = [];
		lines.forEach((line, i) => {
			if (i > 0) inline.push({ type: "hardBreak" });
			if (line) inline.push({ type: "text", text: line });
		});
		return { type: "paragraph", content: inline };
	});
	return { type: "doc", version: 1, content };
}

/** ADF -> plain text (good enough for feeding a model or reading back). */
export function adfToText(node: unknown): string {
	if (node === null || node === undefined) return "";
	if (typeof node === "string") return node;
	if (typeof node !== "object") return "";
	const n = node as { type?: string; text?: string; content?: unknown[] };
	if (n.type === "text") return n.text ?? "";
	if (n.type === "hardBreak") return "\n";
	const inner = (n.content ?? []).map(adfToText).join("");
	return n.type === "paragraph" ? `${inner}\n\n` : inner;
}
