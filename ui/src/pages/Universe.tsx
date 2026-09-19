import {useEffect, useRef, useState} from "react";
import {Link, useNavigate, useSearchParams} from "react-router-dom";
import {ArrowLeft} from "lucide-react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useCompany} from "../context/CompanyContext";
import {commanderConversationsApi} from "../api/internal-agent";
import {issuesApi} from "../api/issues";
import {queryKeys} from "../lib/queryKeys";
import {useUniverseOwner} from "../components/universe/useUniverseOwner";
import {PersistedUniverseWorkspace} from "../components/universe/PersistedUniverseWorkspace";
import {TaskConversationPanel} from "../components/universe/TaskConversationPanel";
import {UniverseTray} from "../components/universe/UniverseTray";
import {CommanderBlob} from "../components/universe/CommanderBlob";
import {UniverseCommanderChat} from "../components/universe/UniverseCommanderChat";
import {initialPresentation, toggleTrayChat} from "../components/universe/commander-presentation";
import {isTransientUniverseReadError} from "../components/universe/transient-read-error";
import type {WorkspaceHandle} from "../components/universe/UniverseWorkspace";
import type {State} from "../components/universe/panel-state";
import "../components/universe/commander-surface.css";
import "../components/universe/universe-shell.css";

/** Dedicated Universe presentation; authentication and company scope remain authoritative. */
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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const {selectedCompany} = useCompany();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presentation, setPresentation] = useState(initialPresentation);
  const [registry, setRegistry] = useState<State | null>(null);
  const frame = useRef<WorkspaceHandle>(null);
  const alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  const conversationKey = ["commander-conversations", companyId, "universe-owner", identity];
  const conversations = useQuery({queryKey: conversationKey,
    queryFn: () => commanderConversationsApi.list(companyId), retry: false});
  const suspended = conversations.isError && !!conversations.data && isTransientUniverseReadError(conversations.error);
  const authorized = conversations.isSuccess || suspended ? conversations.data?.conversations.filter(row => row.userId === userId) ?? [] : [];
  const mine = conversations.isSuccess ? authorized : [];
  const requested = params.get("conversation");
  const selected = requested ? authorized.find(row => row.id === requested)?.id ?? null : authorized[0]?.id ?? null;
  // Pin the initial selection in the route; a later list reorder is not navigation.
  useEffect(() => {
    if (!conversations.isSuccess || requested || !selected) return;
    setParams(previous => {
      if (previous.get("conversation")) return previous;
      const next = new URLSearchParams(previous); next.set("conversation", selected); return next;
    }, {replace: true});
  }, [conversations.isSuccess, requested, selected, setParams]);
  const currentRegistry = registry?.scope.conversationId === selected ? registry : null;
  const tasks = useQuery({queryKey: [...queryKeys.issues.list(companyId), "universe-owner", identity],
    queryFn: () => issuesApi.list(companyId), retry: false});
  const available = tasks.isSuccess ? tasks.data.filter(task => task.companyId === companyId) : [];
  const openConversation = (id: string) => {
    setParams(previous => {const next = new URLSearchParams(previous); next.set("conversation", id); return next;});
  };
  async function create() {
    if (creating) return;
    setCreating(true); setError(null);
    try {
      const row = await commanderConversationsApi.create(companyId);
      if (!alive.current) return;
      await client.invalidateQueries({queryKey: conversationKey});
      if (alive.current) openConversation(row.id);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : "Could not create conversation.");
    } finally {if (alive.current) setCreating(false);}
  }
  const perform = (action: () => void) => {
    try {action(); setError(null);} catch (cause) {setError(cause instanceof Error ? cause.message : "Could not update workspace.");}
  };
  const openPanel = (key: string) => {
    const panel = currentRegistry?.panels[key];
    if (panel) perform(() => frame.current?.dispatch({type: panel.minimized ? "restore" : "focus", key, generation: panel.generation}));
  };
  const prefix = selectedCompany?.issuePrefix;
  const returnPath = prefix ? `/${prefix}/commander${selected ? `?conversation=${encodeURIComponent(selected)}` : ""}` : "/";
  return <main className="universe-shell" aria-label="Universe canvas">
    <Link className="universe-exit" to={returnPath} aria-label="Back to Commander" title="Back to Commander"><ArrowLeft size={18}/></Link>
    <div className="universe-shell-tray">
      <UniverseTray conversationTitle={mine.find(row => row.id === selected)?.title || undefined}
        openPanels={suspended ? [] : currentRegistry?.order.map(key => ({...currentRegistry.panels[key], kind: "Task"})) ?? []}
        menuItems={{work: available.map(task => ({key: task.id, label: task.title})),
          settings: [{key: "company-settings", label: "Company settings"}, {key: "lobby", label: "Return to lobby"}]}}
        commanderConversations={[...mine.map(row => ({key: row.id, label: row.title || "Untitled conversation"})),
          {key: "new-conversation", label: creating ? "Creating conversation…" : "New conversation"}]}
        commanderToggles={{chat: presentation.chat !== "tucked", blob: presentation.blob, captions: presentation.captions}}
        onCommanderPrimary={() => setPresentation(toggleTrayChat)}
        onToggleCommander={(which, value) => setPresentation(previous => which === "chat"
          ? {...previous, chat: value ? previous.lastVisible : "tucked", chatFrontmost: value}
          : {...previous, [which]: value})}
        onOpenConversation={id => {if (id === "new-conversation") void create(); else openConversation(id);}}
        onOpenPanel={openPanel}
        onOpenReference={(menu, id) => {
          if (menu === "settings") { navigate(id === "lobby" ? "/" : `/${prefix}/settings`); return; }
          const task = available.find(row => row.id === id);
          if (menu !== "work" || !task) return;
          if (!selected || !currentRegistry || !frame.current) {setError("Choose or create a conversation in Commander options before opening a task."); return;}
          perform(() => frame.current!.open({ref: {companyId, kind: "task", id}, title: task.title}));
        }}/>
    </div>
    <div className="universe-shell-notices" aria-live="polite">
      {(error || conversations.isError || tasks.isError) && <p role="alert">{error || (conversations.isError ? "Conversations could not be loaded." : "Tasks could not be loaded.")}</p>}
      {conversations.isError && <button type="button" onClick={() => void conversations.refetch()}>Retry conversations</button>}
      {tasks.isError && <button type="button" onClick={() => void tasks.refetch()}>Retry tasks</button>}
      {conversations.isLoading && <p role="status">Loading conversations…</p>}
      {requested && conversations.isSuccess && !selected && <p role="alert">This conversation is unavailable. Choose another in Commander options.</p>}
    </div>
    <div className="universe-shell-canvas" style={suspended ? {display: "none"} : undefined}>
      {selected && <PersistedUniverseWorkspace key={selected} ref={frame} companyId={companyId} conversationId={selected}
        content={{}} motion onStateObserved={setRegistry} resolveContent={panel => panel.ref.kind === "task" ? {
          ref: panel.ref, title: panel.title, render: () => <TaskConversationPanel companyId={companyId}
            issueId={panel.ref.id} panelKey={panel.key} generation={panel.generation} active/>,
        } : undefined}/>}
    </div>
    {presentation.blob && presentation.chat !== "maximized" && <div className="universe-shell-blob" data-occupied={!!currentRegistry?.order.some(key => !currentRegistry.panels[key].minimized)}>
      <CommanderBlob onPrimary={() => setPresentation(toggleTrayChat)} onHide={() => setPresentation(previous => ({...previous, blob: false}))}/>
    </div>}
    {(conversations.isSuccess || suspended) && (!requested || !!selected) && <div className="universe-shell-chat" style={suspended ? {display: "none"} : undefined}>
      <UniverseCommanderChat conversationId={selected} onSelectConversation={async id => {
        await client.invalidateQueries({queryKey: conversationKey}); if (alive.current) openConversation(id);
      }} presentation={presentation} onPresentationChange={setPresentation}/>
    </div>}
  </main>;
}
