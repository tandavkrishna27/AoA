# M3 service operator controls

Settings → Operations now reads the company service list and expanded durable service details from the organization-scoped service API. Refresh services reloads both the list and open details; reconnect also refetches them.

Operators can create a paused service with a structured command, arguments and graceful stop period, set running/paused/stopped desired state, and submit a new generation. The existing server authority, transaction and activity logging apply to every operation. Failed reads and controls remain visible.

The view shows desired state, current generation, active instance status and instance generation. It displays the first 100 services returned by the existing list endpoint. The detail response does not expose checkpoint, per-service budget or restart history metadata; this UI does not synthesize those values.
