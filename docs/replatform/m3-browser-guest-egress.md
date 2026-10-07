# M3 browser guest egress

The staged runner requires the immutable full `networkPolicy` body and nonempty validated `controlPlaneDenyCidrs`. It checks the frozen default-deny schema and SHA-256 of canonical sorted JSON excluding the body's `digest`. The worker separately binds this policy to the leased job reference; the trusted producer snapshots control-plane deny ranges from server configuration. Missing or malformed authority refuses execution.

Before launching Chromium, the runner binds an HTTP CONNECT proxy to loopback. Only explicit HTTPS DNS host and port rules are admitted. Every DNS answer must pass the same metadata, private-network and control-plane classifier used by server egress. The upstream connection uses the chosen validated IP literal, preventing a second DNS lookup. DNS and connect waits are bounded to five seconds; headers, active client connections and idle sockets are bounded. Teardown destroys client and upstream sockets before closing the listener.

The Playwright context uses this fixed proxy, disables Chromium's implicit loopback bypass, QUIC and nonproxied WebRTC UDP, and blocks service workers. Context request routing checks every HTTPS origin, including redirects and popup requests; literal IPs, userinfo, HTTP, wrong ports and unlisted hosts are refused. All ws/wss channels are blocked because this workload does not authorize sockets. The guest emits only the frozen `network_denied` class and a fixed reason, with no URL or credential text.

The pure IP parser, private-range predicate and destination classifier live in `packages/shared`; server modules retain their public exports as wrappers. Shared and server tests consume the same frozen vectors. Focused controls use a real local TLS server and real Chromium, with test-only transport and certificate seams; production accepts no private-network or certificate exception in config.

The provider's verified filtered-egress prerequisite and disabled capability advertisement remain in force. This browser proxy does not establish sandbox-wide provider egress verification. Session login credential materialization is a separate component and is not delivered by this change.
