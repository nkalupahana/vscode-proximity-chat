import * as vscode from 'vscode';
import { ElectronManager } from 'vscode-electron-manager';
import path from "node:path";
import { ChildProcess, execSync } from 'node:child_process';
import gitUrlParse from 'git-url-parse';
import { ExtensionIncomingMessage, extensionIncomingMessageSchema } from './ipc';

const STATUS_BAR_WARNING_BACKGROUND = new vscode.ThemeColor("statusBarItem.warningBackground");
let lastSentFsPath: string | null = null;

const error = (message: string) => {
  vscode.window.showErrorMessage("Proximity Chat: " + message);
};

const info = (message: string) => {
  vscode.window.showInformationMessage("Proximity Chat: " + message);
};

const sendPath = (electron: ChildProcess, fsPath: string | null, path: string | null, remote: string | null) => {
  lastSentFsPath = fsPath;
  electron.send({
    command: "set_path",
    path: path,
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
}

const trySendPath = (electron: ChildProcess, editor: vscode.TextEditor | null | undefined, debug: (message: string) => void) => {
  if (editor === undefined || editor === null || editor.document.uri.scheme !== "file") {
    if (!lastSentPathActive()) {
      sendPath(electron, null, null, null);
    }
    return;
  }

  const data = getRepoAttributes(editor.document.uri.path, debug);

  if (typeof data === "object" && data !== null) {
    const normalizedPath = normalizePath(editor.document.uri.path);
    if (!normalizedPath.startsWith(data.basePath)) {
      error(`Unable to update path. Path (${normalizePath}) should start with repo base path ${data.basePath}, but it doesn't.`);
    } else {
      const serverPath = normalizedPath.replace(data.basePath, "").split(path.sep).join(path.posix.sep);
      sendPath(electron, editor.document.uri.fsPath, serverPath, data.remote);
    }
  }
};

const ERR_NOT_IN_GIT_REPO = "ERR_NOT_IN_GIT_REPO";
const ERR_NO_REMOTES = "ERR_NO_REMOTES";

const getRepoAttributes = (pathStr: string, debug: (message: string) => void) => {
  const fallbackRemoteName: string = vscode.workspace.getConfiguration().get("proximityChat.fallbackRemoteName") ?? "origin";
  const { dir } = path.parse(pathStr);
  let remotes: string;
  try {
    remotes = execSync("git remote", { cwd: dir }).toString().trim();
  } catch {
    return ERR_NOT_IN_GIT_REPO;
  }
  // TODO: allow remote to be configured by workspace setting or something
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
    vscode.commands.executeCommand('setContext', 'proximity-chat.muted', false);
    vscode.commands.executeCommand('setContext', 'proximity-chat.deafened', false);
    muteIcon.command = "proximity-chat.mute";
    muteIcon.text = "$(mic-filled)";
    muteIcon.backgroundColor = undefined;
    deafenIcon.command = "proximity-chat.deafen";
    deafenIcon.text = "$(unmute)";
    deafenIcon.backgroundColor = undefined;
    muteIcon.show();
    deafenIcon.show();

    const stopCommand = vscode.commands.registerCommand('proximity-chat.stop', async () => {
      electron.kill();
    });
    const sendMute = () => {
      electron.send({
        command: "mute"
      });
    };
    const sendDeafen = () => {
      electron.send({
        command: "deafen"
      });
    };

    // Defining each command twice is necessary because
    // package > contributes > commands does not allow duplicate commands
    const muteCommand = vscode.commands.registerCommand('proximity-chat.mute', sendMute);
    const unmuteCommand = vscode.commands.registerCommand('proximity-chat.unmute', sendMute);
    const deafenCommand = vscode.commands.registerCommand('proximity-chat.deafen', sendDeafen);
    const undeafenCommand = vscode.commands.registerCommand('proximity-chat.undeafen', sendDeafen);

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
      trySendPath(electron, editor, debug);
	  }));

    electron.on('exit', () => {
      info("Voice process exited; Proximity Chat is no longer active.");
      vscode.commands.executeCommand('setContext', 'proximity-chat.running', false);
      activeEditorListener.dispose();
      stopCommand.dispose();
      muteIcon.hide();
      deafenIcon.hide();
      muteCommand.dispose();
      deafenCommand.dispose();
      unmuteCommand.dispose();
      undeafenCommand.dispose();
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
        trySendPath(electron, vscode.window.activeTextEditor, debug);
      }
      if (message.command === "debug") {
        channel.appendLine("[Electron]" + message.message);
      }
      if (message.command === "info") {
        info(message.message as string);
      }
      if (message.command === "error") {
        error(message.message as string);
        electron.kill(); // errors are fatal
      }
      if (message.command === "mute_status") {
        vscode.commands.executeCommand('setContext', 'proximity-chat.muted', message.muted);
        if (message.muted) {
          muteIcon.text = "$(mic) Muted";
          muteIcon.backgroundColor = STATUS_BAR_WARNING_BACKGROUND;
        } else {
          muteIcon.text = "$(mic-filled)";
          muteIcon.backgroundColor = undefined;
        }
       }
       if (message.command === "deafen_status") {
        vscode.commands.executeCommand('setContext', 'proximity-chat.deafened', message.deafened);
        if (message.deafened) {
          deafenIcon.text = "$(mute) Deafened";
          deafenIcon.backgroundColor = STATUS_BAR_WARNING_BACKGROUND;
        } else {
          deafenIcon.text = "$(unmute)";
          deafenIcon.backgroundColor = undefined;
         }
       }
    });
  });

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }
