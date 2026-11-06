import { test, expect } from "./fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

const collection = resolve(
  import.meta.dirname,
  "../../.dev/directory-picker-fixture",
);
const alpha = resolve(collection, "Alpha project");
const beta = resolve(collection, "Beta project");
const empty = resolve(collection, "Empty folder");

async function openPicker(page: Page) {
  const summary = page.getByText("Projects directory", { exact: true });
  await expect(summary).toBeVisible({ timeout: 3000 });
  await summary.click();
  return page.getByRole("textbox", { name: "Projects directory", exact: true });
}
async function load(page: Page, path: string) {
  await page
    .getByRole("textbox", { name: "Projects directory", exact: true })
    .fill(path);
  await page
    .getByRole("button", { name: "Load projects", exact: true })
    .click();
}

test.beforeAll(async () => {
  for (const folder of [
    alpha,
    beta,
    empty,
    resolve(alpha, "nested-not-a-project"),
  ])
    await mkdir(folder, { recursive: true });
  await writeFile(
    resolve(collection, "not-a-project.txt"),
    "disposable fixture",
  );
});

test("selecting a parent directory populates every pane from real child folders and survives refresh", async ({
  page,
}) => {
  let ptys = 0;
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/api/pty") ptys++;
  });
  await page.goto("/multi-chat");
  const field = await openPicker(page);
  await expect(field).toBeVisible({ timeout: 3000 });
  await field.fill(collection);
  await field.press("Enter");
  const first = page.getByLabel("Project for pane 1", { exact: true });
  const second = page.getByLabel("Project for pane 2", { exact: true });
  await expect(first.locator(`option[value="${alpha}"]`)).toHaveText(
    "Alpha project — " + alpha,
  );
  await expect(second.locator(`option[value="${beta}"]`)).toHaveCount(1);
  expect(
    (await first.locator("option").allTextContents()).join("\n"),
  ).not.toMatch(/not-a-project|nested-not-a-project/);
  await expect(first).toHaveValue("");
  await first.selectOption(alpha);
  await expect(second).toHaveValue("");
  await page.reload();
  await expect(first).toHaveValue(alpha);
  await expect(second.locator(`option[value="${beta}"]`)).toHaveCount(1);
  await expect(
    page.getByText(collection, { exact: true }).first(),
  ).toBeVisible();
  expect(ptys).toBe(0);
  await page.setViewportSize({ width: 430, height: 980 });
  await openPicker(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("the server-folder browser opens a subfolder and moves up without creating projects", async ({
  page,
}) => {
  await page.goto("/multi-chat");
  await openPicker(page);
  await load(page, collection);
  const nav = page.getByLabel("Folder to open", { exact: true });
  await nav.selectOption(empty);
  await page.getByRole("button", { name: "Open folder", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Projects directory", exact: true }),
  ).toHaveValue(empty);
  await expect(
    page.getByRole("status").filter({ hasText: "No subfolders" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Up one level", exact: true }).click();
  await expect(nav.locator(`option[value="${alpha}"]`)).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Projects directory", exact: true }),
  ).toHaveValue(collection);
  await page
    .getByRole("button", { name: "Use Hermes project list", exact: true })
    .click();
  const picker = page.getByLabel("Project for pane 1", { exact: true });
  await expect(picker.locator(`option[value="${alpha}"]`)).toHaveCount(0);
  await expect(picker.locator('option[value="__custom__"]')).toHaveCount(1);
  const workspaces = await (
    await page.request.get("/api/chat/workspaces?profile=default")
  ).json();
  await page
    .getByRole("button", { name: "Browse from home", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Projects directory", exact: true }),
  ).toHaveValue(workspaces.home);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /project folder\(s\)|No subfolders/ }),
  ).toBeVisible();
});

test("missing and forbidden directories show errors without changing an existing workspace", async ({
  page,
  browser,
}) => {
  const anonymous = await browser.newContext({
    baseURL: String(test.info().project.use.baseURL),
    storageState: { cookies: [], origins: [] },
  });
  expect(
    (
      await anonymous.request.get(
        "/api/fs/list?" +
          new URLSearchParams({ profile: "default", path: collection }),
      )
    ).status(),
  ).toBe(401);
  await anonymous.close();
  await page.goto("/multi-chat");
  await openPicker(page);
  await load(page, collection);
  const picker = page.getByLabel("Project for pane 1", { exact: true });
  await picker.selectOption(alpha);
  await load(page, resolve(collection, "missing-folder"));
  await expect(page.getByRole("alert")).toContainText("does not exist");
  await expect(page.locator('[data-pane="1"] .mc-workspace')).toHaveText(alpha);
  await page.route("**/api/fs/list?**", (route) =>
    route.fulfill({ status: 403, json: { detail: "Denied by the host" } }),
  );
  await load(page, collection);
  await expect(page.getByRole("alert")).toContainText("permissions");
  await expect(page.locator('[data-pane="1"]')).toHaveAttribute(
    "data-connection",
    "empty",
  );
});

for (const reset of [false, true]) {
  test(`a late directory response cannot replace ${reset ? "the Hermes-list reset" : "a newer folder"}`, async ({
    page,
  }) => {
    let deliver!: () => void;
    const gate = new Promise<void>((r) => {
      deliver = r;
    });
    let held = false;
    await page.route("**/api/fs/list?**", async (route) => {
      if (
        new URL(route.request().url()).searchParams.get("path") !== collection
      )
        return route.continue();
      const response = await route.fetch();
      held = true;
      await gate;
      await route.fulfill({ response });
    });
    await page.goto("/multi-chat");
    await openPicker(page);
    await load(page, collection);
    await expect.poll(() => held).toBe(true);
    const picker = page.getByLabel("Project for pane 1", { exact: true });
    if (reset) {
      await page
        .getByRole("button", { name: "Use Hermes project list", exact: true })
        .click();
    } else {
      await load(page, alpha);
      await expect(
        picker.locator(
          `option[value="${resolve(alpha, "nested-not-a-project")}"]`,
        ),
      ).toHaveCount(1);
    }
    const delivered = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/fs/list" &&
        new URL(r.url()).searchParams.get("path") === collection,
    );
    deliver();
    await delivered;
    await expect(picker.locator(`option[value="${beta}"]`)).toHaveCount(0);
    if (reset) {
      await expect(
        picker.locator(
          `option[value="${resolve(alpha, "nested-not-a-project")}"]`,
        ),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            JSON.parse(
              sessionStorage.getItem("hermes.multi-chat.default.v1") || "{}",
            ).projectsDirectory,
        ),
      ).toBeUndefined();
    } else {
      await expect(
        picker.locator(
          `option[value="${resolve(alpha, "nested-not-a-project")}"]`,
        ),
      ).toHaveCount(1);
    }
  });
}

test("loading another project directory never remounts a running TUI or changes its workspace", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/api/pty")
      requested.push(new URL(socket.url()).searchParams.get("cwd") || "");
  });
  await page.goto("/multi-chat");
  await openPicker(page);
  await load(page, collection);
  await page
    .getByLabel("Project for pane 1", { exact: true })
    .selectOption(alpha);
  const pane = page.locator('[data-pane="1"]');
  await pane
    .getByRole("button", { name: "Start new conversation", exact: true })
    .click();
  await expect(pane).toHaveAttribute("data-connection", "connected");
  const id = await pane.getAttribute("data-session");
  await pane
    .locator(".xterm")
    .evaluate((el) => el.setAttribute("data-directory-proof", "same-terminal"));
  await load(page, empty);
  await expect(
    page.getByRole("status").filter({ hasText: "No subfolders" }),
  ).toBeVisible();
  await expect(pane).toHaveAttribute("data-session", id!);
  await expect(pane.locator(".xterm")).toHaveAttribute(
    "data-directory-proof",
    "same-terminal",
  );
  await expect(pane.locator(".mc-workspace")).toHaveText(alpha);
  await expect(pane).toHaveAttribute("data-connection", "connected");
  expect(requested).toHaveLength(1);
});
