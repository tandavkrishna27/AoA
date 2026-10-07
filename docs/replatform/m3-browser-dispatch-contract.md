# Browser dispatch prerequisites and additive contract

Browser jobs enter the actual worker supervisor as `browser_session` with a strict
`browser_request` source and frozen browser workload. The worker refuses malformed
contracts before redeeming secrets or creating a sandbox. Browser capability
advertisement remains filtered out on current providers.

The noncritical extension `com.armyofagents.browser/dispatch`, schema version 1,
has exactly `runnerPath`, `configPath`, and `networkPolicy`. The paths are fixed:
`/home/user/.aoa/browser-runtime/runner.js` and
`/home/user/.aoa/browser-runtime/session.json`. The policy is a frozen
`NetworkPolicyV1`; SHA256 of canonical JSON of the body with `digest` removed must
equal its digest and the job's complete policy reference. A placement digest is
insufficient. There must be exactly one dispatch extension and one version 1,
noncritical `com.armyofagents.job/staged-input` extension with exact file pointer
fields `id`, `path`, `key`, `sha256`, `size`. File paths are unique flat `.js` or
`.json` files under the browser runtime directory, with unique artifact IDs.

The control plane authors and stores the trusted runner bundle and configuration.
Use a CommonJS bundle externalizing `playwright`, stage `package.json` declaring
`commonjs`, and use the guest's installed Playwright via
`NODE_PATH=/usr/local/lib/node_modules`. Configuration must enable approvals with
`approvalDirectory=/home/user/.aoa/browser-approvals`; downloads and persistent
trace/video go under `/home/user/aoa-output`, while profile state and transient
downloads remain outside that export root. Steps, credentials and launch settings
never travel in the frozen workload. The server must validate config against the
frozen workload and authoritative policy before staging it.

The worker resolves only download grants and checks their object key, digest,
size and path against those pointers. Bytes move store → provider → guest.
Provider staging must confirm the complete path set. The provider's local
`browserNetworkPolicyMode=verified_default_deny` contract means it has measured
enforcement and installs `CreateSandboxSpec.browserNetworkPolicy` before guest
creation. The creation result must attest the identical policy digest using
`browserNetworkPolicyDigest`. Existing providers implement neither claim and
refuse browser dispatch. The provisioned self-model must also include filtered
egress in the registered target ceiling and report, with the digest-verified
provider profile matching the registered reference. Those fields do not create
live enforcement evidence by themselves.

After these gates, the supervisor executes the fixed Node guest runner inside the
sandbox. Bounded structured stdout emits approval intents into the fenced,
redacted event sequencer and durable sink. Renewal results reach the per-run
controller and its effect-gated atomic mailbox delivery. Unsupported, mismatched
or closed-run decisions reject. Cancellation, lease loss and terminal completion
close the controller. A successful guest session must emit completion; malformed,
excessive or failed guest output fails the run. Existing bounded artifact export
classifies trace, video and downloads for server-owned browser retention.

Current remaining prerequisite: an actual provider implementation with measured
default-deny/allowlist enforcement and a correctly bound authoritative policy.
No paid provider calls or production capability enablement establish that here.
