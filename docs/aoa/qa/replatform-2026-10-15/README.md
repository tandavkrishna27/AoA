# Replatform testing — 15 October 2026

Tested application revision: `13b4e806f31a67c3c172f2216272570203132f8f`. This branch adds documentation and evidence only.

Start with the [detailed report](REPLATFORM-TEST-REPORT.txt), or download this directory and open the [HTML report](REPLATFORM-TEST-REPORT.html) for linked navigation. The [short summary](TEST-RESULTS.txt) and [structured report](REPLATFORM-TEST-REPORT.json) are also included.

The report covers 33 test groups, 20 gate/ticket mapping rows, 23 pending-work rows and 16 findings. Both installations were healthy at the last recorded check. Release acceptance remains open. No full release gate or epic was formally closed by this session.

Read the findings and pending-work tables before treating passing component checks as milestone acceptance. Original failures and later reruns are both retained. The complete normal Node 24 suite failed; the Windows integration lane also had failures and a final reporting interruption. Its complete decoded per-file log is included, with the limitations documented in the report.

Logs and structured evidence are bundled under their original relative paths. Credentials, private configuration, databases, source archives and toolchains are excluded. Credential-pattern matches, including synthetic fixture values, are replaced with explicit REDACTED markers; no source evidence outside this package was altered. The [package manifest](PACKAGE-MANIFEST.json) records source and packaged hashes, exclusions, redaction counts and the link check. Screenshots were visually inspected. Paths and timestamps inside logs describe the original test hosts.

No application code changed in this handoff. Typecheck, build and test outcomes are the recorded results in the report; these suites were not rerun for this documentation-only packaging step.
