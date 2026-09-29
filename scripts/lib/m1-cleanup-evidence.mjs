// Compose evidence only: successful removal says nothing about provider sandboxes.
export function observeComposeCleanup({ candidate, project, down, inspect }) {
  const invoke = (operation) => {
    try {
      const result = operation();
      return {
        status: Number.isInteger(result?.status) ? result.status : null,
        error: Boolean(result?.error || result?.signal),
        stdout: typeof result?.stdout === "string" ? result.stdout : null,
      };
    } catch {
      return { status: null, error: true, stdout: null };
    }
  };
  const removed = invoke(down);
  const violations = [];
  if (removed.status !== 0 || removed.error) violations.push("compose_down_failed");
  const observations = {};
  for (const kind of ["container", "network", "volume"]) {
    const result = invoke(() => inspect(kind));
    const remaining = result.stdout === null ? null : result.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    observations[kind] = { status: result.status, error: result.error, remaining };
    if (result.status !== 0 || result.error || remaining === null) violations.push(`${kind}_inventory_unknown`);
    else if (remaining.length > 0) violations.push(`${kind}_still_present`);
  }
  return {
    candidate, project, scope: "compose-project-only", providerCleanup: "not-assessed",
    finishedAt: new Date().toISOString(),
    down: { status: removed.status, error: removed.error }, observations,
    pass: violations.length === 0, violations,
  };
}
