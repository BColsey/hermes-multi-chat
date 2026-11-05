import type { Page } from "@playwright/test";
import { test, expect, chooseWorkspace } from "./fixtures";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const workspace = (letter: string) => resolve(root, ".dev/project-" + letter);
const pane = (page: Page, index: number) =>
  page.locator(`[data-pane="${index}"]`);
async function start(page: Page, index: number, letter: string) {
  await chooseWorkspace(page, index, workspace(letter));
  await pane(page, index)
    .getByRole("button", { name: "Start new conversation", exact: true })
    .click();
  await expect(pane(page, index)).toHaveAttribute(
    "data-connection",
    "connected",
  );
  await expect(pane(page, index)).toHaveAttribute("data-session", /.+/);
}
async function command(page: Page, index: number, text: string) {
  const input = pane(page, index).getByLabel("Hermes terminal input", {
    exact: true,
  });
  await expect(pane(page, index).locator(".xterm-rows")).toContainText(
    /ready[ │]/i,
  );
  await input.focus();
  await input.pressSequentially(text, { delay: 30 });
  await page.waitForTimeout(350);
  await input.press("Enter");
  if (text === "/help")
    await expect(pane(page, index).locator(".xterm-rows")).toContainText(
      "Ctrl+W",
    );
}
async function end(page: Page, indexes: number[]) {
  for (const i of indexes) {
    if (
      (await pane(page, i).isVisible()) &&
      (await pane(page, i).getAttribute("data-connection")) === "connected"
    ) {
      await command(page, i, "/stop");
      page.once("dialog", (dialog) => dialog.accept());
      await pane(page, i)
        .getByRole("button", { name: "Close view", exact: true })
        .click();
      await expect(pane(page, i)).toHaveAttribute(
        "data-connection",
        "detached",
      );
    }
  }
}
async function shot(page: Page, name: string) {
  await mkdir(resolve(root, "docs/evidence"), { recursive: true });
  await page.screenshot({
    path: resolve(root, `docs/evidence/${name}.png`),
    fullPage: true,
    mask: [page.getByRole("status", { name: /Logged in as/ })],
    maskColor: "#152a2e",
  });
}

test("two/four independent terminals, workspaces, slash input, resizing, maximize and close-view", async ({
  page,
}) => {
  const ptys: Array<{
    channel: string | null;
    attach: string | null;
    cwd: string | null;
  }> = [];
  page.on("websocket", (ws) => {
    const u = new URL(ws.url());
    if (u.pathname === "/api/pty")
      ptys.push({
        channel: u.searchParams.get("channel"),
        attach: u.searchParams.get("attach"),
        cwd: u.searchParams.get("cwd"),
      });
  });
  await page.goto("/multi-chat");
  await expect(
    page
      .locator(".mc-root")
      .getByRole("heading", { name: "Multi Chat", exact: true }),
  ).toBeVisible();
  const selectors = await page.evaluate(() =>
    Array.from(document.styleSheets)
      .filter((s) => s.href?.includes("/multi-chat/"))
      .flatMap((s) => Array.from(s.cssRules))
      .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
      .flatMap((r) => r.selectorText.split(",")),
  );
  expect(selectors.length).toBeGreaterThan(0);
  expect(selectors.every((s) => s.trim().startsWith(".mc-"))).toBe(true);
  await start(page, 1, "a");
  await start(page, 2, "b");
  const ids = await Promise.all(
    [1, 2].map((i) => pane(page, i).getAttribute("data-session")),
  );
  expect(new Set(ids).size).toBe(2);
  expect([...new Set(ptys.map((p) => p.cwd))]).toEqual([
    workspace("a"),
    workspace("b"),
  ]);
  expect(new Set(ptys.map((p) => p.attach)).size).toBe(2);
  expect(new Set(ptys.map((p) => p.channel)).size).toBe(2);
  // An unsubmitted draft must not leak to the other pane.
  await pane(page, 1)
    .getByLabel("Hermes terminal input", { exact: true })
    .pressSequentially("MC_ONLY_A", { delay: 50 });
  await expect(pane(page, 1).locator(".xterm-rows")).toContainText("MC_ONLY_A");
  await expect(pane(page, 2).locator(".xterm-rows")).not.toContainText(
    "MC_ONLY_A",
  );
  await pane(page, 1)
    .getByLabel("Hermes terminal input", { exact: true })
    .press("Control+u");
  await command(page, 1, "/help");
  await expect(pane(page, 1).locator(".xterm-rows")).toContainText(
    /help|commands/i,
  );
  await shot(page, "two-panes");
  await page.getByLabel("Visible panes", { exact: true }).selectOption("4");
  await start(page, 3, "c");
  await start(page, 4, "d");
  expect(
    new Set(
      await Promise.all(
        [1, 2, 3, 4].map((i) => pane(page, i).getAttribute("data-session")),
      ),
    ).size,
  ).toBe(4);
  const connectedSocketCount = ptys.length;
  await page.getByLabel("Visible panes", { exact: true }).selectOption("2");
  await expect(pane(page, 3)).toBeHidden();
  await page.getByLabel("Visible panes", { exact: true }).focus();
  await page.keyboard.press("Alt+Shift+Digit3");
  await expect(pane(page, 3)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Focus pane 3", exact: true }),
  ).toBeFocused();
  expect(ptys).toHaveLength(connectedSocketCount);
  await expect(page.getByLabel("Visible panes", { exact: true })).toHaveValue(
    "3",
  );
  await page.getByLabel("Visible panes", { exact: true }).selectOption("4");
  const terminals = await page
    .locator(".mc-terminal .xterm")
    .evaluateAll((nodes) => {
      nodes.forEach((n, i) =>
        n.setAttribute("data-mc-test-instance", String(i)),
      );
      return nodes.map((n) => n.getAttribute("data-mc-test-instance"));
    });
  await page.getByRole("separator", { name: "Resize columns" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("separator", { name: "Resize columns" }),
  ).toHaveAttribute("aria-valuenow", "52");
  await page.getByRole("separator", { name: "Resize rows" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("separator", { name: "Resize rows" }),
  ).toHaveAttribute("aria-valuenow", "52");
  await page
    .getByRole("button", { name: "Maximize pane 2", exact: true })
    .click();
  await expect(pane(page, 1)).toBeHidden();
  await expect(pane(page, 2)).toBeVisible();
  await page
    .getByRole("button", { name: "Restore pane 2", exact: true })
    .click();
  expect(
    await page
      .locator(".mc-terminal .xterm")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-mc-test-instance")),
      ),
  ).toEqual(terminals);
  expect(ptys).toHaveLength(connectedSocketCount);
  await command(page, 4, "/help");
  await shot(page, "four-panes");
  page.once("dialog", (dialog) => dialog.accept());
  await pane(page, 1)
    .getByRole("button", { name: "Close view", exact: true })
    .click();
  await expect(pane(page, 1)).toHaveAttribute("data-connection", "detached");
  await expect(pane(page, 2)).toHaveAttribute("data-connection", "connected");
  await pane(page, 1)
    .getByRole("button", { name: "Reattach retained terminal", exact: true })
    .click();
  await expect(pane(page, 1)).toHaveAttribute("data-connection", "connected");
  await expect(pane(page, 1)).toHaveAttribute("data-session", ids[0]!);
  await end(page, [1, 2, 3, 4]);
});

test("refresh and PTY socket reconnect preserve identity and do not replay user input", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    const sockets: WebSocket[] = [];
    (window as unknown as { mcTestSockets: WebSocket[] }).mcTestSockets =
      sockets;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (new URL(url).pathname === "/api/pty") sockets.push(this);
      }
    };
  });
  const ptys: Array<{
    attach: string | null;
    channel: string | null;
    sent: string[];
  }> = [];
  page.on("websocket", (ws) => {
    const u = new URL(ws.url());
    if (u.pathname === "/api/pty") {
      const entry = {
        attach: u.searchParams.get("attach"),
        channel: u.searchParams.get("channel"),
        sent: [] as string[],
      };
      ptys.push(entry);
      ws.on("framesent", (e) => {
        if (typeof e.payload === "string") entry.sent.push(e.payload);
      });
    }
  });
  await page.goto("/multi-chat");
  await start(page, 1, "a");
  await command(page, 1, "/help");
  const id = await pane(page, 1).getAttribute("data-session");
  const baselineSockets = ptys.length;
  // Keep identity inspection online: losing HTTP verification intentionally
  // fails closed and may require manual reattachment, unlike a PTY-only drop.
  await page.evaluate(() =>
    (window as unknown as { mcTestSockets: WebSocket[] }).mcTestSockets
      .at(-1)!
      .close(),
  );
  await expect.poll(() => ptys.length).toBe(baselineSockets + 1);
  await expect(pane(page, 1)).toHaveAttribute("data-connection", "connected");
  await page.reload();
  await expect(pane(page, 1)).toHaveAttribute("data-connection", "connected");
  await expect(pane(page, 1)).toHaveAttribute("data-session", id!);
  expect(new Set(ptys.map((p) => p.attach?.split("\0")[0])).size).toBe(1);
  expect(new Set(ptys.map((p) => p.channel)).size).toBe(1);
  expect(ptys).toHaveLength(baselineSockets + 2);
  expect(
    ptys
      .slice(baselineSockets)
      .flatMap((p) => p.sent)
      .filter(
        (s) =>
          !/^(?:\x1b\[RESIZE:\d+;\d+\]|\x1b\[[?>0-9;]*c|\x1b\[[IO]|\x1b\](?:10|11);rgb:[0-9a-f/]+\x1b\\)$/i.test(
            s,
          ),
      ),
  ).toEqual([]);
  await end(page, [1]);
});

test("duplicated tab with cloned sessionStorage and no Web Locks cannot take over", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    });
  });
  await page.goto("/multi-chat");
  const securityContext = await page.evaluate(() =>
    window.isSecureContext ? "secure (loopback/HTTPS)" : "insecure HTTP",
  );
  test.info().annotations.push({
    type: "security-context",
    description: securityContext,
  });
  expect(await page.evaluate(() => navigator.locks)).toBeUndefined();
  await start(page, 1, "a");
  const id = await pane(page, 1).getAttribute("data-session");
  const clone = await page.evaluate(() =>
    sessionStorage.getItem("hermes.multi-chat.default.v1"),
  );
  const duplicate = await context.newPage();
  let duplicatePtys = 0;
  duplicate.on("websocket", (ws) => {
    if (new URL(ws.url()).pathname === "/api/pty") duplicatePtys++;
  });
  await duplicate.goto("/");
  await duplicate.evaluate(
    (value) => sessionStorage.setItem("hermes.multi-chat.default.v1", value!),
    clone,
  );
  await duplicate.goto("/multi-chat");
  await expect(pane(duplicate, 1)).toHaveAttribute(
    "data-connection",
    "conflict",
  );
  expect(duplicatePtys).toBe(0);
  await expect(pane(page, 1)).toHaveAttribute("data-session", id!);
  await expect(pane(page, 1)).toHaveAttribute("data-connection", "connected");
  await command(page, 1, "/help");
  await duplicate.close();
  await end(page, [1]);
});

test("existing session conflict focuses the original pane instead of a second writer", async ({
  page,
}) => {
  let count = 0;
  page.on("websocket", (ws) => {
    if (new URL(ws.url()).pathname === "/api/pty") count++;
  });
  await page.goto("/multi-chat");
  await start(page, 1, "a");
  const baselineSockets = count;
  const id = await pane(page, 1).getAttribute("data-session");
  await pane(page, 2)
    .getByLabel("Session ID for pane 2", { exact: true })
    .fill(id!);
  await pane(page, 2)
    .getByRole("button", { name: "Resume conversation", exact: true })
    .click();
  await expect(
    page.getByText("That conversation is already selected.", { exact: false }),
  ).toBeVisible();
  expect(count).toBe(baselineSockets);
  await expect(pane(page, 1)).toHaveClass(/mc-focused/);
  await end(page, [1]);
});

test("narrow viewport remains keyboard-usable without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto("/multi-chat");
  await page.getByLabel("Visible panes", { exact: true }).selectOption("4");
  await expect(pane(page, 4)).toBeVisible();
  expect(
    await page
      .locator(".mc-root")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await start(page, 1, "a");
  await command(page, 1, "/help");
  await page.locator(".mc-root h1").scrollIntoViewIfNeeded();
  await shot(page, "narrow-viewport");
  await end(page, [1]);
});
