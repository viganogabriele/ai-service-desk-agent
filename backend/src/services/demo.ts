import type { SQL } from "bun";
import { z } from "zod";
import type { CoreClient } from "../clients/core/core-client";
import { adf } from "../clients/jira/adf";
import { JIRA_FIELDS, JIRA_PROJECT_KEY } from "../clients/jira/field-config";
import type { JiraClient } from "../clients/jira/jira-client";
import { log } from "../lib/log";
import { refreshTicket } from "./jira-sync";
import type { Syncer } from "./sync";
import { applyTicketPatch, findWorkType } from "./ticket-patch";
import { FOOTER_MARKER } from "./tickets";

/** Label on every demo ticket in Jira, so they can be found and removed after a demo. */
export const DEMO_LABEL = "demo";

// The fields of the Core's challenge record that a new Jira ticket carries.
const demoRecordSchema = z.object({
	"Work type": z.enum(["Incident", "Service Request"]),
	"Request type": z.string().nullable(),
	Summary: z.string().min(1),
	Description: z.string(),
	"Affected Business or IT Services": z.array(z.string()).max(1),
	"Business Entity": z.array(z.string()),
	Reporter: z.string().nullable(),
	Urgency: z.string().nullable(),
	Impact: z.string().nullable(),
	"All Comments": z.array(z.string().min(1)),
});

export class DemoTicketError extends Error {}

export type DemoTicket = { key: string; warnings: string[] };

/**
 * Files a ticket the Core wrote in Jira, like backend/jira_scripts/upload.py files the challenge (the
 * request type goes in the description footer), then hands it to the Core for triage.
 */
export async function createDemoTicket(
	core: CoreClient,
	jira: JiraClient,
	sql: SQL,
	syncer: Syncer,
): Promise<DemoTicket> {
	const parsed = demoRecordSchema.safeParse(await core.demoTicket());
	if (!parsed.success)
		throw new DemoTicketError(
			`The Core wrote an invalid demo ticket: ${parsed.error.message}`,
		);
	const record = parsed.data;
	const workType = findWorkType(await jira.getWorkTypes(), record["Work type"]);
	if (!workType)
		throw new DemoTicketError(
			`No Jira work type matches '${record["Work type"]}'`,
		);

	const footer = `${FOOTER_MARKER}Original request type: ${record["Request type"] ?? "-"}`;
	const { key } = await jira.createIssue({
		project: { key: JIRA_PROJECT_KEY },
		issuetype: { id: workType.id },
		summary: record.Summary.slice(0, 254),
		description: adf(record.Description.trim() + footer),
		labels: [DEMO_LABEL],
		...(record.Reporter
			? { [JIRA_FIELDS.originalReporter]: record.Reporter }
			: {}),
	});

	// Select fields go through the patch path, which matches Jira's options and derives priority.
	const result = await applyTicketPatch(jira, {
		Key: key,
		"Affected Business or IT Services":
			record["Affected Business or IT Services"],
		"Business Entity": record["Business Entity"],
		Urgency: record.Urgency,
		Impact: record.Impact,
		"All Comments": record["All Comments"],
	});
	const warnings = result.ok
		? result.warnings
		: [...result.warnings, result.error];

	// Stored now, so the dashboard sees it on its next read; the Jira search index may lag.
	await refreshTicket(jira, sql, key);
	// Sent to the Core now rather than on the next scheduled pass, which retries a failure.
	syncer
		.syncNow()
		.catch((error) =>
			log.error(`Sync after creating demo ticket ${key} failed`, error),
		);
	return { key, warnings };
}
