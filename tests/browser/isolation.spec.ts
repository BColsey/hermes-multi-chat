import type { Page } from "@playwright/test";
import { test, expect, chooseWorkspace } from "./fixtures";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const pane = (page: Page, i: number) => page.locator(`[data-pane="${i}"]`);
async function start(page: Page, i: number, letter: string) {
  await chooseWorkspace(page, i, resolve(root, ".dev/project-" + letter));
  await pane(page, i)
    .getByRole("button", { name: "Start new conversation", exact: true })
    .click();
  await expect(pane(page, i)).toHaveAttribute("data-session", /.+/);
  await expect(pane(page, i).locator(".xterm-rows")).toContainText(
    /ready[ │]/i,
  );
}
async function command(page: Page, i: number, text: string) {
  const input = pane(page, i).getByLabel("Hermes terminal input", {
    exact: true,
  });
  await input.focus();
  await input.pressSequentially(text, { delay: 40 });
  await page.waitForTimeout(350);
  await input.press("Enter");
}

test("native TUI resume into an already-viewed conversation blocks the second input path", async ({
  page,
}) => {
  await page.goto("/multi-chat");
  await start(page, 1, "a");
  await start(page, 2, "b");
  const id = await pane(page, 2).getAttribute("data-session");
  await command(page, 1, "/resume " + id);
  await expect(pane(page, 1)).toHaveAttribute("data-connection", "conflict");
  await expect(pane(page, 2)).toHaveAttribute("data-connection", "connected");
  await expect(pane(page, 2)).toHaveClass(/mc-focused/);
  await command(page, 2, "/help");
  await expect(pane(page, 2).locator(".xterm-rows")).toContainText(/commands/i);
});

test("loss of the actual disposable PTY never becomes refresh permission to spawn another", async ({
  page,
}) => {
  const channels: string[] = [];
  page.on("websocket", (ws) => {
    const u = new URL(ws.url());
    if (u.pathname === "/api/pty")
      channels.push(u.searchParams.get("channel")!);
  });
  await page.goto("/multi-chat");
  await start(page, 1, "a");
  const id = await pane(page, 1).getAttribute("data-session");
  const count = channels.length;
  // Identify exactly one disposable UI by UID, executable, isolated HERMES_HOME,
  // dashboard flag and its random channel. Never infer identity from argv text.
  const code = `import os, pathlib, signal, sys, urllib.parse
home, channel = sys.argv[1:]
matches=[]
for proc in pathlib.Path('/proc').iterdir():
 if not proc.name.isdigit(): continue
 try:
  if proc.stat().st_uid != os.getuid() or (proc/'exe').resolve().name != 'node': continue
  env=dict(v.partition(b'=')[::2] for v in (proc/'environ').read_bytes().split(b'\\0') if b'=' in v)
  if env.get(b'HERMES_HOME',b'').decode() != home or env.get(b'HERMES_TUI_DASHBOARD') != b'1': continue
  url=env.get(b'HERMES_TUI_SIDECAR_URL',b'').decode()
  if urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get('channel') == [channel]: matches.append(int(proc.name))
 except (OSError,ValueError): continue
if len(matches) != 1: raise SystemExit('Expected exactly one disposable terminal; killed none')
os.kill(matches[0], signal.SIGKILL)
print('One disposable TUI stopped')`;
  expect(
    execFileSync(
      "python3",
      ["-c", code, resolve(root, ".dev/user/.hermes"), channels[0]],
      { encoding: "utf8" },
    ).trim(),
  ).toBe("One disposable TUI stopped");
  await expect(pane(page, 1)).toHaveAttribute("data-connection", "ended");
  await page.reload();
  await expect(pane(page, 1)).toHaveAttribute("data-connection", "conflict");
  await expect(pane(page, 1)).toHaveAttribute("data-session", id!);
  expect(channels).toHaveLength(count);
  await expect(pane(page, 1)).toContainText("No replacement was spawned");
});
