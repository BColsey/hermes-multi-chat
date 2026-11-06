import { React, sdk } from "./sdk";
import {
  DirectoryError,
  directoryPath,
  parentDirectory,
  projectFolders,
  type DirectorySource,
} from "./directories";

interface Props {
  initialDirectory?: string;
  home?: string;
  source: DirectorySource | null;
  change(source: DirectorySource | null): void;
}
export function ProjectDirectory(props: Props) {
  const [draft, setDraft] = React.useState(props.initialDirectory || "");
  const [folder, setFolder] = React.useState("");
  const request = React.useRef(0);
  const load = async (raw: string) => {
    const token = ++request.current;
    setFolder("");
    let path = raw;
    try {
      path = directoryPath(raw);
      setDraft(path);
      props.change({ path, folders: [], status: "loading" });
      const response = await sdk.fetchJSON<unknown>(
        "/api/fs/list?" + new URLSearchParams({ profile: "default", path }),
      );
      if (token !== request.current) return;
      props.change({
        path,
        folders: projectFolders(response),
        status: "ready",
      });
    } catch (error) {
      if (token !== request.current) return;
      props.change({
        path,
        folders: [],
        status: "error",
        error:
          error instanceof DirectoryError
            ? error.message
            : "Could not load this directory. Check its path, permissions and your sign-in.",
      });
    }
  };
  React.useEffect(() => {
    if (props.initialDirectory) void load(props.initialDirectory);
    return () => {
      request.current++;
    };
  }, []);
  const source = props.source;
  const reset = () => {
    request.current++;
    setDraft("");
    setFolder("");
    props.change(null);
  };
  return (
    <details className="mc-project-directory">
      <summary>
        <span>Projects directory</span>
        <span className="mc-directory-source" title={source?.path}>
          {source?.path || "Hermes project list"}
        </span>
      </summary>
      <p className="mc-start-warning">
        Choose a parent folder on the Hermes server. Its immediate subfolders
        populate every pane’s project dropdown; browsing starts no conversations
        and changes no existing workspace. Hermes’s file-access restrictions
        apply.
      </p>
      <form
        className="mc-directory-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void load(draft);
        }}
      >
        <label>
          Parent folder on the server
          <input
            aria-label="Projects directory"
            placeholder={
              props.home
                ? props.home + "/projects"
                : "/absolute/server/projects"
            }
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button type="submit">Load projects</button>
        <button
          type="button"
          onClick={() => {
            void load(props.home || "/");
          }}
        >
          {props.home ? "Browse from home" : "Browse from /"}
        </button>
        <button type="button" onClick={reset}>
          Use Hermes project list
        </button>
      </form>
      {source?.status === "ready" && (
        <div className="mc-directory-controls">
          <button
            disabled={source.path === "/"}
            onClick={() => {
              void load(parentDirectory(source.path));
            }}
          >
            Up one level
          </button>
          <label>
            Browse subfolders
            <select
              aria-label="Folder to open"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
            >
              <option value="">Choose a folder to open…</option>
              {source.folders.map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!folder}
            onClick={() => {
              void load(folder);
            }}
          >
            Open folder
          </button>
        </div>
      )}
      {source?.status === "loading" && (
        <p role="status">Loading project folders…</p>
      )}
      {source?.status === "error" && (
        <p className="mc-error" role="alert">
          {source.error}
        </p>
      )}
      {source?.status === "ready" && (
        <p className="mc-start-warning" role="status">
          {source.folders.length
            ? `${source.folders.length} project folder(s) available in every pane.`
            : "No subfolders in this directory. Choose another parent folder, or use Other folder… in a pane to work here directly."}
        </p>
      )}
    </details>
  );
}
