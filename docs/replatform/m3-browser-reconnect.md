# Browser operator reconnect

Settings → Operations job details show persisted evidence identifiers, kinds,
statuses, sizes and expiry times. The list preserves expired and quarantined
dispositions and reports truncation. Storage keys, grants and raw browser control
endpoints are excluded.

Browser job details also show durable native permission requests. The server
resolves them only through applied `runtime_decision` projection receipts for
the exact Organization, Company and job, with aggregate kind
`agent_runtime_decisions`. Decision rows must belong to that Company and have
the browser runtime adapter and permission kind. Both reads are bounded.

The existing runtime decision content is shared by the Inbox and Operations.
Browser permissions offer Allow once and Deny through the existing Company
runtime decision API, preserving the nonce and expected source revision. Expired
requests are visible with disabled controls. Answer failures remain visible.

Refresh reloads open job details and permission content. Reconnecting refetches
persisted detail and decision queries; answering also refreshes the job summary.
This resumes the operator view of durable state without opening a browser control
connection or bypassing worker lease authority.
