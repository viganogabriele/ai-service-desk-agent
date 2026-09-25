// Site-specific Jira ids and vocabulary. Mirrors backend/jira_scripts/config.py.

export const JIRA_PROJECT_KEY = "SUP";

export const JIRA_FIELDS = {
	affectedService: "customfield_10059",
	serviceTeam: "customfield_10060",
	businessEntity: "customfield_10061",
	proposedAssignee: "customfield_10062",
	originalReporter: "customfield_10063",
	urgency: "customfield_10053",
	impact: "customfield_10004",
	severity: "customfield_10055",
	businessCritical: "customfield_10096",
} as const;

export type FieldMapping = {
	recordField: string;
	jiraFieldId: string;
	jiraType: "native" | "select" | "multiselect" | "text" | "footer";
	writable: boolean;
};

/** Record field -> where it lives in Jira. Stored in jira_field_map at startup. */
export const RECORD_FIELD_MAP: readonly FieldMapping[] = [
	{
		recordField: "Key",
		jiraFieldId: "key",
		jiraType: "native",
		writable: false,
	},
	{
		recordField: "Work type",
		jiraFieldId: "issuetype",
		jiraType: "native",
		writable: true,
	},
	{
		recordField: "Request type",
		jiraFieldId: "description",
		jiraType: "footer",
		writable: false,
	},
	{
		recordField: "Summary",
		jiraFieldId: "summary",
		jiraType: "native",
		writable: true,
	},
	{
		recordField: "Description",
		jiraFieldId: "description",
		jiraType: "native",
		writable: true,
	},
	{
		recordField: "Affected Business or IT Services",
		jiraFieldId: JIRA_FIELDS.affectedService,
		jiraType: "select",
		writable: true,
	},
	{
		recordField: "Business Entity",
		jiraFieldId: JIRA_FIELDS.businessEntity,
		jiraType: "multiselect",
		writable: true,
	},
	// Single select on the site for now; read-only until it is recreated as multi select.
	{
		recordField: "Business Critical for Entity",
		jiraFieldId: JIRA_FIELDS.businessCritical,
		jiraType: "select",
		writable: false,
	},
	{
		recordField: "Service Team(s)",
		jiraFieldId: JIRA_FIELDS.serviceTeam,
		jiraType: "select",
		writable: true,
	},
	{
		recordField: "Reporter",
		jiraFieldId: JIRA_FIELDS.originalReporter,
		jiraType: "text",
		writable: true,
	},
	{
		recordField: "Assignee",
		jiraFieldId: JIRA_FIELDS.proposedAssignee,
		jiraType: "text",
		writable: true,
	},
	{
		recordField: "Priority",
		jiraFieldId: "priority",
		jiraType: "native",
		writable: true,
	},
	{
		recordField: "Urgency",
		jiraFieldId: JIRA_FIELDS.urgency,
		jiraType: "select",
		writable: true,
	},
	{
		recordField: "Impact",
		jiraFieldId: JIRA_FIELDS.impact,
		jiraType: "select",
		writable: true,
	},
	{
		recordField: "Severity",
		jiraFieldId: JIRA_FIELDS.severity,
		jiraType: "select",
		writable: true,
	},
	{
		recordField: "Created date",
		jiraFieldId: "description",
		jiraType: "footer",
		writable: false,
	},
	{
		recordField: "Status",
		jiraFieldId: "status",
		jiraType: "native",
		writable: false,
	},
	{
		recordField: "Linked issues",
		jiraFieldId: "description",
		jiraType: "footer",
		writable: false,
	},
	{
		recordField: "Resolution",
		jiraFieldId: "resolution",
		jiraType: "native",
		writable: true,
	},
	{
		recordField: "Due date",
		jiraFieldId: "duedate",
		jiraType: "native",
		writable: false,
	},
	{
		recordField: "Resolution date",
		jiraFieldId: "resolutiondate",
		jiraType: "native",
		writable: false,
	},
	{
		recordField: "All Comments",
		jiraFieldId: "comment",
		jiraType: "native",
		writable: true,
	},
];

// Challenge resolution vocabulary -> Jira resolution names
export const JIRA_RESOLUTIONS = {
	done: "Done",
	cancelled: "Cancelled",
	clarification: "Clarification",
	"cannot reproduce": "Cannot Reproduce",
} as const;

export type ChallengeResolution = keyof typeof JIRA_RESOLUTIONS;

export function toChallengeResolution(
	jiraName: string | null,
): ChallengeResolution | null {
	if (!jiraName) return null;
	const lower = jiraName.toLowerCase();
	for (const [challenge, jira] of Object.entries(JIRA_RESOLUTIONS)) {
		if (jira.toLowerCase() === lower) return challenge as ChallengeResolution;
	}
	return null;
}
