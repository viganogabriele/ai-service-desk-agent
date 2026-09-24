// Site-specific Jira ids and vocabulary. Mirrors jira/config.py.

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
} as const;

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
