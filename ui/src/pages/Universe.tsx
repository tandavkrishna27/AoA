import {isTransientUniverseReadError} from "../components/universe/transient-read-error";
import {useEffect, useRef, useState} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useCompany} from "../context/CompanyContext";
import {commanderConversationsApi} from "../api/internal-agent";
import {issuesApi} from "../api/issues";
import {queryKeys} from "../lib/queryKeys";
import {useUniverseOwner} from "../components/universe/useUniverseOwner";
import {PersistedUniverseWorkspace} from "../components/universe/PersistedUniverseWorkspace";
import {TaskConversationPanel} from "../components/universe/TaskConversationPanel";
import type {WorkspaceHandle} from "../components/universe/UniverseWorkspace";
import type {State} from "../components/universe/panel-state";

/** Bounded E1.2 consuming entry. Existing Commander remains available while the
 * rest of the Universe shell is integrated in its planned slices. */
export function Universe() {
  const {selectedCompanyId} = useCompany();
  const owner = useUniverseOwner();
  if (!selectedCompanyId) return <p>Select a company to open Universe.</p>;
  if (!owner.identity || !owner.userId || !owner.isVerified || !owner.isCurrent())
    return <p role="status">Sign in to open your workspace.</p>;
  return <OwnedUniverse key={JSON.stringify([owner.identity, selectedCompanyId])}
    companyId={selectedCompanyId} userId={owner.userId} identity={owner.identity}/>;
}

function OwnedUniverse({companyId, userId, identity}: {companyId: string; userId: string; identity: string}) {
  const client = useQueryClient();
  const [conversationId, setConversationId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  const conversationKey = ["commander-conversations", companyId, "universe-owner", identity];
  const conversations = useQuery({queryKey: conversationKey,
    queryFn: () => commanderConversationsApi.list(companyId), retry: false});
  // Founder APIs may return other users' conversations; layout ownership is
  // narrower. The server independently enforces ownership on every layout call.
  const mine = conversations.isSuccess ? conversations.data.conversations.filter(row => row.userId === userId) : [];
  const suspended = conversations.isError && !!conversations.data && isTransientUniverseReadError(conversations.error);
  const authorized = conversations.isSuccess || suspended ? conversations.data?.conversations.filter(row => row.userId === userId) ?? [] : [];
  const selected = authorized.some(row => row.id === conversationId) ? conversationId : null;
  async function create() {
    setCreating(true); setError(null);
    try {
      const row = await commanderConversationsApi.create(companyId);
      if (!alive.current) return;
      await client.invalidateQueries({queryKey: conversationKey});
      if (alive.current) setConversationId(row.id);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : "Could not create conversation.");
    } finally {if (alive.current) setCreating(false);}
  }
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b p-3">
      <strong>Universe</strong>
      <label>Conversation <select aria-label="Conversation" value={conversations.isError ? "" : selected ?? ""}
        onChange={event => setConversationId(event.target.value)}>
        <option value="">Choose a conversation</option>
        {mine.map(row => <option key={row.id} value={row.id}>{row.title || "Untitled conversation"}</option>)}
      </select></label>
      <button type="button" disabled={creating} onClick={() => void create()}>{creating ? "Creating…" : "New conversation"}</button>
    </header>
    {(error || conversations.isError) && <p role="alert">{error || "Conversations could not be loaded."}</p>}
    {conversations.isError && <button type="button" onClick={() => void conversations.refetch()}>Retry conversations</button>}
    {selected ? <div className="flex min-h-0 flex-1 flex-col" style={suspended ? {display: "none"} : undefined}>
      <ConversationWorkspace key={selected} companyId={companyId} conversationId={selected} identity={identity}/></div> :
      <p role="status">{conversations.isLoading ? "Loading conversations…" : "Choose a conversation or create one to open your workspace."}</p>}
  </div>;
}

function ConversationWorkspace({companyId, conversationId, identity}: {companyId: string; conversationId: string; identity: string}) {
  const frame = useRef<WorkspaceHandle>(null);
  const [registry, setRegistry] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tasks = useQuery({queryKey: [...queryKeys.issues.list(companyId), "universe-owner", identity],
    queryFn: () => issuesApi.list(companyId), retry: false});
  const available = tasks.isSuccess ? tasks.data.filter(task => task.companyId === companyId) : [];
  const perform = (action: () => void) => {
    try {action(); setError(null);} catch (cause) {setError(cause instanceof Error ? cause.message : "Could not update workspace.");}
  };
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b p-2">
      <label>Open task <select aria-label="Open task" value="" disabled={!registry || tasks.isError}
        onChange={event => {
          const task = available.find(row => row.id === event.target.value);
          if (task) perform(() => frame.current!.open({ref: {companyId, kind: "task", id: task.id}, title: task.title}));
        }}>
        <option value="">{tasks.isLoading ? "Loading tasks…" : "Choose a task"}</option>
        {available.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
      </select></label>
      {!!registry?.order.length && <label>Open panels <select aria-label="Open panels" value=""
        onChange={event => {
          const panel = registry.panels[event.target.value];
          if (panel) perform(() => frame.current!.dispatch({type: panel.minimized ? "restore" : "focus", key: panel.key, generation: panel.generation}));
        }}><option value="">Choose an open panel</option>{registry.order.map(key =>
          <option key={key} value={key}>{registry.panels[key].title}{registry.panels[key].minimized ? " (minimized)" : ""}</option>)}</select></label>}
    </div>
    {(error || tasks.isError) && <p role="alert">{error || "Tasks could not be loaded."}</p>}
    <PersistedUniverseWorkspace ref={frame} companyId={companyId} conversationId={conversationId}
      content={{}} onStateObserved={setRegistry} resolveContent={panel => panel.ref.kind === "task" ? {
        ref: panel.ref, title: panel.title, render: () => <TaskConversationPanel companyId={companyId}
          issueId={panel.ref.id} panelKey={panel.key} generation={panel.generation} active/>,
      } : undefined}/>
  </div>;
}
