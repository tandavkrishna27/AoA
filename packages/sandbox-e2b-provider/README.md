# Browser session credential delivery

The optional credential port accepts only a scoped download grant and request ID. The provider redeems the one-use native control-plane URL, verifies the exact plaintext size (at most 8192 bytes) and SHA256, validates the session envelope, and writes the fixed private guest mailbox atomically. Worker responses contain acknowledgement metadata only. Redirects and untrusted endpoints are refused.

The adapter-manager pins redemption to the HTTPS origin of its native `AOA_ADAPTER_MANAGER_CONTROL_PLANE_URL` configuration. Missing, invalid, non-HTTPS, or userinfo-bearing configuration disables credential delivery. This configuration does not establish verified provider egress.

Credential values join the existing sandbox-local export secret scanner registry without extending its retention deadline. Delivery uses the owned interrupt lane, so a browser waiting in the main execution lane can receive its credential.
