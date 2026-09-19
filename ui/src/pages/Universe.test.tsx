import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {beforeEach, expect, it, vi} from "vitest";
import {Universe} from "./Universe";
import {queryKeys} from "../lib/queryKeys";
import {ApiError} from "../api/client";
const h=vi.hoisted(()=>({company:"c",verified:true,list:vi.fn(),tasks:vi.fn(),create:vi.fn()}));
vi.mock("../context/CompanyContext",()=>({useCompany:()=>({selectedCompanyId:h.company})}));
vi.mock("../components/universe/useUniverseOwner",()=>({useUniverseOwner:()=>({identity:"owner:session",userId:"owner",isVerified:h.verified,isCurrent:()=>h.verified})}));
vi.mock("../api/internal-agent",()=>({commanderConversationsApi:{list:h.list,create:h.create}}));
vi.mock("../api/issues",()=>({issuesApi:{list:h.tasks}}));
vi.mock("../components/universe/PersistedUniverseWorkspace",()=>({PersistedUniverseWorkspace:({companyId,conversationId}:{companyId:string;conversationId:string})=><div>Workspace {companyId} {conversationId}</div>}));
function setup(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return {...render(<QueryClientProvider client={client}><Universe/></QueryClientProvider>),client};}
beforeEach(()=>{h.company="c";h.verified=true;h.list.mockReset();h.tasks.mockReset();h.create.mockReset();h.tasks.mockResolvedValue([]);});
it("only offers the authenticated owner's conversations even when the founder list includes others",async()=>{
 h.list.mockResolvedValue({conversations:[{id:"mine",userId:"owner",title:"Mine"},{id:"foreign",userId:"other",title:"Private"}]});setup();
 await screen.findByRole("option",{name:"Mine"});
 fireEvent.change(screen.getByLabelText("Conversation"),{target:{value:"mine"}});
 expect(await screen.findByText("Workspace c mine")).toBeInTheDocument();
 expect(screen.queryByRole("option",{name:"Private"})).toBeNull();
});
it("does not load private libraries before authentication",()=>{
 h.verified=false;setup();expect(h.list).not.toHaveBeenCalled();expect(h.tasks).not.toHaveBeenCalled();
});
it("does not create a conversation just by visiting the workspace",async()=>{
 h.list.mockResolvedValue({conversations:[]});setup();await screen.findByText("Choose a conversation or create one to open your workspace.");
 expect(h.create).not.toHaveBeenCalled();
});
it("removes retained conversation titles when the list is denied",async()=>{
 h.list.mockResolvedValue({conversations:[{id:"mine",userId:"owner",title:"Mine"}]});const view=setup();
 await screen.findByRole("option",{name:"Mine"});h.list.mockRejectedValue(new Error("Forbidden"));
 await act(async()=>{await view.client.invalidateQueries({queryKey:["commander-conversations"]});});
 await waitFor(()=>expect(screen.queryByRole("option",{name:"Mine"})).toBeNull());
});
it("uses canonical task invalidation and removes denied task titles",async()=>{
 h.list.mockResolvedValue({conversations:[{id:"mine",userId:"owner",title:"Mine"}]});
 h.tasks.mockResolvedValue([{id:"task",companyId:"c",title:"Private task"}]);const view=setup();
 await screen.findByRole("option",{name:"Mine"});fireEvent.change(screen.getByLabelText("Conversation"),{target:{value:"mine"}});
 await screen.findByRole("option",{name:"Private task"});h.tasks.mockRejectedValue(new Error("Forbidden"));
 await act(async()=>{await view.client.invalidateQueries({queryKey:queryKeys.issues.list("c")});});
 await waitFor(()=>expect(screen.queryByRole("option",{name:"Private task"})).toBeNull());
});
it("keeps the selected workspace mounted but hidden through a transient conversation-list failure",async()=>{
 h.list.mockResolvedValue({conversations:[{id:"mine",userId:"owner",title:"Mine"}]});const view=setup();
 await screen.findByRole("option",{name:"Mine"});fireEvent.change(screen.getByLabelText("Conversation"),{target:{value:"mine"}});
 const workspace=await screen.findByText("Workspace c mine");
 h.list.mockRejectedValue(new ApiError("Unavailable",503,null));
 await act(async()=>{await view.client.invalidateQueries({queryKey:["commander-conversations"]});});
 await waitFor(()=>expect(workspace).not.toBeVisible());expect(workspace).toBeInTheDocument();
 expect(screen.queryByRole("option",{name:"Mine"})).toBeNull();
 h.list.mockResolvedValue({conversations:[{id:"mine",userId:"owner",title:"Mine"}]});
 await act(async()=>{screen.getByRole("button",{name:"Retry conversations"}).click();});
 await waitFor(()=>expect(workspace).toBeVisible());
 expect(screen.getByText("Workspace c mine")).toBe(workspace);
});
