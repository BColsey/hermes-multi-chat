import { expect, test } from "vitest";
import {
  DirectoryError,
  directoryPath,
  parentDirectory,
  projectFolders,
} from "../src/directories";

test("directory paths are absolute, normalized and preserve literal special characters", () => {
  expect(directoryPath(" /projects//one/../two/./ ")).toBe("/projects/two");
  expect(directoryPath("/projects/A & B+#?%2f/λ")).toBe(
    "/projects/A & B+#?%2f/λ",
  );
  for (const value of ["", "relative", "~/projects", "/bad\0path"])
    expect(() => directoryPath(value)).toThrow(DirectoryError);
});
test("browsing up stops at the filesystem root", () => {
  expect(parentDirectory("/projects/alpha/")).toBe("/projects");
  expect(parentDirectory("/projects")).toBe("/");
  expect(parentDirectory("/")).toBe("/");
});
test("only valid directory entries become choices, without following files or duplicating paths", () => {
  expect(
    projectFolders({
      entries: [
        { name: "Alpha project", path: "/projects/alpha", isDirectory: true },
        { name: "file.txt", path: "/projects/file.txt", isDirectory: false },
        { name: "link", path: "/projects/link", isDirectory: false },
        { name: "Alpha project", path: "/projects/alpha", isDirectory: true },
        { name: "bad/path", path: "/projects/bad", isDirectory: true },
        { name: "relative", path: "relative", isDirectory: true },
        { name: ".", path: "/projects", isDirectory: true },
        null,
        {},
      ],
    }),
  ).toEqual([{ name: "Alpha project", path: "/projects/alpha" }]);
});
test("backend directory errors and malformed replies are not mistaken for an empty folder", () => {
  expect(projectFolders({ entries: [] })).toEqual([]);
  for (const error of ["ENOENT", "ENOTDIR", "EACCES", "read-error"])
    expect(() => projectFolders({ entries: [], error })).toThrow(
      DirectoryError,
    );
  for (const value of [null, {}, { entries: "not a list" }])
    expect(() => projectFolders(value)).toThrow(DirectoryError);
});
