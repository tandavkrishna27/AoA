# Governed agent browser requests

`request_browser_session` is available to authenticated agent MCP callers and the internal agent tool registry. The trusted caller identity must identify a running distributed task run and its checked-out task. The server derives the parent job, active lease, target, generation and authority from stored run records. Agents cannot select these identities or supply a runner, configuration, credentials or network policy.

The first producer accepts up to 16 public HTTPS navigation URLs without embedded credentials, query strings or fragments. Browser options are bounded viewport, locale, timezone, tracing, video and session duration. Requested destinations must already occur in the parent's immutable network policy. The exact parent target is pinned, with its trust, credential and locality ceilings. Budget hard stops, organization admission, worker capacity, browser capability and filtered egress capability all apply.

The server bundles the installed browser runtime and stages `runner.js`, `session.json` and CommonJS `package.json` using existing staged-input object pointers. Lease extensions contain pointers and the verified policy, never configuration contents or artifact bytes. The trusted configuration requires private guest approval and uses fixed guest paths. Parent cancellation, terminal completion and permanent lease loss cancel browser children; child activation and every guarded fence operation require the parent lease to remain active. Browser requests have one attempt; a fresh authorized request is required for recovery.

## Trusted configuration

Set `AOA_DISTRIBUTED_NETWORK_POLICIES` to a JSON object keyed by organization UUID and then company UUID. For example:

```json
{
  "11111111-1111-4111-8111-111111111111": {
    "22222222-2222-4222-8222-222222222222": {
      "policyId": "company-approved-browser-egress",
      "version": 1,
      "allow": [{ "scheme": "https", "host": "example.com", "port": 443 }]
    }
  }
}
```

The server constructs a default-deny body with private-network, metadata and control-plane denial, hashes the canonical complete body excluding `digest`, and snapshots it when an ordinary parent job is submitted. Duplicate JSON keys, duplicate rules, unsafe rules and oversized configuration are rejected. Configuration cannot grant authority retroactively to existing jobs. Missing configuration preserves ordinary job behavior and refuses browser children.

`AOA_CONTROL_PLANE_DENY_CIDRS` must explicitly identify the deployment's actual control-plane addresses, as comma or whitespace separated IP literals/CIDRs. These bounded, validated values are also snapshotted into parent jobs and staged as `controlPlaneDenyCidrs` alongside `networkPolicy`. An empty snapshot refuses browser preparation. Supply deployment addresses; do not copy illustrative addresses from a test fixture.

## Remaining integration

Distributed rollout flags remain off. Existing providers lack measured default-deny enforcement and must not advertise browser capability until the worker/provider contract is satisfied. Guest enforcement, worker dispatch, accepted browser approvals and artifact projections must be integrated and verified together before enabling a provider. Commander host spawning remains until the governed path is proven; this producer grants Commander no new browser authority. No live or paid provider calls are part of the focused producer tests.
