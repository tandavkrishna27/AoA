# Historical proposal archive

This archive preserves abandoned PR610/PR615 originals and PR632 corrections. It is NOT QA certification, a handoff, a candidate pass, or a new canonical certification chain. Embedded PASS labels are withdrawn/non-adopted by the external [disposition](disposition.md); source text is deliberately unchanged.

## Scoped implementation plan

1. Start isolated branch `codex/m1a-historical-qa-archive` at verified `origin/docs/replatform-program` commit `0510d482798e62672a8f6085915231c5f8578e87`.
2. Copy ten structured Markdown records from PR615 head and eight corrections from PR632 head, byte for byte, exclusively into this history directory. Check eight shared originals against PR610. Generate a provenance manifest with exact source paths, heads, Git blobs and content SHA-256 values.
3. Assess all eleven PR610/615 findings and both PR632 findings separately. Explicitly grade H-01 through H-10, EVID-01 through EVID-04 and RET-01; unknown required evidence fails. Allocate no attempts and change no canonical evidence.
4. Verify all eighteen copies, all 85 base immutable records, docs-only additions, unchanged canonical ordering, the immutability guard and whitespace. Commit locally for fresh independent parent review before publication.

## Navigation and authority

- [Provenance manifest](manifest.json): machine-readable source and copy pins, including shared PR610 matches.
- [Corrective disposition](disposition.md): non-adoption, requirements, review findings and closure conditions.
- `pr610-pr615/originals/`: ten original records from `af3ca5ceb49f7bcb7d7012ab8f100d5e38894f1d`.
- `pr632/corrections/`: eight historical correction proposals from `762d5e48172e951ec012aadf7b08e6ff38330966`.

The copies are mirrors, not moves. Original paths remain on the retained original branches. Embedded Record path, Attempt and Supersedes fields describe those source proposals; they do not enroll these mirrors in the canonical ledger. Relative links and original paths inside mirrors are historical text, not authoritative navigation; use the manifest for resolution. No records are introduced under any `qa/` directory.

The active global attempt ordering and predecessor links remain unchanged. Higher attempts published in abandoned proposals remain proposal history, not an adopted successor chain. For any future canonical allocation, the owner must recheck the maximum published ordinal across retained local/remote proposals as well as the active ledger, avoid reuse, and freeze the candidate and allocation before execution/commit. This archive reserves no number and does not repair ordering by renumbering history.

PR610, PR615 and PR632 may close only after the independently reviewed replacement has landed; retain their branches and first-committed records. This local implementation neither closes nor publishes them. PR631 is separate parent-owned work at reported `0cf` head with CI pending; this archive grants it no clearance.
