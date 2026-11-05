import { test, expect, chooseWorkspace } from "./fixtures";
import { resolve } from "node:path";

for (const interrupted of [false, true]) {
  test(
    interrupted
      ? "disconnect during identity revalidation discards all pending input"
      : "session-list refresh gates live input without rejecting or sending it before revalidation",
    async ({ page, context }) => {
      await context.addInitScript(() => {
        const Native = window.WebSocket;
        const feeds: WebSocket[] = [],
          ptys: WebSocket[] = [];
        (window as unknown as { mcTestFeeds: WebSocket[] }).mcTestFeeds = feeds;
        (window as unknown as { mcTestPtys: WebSocket[] }).mcTestPtys = ptys;
        window.WebSocket = class extends Native {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            if (new URL(url).pathname === "/api/events") feeds.push(this);
            if (new URL(url).pathname === "/api/pty") ptys.push(this);
          }
        };
      });
      let hold = false,
        held = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/plugins/multi-chat/pane?**", async (route) => {
        const response = await route.fetch();
        if (hold) {
          held++;
          await gate;
        }
        await route.fulfill({ response });
      });
      try {
        await page.goto("/multi-chat");
        const pane = page.locator('[data-pane="1"]');
        await chooseWorkspace(
          page,
          1,
          resolve(import.meta.dirname, "../../.dev/project-a"),
        );
        await pane
          .getByRole("button", { name: "Start new conversation", exact: true })
          .click();
        await expect(pane).toHaveAttribute("data-session", /.+/);
        await expect(pane.locator(".xterm-rows")).toContainText(/ready[ │]/i);
        const id = await pane.getAttribute("data-session");
        hold = true;
        await page.evaluate(() => {
          const feed = (
            window as unknown as { mcTestFeeds: WebSocket[] }
          ).mcTestFeeds.at(-1)!;
          feed.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ params: { type: "sessions.changed" } }),
            }),
          );
        });
        await expect.poll(() => held).toBeGreaterThan(0);
        const input = pane.getByLabel("Hermes terminal input", { exact: true });
        await input.pressSequentially("MC_REVALIDATED_INPUT", { delay: 20 });
        await expect(pane).toHaveAttribute("data-connection", "connected", {
          timeout: 1000,
        });
        await expect(pane.locator(".xterm-rows")).not.toContainText(
          "MC_REVALIDATED_INPUT",
        );
        if (interrupted) {
          await page.evaluate(() =>
            (window as unknown as { mcTestPtys: WebSocket[] }).mcTestPtys
              .at(-1)!
              .close(),
          );
          await expect(pane).toHaveAttribute("data-connection", "reconnecting");
        }
        hold = false;
        release();
        if (interrupted) {
          await expect(pane).toHaveAttribute("data-connection", "conflict");
          await pane
            .getByRole("button", { name: "Retry attachment", exact: true })
            .click();
          await expect(pane).toHaveAttribute("data-connection", "connected");
          await expect(pane).toHaveAttribute("data-session", id!);
          await expect(pane.locator(".xterm-rows")).not.toContainText(
            "MC_REVALIDATED_INPUT",
          );
        } else {
          await expect(pane.locator(".xterm-rows")).toContainText(
            "MC_REVALIDATED_INPUT",
          );
          await input.press("Control+u");
        }
      } finally {
        hold = false;
        release();
        await page.unrouteAll({ behavior: "wait" });
      }
    },
  );
}
