import { debounce } from "lodash";
import * as vscode from "vscode";
import { error } from "./log";
import path from "node:path";
import { type ChildProcess, execSync } from "node:child_process";
import gitUrlParse from "git-url-parse";
import type { ParticipantsTreeViewDataProvider } from "./participantsTreeView";

let lastSentFsPath: string | null = null;

const sendPath = ({
  electron,
  fsPath,
  basePath,
  path,
  remote,
  prettyPath,
  provider
}: {
  electron: ChildProcess;
  fsPath: string | null;
  basePath: string | null;
  path: string | null;
  remote: string | null;
  prettyPath: string | null;
  provider: ParticipantsTreeViewDataProvider;
}) => {
  lastSentFsPath = fsPath;
  provider.setBasePath(basePath);
  electron.send({
    command: "set_path",
    path: path,
    prettyPath: prettyPath,
    remote: remote
  });
};

const lastSentPathActive = () => {
  let found = false;
  vscode.window.visibleTextEditors.forEach(editor => {
    if (editor.document.uri.fsPath === lastSentFsPath) {
      found = true;
    }
  });

  return found;
};

// Debounced because when you switch from one file to another in VSCode via the sidebar,
// it sends an undefined first, and then the new file.
export const trySendPath = debounce(({
  electron,
  editor,
  debug,
  provider
}: {
  electron: ChildProcess;
  editor: vscode.TextEditor | null | undefined;
  debug: (message: string) => void;
  provider: ParticipantsTreeViewDataProvider;
}) => {
  if (editor === undefined || editor === null || editor.document.uri.scheme !== "file") {
    if (!lastSentPathActive()) {
      sendPath({
        electron,
        fsPath: null,
        basePath: null,
        path: null,
        remote: null,
        prettyPath: null,
        provider
      });
    }
    return;
  }

  const data = getRepoAttributes(editor.document.uri.fsPath, debug);

  if (typeof data === "object" && data !== null) {
    const normalizedPath = normalizePath(editor.document.uri.fsPath);
    if (!normalizedPath.startsWith(data.basePath)) {
      error(`Unable to update path. Path (${normalizedPath}) should start with repo base path ${data.basePath}, but it doesn't.`);
    } else {
      const serverPath = normalizedPath.replace(data.basePath, "").split(path.sep).join(path.posix.sep);
      const prettyPath = path.normalize(editor.document.uri.fsPath).slice(data.basePath.length).split(path.sep).join(path.posix.sep);
      sendPath({
        electron,
        fsPath: editor.document.uri.fsPath,
        basePath: data.basePath,
        path: serverPath,
        remote: data.remote,
        prettyPath,
        provider
      });
    }
  }
}, 100);

export const ERR_NOT_IN_GIT_REPO = "ERR_NOT_IN_GIT_REPO";
export const ERR_NO_REMOTES = "ERR_NO_REMOTES";

export const getRepoAttributes = (pathStr: string, debug: (message: string) => void) => {
  const fallbackRemoteName: string = vscode.workspace.getConfiguration().get("proximityChat.fallbackRemoteName") ?? "origin";
  const { dir } = path.parse(pathStr);
  let remotes: string;
  try {
    remotes = execSync("git remote", { cwd: dir }).toString().trim();
  } catch {
    return ERR_NOT_IN_GIT_REPO;
  }

  let remote: string;
  if (remotes.includes(fallbackRemoteName)) {
    remote = fallbackRemoteName;
  } else if (remotes.length > 0) {
    remote = remotes.split("\n")[0].trim();
  } else {
    return ERR_NO_REMOTES;
  }

  let remotePath: string;
  try {
    remotePath = execSync(`git remote get-url ${remote}`, { cwd: dir }).toString().trim();
  } catch {
    error(`Failed to get Git remote path for remote "${remote}".`);
    return null;
  }
  const remoteParsed = gitUrlParse(remotePath.toLowerCase());
  if (!remoteParsed.resource || !remoteParsed.pathname) {
    error("Failed to parse Git remote path: " + remotePath);
    return null;
  }

  let basePath: string;
  try {
    basePath = execSync(`git rev-parse --show-toplevel`, { cwd: dir }).toString().trim();
  } catch {
    error("Failed to get Git repo top-level path in " + dir);
    return null;
  }

  return {
    remote: remoteParsed.resource + remoteParsed.pathname,
    basePath: normalizePath(basePath)
  };
};

const normalizePath = (pathStr: string) => {
  return path.normalize(pathStr).toLowerCase();
};