import { beforeEach, describe, expect, it, vi } from "vitest";
const request = vi.hoisted(()=>vi.fn());
vi.mock("../services/agent-browser-request.js",()=>({requestBrowserSessionForActiveRun:request}));
import { handleBrowserSessionRequest } from "../mcp/tools/browser-session-tool.js";
import { browserSessionTool } from "../services/internal-agent/tools/browser-session-tool.js";
import type { ToolContext } from "../mcp/tools/types.js";
import type { ToolContext as ToolExecutionContext } from "../services/internal-agent/types.js";
const identifiers={browserRequestId:"request",jobId:"job",attemptId:"attempt",status:"queued",replayed:false};
beforeEach(()=>{request.mockReset();request.mockResolvedValue(identifiers);});
describe("governed browser tool caller identity",()=>{
  it.each(["board","mcp","commander"])("refuses %s MCP context",async(source)=>{
    const result=await handleBrowserSessionRequest({companyId:"company",actor:{source,companyId:"company",agentId:"agent",runId:"run"}} as ToolContext,{});
    expect(result).toMatchObject({ok:false,status:403}); expect(request).not.toHaveBeenCalled();
  });
  it("binds MCP identity from authenticated context",async()=>{
    await handleBrowserSessionRequest({companyId:"company",actor:{source:"agent",companyId:"company",agentId:"agent",runId:"run"}} as ToolContext,{idempotencyKey:"one"});
    expect(request).toHaveBeenCalledWith({companyId:"company",agentId:"agent",runId:"run"},{idempotencyKey:"one"});
  });
  it("refuses MCP cross-company context",async()=>{
    await handleBrowserSessionRequest({companyId:"other",actor:{source:"agent",companyId:"company",agentId:"agent",runId:"run"}} as ToolContext,{});
    expect(request).not.toHaveBeenCalled();
  });
  it("binds internal agent run identity without granting Commander authority",async()=>{
    await browserSessionTool.execute({}, {actorType:"agent",agentKind:"aoa",companyId:"company",agentId:"agent",runId:"run"} as ToolExecutionContext);
    expect(request).toHaveBeenCalledWith({companyId:"company",agentId:"agent",runId:"run",runKind:"internal_agent"},{});
    request.mockClear();
    await browserSessionTool.execute({}, {actorType:"commander",companyId:"company",agentId:"agent",runId:"run"} as ToolExecutionContext);
    expect(request).not.toHaveBeenCalled();
  });
});
