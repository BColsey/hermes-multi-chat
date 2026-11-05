import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
type AuthState = Awaited<ReturnType<APIRequestContext["storageState"]>>;
/** One real password login per worker, not one per test: respect Hermes's
 * 10/minute login limit. Session cookies remain in memory; never record traces
 * or serialize this fixture to an evidence file. */
export const test = base.extend<
  Record<never, never>,
  { loginState: AuthState }
>({
  loginState: [
    async ({ playwright }, use, info) => {
      const root = resolve(import.meta.dirname, "../..");
      const request = await playwright.request.newContext({
        baseURL: String(info.project.use.baseURL),
      });
      const health = await (await request.get("/api/health")).json();
      expect(
        health.auth_required,
        "Integration tests require a gated disposable dashboard; bind a non-loopback address (see docs/development.md).",
      ).toBe(true);
      const credentials = JSON.parse(
        await readFile(resolve(root, ".dev/login.json"), "utf8"),
      );
      expect(
        (
          await request.post("/auth/password-login", { data: credentials })
        ).status(),
      ).toBe(200);
      expect((await request.get("/api/auth/me")).status()).toBe(200);
      const profiles = await (await request.get("/api/profiles")).json();
      expect(
        profiles.profiles.find((p: { name: string }) => p.name === "default")
          ?.path,
      ).toBe(resolve(root, ".dev/user/.hermes"));
      await use(await request.storageState());
      await request.dispose();
    },
    { scope: "worker" },
  ],
  storageState: async ({ loginState }, use) => {
    await use(loginState);
  },
});
export async function chooseWorkspace(page: Page, pane: number, path: string) {
  await page
    .getByLabel(`Project for pane ${pane}`, { exact: true })
    .selectOption("__custom__");
  await page
    .getByLabel(`Workspace for pane ${pane}`, { exact: true })
    .fill(path);
}
export { expect };
