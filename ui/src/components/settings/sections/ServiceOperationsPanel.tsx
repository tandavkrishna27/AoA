import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { serviceControlApi, type ServiceDefinition } from "@/api/service-control";

const reason = "Operator service control";
const transitions: Record<string, readonly string[]> = {
  running: ["paused", "stopped"], paused: ["running", "stopped"], stopped: ["running"], deleted: [],
};
const serviceKey = (organizationId: string, companyId: string) => ["service-control", organizationId, companyId] as const;
type Editor = { serviceId: string | null; definition: ServiceDefinition };

function DefinitionEditor({ initial, pending, submit, close }: { initial: Editor; pending: boolean;
  submit(definition: ServiceDefinition): void; close(): void }) {
  const [command, setCommand] = useState(initial.definition.command);
  const [args, setArgs] = useState(initial.definition.args.join("\n"));
  const [grace, setGrace] = useState(initial.definition.gracefulStopSeconds);
  return <form className="grid gap-3 rounded border border-border p-3" onSubmit={(event) => {
    event.preventDefault(); submit({ command: command.trim(), args: args.split("\n").filter((arg) => arg.length > 0), gracefulStopSeconds: grace });
  }}>
    <label className="grid gap-1 text-sm">Service command<input className="rounded border border-border bg-background p-2" required
      value={command} onChange={(event) => setCommand(event.target.value)} /></label>
    <label className="grid gap-1 text-sm">Arguments (one per line)<textarea className="rounded border border-border bg-background p-2"
      value={args} onChange={(event) => setArgs(event.target.value)} /></label>
    <label className="grid gap-1 text-sm">Graceful stop seconds<input type="number" min={1} max={300} required
      className="rounded border border-border bg-background p-2" value={grace} onChange={(event) => setGrace(Number(event.target.value))} /></label>
    <div className="flex gap-2"><Button type="submit" size="sm" disabled={pending || !command.trim()}>
      {initial.serviceId ? "Save generation" : "Create paused service"}</Button>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={close}>Cancel edit</Button></div>
  </form>;
}

function ServiceDetails({ organizationId, companyId, serviceId, edit }: { organizationId: string; companyId: string; serviceId: string;
  edit(definition: ServiceDefinition): void }) {
  const detail = useQuery({ queryKey: [...serviceKey(organizationId, companyId), serviceId],
    queryFn: () => serviceControlApi.detail(organizationId, companyId, serviceId), refetchOnReconnect: "always" });
  if (detail.isLoading) return <p className="text-xs text-muted-foreground">Loading service details…</p>;
  if (detail.isError) return <p role="alert" className="text-sm text-destructive">Failed to load service details.</p>;
  if (!detail.data) return null;
  const data = detail.data;
  return <div className="space-y-2 border-t border-border pt-2 text-sm">
    <p>Active instance: {data.liveInstance?.status ?? "No active instance"}</p>
    {data.liveInstance ? <p className="text-xs text-muted-foreground">Instance generation {data.liveInstance.generation}</p> : null}
    {data.definition ? <><p className="break-words font-mono text-xs">{data.definition.command}</p>
      <Button variant="outline" size="sm" onClick={() => edit(data.definition!)}>Update generation</Button></> :
      <p className="text-xs text-muted-foreground">Current definition unavailable.</p>}
  </div>;
}

export function ServiceOperationsPanel({ organizationId, companyId }: { organizationId: string; companyId: string }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const key = serviceKey(organizationId, companyId);
  const list = useQuery({ queryKey: key, queryFn: () => serviceControlApi.list(organizationId, companyId), refetchOnReconnect: "always" });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });
  const desired = useMutation({ mutationFn: ({ id, state }: { id: string; state: "running" | "paused" | "stopped" }) =>
    serviceControlApi.desiredState(organizationId, companyId, id, state, reason), onSuccess: invalidate });
  const save = useMutation({ mutationFn: ({ serviceId, definition }: Editor) => serviceId ?
    serviceControlApi.generation(organizationId, companyId, serviceId, definition, reason) : serviceControlApi.create(organizationId, companyId, definition),
    onSuccess: async () => { setEditor(null); await invalidate(); } });
  return <section className="space-y-3" aria-label="Service operations">
    <div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold">Services</h3>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={list.isFetching} onClick={() => void invalidate()}>Refresh services</Button>
        <Button size="sm" onClick={() => { save.reset(); setEditor({ serviceId: null, definition: { command: "", args: [], gracefulStopSeconds: 30 } }); }}>New service</Button></div>
    </div>
    {editor ? <DefinitionEditor key={editor.serviceId ?? "new"} initial={editor} pending={save.isPending}
      close={() => setEditor(null)} submit={(definition) => save.mutate({ ...editor, definition })} /> : null}
    {save.error || desired.error ? <p role="alert" className="text-sm text-destructive">{(save.error ?? desired.error)?.message ?? "Service action failed."}</p> : null}
    {list.isLoading ? <p className="text-sm text-muted-foreground">Loading services…</p> : list.isError ?
      <p role="alert" className="text-sm text-destructive">Failed to load services. Refresh to reconnect.</p> :
      !list.data?.length ? <p className="text-sm text-muted-foreground">No services.</p> : list.data.map((service) =>
        <div key={service.serviceId} className="space-y-2 rounded border border-border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm"><span className="font-mono">{service.serviceId.slice(0, 8)}</span> · {service.desiredState} · Generation {service.generation}</div>
            <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" aria-expanded={expanded === service.serviceId}
              onClick={() => setExpanded(expanded === service.serviceId ? null : service.serviceId)}>Service details</Button>
              {(["running", "paused", "stopped"] as const).map((state) => <Button key={state} variant="outline" size="sm"
                disabled={desired.isPending || !(transitions[service.desiredState] ?? []).includes(state)} onClick={() => { desired.reset(); desired.mutate({ id: service.serviceId, state }); }}>
                {state === "running" ? "Resume" : state === "paused" ? "Pause" : "Stop"}</Button>)}
            </div>
          </div>
          {expanded === service.serviceId ? <ServiceDetails organizationId={organizationId} companyId={companyId} serviceId={service.serviceId}
            edit={(definition) => { save.reset(); setEditor({ serviceId: service.serviceId, definition }); }} /> : null}
        </div>)}
    {list.data?.length === 100 ? <p className="text-xs text-muted-foreground">Showing the first 100 services.</p> : null}
  </section>;
}
