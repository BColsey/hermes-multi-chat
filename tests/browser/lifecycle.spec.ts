import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { readFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const pane = (page: Page, i: number) => page.locator(`[data-pane="${i}"]`);
async function cmd(page: Page, i: number, text: string) {
  const input = pane(page, i).getByLabel("Hermes terminal input", {
    exact: true,
  });
  await expect(pane(page, i).locator(".xterm-rows")).toContainText(
    /ready[ │]/i,
  );
  await input.focus();
  await input.pressSequentially(text, { delay: 30 });
  await page.waitForTimeout(350);
  await input.press("Enter");
  if (text === "/help")
    await expect(pane(page, i).locator(".xterm-rows")).toContainText("Ctrl+W");
}
async function start(page: Page, i: number, letter: string) {
  await pane(page, i)
    .getByLabel(`Workspace for pane ${i}`, { exact: true })
    .fill(resolve(root, ".dev/project-" + letter));
  await pane(page, i)
    .getByRole("button", { name: "Start new conversation", exact: true })
    .click();
  await expect(pane(page, i)).toHaveAttribute("data-session", /.+/);
}
async function detach(page: Page, i: number) {
  page.once("dialog", (d) => d.accept());
  await pane(page, i)
    .getByRole("button", { name: "Close view", exact: true })
    .click();
}

test("resume keeps workspace/title; native /new confirmation, identity and refresh stay correct", async ({
  page,
}) => {
  await page.goto("/multi-chat");
  await start(page, 1, "a");
  const original = await pane(page, 1).getAttribute("data-session");
  const title = "Multi Chat disposable " + original!.slice(-8);
  await cmd(page, 1, "/title " + title);
  await expect(pane(page, 1).locator(".mc-title")).toHaveText(title);
  await detach(page, 1);
  await pane(page, 1)
    .getByRole("button", { name: "Choose another conversation", exact: true })
    .click();
  await pane(page, 2)
    .getByLabel("Workspace for pane 2", { exact: true })
    .fill(resolve(root, ".dev/project-b"));
  await pane(page, 2)
    .getByLabel("Session ID for pane 2", { exact: true })
    .fill(original!);
  page.once("dialog", (d) => d.accept());
  await pane(page, 2)
    .getByRole("button", { name: "Resume conversation", exact: true })
    .click();
  await expect(pane(page, 2)).toHaveAttribute("data-connection", "connected");
  await expect(pane(page, 2).locator(".mc-workspace")).toHaveText(
    resolve(root, ".dev/project-a"),
  );
  await expect(pane(page, 2).locator(".mc-title")).toHaveText(title);
  await cmd(page, 2, "/new");
  await expect(pane(page, 2).locator(".xterm-rows")).toContainText(
    /Start a new session/,
  );
  const input = pane(page, 2).getByLabel("Hermes terminal input", {
    exact: true,
  });
  await input.press("y");
  await expect(pane(page, 2)).not.toHaveAttribute("data-session", original!);
  const next = await pane(page, 2).getAttribute("data-session");
  expect(next).toBeTruthy();
  await page.reload();
  await expect(pane(page, 2)).toHaveAttribute("data-connection", "connected");
  await expect(pane(page, 2)).toHaveAttribute("data-session", next!);
  await cmd(page, 2, "/help");
  await expect(pane(page, 2).locator(".xterm-rows")).toContainText(/commands/i);
  await detach(page, 2);
});

test("model changes are session-scoped and do not write the profile default", async ({
  page,
}) => {
  const before = await readFile(
    resolve(root, ".dev/user/.hermes/config.yaml"),
    "utf8",
  );
  await page.goto("/multi-chat");
  await start(page, 1, "a");
  await start(page, 2, "b");
  await cmd(page, 1, "/model custom:development-other --session");
  await expect(pane(page, 1).locator(".mc-terminal-toolbar")).toContainText(
    "development-other",
  );
  await expect(pane(page, 2).locator(".mc-terminal-toolbar")).toContainText(
    "development-no-inference",
  );
  expect(
    await readFile(resolve(root, ".dev/user/.hermes/config.yaml"), "utf8"),
  ).toBe(before);
  await detach(page, 1);
  await detach(page, 2);
});

test("password gate, PTY ticket requirement and single-use SDK tickets remain enforced", async ({
  page,
  playwright,
  baseURL,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  expect((await anonymous.get("/api/sessions?profile=default")).status()).toBe(
    401,
  );
  expect((await anonymous.post("/api/auth/ws-ticket")).status()).toBe(401);
  expect(
    (
      await anonymous.get(
        "/api/plugins/multi-chat/pane?profile=default&channel=mc-" +
          "a".repeat(32) +
          "&attachment=" +
          "a".repeat(32),
      )
    ).status(),
  ).toBe(401);
  await anonymous.dispose();
  await page.goto("/multi-chat");
  const result = await page.evaluate(async () => {
    const open = (url: string) =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(url);
        const t = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 5000);
        ws.onopen = () => {
          clearTimeout(t);
          ws.close();
          resolve(true);
        };
        ws.onerror = () => {
          clearTimeout(t);
          resolve(false);
        };
        ws.onclose = () => {
          clearTimeout(t);
          resolve(false);
        };
      });
    const sdk = window.__HERMES_PLUGIN_SDK__!;
    const url = await sdk.buildWsUrl("/api/events", {
      channel: "multi-chat-auth-test",
    });
    const first = await open(url),
      reused = await open(url);
    const missing = await open(
      location.origin.replace(/^http/, "ws") +
        "/api/pty?channel=multi-chat-auth-test",
    );
    return { first, reused, missing };
  });
  expect(result).toEqual({ first: true, reused: false, missing: false });
});

test("disabling and removing the plugin restore navigation; Normal Chat and history remain", async ({
  page,
}) => {
  await page.goto("/multi-chat");
  await start(page, 1, "a");
  const id = await pane(page, 1).getAttribute("data-session");
  await detach(page, 1);
  const config = await (
    await page.request.get("/api/config?profile=default&include_defaults=false")
  ).json();
  const saved = {
    enabled: config.plugins?.enabled ?? [],
    disabled: config.plugins?.disabled ?? [],
  };
  const installed = resolve(root, ".dev/user/.hermes/plugins/multi-chat"),
    parked = resolve(root, ".dev/removed-multi-chat");
  let moved = false;
  try {
    const disabled = {
      enabled: saved.enabled.filter((s: string) => s !== "multi-chat"),
      disabled: [...new Set([...saved.disabled, "multi-chat"])],
    };
    expect(
      (
        await page.request.put("/api/config?profile=default", {
          data: { profile: "default", config: { plugins: disabled } },
        })
      ).status(),
    ).toBe(200);
    await page.goto("/sessions");
    await expect(
      page.getByRole("link", { name: "Multi Chat", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.get(
          "/api/plugins/multi-chat/pane?profile=default&channel=mc-" +
            "a".repeat(32) +
            "&attachment=" +
            "a".repeat(32),
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.get(
          "/api/sessions/" + encodeURIComponent(id!) + "?profile=default",
        )
      ).status(),
    ).toBe(200);
    await rename(installed, parked);
    moved = true;
    await page.request.get("/api/dashboard/plugins/rescan?profile=default");
    await page.goto("/chat");
    await expect(
      page.getByRole("link", { name: "Multi Chat", exact: true }),
    ).toHaveCount(0);
    const input = page.locator(".xterm-helper-textarea");
    await expect(input).toBeVisible();
    await expect(page.locator(".xterm-rows")).toContainText(/ready|Session:/i);
    await input.focus();
    await input.pressSequentially("/help", { delay: 40 });
    await page.waitForTimeout(350);
    await input.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("Ctrl+W");
    expect(
      (
        await page.request.get(
          "/api/sessions/" + encodeURIComponent(id!) + "?profile=default",
        )
      ).status(),
    ).toBe(200);
  } finally {
    if (moved) await rename(parked, installed);
    await page.request.put("/api/config?profile=default", {
      data: { profile: "default", config: { plugins: saved } },
    });
    await page.request.get("/api/dashboard/plugins/rescan?profile=default");
  }
  await page.goto("/multi-chat");
  await expect(
    page
      .locator(".mc-root")
      .getByRole("heading", { name: "Multi Chat", exact: true }),
  ).toBeVisible();
});
