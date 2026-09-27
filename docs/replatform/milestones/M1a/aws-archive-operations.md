# M1a archive operator operations

## Approval boundary and current availability

These standalone CLIs archive already collected final observations. Offline source implementation is approved; live sensitive evidence upload, spend, IAM changes, signing, campaign execution and publication are not approved by that implementation approval. Before any live use, an operator must independently approve the exact sensitive evidence set, destination/access policy and storage spend. `--allow-upload` is only explicit mechanical intent; it is never authorization inferred by an agent.

The destination is fixed: account `010438509726`, region `us-east-1`, bucket `aoa-platform-evidence-010438509726-us-east-1-an`, prefix `replatform/m1a/`. The uploader must be `arn:aws:iam::010438509726:user/aoa-s3-artifacts`. The tooling inherits the bucket's COMPLIANCE 180-day default; it cannot set retention, delete objects, change bucket policy, provision roles or select another endpoint/principal. No root keys, extra access keys or broad policy are authorized.

An independently approved read-only verifier role and its provisioning remain operator prerequisites. A matching distinct same-account ARN records identity; it does not prove IAM permission policy or approval. H-08 prospective policy/root approval remains unresolved. Historical archive review cannot retroactively change H-08 or rewrite a23. Storage facts never certify RET-01 or H-08, grade a campaign pass, complete M1a, permit M1b/M2 entry or expand the single named F8 paid authorization. Hubble remains reserved for E5 certification. Existing local E3 tooling stays `DEV_ONLY`; these CLIs cannot promote its receipts.

Real Windows privacy is currently UNAVAILABLE on the implementation host because full registered synchronization-root enumeration is inaccessible. Input/output/scratch checks fail closed without changing OS permissions. Library test privacy facts cannot enter production. Every ancestor is checked before raw I/O. Windows conservatively requires the existing private SID/ACL checks at each ancestor, refusing broader ownership/permissions rather than inferring delete/replace protection from a private leaf. Successful POSIX operation still requires actual platform CI. Unregistered synchronization software and the trusted host/user threat model remain operator review responsibilities.

## Commands

Run only from an independently approved runtime with fixed AWS CLI v2, Python (`python3` on POSIX), and externally supplied credentials. Credentials never go in flags, files shown below, output or logs. The existing GitHub secret names are `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; values are never extracted. A future protected runner requires separate review. This task adds ordinary offline unit tests only, with no credentials, campaign wiring, upload workflow or dispatch.

Upload accepts exactly these flags, each once; `--allow-upload` takes no value:

```sh
node scripts/m1a-archive.mjs \
  --contract /private/operator/contract.json \
  --expected-contract-sha256 <externally-reviewed-64-lowercase-hex-digest> \
  --inventory /private/operator/inventory.json \
  --input-root /private/operator/source \
  --scratch-root /private/operator/scratch \
  --output /private/operator/new-upload-facts.json \
  --allow-upload
```

Verify accepts exactly these flags, each once, and has no cloud write operation:

```sh
node scripts/verify-m1a-archive.mjs \
  --facts /private/reviewer/upload-facts.json \
  --expected /private/reviewer/pinned-expected.json \
  --authority /private/reviewer/authority.json \
  --scratch-root /private/reviewer/scratch \
  --output /private/reviewer/new-verification.json
```

Examples describe shapes, not runnable authorization. Replace placeholders with independently reviewed pins. All production paths must be absolute canonical local paths outside Git and synchronized folders. Provision private directories/files separately; CLIs do not create directories or relax ACLs. POSIX private directories/files require current-user ownership and no group/other permissions. All ancestors must be owned by the current UID or root, with no group/other write permission. A writable ancestor is accepted only with the sticky bit and a direct child owned by the current UID or root that is not group/other writable; sticky alone is insufficient. This trusts root and the executing UID, not another local user. Windows uses real SID/ACL and full synchronization inventory checks on the complete ancestry and refuses when those checks cannot establish privacy. Symlinks/reparse aliases, Git ancestors, named/environment/registered sync roots and unsafe paths are refused. Scratch cleanup unlinks only a path still matching the generated file's recorded device/inode under validated ancestry; a replacement is preserved and cleanup fails.

Unknown, repeated or missing options, `--name=value`, destination/endpoint/principal/executable/privacy overrides, signing, dispatch and promotion intents are refused. No caller-selected runner, module, executable, endpoint or privacy callback is available in production. Imports perform no I/O. Production constructs the real Tasks 2/3 APIs and `createProductionS3ArchiveStore` with only fixed mode, private scratch and clock.

## Trusted inputs

`inventory.json` is a closed object; jobs/categories are nonempty unique arrays of at most 128 bounded labels. Optional canaries are at most 128 strings of at most 4096 characters. All three mandatory fields are externally pinned:

```json
{
  "sourceInventorySha256": "<independent-descriptor-digest>",
  "expectedJobs": ["build", "cleanup"],
  "requiredCategories": ["logs", "observations"],
  "secretCanaries": ["<optional-offline-inspection-canary>"]
}
```

`contract.json` is closed and has this shape (repeat descriptors/observations for the exact inventory):

```json
{
  "schema": 1,
  "classification": "M1A_ARCHIVE_INPUT",
  "candidate": "<exact-40-lowercase-hex-candidate>",
  "campaignId": "m1a-run",
  "runId": "123",
  "runAttempt": 1,
  "qaAttempt": "a1",
  "completedAt": "2026-09-27T11:00:00.000Z",
  "requiredRetainUntil": "2027-03-26T12:00:00.000Z",
  "members": [{"path":"job.txt","sha256":"<raw-byte-digest>","size":123,"format":"utf8","artifactId":"artifact-1","category":"logs"}],
  "finalObservations": [{"job":"build","conclusion":"failure","cleanupObserved":false,"evidencePath":"job.txt"}],
  "redactionReview": {"reviewerId":"redactor","reviewedAt":"2026-09-27T11:30:00.000Z","sourceInventorySha256":"<independent-descriptor-digest>"}
}
```

The final job set must exactly match external `expectedJobs`; every required category must appear. Extra categories/members are bound by the full contract pin. Success, failure and cancelled conclusions and absent cleanup success are archivable facts, never pass/approval assertions. The source root must contain exactly listed files and necessary directories. Original raw and ZIP bytes remain unchanged. Secret detection is conservative pattern/canary inspection, not proof against obfuscation/steganography. Unsupported binary formats, nested archives and unsupported ZIP metadata require separately reviewed support; there is no permissive flag.

Independent `pinned-expected.json` is closed `{ref,expected}`. The reference must come from a separately trusted pin, never automatically copied from receipt facts by this CLI:

```json
{
  "ref": {"key":"replatform/m1a/m1a-run/123-r1/a1/<archive-sha256>.json","versionId":"<exact-returned-version>"},
  "expected": {
    "contractSha256":"<external-full-contract-digest>","sha256":"<external-bundle-digest>","size":1234,
    "identity":{"candidate":"<40-hex>","campaignId":"m1a-run","runId":"123","runAttempt":1,"qaAttempt":"a1"},
    "requiredRetainUntil":"2027-03-26T12:00:00.000Z",
    "expectedJobs":["build","cleanup"],"requiredCategories":["logs","observations"],
    "secretCanaries":["<optional-canary>"]
  }
}
```

`authority.json` is closed `{expectedAccount:"010438509726",expectedArn:"<externally-approved-distinct-qualified-read-only-principal>",reviewerId:"<independent-reviewer>"}`. No production verifier ARN is invented here. The verifier compares STS identity to this pin, refuses the fixed uploader, rejects stores exposing `put`, and reads only the externally pinned version.

## Canonical algorithms

Inventory and full-contract digests are SHA-256 lowercase hex over their canonical UTF-8 `JSON.stringify` preimages, without formatting whitespace or a final newline. Raw-member digests hash exact original member bytes, including original ZIP bytes. The bundle digest hashes the exact serialized bundle bytes; readback separately requires that serialization to be canonical. Sorting uses `a < b ? -1 : a > b ? 1 : 0` (JavaScript code-unit order), never locale comparison. Input object insertion order is normalized. Strings and validated whole-second/three-fractional-digit UTC timestamps are preserved; different valid timestamp spellings produce different contract pins.

Prepared/expected/facts digests are hex. At the Store boundary, `checksumSha256` is canonical base64 of the SHA-256 digest bytes, compared separately to the service response; it is not base64 of the hex text.

1. Inventory preimage: ALL descriptors, each with keys `path,sha256,size,format,artifactId,category` in that order, sorted by `path`, serialized as an array. No omissions/filtering/extra fields. This excludes redactionReview and is not self-referential. The CLI compares the external inventory digest to both this computed digest and `contract.redactionReview.sourceInventorySha256`.
2. Full contract preimage: root keys `schema,classification,candidate,campaignId,runId,runAttempt,qaAttempt,completedAt,requiredRetainUntil,members,finalObservations,redactionReview`. Members use the complete ordered array above. Observations have keys `job,conclusion,cleanupObserved,evidencePath`, sorted by `job`. Review keys are `reviewerId,reviewedAt,sourceInventorySha256`. Hash the complete serialization, including the redaction declaration, for `--expected-contract-sha256`.
3. Bundle preimage: root keys `format,contractSha256,contract,members`, with format `aoa-m1a-archive-v1`, canonical contract above, and members sorted by path with keys `path,sha256,size,base64`. Base64 encodes exact original bytes. Bundle SHA-256/size bind these bytes. Readback revalidates canonical serialization, size, digest, identity, deadline, jobs/categories and optional canaries; it rejects noncanonical wire bytes and duplicate JSON keys in the bundle.

At most 128 raw members and 64 MiB total raw bytes; canonical bundle ceiling 128 MiB. ZIP inspection uses the fixed isolated standard-library Python helper, with at most 4096 total entries and 64 MiB total inflated bytes, bounded child I/O and timeout. ZIP extra fields and unknown records/flags, aliases, unsafe names, special files and secret-bearing comments/metadata are refused. Standard signed/unsigned data descriptors remain supported.

## Output, errors and uncertain uploads

CLI input JSON is limited to 1 MiB per file before allocation, opened without following symlinks where supported, and checked against held/path identity, size, timestamps and a growth sentinel. Trusted objects/bytes are snapshotted before later asynchronous calls. Output is exclusively reserved as an empty private file, checked with its actual OS FileHandle BEFORE store construction/cloud operations, then written through that handle and flushed/rechecked. No output overwrite or unlink occurs, even on failure. A failed reservation or existing output stops before store creation. A failed later action leaves the reserved file empty or potentially partial; it is never a successful receipt. Preserve diagnostics and use independently reviewed recovery rather than recycling that path.

Exit `0` means verified storage facts only; exit `1` means refusal/I/O failure; exit `2` means syntax/prohibited intent. JSON stdout contains facts or fixed `M1A_COMMAND_REFUSED`/`M1A_SYNTAX` with an optional validated known `{key,versionId}`. Raw source, credentials, transport response/stderr and error causes are never printed. Internal bounded/private read errors include `M1A_INPUT_BOUND`, `M1A_INPUT_CHANGED`, `M1A_INPUT_REFUSED`, `M1A_PATH_REFUSED`, `M1A_OUTPUT_REFUSED`; real Windows refusals remain `M1A_SOURCE_PRIVACY_UNAVAILABLE`/`SCRATCH_PRIVACY_UNAVAILABLE`. Public command failures intentionally coalesce these to a fixed refusal.

One conditional checksum PutObject is attempted, with no retry or latest lookup. Timeout/missing returned version means outcome UNKNOWN, not proof that no object was stored. If S3 returned a validated version before checksum/encryption/readback/cleanup/receipt failure, the diagnostic retains that exact reference; receipt cleanup cannot mask it. Never fabricate a version or retry automatically. Operator recovery must independently reconcile the exact known version or investigate an unknown outcome using separately approved tooling and authorization.

Uploader integrity readback uses only the returned version and service checksum, byte size, AES256 encryption and exact bytes. Retention must be COMPLIANCE and meet both `Head.LastModified + 180*24h` and the original deadline, with no negative tolerance. Ordered actual timestamps are required; five minutes is only put-clock plausibility. Independent review repeats creation-based retention and refuses expiry; it does not add 180 days to review time.

Upload facts status is `uploaded_verified_pending_independent_review`. Independent output is `M1A_ARCHIVE_VERIFICATION` with status `independently_verified_pending_owner_disposition`. Neither carries compliance, gate, campaign-pass or advancement booleans. Uploader readback is integrity checking, not independent certification.

Upload facts have exactly `schema:1,classification:"M1A_ARCHIVE_FACTS",status,destination,identity,contractSha256,sha256,size,uploader,putStartedAt,putCompletedAt,lastModified,retainUntil,requiredRetainUntil`. Destination is `{account,region,bucket,key,versionId}`, uploader is `{account,arn}`, and identity uses `candidate,campaignId,runId,runAttempt,qaAttempt`. This is the `--facts` input shape. Independent output has `classification,status,verifier,reviewerId,verifiedAt,facts`, with verifier `{account,arn}` and the validated upload facts nested unchanged.

## Interface rulings and audit ownership

PreparedArchive remains exactly six facts fields: `bytes,sha256,size,contractSha256,identity,requiredRetainUntil`. Task 3 upload is explicitly `uploadPreparedArchive({store,prepared,expected,now})`; expected job/category policy is supplied externally, never hidden in prepared facts or derived from downloaded evidence. Upload's hash/size/identity/deadline expectations come from validated source preparation; independent review pins these separately.

Task 1 production construction is `createProductionS3ArchiveStore({mode,privateScratch,now})`, wrapping its private fixed AWS runner. Library-only runner/Windows-facts seams are inaccessible through production. Producer errors can carry validated `knownVersionRef` after a returned version, including scratch cleanup failures; Task 3 validates its exact key/version before preserving sanitized `ref`. Missing/invalid versions produce no fabricated diagnostic.

Parent authorized exactly four real-only wrappers: Task 2 `assertPrivateArchiveInputRoot(path)` -> privateRoot and `assertPrivateArchiveInputFile(path)` -> privateStat(path,false); Task 1 `assertPrivateArchiveOutputRoot(path)` -> privateDirectory without inspector and `assertPrivateArchiveOutputFile(path,handle)` -> privateFile without inspector. Extra arguments, including privacy callbacks, are rejected. This narrow export scope plus owning-module tests avoids duplicating the existing ACL/sync logic. Cost if wrong: revise these internal exports/call sites before live use. Ancestor replacement checks remain in these owning modules, with no new privacy helper architecture. Both CLIs share fixed private JSON reading/reservation code in the upload module; only offline command APIs accept the brief's injected capabilities. `writeExclusive(path)` returns `{write(facts),close()}` after successful empty reservation; it is not a delayed post-upload file creation.

Parent also authorized only an ordinary offline PR unit-test step and generated inventory maintenance for the five new archive test files (scripts pinned count 80 -> 85). No gates are removed/weakened, no secrets or AWS/campaign upload integration added. Hash/interface/producer-diagnostic rulings avoid circular inventory hashing, hidden policy fields and lost known versions; cost if wrong is source/API correction before live evidence use, never historical QA edits.

Archive implementation does not implement campaign image admission or post-job collection. Future campaign wiring must separately produce final exact inventory; campaign source/config changes need a new candidate/freeze. Historical QA/handoff records stay byte-identical and no attempt is allocated here. Source tests use synthetic data; Windows memory roundtrip is not source privacy proof, while POSIX CI must execute real prepareArchive source closure.

The implementer authors source and self-review; a separate fresh parent-owned reviewer audits the committed task, then whole-branch review, full pnpm checks and exact-head CI precede integration. Operator evidence-set/redaction approval and distinct read-only review/disposition are separate audit responsibilities; preserve their identity, pins, timestamps and exact version outside Git/sync. No test result or report grants live authorization.
