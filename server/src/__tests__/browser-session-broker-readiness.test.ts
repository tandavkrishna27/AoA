import { describe, expect, it } from "vitest";
import { createBrowserSessionCredentialBroker } from "../services/browser-session-credentials.js";
describe("browser session broker readiness", () => {
  it("refuses an unavailable encryption key before creating a guest request", async () => {
    const prior = process.env.AOA_SECRETS_MASTER_KEY;
    process.env.AOA_SECRETS_MASTER_KEY = "invalid-key";
    try {
      const broker = createBrowserSessionCredentialBroker({
        appDb: {} as any,
        identityDb: {} as any,
        storage: {} as any,
        publicOrigin: "https://control.example",
        signingKey: "s".repeat(64),
      });
      await expect(broker.assertReady()).rejects.toThrow(
        "encryption unavailable"
      );
    } finally {
      if (prior === undefined) delete process.env.AOA_SECRETS_MASTER_KEY;
      else process.env.AOA_SECRETS_MASTER_KEY = prior;
    }
  });
  it.each(["http://control.example", "https://control.example/path"])(
    "refuses native transport origin %s",
    (publicOrigin) =>
      expect(() =>
        createBrowserSessionCredentialBroker({
          appDb: {} as any,
          identityDb: {} as any,
          storage: {} as any,
          publicOrigin,
          signingKey: "s".repeat(64),
        })
      ).toThrow()
  );
});
