# Optional governed browser session credentials

The agent browser producer accepts an optional `sessionBindingId`. It resolves
that identifier from the immutable parent policy snapshot. Trusted boot
configuration is organization/company scoped; agent URLs never author login
endpoints, cookie names, connector references, or network rules.

`AOA_BROWSER_SESSION_BINDINGS` accepts this JSON shape (replace identifiers):

```json
{"11111111-1111-4111-8111-111111111111":{"22222222-2222-4222-8222-222222222222":[{"bindingId":"33333333-3333-4333-8333-333333333333","connectorId":"44444444-4444-4444-8444-444444444444","origin":"https://app.example.com","exchangeUrl":"https://app.example.com/aoa/session","cookieName":"__Host-aoa-session"}]}}
```

Duplicate JSON keys/binding IDs, unsafe endpoints, and cookie names exceeding
64 suffix characters are refused. Ordinary jobs with no configured network
policy retain their previous submission behavior. Credential browser requests
require an available broker: HTTPS `authPublicBaseUrl`, a configured existing
`BETTER_AUTH_SECRET` or `AOA_AGENT_JWT_SECRET` of at least 32 characters, a working
local encrypted secret provider, and an active catalog OAuth connector with an
explicit company agent opt-in. `AOA_DISTRIBUTED_NETWORK_POLICIES` and explicit
`AOA_CONTROL_PLANE_DENY_CIDRS` remain required; no policy is synthesized from the
requested URL. Missing authority refuses the optional credential request.
The encryption provider is probed before the producer admits credential browser
requests. The provider's existing master key configuration applies. Configure
`AOA_ADAPTER_MANAGER_CONTROL_PLANE_URL` to the same trusted HTTPS origin as
`authPublicBaseUrl`; the provider pins that independent configured origin for
native grant redemption and rejects a different origin or path.

The runner receives only `{bindingId,origin,cookieName}`. Credential sessions
must disable Playwright tracing because traces can include Cookie headers.
The trusted lease extension is `com.armyofagents.browser/session-binding`,
schema 1, noncritical, `{bindingId,origin,policyDigest}`. The guest requests a
credential using its UUID request ID, trusted binding/digest, and bounded expiry.

The existing accepted permission event and applied native projection receipt
must match the complete active child fence. The native human answer and matching
control command must both be `allow_once`; `decidedBy.principalType` must be
`user`, and its principal ID must equal `answeredByUserId`. Denial, timeout,
cancellation, wrong tuple/digest, standing grants, and missing human authority
produce no cookie. This uses the existing permission engine.
The immutable request/control source revision remains zero while the native
decision aggregate revision advances on answer and relay. Explicit request UUIDs
have company-scoped immutable source identities, so separate jobs can reuse the
same trusted binding nonce without colliding with earlier permission requests.

The control plane mints a live-fenced `connector_oauth` proxy handle and resolves
OAuth only in the control plane. All resolved login addresses must pass the
parent immutable policy and explicit control-plane deny set. The request pins
DNS/TLS, follows no redirects, and accepts one named Secure HttpOnly
SameSite=Strict host-only cookie with Path=/ and Max-Age 1..300. Domain widening,
duplicate/extra attributes, extra cookies, and a value equal to the OAuth token
are refused. Fence and connector authority are checked again before delivery.

The full request/binding/policy/parent/fence reply envelope is AES-GCM encrypted
using the existing local encrypted secret provider before object storage.
Its metadata is `browser_cookie_state`, `pending`, `secret`, `ephemeral`, with
identifier `browser-session-credential:<requestId>`. It never enters ordinary
committed artifact downloads or exports. Expiry is capped by the permission,
current lease, started attempt session budget, cookie Max-Age, and five minutes.
Pending/expired objects are removed on expiry or cancellation/terminal state.

Renewal commits before login exchange, then adds the noncritical schema 1
`com.armyofagents.browser/session-credential-grants` extension:
`{grants:[{requestId,bindingId,policyDigest,grant}]}` (at most one grant).
`grant` uses frozen `ArtifactDownloadGrantV1`, GET, empty headers, exact plaintext
SHA256/size, and the scoped one-use URL
`/api/worker-control/browser-session-credentials/<artifactId>?grant=<token>`.
The provider independently pins the trusted HTTPS origin and exact UUID path,
rejects redirects, and writes only the fixed guest mailbox file. Redemption
rechecks the live fence, immutable binding and connector, removes the encrypted
object, and marks it expired before returning at most 8192 bytes. Query tokens,
headers and secret response contents are excluded from HTTP logging.

This native secret-broker response is the narrow secret transport, separate
from locked DAT-002's ordinary artifact transfers, which continue directly
between worker and object storage. It introduces no frozen operation, schema
table, ordinary artifact output route, or alternate approval engine. No raw
OAuth access/refresh token, connector bundle, CDP endpoint, or control credential
is delivered to the agent or sandbox.

Rollout and provider verified enforcement gates remain off until separately
proved. No live connector exchange, paid browser call, deployment, or merge is
part of this implementation. Storage operations have a five-second response
bound. Since StorageProvider puts have no abort contract, timed-out writes keep
a durable hashless tombstone until the actual writer settles. Late settlement
triggers compensating deletion; the cleanup sweep retains that pointer until
deletion after writer settlement succeeds. No grant is published on timeout.
If the control-plane process dies before writer settlement, the hashless
tombstone remains and the sweep retries deletion; it cannot prove that the
external writer has settled and therefore does not clear that metadata pointer.
The focused tests prove late settlement in a live process, rather than universal
orphan elimination across arbitrary object-store/process failures.
