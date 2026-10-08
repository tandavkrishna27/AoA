import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { acquireSlotOwnership } from "../identity/slot-ownership.js";
import { provisionSlot } from "../identity/slot-binding.js";

/** Explicit trusted-operator action; boot never calls this to replace missing bindings. */
export async function runProvisionSlot(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    "binding-dir": { type: "string" }, "slot-id": { type: "string" },
    "organization-id": { type: "string" }, "target-id": { type: "string" },
  } });
  if (!values["binding-dir"] || !values["slot-id"] || !values["organization-id"] || !values["target-id"]) {
    throw new Error("slot provisioning requires binding-dir, slot-id, organization-id and target-id");
  }
  const ownership = await acquireSlotOwnership([values["binding-dir"]]);
  try {
    await provisionSlot({ bindingDir: values["binding-dir"], slotId: values["slot-id"],
      organizationId: values["organization-id"], targetId: values["target-id"] });
  } finally { await ownership.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProvisionSlot(process.argv.slice(2)).then(() => {
    process.stdout.write("Fresh slot provisioned. Existing worker state was not adopted.\n");
  }).catch(() => { process.stderr.write("Slot provisioning refused; verify input and existing binding.\n"); process.exitCode = 1; });
}
