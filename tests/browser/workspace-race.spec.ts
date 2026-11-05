import { test, expect } from "./fixtures";
import { resolve } from "node:path";
test("late real workspace discovery does not write into an editing pane", async ({
  page,
}) => {
  const root = resolve(import.meta.dirname, "../..");
  let deliver!: () => void;
  const gate = new Promise<void>((r) => {
    deliver = r;
  });
  await page.route("**/api/chat/workspaces?profile=default", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto("/multi-chat");
  const picker = page.getByLabel("Project for pane 1", { exact: true });
  await expect(picker).toHaveAttribute("aria-busy", "true");
  await picker.selectOption("__custom__");
  const field = page.getByLabel("Workspace for pane 1", { exact: true });
  await field.focus();
  await field.fill("");
  deliver();
  await page.waitForResponse("**/api/chat/workspaces?profile=default");
  await expect(field).toHaveValue("");
  await expect(picker).toHaveValue("__custom__");
  const intended = resolve(root, ".dev/project-b");
  await field.pressSequentially(intended, { delay: 5 });
  await expect(field).toHaveValue(intended);
});
