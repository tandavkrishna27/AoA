# M2 live provider output

The earlier Commander streaming slice collected output on the worker supervisor,
but the network driver returned an Adapter Manager stdout tail only after the
provider command completed. It did not establish early delivery over the real
network path. A gated HTTP regression held the provider command open and failed
because no output arrived; the new live transport passes that test.

The provider driver has an optional live stdout mode, off by default. The
networked worker factory selects it when execution requests a stdout callback.
Adapter Manager emits bounded NDJSON stdout frames followed by exactly one
ordinary result envelope. The callback is never serialized. The existing signed
ownership gate runs before any provider output or effect. An older JSON peer is
handled without redispatch. Without a callback, existing request bytes remain
unchanged; the frozen worker protocol is unchanged.

The relay buffers whole lines before scrubbing, so a credential split across
provider chunks cannot cross the wire. It includes both fresh credentials and
historical warm canaries. It bounds partial lines, total retained live output,
HTTP backpressure, decoded frame size and response size. Incomplete or malformed
streams fail rather than fabricating a success receipt. Unmodelled provider
errors use the existing fixed error boundary, including after early output.

Focused provider-wire, Adapter Manager and networked-host regression: 356 passed,
one skipped, across 31 files. Tests cover actual early delivery, raw HTTP privacy
for fresh and historical keys, unsigned refusal before effects, provider failure
after early output, malformed/missing/extra result frames, and older-peer parity.
The combined candidate passed recursive typecheck, the full test suite (23,848
passed; 1,916 skipped), and the production build. Rollout and paid provider calls remain
off. Warm cleanup, routing and personal/device execution still require completion.
