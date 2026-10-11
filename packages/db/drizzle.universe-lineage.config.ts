import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./dist/schema/*.js",
  out: "./src/migrations/lineages/universe",
  dialect: "postgresql",
});
