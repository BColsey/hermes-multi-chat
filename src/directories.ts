export interface ProjectFolder {
  name: string;
  path: string;
}
export interface DirectorySource {
  path: string;
  folders: ProjectFolder[];
  status: "loading" | "ready" | "error";
  error?: string;
}
export class DirectoryError extends Error {}

export function isDirectoryPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    value.length <= 4096 &&
    !value.includes("\0")
  );
}
export function directoryPath(raw: string): string {
  const value = raw.trim();
  if (!isDirectoryPath(value))
    throw new DirectoryError(
      "Enter an absolute directory path on the Hermes server.",
    );
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
}
export function parentDirectory(path: string): string {
  const normalized = directoryPath(path);
  return normalized.slice(0, normalized.lastIndexOf("/")) || "/";
}
export function projectFolders(response: unknown): ProjectFolder[] {
  if (!response || typeof response !== "object")
    throw new DirectoryError("Hermes returned an invalid directory list.");
  const value = response as { entries?: unknown; error?: unknown };
  if (value.error) {
    const messages: Record<string, string> = {
      ENOENT: "That directory does not exist.",
      ENOTDIR: "That path is not a directory.",
      EACCES: "Hermes does not have permission to read that directory.",
    };
    throw new DirectoryError(
      messages[String(value.error)] || "Hermes could not read that directory.",
    );
  }
  if (!Array.isArray(value.entries))
    throw new DirectoryError("Hermes returned an invalid directory list.");
  const folders = new Map<string, ProjectFolder>();
  for (const entry of value.entries) {
    if (
      entry &&
      entry.isDirectory === true &&
      typeof entry.name === "string" &&
      entry.name &&
      entry.name !== "." &&
      entry.name !== ".." &&
      !entry.name.includes("/") &&
      !entry.name.includes("\0") &&
      isDirectoryPath(entry.path)
    )
      folders.set(entry.path, { name: entry.name, path: entry.path });
  }
  return [...folders.values()];
}
