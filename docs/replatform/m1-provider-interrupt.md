# Provider cancellation during execution

The adapter manager previously held its per-resource mutation lock for the whole
execute call. Cancel and kill queued behind the command they needed to interrupt.
They now share a separate interrupt lock. Physical ownership remains immutable;
each interrupt still verifies its signed authority, inspects the exact resource,
and rechecks expiry after queueing and inspection. Mutation operations keep their
existing lock.

Real signed HTTP tests hold execution open and prove cancel and kill reach the
provider before execution completes. Queue and inspection expiry tests refuse
dispatch. The focused adapter-manager suite passed 275 tests across 27 files;
package typecheck, boundary checks and repository citation checks passed.
Recursive typecheck passed. The full repository rerun passed 23,906 tests with
1,917 skipped by existing environment guards. Its first run hit a five-second
timeout in the unchanged migration-identity test, which passed individually and
on the full rerun with two workers. The repository build passed.
No provider keys or paid calls were used.
