import {lstatSync,mkdirSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

// Refuse aliases before creating anything, including Windows directory junctions.
export function assertUnaliasedAbsoluteDirectory(directory) {
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('Fixture directory must be absolute');
  if(path.resolve(directory)!==directory)throw Error('Fixture directory must use a canonical absolute path');
  let current=path.parse(directory).root;
  for(const segment of path.relative(current,path.resolve(directory)).split(path.sep).filter(Boolean)) {
    current=path.join(current,segment);
    let stat;try{stat=lstatSync(current);}catch(error){if(error.code==='ENOENT')break;throw error;}
    if(stat.isSymbolicLink())throw Error('Fixture path cannot contain a symlink or junction');
  }
}

export function createPrivateFixtureDirectory(directory,{platform=process.platform,run=spawnSync}={}) {
  assertUnaliasedAbsoluteDirectory(directory);
  // Non-recursive and exclusive: existing empty directories are also refused.
  mkdirSync(directory,{mode:0o700});
  const stat=lstatSync(directory);
  const normalized=value=>platform==='win32'?value.toLowerCase():value;
  if(!stat.isDirectory()||stat.isSymbolicLink()||normalized(realpathSync(directory))!==normalized(path.resolve(directory)))throw Error('Fixture private directory identity changed');
  if(platform!=='win32') {
    if(stat.uid!==process.getuid() || (stat.mode&0o777)!==0o700)throw Error('Fixture directory must be owned by current user with private mode 0700');
    return;
  }
  const execute=(command,args,extra={})=>{
    const result=run(command,args,{encoding:'utf8',timeout:15000,windowsHide:true,...extra});
    if(result.error||result.status!==0)throw Error('Fixture private directory ACL or identity verification failed');
    return result.stdout??'';
  };
  const who=execute('whoami.exe',['/user','/fo','csv','/nh']);
  const sid=who.match(/S-1-\d+(?:-\d+)+/)?.[0];
  if(!sid)throw Error('Cannot determine current Windows user identity for private fixture');
  // Each path/SID is a distinct argv value. No shell or interpolated command text.
  execute('icacls.exe',[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F']);
  execute('icacls.exe',[directory,'/setowner',`*${sid}`]);
  const verify=`$ErrorActionPreference='Stop';
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
$acl=[System.IO.Directory]::GetAccessControl($env:AOA_M4_PRIVATE_DIRECTORY);
if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid -or -not $acl.AreAccessRulesProtected){throw 'private directory owner or inheritance mismatch'};
$rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]));
if($rules.Count -ne 2){throw 'unexpected private directory ACL'};
foreach($rule in $rules){if($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin @($sid,'S-1-5-18') -or $rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl){throw 'private directory ACL mismatch'}};
'PRIVATE_DIRECTORY_OK'`;
  const checked=execute('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(verify,'utf16le').toString('base64')],
    {env:{...process.env,AOA_M4_PRIVATE_DIRECTORY:directory}});
  if(checked.trim()!=='PRIVATE_DIRECTORY_OK')throw Error('Fixture private directory ACL readback failed');
}
