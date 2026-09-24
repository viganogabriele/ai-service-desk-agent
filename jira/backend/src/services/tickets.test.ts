import { describe, expect, it } from "vitest";
import { adf } from "../clients/jira/adf";
import { fakeComment, fakeIssue } from "../clients/jira/jira-client.fake";
import { isTicket, toTicketRecord } from "./tickets";

describe("toTicketRecord", () => {
	it("maps a Jira issue to the challenge record shape", () => {
		const issue = fakeIssue("SUP-2", {
			description: adf(
				"Need a licence.\n\n---\nOriginal request type: New License\nOriginal created date: 2026-01-02 03:04\nOriginal status: open\nLinked issues: BROKER-93623, REP-20247",
			),
			comment: {
				comments: [
					fakeComment("amelia.marcus@intcom.com: please hurry"),
					fakeComment("AI triage: internal note", false),
				],
			},
			status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
		});

		expect(toTicketRecord(issue)).toEqual({
			Key: "SUP-2",
			"Work type": "Incident",
			"Request type": "New License",
			Summary: "Tax Reporting portal unreachable",
			Description: "Need a licence.",
			"Affected Business or IT Services": ["Tax Reporting"],
			"Business Entity": ["Germany"],
			"Business Critical for Entity": [],
			"Service Team(s)": ["Tax & Reporting"],
			Reporter: "amelia.marcus@intcom.com",
			Assignee: null,
			Priority: "Medium",
			Urgency: "Medium",
			Impact: "Medium",
			Severity: null,
			"Created date": "2026-01-02 03:04",
			Status: "in progress",
			"Linked issues": ["BROKER-93623", "REP-20247"],
			Resolution: null,
			"Due date": null,
			"Resolution date": null,
			"All Comments": ["amelia.marcus@intcom.com: please hurry"],
		});
	});

	it("converts Jira's option names back to the challenge levels", () => {
		const record = toTicketRecord(
			fakeIssue("SUP-3", {
				customfield_10053: { id: "1", value: "Critical" },
				customfield_10004: { id: "2", value: "Significant / Large" },
				resolution: { id: "5", name: "Cannot Reproduce" },
				issuetype: { id: "10010", name: "[System] Service request" },
			}),
		);
		expect(record).toMatchObject({
			"Work type": "Service Request",
			Urgency: "Highest",
			Impact: "High",
			Resolution: "cannot reproduce",
			Status: "done",
		});
	});

	it("excludes work types that are not tickets", () => {
		expect(
			isTicket(fakeIssue("SUP-4", { issuetype: { id: "1", name: "Task" } })),
		).toBe(false);
		expect(
			isTicket(
				fakeIssue("SUP-5", {
					issuetype: {
						id: "10011",
						name: "[System] Service request with approvals",
					},
				}),
			),
		).toBe(false);
	});
});
