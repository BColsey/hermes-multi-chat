import { test, expect } from "./fixtures";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const pane = (page: import("@playwright/test").Page, n: number) =>
  page.locator(`[data-pane="${n}"]`);
const storageKey = "hermes.multi-chat.default.v1";

test("all 1–16 pane counts, keyboard selection and multi-track splitters work without opening agents", async ({
  page,
}) => {
  let ptys = 0;
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/api/pty") ptys++;
  });
  await page.goto("/multi-chat");
  const count = page.getByLabel("Visible panes", { exact: true });
  await expect(count.locator("option")).toHaveCount(16);
  await pane(page, 1).evaluate((element) =>
    element.setAttribute("data-node-proof", "same-pane"),
  );
  for (let n = 1; n <= 16; n++) {
    await count.selectOption(String(n));
    await expect(page.locator(".mc-pane:not([hidden])")).toHaveCount(n);
    await expect(pane(page, 1)).toHaveAttribute("data-node-proof", "same-pane");
  }
  expect(ptys).toBe(0);
  await count.focus();
  await page.keyboard.press("Home");
  await expect(count).toHaveValue("1");
  await page.keyboard.press("End");
  await expect(count).toHaveValue("16");
  await count.selectOption("6");
  const separator = page.getByRole("separator", {
    name: "Resize columns 1",
    exact: true,
  });
  const second = page.getByRole("separator", {
    name: "Resize columns 2",
    exact: true,
  });
  await second.focus();
  await page.keyboard.press("Home");
  expect(
    Number(await second.getAttribute("aria-valuenow")),
  ).toBeGreaterThanOrEqual(Number(await second.getAttribute("aria-valuemin")));
  expect(
    Number(await second.getAttribute("aria-valuenow")),
  ).toBeLessThanOrEqual(Number(await second.getAttribute("aria-valuemax")));
  await separator.focus();
  await page.keyboard.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "20");
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "22");
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 4, {
    steps: 5,
  });
  await page.mouse.up();
  expect(Number(await separator.getAttribute("aria-valuenow"))).toBeGreaterThan(
    22,
  );
  const position = await separator.getAttribute("aria-valuenow");
  await page.reload();
  await expect(count).toHaveValue("6");
  await expect(separator).toHaveAttribute("aria-valuenow", position!);
  expect(ptys).toBe(0);
  await page.setViewportSize({ width: 430, height: 980 });
  await expect(page.locator(".mc-pane:not([hidden])")).toHaveCount(6);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("legacy migration and five live panes preserve identity through count changes, maximize and refresh", async ({
  page,
}) => {
  const sockets: string[] = [];
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/api/pty") sockets.push("/api/pty");
  });
  await page.goto("/multi-chat");
  const count = page.getByLabel("Visible panes", { exact: true });
  await count.selectOption("4");
  const ids: string[] = [];
  for (let n = 1; n <= 4; n++) {
    await pane(page, n)
      .getByLabel(`Workspace for pane ${n}`, { exact: true })
      .fill(
        resolve(import.meta.dirname, `../../.dev/project-${"abcd"[n - 1]}`),
      );
    await pane(page, n)
      .getByRole("button", { name: "Start new conversation", exact: true })
      .click();
    await expect(pane(page, n)).toHaveAttribute("data-session", /.+/);
    ids.push((await pane(page, n).getAttribute("data-session"))!);
  }
  const legacy = await page.evaluate((key) => {
    const value = JSON.parse(sessionStorage.getItem(key)!);
    return { ...value, version: 1, columns: 63, rows: 42 };
  }, storageKey);
  await page.addInitScript(
    ({ key, value }) => {
      if (!sessionStorage.getItem("mc-test-legacy-injected")) {
        sessionStorage.setItem(key, JSON.stringify(value));
        sessionStorage.setItem("mc-test-legacy-injected", "true");
      }
    },
    { key: storageKey, value: legacy },
  );
  await page.reload();
  await expect(count).toHaveValue("4");
  await expect(
    page.getByRole("separator", { name: "Resize columns", exact: true }),
  ).toHaveAttribute("aria-valuenow", "63");
  await expect(
    page.getByRole("separator", { name: "Resize rows", exact: true }),
  ).toHaveAttribute("aria-valuenow", "42");
  for (let n = 1; n <= 4; n++)
    await expect(pane(page, n)).toHaveAttribute("data-session", ids[n - 1]);
  await count.selectOption("5");
  const fifth = resolve(import.meta.dirname, "../../.dev/project-e");
  await mkdir(fifth, { recursive: true });
  await pane(page, 5)
    .getByLabel("Workspace for pane 5", { exact: true })
    .fill(fifth);
  await pane(page, 5)
    .getByRole("button", { name: "Start new conversation", exact: true })
    .click();
  await expect(pane(page, 5)).toHaveAttribute("data-session", /.+/);
  ids.push((await pane(page, 5).getAttribute("data-session"))!);
  expect(new Set(ids).size).toBe(5);
  await page
    .locator(".mc-terminal .xterm")
    .evaluateAll((elements) =>
      elements.forEach((e, i) => e.setAttribute("data-node-proof", String(i))),
    );
  const socketCount = sockets.length;
  await count.selectOption("1");
  await expect(
    page.getByText(/4 hidden terminal\(s\) remain connected/),
  ).toBeVisible();
  await count.selectOption("3");
  await count.selectOption("16");
  await expect(page.locator(".mc-pane:not([hidden])")).toHaveCount(16);
  await count.selectOption("1");
  await count.focus();
  await page.keyboard.press("Alt+Shift+Digit9");
  await expect(count).toHaveValue("9");
  await expect(
    page.getByRole("button", { name: "Focus pane 9", exact: true }),
  ).toBeFocused();
  await count.selectOption("5");
  await page
    .getByRole("button", { name: "Maximize pane 5", exact: true })
    .click();
  await expect(page.locator(".mc-pane:not([hidden])")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Restore pane 5", exact: true })
    .click();
  await expect(page.locator(".mc-pane:not([hidden])")).toHaveCount(5);
  expect(
    await page
      .locator(".mc-terminal .xterm")
      .evaluateAll((elements) =>
        elements.map((e) => e.getAttribute("data-node-proof")),
      ),
  ).toEqual(["0", "1", "2", "3", "4"]);
  expect(sockets).toHaveLength(socketCount);
  for (let n = 1; n <= 5; n++)
    await expect(pane(page, n)).toHaveAttribute("data-session", ids[n - 1]);
  await page.reload();
  await expect(count).toHaveValue("5");
  for (let n = 1; n <= 5; n++)
    await expect(pane(page, n)).toHaveAttribute("data-session", ids[n - 1]);
});
