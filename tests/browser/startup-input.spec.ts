import { test, expect } from "./fixtures";
import { resolve } from "node:path";

test("early input cannot lose its slash prefix and become a partial prompt", async ({
  page,
}) => {
  let publishIdentity = false;
  let sessionId = "";
  // The real PTY boots normally; simulate only a delayed identity publication.
  await page.route("**/api/plugins/multi-chat/pane?**", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    if (state.retained && state.session_id) sessionId = state.session_id;
    if (!publishIdentity && state.retained) state.session_id = null;
    await route.fulfill({ response, json: state });
  });
  await page.goto("/multi-chat");
  const pane = page.locator('[data-pane="1"]');
  await pane
    .getByLabel("Workspace for pane 1", { exact: true })
    .fill(resolve(import.meta.dirname, "../../.dev/project-a"));
  await pane
    .getByRole("button", { name: "Start new conversation", exact: true })
    .click();
  await expect(pane).toHaveAttribute("data-connection", "connecting");
  await expect(pane.locator(".xterm-rows")).toContainText(/ready[ │]/i);
  await expect(pane).toContainText("Verifying terminal identity");
  await expect.poll(() => sessionId).not.toBe("");
  await pane.getByLabel("Hermes terminal input", { exact: true }).press("/");
  await expect(pane).toContainText(
    "Input arrived before session identity was verified",
    { timeout: 3000 },
  );
  await expect(pane).toHaveAttribute("data-connection", "conflict");
  publishIdentity = true;
  await pane
    .getByLabel("Hermes terminal input", { exact: true })
    .pressSequentially("help", { delay: 40 });
  await pane
    .getByLabel("Hermes terminal input", { exact: true })
    .press("Enter");
  await pane
    .getByRole("button", { name: "Retry attachment", exact: true })
    .click();
  await expect(pane).toHaveAttribute("data-session", sessionId);
  await expect(pane).toHaveAttribute("data-connection", "connected");
  await expect(pane.locator(".xterm-rows")).not.toContainText("processing…");
  const messages = await (
    await page.request.get(
      `/api/sessions/${sessionId}/messages?profile=default`,
    )
  ).json();
  expect(
    messages.messages.filter(
      (message: { role: string }) => message.role === "user",
    ),
  ).toEqual([]);
});
