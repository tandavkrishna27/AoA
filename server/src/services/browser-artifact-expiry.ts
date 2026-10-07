import { BROWSER_ARTIFACT_KINDS, CREDENTIAL_BEARING_ARTIFACT_KINDS } from "./browser-artifact-retention.js";

/** Control-plane lifetimes, measured from commit. The five-minute minimum
 * outlasts every upload URL minted before commit (the maximum grant TTL).
 * Non-browser artifacts retain their current policy. */
export function browserArtifactLifetimeSeconds(kind: string): number | null {
  if ((CREDENTIAL_BEARING_ARTIFACT_KINDS as readonly string[]).includes(kind)) return 300;
  if ((BROWSER_ARTIFACT_KINDS as readonly string[]).includes(kind)) return 86_400;
  return null;
}
