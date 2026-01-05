import * as vscode from 'vscode';
import { ElectronManager } from 'vscode-electron-manager';
import path from "node:path";
import { ChildProcess, execSync } from 'node:child_process';
import gitUrlParse from 'git-url-parse';
import { ExtensionIncomingMessage, extensionIncomingMessageSchema } from './ipc';

const error = (message: string) => {
  vscode.window.showErrorMessage("Proximity Chat: " + message);
};

const info = (message: string) => {
  vscode.window.showInformationMessage("Proximity Chat: " + message);
};

const sendPath = (electron: ChildProcess, editor: vscode.TextEditor | null | undefined, debug: (message: string) => void) => {
  if (editor === undefined || editor === null) {
    // TODO: handle disconnections with a delay
    return;
  }

  if (editor.document.uri.scheme !== "file") {
    // TODO: handle non-file schemes gracefully (compare last value with open windows)
    return;
  }

  const data = getRepoAttributes(editor.document.uri.path, debug);

  if (typeof data === "object" && data !== null) {
    const normalizedPath = normalizePath(editor.document.uri.path);
    if (!normalizedPath.startsWith(data.basePath)) {
      error(`Unable to update path. Path (${normalizePath}) should start with repo base path ${data.basePath}, but it doesn't.`);
    } else {
      const serverPath = normalizedPath.replace(data.basePath, "").split(path.sep).join(path.posix.sep);
      electron.send({
        command: "set_path",
        path: serverPath,
        remote: data.remote
      });
    }
  }
};

const ERR_NOT_IN_GIT_REPO = "ERR_NOT_IN_GIT_REPO";
const ERR_NO_REMOTES = "ERR_NO_REMOTES";

const getRepoAttributes = (pathStr: string, debug: (message: string) => void) => {
  const { dir } = path.parse(pathStr);
  let remotes: string;
  try {
    remotes = execSync("git remote", { cwd: dir }).toString().trim();
  } catch {
    return ERR_NOT_IN_GIT_REPO;
  }
  // TODO: allow remote to be configured by workspace setting or something
  let remote: string;
  if (remotes.includes("origin")) {
    remote = "origin";
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

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  const channel = vscode.window.createOutputChannel("Proximity Chat", { log: true });
  const debug = (message: string) => {
    channel.appendLine("[Extension]" + message);
  };
  const muteIcon = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  const deafenIcon = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  context.subscriptions.push(muteIcon);
  context.subscriptions.push(deafenIcon);
  muteIcon.command = "proximity-chat.mute";
  muteIcon.text = "$(mic-filled)";
  deafenIcon.command = "proximity-chat.deafen";
  deafenIcon.text = "$(unmute)";

  const disposable = vscode.commands.registerCommand('proximity-chat.start', async () => {
    try {
      execSync("git --version");
    } catch (e) {
      error(
        "Git is not installed, which is required for Proximity Chat to connect you " + 
        "to people who are in the same repository as you. Please install " +
        "it, ensure it is in your path, and try again."
      );
      return;
    }

    // install dir is the root folder in which electron is installed and extension has access
    const installDir = context.globalStorageUri.fsPath;
    const envVars = process.env;
    const electronManager = new ElectronManager(installDir, envVars);

    const installed = await electronManager.getInstalled();
    if (!installed) {
      await electronManager.install();
    }

    const electronMainFile = path.resolve(
      __dirname,
      'electron.js'
    );

    const electron = await electronManager.start(electronMainFile, []);
    if (!electron) {
      error("Failed to start voice capture process");
      return;
    }

    vscode.commands.executeCommand('setContext', 'proximity-chat.running', true);
    muteIcon.show();
    deafenIcon.show();
    const stopCommand = vscode.commands.registerCommand('proximity-chat.stop', async () => {
      electron.kill();
    });

    if (!vscode.window.activeTextEditor || vscode.window.activeTextEditor.document.uri.scheme !== "file") {
      info("Chat started! Open a file to begin.");
    } else {
      const checkRemote = getRepoAttributes(vscode.window.activeTextEditor.document.uri.path, debug);
      if (checkRemote === ERR_NOT_IN_GIT_REPO) {
        info("Cannot connect because this file is not in a Git repository. Set up a repository with a remote (e.g. GitHub) to use Proximity Chat with your current file.");
      } else if (checkRemote === ERR_NO_REMOTES) {
        info("Cannot connect because the Git repository this file is in has no remotes (not on GitHub, etc.). Set this up to use Proximity Chat with your current file.");
      } else if (checkRemote !== null) {
        info("Chat started!");
      }
    }

    const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(((editor) => {
      sendPath(electron, editor, debug);
	  }));

    electron.on('exit', () => {
      info("Voice process exited; Proximity Chat is no longer active.");
      vscode.commands.executeCommand('setContext', 'proximity-chat.running', false);
      activeEditorListener.dispose();
      stopCommand.dispose();
      muteIcon.hide();
      deafenIcon.hide();
    });

    electron.on('message', (data) => {
      if (typeof data !== "object" || !data) return;
      let message: ExtensionIncomingMessage;
      try {
        message = extensionIncomingMessageSchema.parse(data);
      } catch (e: any) {
        debug("Failed to parse message: " + JSON.stringify(data));
        debug(e?.message);
        return;
      }

      debug("Received command: " + message.command);
      if (message.command === "request_path") {
        sendPath(electron, vscode.window.activeTextEditor, debug);
      }
      if (message.command === "debug") {
        if ("message" in message) {
          channel.appendLine("[Electron]" + message.message);
        }
      }
      if (message.command === "info") {
        if ("message" in message) {
          info("Proximity Chat: " + message.message as string);
        }
      }
      if (message.command === "error") {
        if ("message" in message) {
          error("Proximity Chat: " + message.message as string);
        }
      }
    });
  });

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }
