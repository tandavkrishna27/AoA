# M3 service operator controls

Settings → Operations now reads the company service list and expanded durable service details from the organization-scoped service API. Refresh services reloads both the list and open details; reconnect also refetches them.

Operators can create a paused service with a structured command, arguments and graceful stop period, set running/paused/stopped desired state, and submit a new generation. The existing server authority, transaction and activity logging apply to every operation. Failed reads and controls remain visible.

The view shows desired state, current generation, active instance status and instance generation. It displays the first 100 services returned by the existing list endpoint.

Expanded details also show the witnessed-crash recovery verdict and the latest 20 durable instance records, including whether a process exit was confirmed. Lost or otherwise unconfirmed instances do not become crash witnesses. A crash-limit verdict does not claim that the desired state has already changed to paused.

Checkpoint metadata is scoped to the service's exact job and attempt, a witnessed source exit, and committed control-plane checkpoint records. The view reports generation, creation time and expiry, plus whether the current generation has a restore pointer selected. It exposes no checkpoint bytes, storage keys, fence tokens or download links. Restore still performs its full authority and byte validation.

Budget usage is the active company policy's current UTC calendar month. Other companies and earlier months do not contribute. The UI explicitly labels this Company budget; there is no synthetic per-service budget allocation. Unconfigured limits and unavailable response data are distinct states.
