import { isOwnedLabelsCapabilityShape, type OwnedLabelsCapabilityLike } from "./owned-labels-capability.js";

export const OWNED_LABELS_CAPABILITY_EXTENSION_NAMESPACE = "aoa.dev/owned-labels-capability";

/** Shape only: the adapter-manager verifies the signature at every provider
 * operation. A present unreadable token cannot be treated as a successful refresh. */
export function readRenewedOwnedLabelsCapability(extensions: readonly unknown[] | undefined): OwnedLabelsCapabilityLike | null {
  const matches = (extensions ?? []).filter((entry) => typeof entry === "object" && entry !== null &&
    (entry as Record<string, unknown>).namespace === OWNED_LABELS_CAPABILITY_EXTENSION_NAMESPACE);
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new Error("ambiguous renewed owned-labels capability");
  const extension = matches[0] as Record<string, unknown>;
  const cap = extension.value;
  if (extension.schemaVersion !== 1 || extension.critical !== false || !isOwnedLabelsCapabilityShape(cap) ||
      cap.v !== 1 || cap.audience !== "adapter-manager" || !Number.isSafeInteger(cap.expiresAt) || cap.expiresAt <= 0 ||
      cap.sig.length === 0 || cap.sig.length > 256 || !Number.isSafeInteger(cap.ownedLabels.attempt) || cap.ownedLabels.attempt < 1 ||
      !Number.isSafeInteger(cap.ownedLabels.deviceGeneration) || cap.ownedLabels.deviceGeneration < 1) {
    throw new Error("malformed renewed owned-labels capability");
  }
  return cap;
}
