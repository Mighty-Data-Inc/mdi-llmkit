import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const DIST_GPTAPI_INDEX = path.resolve("dist/src/gptApi/index.js");
const DIST_JSON_SURGERY = path.resolve("dist/src/jsonSurgery/jsonSurgery.js");

beforeAll(() => {
  if (!existsSync(DIST_GPTAPI_INDEX) || !existsSync(DIST_JSON_SURGERY)) {
    execSync("npm run build", { stdio: "inherit" });
  }
});

describe("package subpath exports", () => {
  it("declares gptApi and jsonSurgery in package exports", async () => {
    const packageJsonPath = path.resolve("package.json");
    const packageJsonRaw = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonRaw) as {
      exports?: Record<string, { types?: string; import?: string }>;
    };

    expect(packageJson.exports?.["./gptApi"]).toBeDefined();
    expect(packageJson.exports?.["./gptApi"]?.types).toBe(
      "./dist/src/gptApi/index.d.ts",
    );
    expect(packageJson.exports?.["./gptApi"]?.import).toBe(
      "./dist/src/gptApi/index.js",
    );

    expect(packageJson.exports?.["./jsonSurgery"]).toBeDefined();
    expect(packageJson.exports?.["./jsonSurgery"]?.types).toBe(
      "./dist/src/jsonSurgery/jsonSurgery.d.ts",
    );
    expect(packageJson.exports?.["./jsonSurgery"]?.import).toBe(
      "./dist/src/jsonSurgery/jsonSurgery.js",
    );
  });

  it('imports GPT API symbols from "mdi-llmkit/gptApi"', async () => {
    const mod = await import("mdi-llmkit/gptApi");

    expect(typeof mod.gptSubmit).toBe("function");
    expect(typeof mod.GptConversation).toBe("function");
    expect(typeof mod.JSONSchemaFormat).toBe("function");
  });

  it('imports jsonSurgery symbols from "mdi-llmkit/jsonSurgery"', async () => {
    const mod = await import("mdi-llmkit/jsonSurgery");

    expect(typeof mod.jsonSurgery).toBe("function");
    expect(typeof mod.JSONSurgeryError).toBe("function");
  });
});
