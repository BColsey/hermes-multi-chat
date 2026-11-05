import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const workspace = (letter: string) => resolve(root, ".dev/project-" + letter);

async function projectList(page: Page) {
  await page.route("**/api/chat/workspaces?profile=default", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        projects: [
          {
            name: "Picker project",
            archived: false,
            folders: [
              { path: workspace("a"), label: "Main" },
              { path: workspace("b"), label: "Secondary" },
            ],
          },
          {
            name: "Archived picker project",
            archived: true,
            folders: [{ path: workspace("c"), label: null }],
          },
        ],
      },
    });
  });
}

test("projects are a keyboard-accessible dropdown with names and per-pane choices", async ({
  page,
}) => {
  await projectList(page);
  let ptys = 0;
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/api/pty") ptys++;
  });
  await page.goto("/multi-chat");
  const picker = page.getByLabel("Project for pane 1", { exact: true });
  await expect(picker).toBeVisible({ timeout: 3000 });
  await expect(picker).toHaveJSProperty("tagName", "SELECT");
  await expect(
    picker.locator(`option[value="${workspace("b")}"]`),
  ).toContainText("Picker project · Secondary");
  expect(
    (await picker.locator("option").allTextContents()).join("\n"),
  ).not.toContain("Archived picker project");
  await expect(picker).toHaveValue("");
  await picker.selectOption(workspace("b"));
  await expect(page.locator('[data-pane="1"] .mc-workspace')).toHaveText(
    workspace("b"),
  );
  await expect(
    page.getByLabel("Project for pane 2", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByLabel("Workspace for pane 1", { exact: true }),
  ).toHaveCount(0);
  await picker.focus();
  await page.keyboard.press("Home");
  await expect(picker).toHaveValue("");
  await page.keyboard.press("ArrowDown");
  await expect(picker).toHaveValue(workspace("a"));
  await picker.selectOption(workspace("b"));
  await page.reload();
  await expect(picker).toHaveValue(workspace("b"));
  await page.setViewportSize({ width: 430, height: 980 });
  await expect(picker).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(ptys).toBe(0);
});

test("other-folder selection stays editable and survives refresh without starting a conversation", async ({
  page,
}) => {
  await projectList(page);
  await page.goto("/multi-chat");
  const picker = page.getByLabel("Project for pane 1", { exact: true });
  await expect(picker).toBeVisible();
  await picker.selectOption("__custom__");
  const field = page.getByLabel("Workspace for pane 1", { exact: true });
  const custom = resolve(root, ".dev/unlisted-picker-folder");
  await field.fill(custom);
  await page.reload();
  await expect(picker).toHaveValue("__custom__");
  await expect(field).toHaveValue(custom);
  await picker.selectOption(workspace("a"));
  await expect(field).toHaveCount(0);
  await expect(page.locator('[data-pane="1"] .mc-workspace')).toHaveText(
    workspace("a"),
  );
  await expect(page.locator('[data-pane="1"]')).toHaveAttribute(
    "data-connection",
    "empty",
  );
});

test("choosing a project starts the real TUI in that project's folder", async ({
  page,
}) => {
  await projectList(page);
  const requested: Array<string | null> = [];
  page.on("websocket", (socket) => {
    const url = new URL(socket.url());
    if (url.pathname === "/api/pty")
      requested.push(url.searchParams.get("cwd"));
  });
  await page.goto("/multi-chat");
  await page
    .getByLabel("Project for pane 1", { exact: true })
    .selectOption(workspace("b"));
  const pane = page.locator('[data-pane="1"]');
  await pane
    .getByRole("button", { name: "Start new conversation", exact: true })
    .click();
  await expect(pane).toHaveAttribute("data-connection", "connected");
  await expect(pane.locator(".mc-workspace")).toHaveText(workspace("b"));
  expect(requested).toEqual([workspace("b")]);
});

test("failed project discovery leaves a clear manual-folder fallback", async ({
  page,
}) => {
  await page.route("**/api/chat/workspaces?profile=default", (route) =>
    route.abort(),
  );
  await page.goto("/multi-chat");
  const picker = page.getByLabel("Project for pane 1", { exact: true });
  await expect(picker).toHaveAttribute("aria-busy", "false");
  await expect(picker.locator('option[value=""]')).toHaveText(
    "No projects found",
  );
  await picker.selectOption("__custom__");
  const field = page.getByLabel("Workspace for pane 1", { exact: true });
  await field.fill(workspace("d"));
  await expect(field).toHaveValue(workspace("d"));
  await expect(page.locator('[data-pane="1"]')).toHaveAttribute(
    "data-connection",
    "empty",
  );
});
