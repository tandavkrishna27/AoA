import { readStagedInputPointers } from "../lease/staged-input.js";

/** The existing staged-input pointer and provider receipt are both required.
 * No payload bytes pass through the daemon. The provider verified their hashes. */
export function serviceCheckpointWasStaged(
  workload: { serviceId: string; generation: number; checkpointArtifactId: string | null },
  extensions: unknown, stagedPaths: readonly string[],
): boolean {
  if (workload.checkpointArtifactId === null) return true;
  const prefix = `/tmp/aoa-service-state/${workload.serviceId}/`;
  const marker = `${prefix}.aoa-checkpoint-${workload.checkpointArtifactId}-${workload.generation}.json`;
  const pointers = readStagedInputPointers(extensions).filter((pointer) => pointer.path.startsWith(prefix));
  if (!pointers.some((pointer) => pointer.path === marker) || pointers.length < 2) return false;
  return pointers.every((pointer) => stagedPaths.includes(pointer.path));
}
