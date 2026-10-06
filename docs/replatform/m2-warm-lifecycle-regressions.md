# Warm checkpoint cancellation and deadlines

The actual worker supervisor is tested with a checkpoint that completes after
cancellation, lease loss, or its five-second deadline. None of those paths emits
a successful terminal or an accepted checkpoint marker. Each reclaims the
resource and releases the active run. A late provider response cannot retain it.

Worker package typecheck passed. The supervisor, protected warm control and
signed checkpoint/restore wire group passed 48 tests across three files. These
tests use controlled providers and signed HTTP requests; no paid provider call
or rollout activation is involved. The combined candidate passed recursive
typecheck, 23,934 full-suite tests and build. Its explicit PostgreSQL group
passed 156 tests; seven older claim tests remain skipped by their Windows guard.
