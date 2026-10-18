import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

const REF = /^aoa-winjob:v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isWindowsRuntimeJobRef = (value: string): boolean => REF.test(value);
type JobState = "starting" | "active" | "empty" | "unknown";
export interface WindowsRuntimeJob {
  readonly providerRef: string;
  readonly ownerId: string;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly ready: Promise<void>;
  readonly completion: Promise<"empty" | "unknown">;
  readonly state: JobState;
  readonly host: ChildProcess | null;
  readonly rootPid: number | null;
  readonly exitCode: number | null;
  stop(): Promise<boolean>;
}
const jobs = new Map<string, WindowsRuntimeJob>();
// Match Node's Windows spawn handling of case-insensitive environment names.
export function normalizeWindowsRuntimeEnv(env: Record<string, string>): Record<string, string> {
  const seen = new Set<string>();
  return Object.fromEntries(Object.keys(env).sort().filter((key) => {
    const folded = key.toUpperCase();
    if (seen.has(folded)) return false;
    seen.add(folded); return true;
  }).map((key) => [key, env[key]!]));
}

export async function stopOwnedWindowsRuntimeJob(ref: string, ownerId: string): Promise<boolean> {
  if (!isWindowsRuntimeJobRef(ref)) return false;
  const job = jobs.get(ref);
  return job?.ownerId === ownerId ? job.stop() : false;
}

export function forgetWindowsRuntimeJob(job: WindowsRuntimeJob): void {
  if (job.state === "empty" && jobs.get(job.providerRef) === job) jobs.delete(job.providerRef);
}

/** The original private pipe and held native job, never a persisted PID, confer authority. */
export function launchWindowsRuntimeJob(input: {
  ownerId: string; command: string; args: string[]; cwd: string; env: Record<string, string>;
}): WindowsRuntimeJob {
  input = { ...input, env: normalizeWindowsRuntimeEnv(input.env) };
  const providerRef = `aoa-winjob:v1:${randomUUID()}`;
  const challenge = randomBytes(32).toString("hex");
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let state: JobState = "starting";
  let host: ChildProcess | null = null;
  let rootPid: number | null = null;
  let exitCode: number | null = null;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveCompletion!: (state: "empty" | "unknown") => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // The caller registers its provisional record before awaiting activation.
  void ready.catch(() => {});
  const completion = new Promise<"empty" | "unknown">((resolve) => { resolveCompletion = resolve; });
  let stopPromise: Promise<boolean> | null = null;
  let configSent = false;
  let stopRequested = false;
  let launchDirectory: string | null = null;
  let pending = "";
  let hostClosed = false;
  let hostDiagnostics = "";
  const finish = (result: "empty" | "unknown", error?: string) => {
    if (state === "empty" || state === "unknown") return;
    state = result;
    clearTimeout(activationTimer);
    rejectReady(new Error(error ?? "runtime job exited before activation"));
    if (result === "unknown" || !host || hostClosed) resolveCompletion(result);
  };
  const fail = (message: string) => {
    stopRequested = true;
    finish("unknown", message);
    // EOF makes a healthy host terminate its job. A crashed host already closed
    // its sole job handle. Neither condition is promoted into an EMPTY receipt.
    host?.stdin?.end();
    host?.kill("SIGKILL");
  };
  const activationTimer = setTimeout(() => fail("Windows runtime job activation timed out"), 10_000);
  activationTimer.unref();
  const receive = (line: string) => {
    if (state === "unknown") return;
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(line); } catch { fail("invalid Windows runtime job frame"); return; }
    if (frame.v !== 1 || frame.ref !== providerRef || frame.challenge !== challenge) {
      fail("Windows runtime job generation mismatch"); return;
    }
    if (frame.type === "data") {
      if ((frame.stream !== "stdout" && frame.stream !== "stderr") || typeof frame.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)) {
        fail("invalid Windows runtime job output"); return;
      }
      (frame.stream === "stdout" ? stdout : stderr).write(Buffer.from(frame.data, "base64"));
    } else if (frame.type === "ready") {
      if (state !== "starting" || !Number.isSafeInteger(frame.rootPid) || Number(frame.rootPid) <= 0 || !Number.isSafeInteger(frame.hostPid) || !/^\d+$/.test(String(frame.rootTicks)) || !/^\d+$/.test(String(frame.hostTicks))) {
        fail("invalid Windows runtime job activation receipt"); return;
      }
      rootPid = Number(frame.rootPid);
      state = "active";
      clearTimeout(activationTimer);
      resolveReady();
    } else if (frame.type === "empty") {
      if (frame.activeProcesses !== 0 || (frame.exitCode !== null && !Number.isSafeInteger(frame.exitCode))) {
        fail("invalid Windows runtime job empty receipt"); return;
      }
      exitCode = frame.exitCode === null ? null : Number(frame.exitCode);
      finish("empty");
    } else if (frame.type === "error") {
      stderr.write(String(frame.message ?? "Windows runtime job host error"));
      rejectReady(new Error(String(frame.message ?? "Windows runtime job host error")));
    } else fail("unknown Windows runtime job frame");
  };
  const job: WindowsRuntimeJob = {
    providerRef, ownerId: input.ownerId, stdout, stderr, ready, completion,
    get state() { return state; }, get host() { return host; }, get rootPid() { return rootPid; }, get exitCode() { return exitCode; },
    stop() {
      if (state === "empty") return completion.then(() => true);
      if (state === "unknown") return Promise.resolve(false);
      if (stopPromise) return stopPromise;
      stopRequested = true;
      if (configSent) host?.stdin?.write(JSON.stringify({ v: 1, ref: providerRef, challenge, type: "stop" }) + "\n");
      stopPromise = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          fail("Windows runtime job stop could not be confirmed");
          // This original ChildProcess handle is owned; no numeric PID lookup.
          host?.kill("SIGKILL");
          resolve(false);
        }, 6_000);
        void completion.then((result) => { clearTimeout(timeout); resolve(result === "empty"); });
      });
      return stopPromise;
    },
  };
  jobs.set(providerRef, job);
  // A timer/control failure can change state across each filesystem await.
  const cancelled = () => job.state === "unknown";
  void (async () => {
    try {
      launchDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-windows-runtime-job-"));
      if (cancelled()) { await fs.rm(launchDirectory, { recursive: true, force: true }); return; }
      const script = path.join(launchDirectory, "host.ps1");
      await fs.writeFile(script, "\ufeff" + HOST, { flag: "wx", mode: 0o600 });
      if (cancelled()) { await fs.rm(launchDirectory, { recursive: true, force: true }); return; }
      const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      host = spawn(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], {
        cwd: input.cwd, env: input.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      });
      host.stdin?.on("error", () => fail("Windows runtime job control pipe closed"));
      host.stdout?.setEncoding("utf8");
      host.stdout?.on("data", (chunk: string) => {
        pending += chunk;
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
          if (newline > 128 * 1024) { fail("oversized Windows runtime job frame"); return; }
          const line = pending.slice(0, newline).replace(/\r$/, "");
          pending = pending.slice(newline + 1);
          receive(line);
        }
        if (pending.length > 128 * 1024) fail("oversized Windows runtime job frame");
      });
      host.stderr?.on("data", (chunk) => { hostDiagnostics = (hostDiagnostics + String(chunk)).slice(-4096); stderr.write(chunk); });
      host.once("error", (error) => fail(`Windows runtime job host: ${error.message}`));
      host.once("close", () => {
        hostClosed = true;
        if (state !== "empty") fail(`Windows runtime job host closed without empty receipt${hostDiagnostics ? `: ${hostDiagnostics}` : ""}`);
        if (state === "empty") resolveCompletion("empty");
        void (async () => {
          if (launchDirectory) await fs.rm(launchDirectory, { recursive: true, force: true }).catch((error) => stderr.write(`Windows runtime job temporary source cleanup failed: ${String(error)}`));
          stdout.end(); stderr.end();
        })();
      });
      host.stdin?.write(JSON.stringify({ ...input, v: 1, ref: providerRef, challenge, cancelled: stopRequested }) + "\n");
      configSent = true;
    } catch (error) {
      // No native host was created: no target could have been launched. This is
      // the only no-receipt empty case, established by our own failed spawn/setup.
      if (!host) finish("empty", String(error)); else fail(String(error));
      if (launchDirectory) await fs.rm(launchDirectory, { recursive: true, force: true }).catch((error) => stderr.write(`Windows runtime job temporary source cleanup failed: ${String(error)}`));
    }
  })();
  return job;
}

// Windows PowerShell 5 / .NET Framework C# compiler compatible. Source remains
// embedded so the normal TypeScript build needs no runtime asset copying.
const HOST = String.raw`$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies 'System.Web.Extensions' -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
public static class AoARuntimeJob {
  [StructLayout(LayoutKind.Sequential)] struct SA { public int length; public IntPtr security; public int inherit; }
  [StructLayout(LayoutKind.Sequential)] struct SI { public int cb; public IntPtr reserved, desktop, title; public int x,y,xSize,ySize,xCount,yCount,fill,flags; public short show,reservedSize; public IntPtr reservedBytes,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct SIX { public SI info; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public int pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASICLIMIT { public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint activeLimit; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct LIMIT { public BASICLIMIT basic; public IO io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNT { public long a,b,c,d; public uint faults,total,active,terminated; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref LIMIT value,int size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out ACCOUNT value,int size,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SA attributes,int size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint share,ref SA security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr key,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr env,string cwd,ref SIX startup,out PI result);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint SearchPath(string directory,string file,string extension,int size,StringBuilder result,IntPtr part);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr handle,out long created,out long exited,out long kernel,out long user);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern int GetCurrentProcessId();
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadFile(IntPtr file,byte[] buffer,int size,out int read,IntPtr overlapped);
  static readonly object writer = new object();
  static JavaScriptSerializer json = new JavaScriptSerializer();
  static string reference,challenge;
  static int stop;
  static void Check(bool ok,string operation) { if(!ok) throw new Exception(operation+": "+Marshal.GetLastWin32Error()); }
  static void Frame(string type,Dictionary<string,object> fields) { lock(writer) { fields["v"]=1;fields["ref"]=reference;fields["challenge"]=challenge;fields["type"]=type;Console.Out.WriteLine(json.Serialize(fields));Console.Out.Flush(); } }
  static string Quote(string value) {
    StringBuilder b=new StringBuilder("\"");int slashes=0;
    foreach(char c in value) { if(c=='\\') {slashes++;continue;} if(c=='\"') {b.Append('\\',slashes*2+1);b.Append(c);} else {b.Append('\\',slashes);b.Append(c);} slashes=0; }
    b.Append('\\',slashes*2);b.Append('"');return b.ToString();
  }
  static void Pump(IntPtr handle,string stream) { try { byte[] b=new byte[4096];int count;while(ReadFile(handle,b,b.Length,out count,IntPtr.Zero)&&count>0) Frame("data",new Dictionary<string,object>{{"stream",stream},{"data",Convert.ToBase64String(b,0,count)}}); } finally {CloseHandle(handle);} }
  static long Creation(IntPtr handle) {long a,b,c,d;Check(GetProcessTimes(handle,out a,out b,out c,out d),"GetProcessTimes");return a;}
  public static void Run() {
    IntPtr job=IntPtr.Zero,attributes=IntPtr.Zero,jobList=IntPtr.Zero,handleList=IntPtr.Zero,environment=IntPtr.Zero;
    IntPtr outRead=IntPtr.Zero,outWrite=IntPtr.Zero,errRead=IntPtr.Zero,errWrite=IntPtr.Zero,nul=IntPtr.Zero;
    PI process=new PI();Thread output=null,error=null;bool initialized=false;
    try {
      Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
      string line=Console.In.ReadLine();if(line==null)return;
      Dictionary<string,object> cfg=json.Deserialize<Dictionary<string,object>>(line);
      reference=(string)cfg["ref"];challenge=(string)cfg["challenge"];
      job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"CreateJobObject");
      LIMIT limit=new LIMIT();limit.basic.flags=0x2000;Check(SetInformationJobObject(job,9,ref limit,Marshal.SizeOf(typeof(LIMIT))),"SetInformationJobObject");
      if((bool)cfg["cancelled"]) {ACCOUNT cancelled;Check(QueryInformationJobObject(job,1,out cancelled,Marshal.SizeOf(typeof(ACCOUNT)),IntPtr.Zero),"cancelled accounting");Check(cancelled.active==0,"cancelled job empty");Frame("empty",new Dictionary<string,object>{{"activeProcesses",0},{"exitCode",null}});return;}
      Thread control=new Thread(delegate() {try {string command;while((command=Console.In.ReadLine())!=null) {var frame=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(command);if((string)frame["ref"]==reference&&(string)frame["challenge"]==challenge&&(string)frame["type"]=="stop")break;}}catch{}finally{Interlocked.Exchange(ref stop,1);} });control.IsBackground=true;control.Start();
      SA sa=new SA();sa.length=Marshal.SizeOf(typeof(SA));sa.inherit=1;
      Check(CreatePipe(out outRead,out outWrite,ref sa,0),"stdout pipe");Check(SetHandleInformation(outRead,1,0),"stdout inheritance");
      Check(CreatePipe(out errRead,out errWrite,ref sa,0),"stderr pipe");Check(SetHandleInformation(errRead,1,0),"stderr inheritance");
      nul=CreateFile("NUL",0x80000000,3,ref sa,3,0,IntPtr.Zero);Check(nul!=new IntPtr(-1),"NUL stdin");
      IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);attributes=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(attributes,2,0,ref size),"InitializeProcThreadAttributeList");initialized=true;
      jobList=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobList,job);
      handleList=Marshal.AllocHGlobal(IntPtr.Size*3);Marshal.WriteIntPtr(handleList,0,nul);Marshal.WriteIntPtr(handleList,IntPtr.Size,outWrite);Marshal.WriteIntPtr(handleList,IntPtr.Size*2,errWrite);
      Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x2000D),jobList,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"JOB_LIST");
      Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handleList,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero),"HANDLE_LIST");
      string executable=(string)cfg["command"];StringBuilder resolved=new StringBuilder(32768);uint length=SearchPath(null,executable,".exe",resolved.Capacity,resolved,IntPtr.Zero);Check(length>0&&length<resolved.Capacity,"SearchPath");executable=resolved.ToString();
      StringBuilder commandLine=new StringBuilder(Quote(executable));foreach(object arg in (System.Collections.IEnumerable)cfg["args"])commandLine.Append(" ").Append(Quote((string)arg));
      Dictionary<string,object> env=(Dictionary<string,object>)cfg["env"];List<string> keys=new List<string>(env.Keys);keys.Sort(StringComparer.OrdinalIgnoreCase);StringBuilder block=new StringBuilder();foreach(string key in keys)block.Append(key).Append('=').Append((string)env[key]).Append('\0');block.Append('\0');environment=Marshal.StringToHGlobalUni(block.ToString());
      SIX startup=new SIX();startup.info.cb=Marshal.SizeOf(typeof(SIX));startup.info.flags=0x100;startup.info.input=nul;startup.info.output=outWrite;startup.info.error=errWrite;startup.attributes=attributes;
      if(Interlocked.CompareExchange(ref stop,0,0)!=0) {ACCOUNT cancelled;Check(QueryInformationJobObject(job,1,out cancelled,Marshal.SizeOf(typeof(ACCOUNT)),IntPtr.Zero),"cancelled accounting");Check(cancelled.active==0,"cancelled job empty");Frame("empty",new Dictionary<string,object>{{"activeProcesses",0},{"exitCode",null}});return;}
      Check(CreateProcess(executable,commandLine,IntPtr.Zero,IntPtr.Zero,true,0x80000|0x400|0x08000000,environment,(string)cfg["cwd"],ref startup,out process),"CreateProcess JOB_LIST");
      CloseHandle(process.thread);process.thread=IntPtr.Zero;CloseHandle(outWrite);outWrite=IntPtr.Zero;CloseHandle(errWrite);errWrite=IntPtr.Zero;CloseHandle(nul);nul=IntPtr.Zero;
      IntPtr stdoutHandle=outRead;outRead=IntPtr.Zero;output=new Thread(delegate(){Pump(stdoutHandle,"stdout");});output.IsBackground=true;output.Start();
      IntPtr stderrHandle=errRead;errRead=IntPtr.Zero;error=new Thread(delegate(){Pump(stderrHandle,"stderr");});error.IsBackground=true;error.Start();
      Frame("ready",new Dictionary<string,object>{{"rootPid",process.pid},{"rootTicks",Creation(process.process).ToString()},{"hostPid",GetCurrentProcessId()},{"hostTicks",Creation(GetCurrentProcess()).ToString()}});
      while(Interlocked.CompareExchange(ref stop,0,0)==0&&WaitForSingleObject(process.process,10)==258){}
      Check(TerminateJobObject(job,1),"TerminateJobObject");
      DateTime deadline=DateTime.UtcNow.AddSeconds(5);ACCOUNT accounting;
      do {Check(QueryInformationJobObject(job,1,out accounting,Marshal.SizeOf(typeof(ACCOUNT)),IntPtr.Zero),"QueryInformationJobObject");if(accounting.active==0)break;if(DateTime.UtcNow>=deadline)throw new Exception("job did not become empty");Thread.Sleep(10);}while(true);
      uint code;object outcome=GetExitCodeProcess(process.process,out code)?(object)(int)code:null;
      if(output!=null)output.Join(1000);if(error!=null)error.Join(1000);
      Frame("empty",new Dictionary<string,object>{{"activeProcesses",0},{"exitCode",outcome}});
    } catch(Exception ex) {
      if(reference!=null) {Frame("error",new Dictionary<string,object>{{"message",ex.Message}});if(job!=IntPtr.Zero) {TerminateJobObject(job,1);ACCOUNT a;if(QueryInformationJobObject(job,1,out a,Marshal.SizeOf(typeof(ACCOUNT)),IntPtr.Zero)&&a.active==0)Frame("empty",new Dictionary<string,object>{{"activeProcesses",0},{"exitCode",null}});}}
      else Console.Error.WriteLine(ex.ToString());
    } finally {
      if(job!=IntPtr.Zero)CloseHandle(job);
      if(process.process!=IntPtr.Zero)CloseHandle(process.process);if(process.thread!=IntPtr.Zero)CloseHandle(process.thread);
      if(outRead!=IntPtr.Zero)CloseHandle(outRead);if(outWrite!=IntPtr.Zero)CloseHandle(outWrite);if(errRead!=IntPtr.Zero)CloseHandle(errRead);if(errWrite!=IntPtr.Zero)CloseHandle(errWrite);if(nul!=IntPtr.Zero&&nul!=new IntPtr(-1))CloseHandle(nul);
      if(initialized)DeleteProcThreadAttributeList(attributes);if(attributes!=IntPtr.Zero)Marshal.FreeHGlobal(attributes);if(jobList!=IntPtr.Zero)Marshal.FreeHGlobal(jobList);if(handleList!=IntPtr.Zero)Marshal.FreeHGlobal(handleList);if(environment!=IntPtr.Zero)Marshal.FreeHGlobal(environment);
    }
  }
}
'@
[AoARuntimeJob]::Run()
`;
