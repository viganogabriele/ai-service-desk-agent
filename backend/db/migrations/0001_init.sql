-- Integration state of the backend. Jira stays the source of truth for ticket
-- data; the Core keeps its own store for runs, overrides, KB and policy.

-- Which Jira field each record field comes from. Rewritten by the backend at
-- startup from src/clients/jira/field-config.ts, so it always matches the code.
CREATE TABLE jira_field_map (
    record_field  text PRIMARY KEY,               -- "Urgency"
    jira_field_id text NOT NULL,                  -- "customfield_10053"
    jira_type     text NOT NULL,                  -- "select", "multiselect", "text", "footer", ...
    writable      boolean NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per Jira ticket, in the challenge-record shape (same names as
-- backend/jira_scripts/data/challenge_blind.json). Dates are site-local, like the dataset.
CREATE TABLE tickets (
    external_key               text PRIMARY KEY,  -- "SUP-22"
    jira_id                    text NOT NULL UNIQUE,

    work_type                  text NOT NULL CHECK (work_type IN ('Incident', 'Service Request')),
    request_type               text,
    summary                    text NOT NULL,
    description                text NOT NULL DEFAULT '',
    affected_services          text[] NOT NULL DEFAULT '{}',
    business_entities          text[] NOT NULL DEFAULT '{}',
    business_critical_entities text[] NOT NULL DEFAULT '{}',
    service_teams              text[] NOT NULL DEFAULT '{}',
    reporter                   text,
    assignee                   text,
    priority                   text CHECK (priority IN ('Highest', 'High', 'Medium', 'Low', 'Lowest')),
    urgency                    text CHECK (urgency  IN ('Highest', 'High', 'Medium', 'Low', 'Lowest')),
    impact                     text CHECK (impact   IN ('Highest', 'High', 'Medium', 'Low', 'Lowest')),
    severity                   text,
    created_date               timestamp,
    status                     text NOT NULL CHECK (status IN ('open', 'in progress', 'done')),
    linked_issues              text[] NOT NULL DEFAULT '{}',
    resolution                 text CHECK (resolution IN ('done', 'cancelled', 'clarification', 'cannot reproduce')),
    due_date                   timestamp,
    resolution_date            timestamp,

    jira_status                text NOT NULL,      -- Jira's own status name, e.g. "Work in progress"
    raw                        jsonb NOT NULL,     -- the full Jira issue as last read
    content_hash               text NOT NULL,      -- hash of the record fields above
    jira_updated_at            timestamptz NOT NULL,
    synced_at                  timestamptz NOT NULL DEFAULT now(),

    core_ticket_id             text UNIQUE,        -- set once the Core has the ticket
    core_content_hash          text               -- content_hash last sent to the Core
);

CREATE INDEX tickets_jira_updated_at_idx ON tickets (jira_updated_at);
CREATE INDEX tickets_status_idx ON tickets (status);

-- Comments, so "All Comments" and internal notes don't need a Jira call.
CREATE TABLE ticket_comments (
    jira_comment_id text PRIMARY KEY,
    external_key    text NOT NULL REFERENCES tickets (external_key) ON DELETE CASCADE,
    author          text,                          -- Jira display name of the writer
    body            text NOT NULL,
    is_public       boolean NOT NULL,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL
);

CREATE INDEX ticket_comments_ticket_idx ON ticket_comments (external_key, created_at);

-- Every write the backend makes to Jira, and why.
CREATE TABLE writebacks (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_key   text NOT NULL,                  -- no FK: failed writes to unknown keys are logged too
    trigger        text NOT NULL CHECK (trigger IN ('core_auto_applied', 'core_override', 'core_comment', 'api')),
    core_event_seq bigint,                         -- the Core event that caused it, if any
    requested      jsonb NOT NULL,                 -- the patch sent
    changed        text[] NOT NULL DEFAULT '{}',
    warnings       text[] NOT NULL DEFAULT '{}',
    ok             boolean NOT NULL,
    error          text,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX writebacks_ticket_idx ON writebacks (external_key, created_at);
CREATE UNIQUE INDEX writebacks_core_event_idx ON writebacks (core_event_seq, external_key)
    WHERE core_event_seq IS NOT NULL;

-- Cursors for the sync loops, e.g. 'jira.last_updated' and 'core.last_event_seq'.
CREATE TABLE sync_state (
    name       text PRIMARY KEY,
    value      text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
