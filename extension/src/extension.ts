// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ElectronManager } from 'vscode-electron-manager';
import path from "node:path";
import { ChildProcess, execSync } from 'node:child_process';
import gitUrlParse from 'git-url-parse';

const sendPath = (electron: ChildProcess, editor: vscode.TextEditor | null | undefined) => {
  if (editor === undefined || editor === null) {
    // TODO: handle disconnections with a delay
    return;
  }

  if (editor.document.uri.scheme !== "file") {
    // TODO: handle non-file schemes gracefully (compare last value with open windows)
    return;
  }

  const data = getRepoAttributes(editor.document.uri.path);

  if (data) {
    const normalizedPath = normalizePath(editor.document.uri.path);
    if (!normalizedPath.startsWith(data.basePath)) {
      // channel.appendLine("base path does not start with normalized path; bailing out");
    } else {
      // Normalize to posix path for server
      const serverPath = normalizedPath.replace(data.basePath, "").split(path.sep).join(path.posix.sep);
      electron.send({
        command: "set_path",
        path: serverPath,
        remote: data.remote
      });
    }
  }
};

const getRepoAttributes = (pathStr: string) => {
  const { dir } = path.parse(pathStr);
  let remotes: string;
  try {
    remotes = execSync("git remote", { cwd: dir }).toString().trim();
  } catch {
    // channel.appendLine("Failed to list git remotes");
    return null;
  }
  // channel.appendLine("Remotes: " + remotes);
  // TODO: allow remote to be configured by workspace setting or something
  let remote: string;
  if (remotes.includes("origin")) {
    remote = "origin";
  } else if (remotes.length > 0) {
    remote = remotes.split("\n")[0].trim();
  } else {
    return null;
  }

  // channel.appendLine("Selected remote: " + remote);

  let remotePath: string;
  try {
    remotePath = execSync(`git remote get-url ${remote}`, { cwd: dir }).toString().trim();
  } catch {
    return null;
  }
  // channel.appendLine("Remote path: " + remotePath);
  const remoteParsed = gitUrlParse(remotePath.toLowerCase());
  // channel.appendLine("Parsed remote: " + JSON.stringify(remoteParsed));
  if (!remoteParsed.resource || !remoteParsed.pathname) {
    // channel.appendLine("Failed to parse remote");
    return null;
  }

  let basePath: string;
  try {
    basePath = execSync(`git rev-parse --show-toplevel`, { cwd: dir }).toString().trim();
  } catch {
    // channel.appendLine("Failed to get base path");
    return null;
  }
  // channel.appendLine("Base path: " + basePath);

  return {
    remote: remoteParsed.resource + remoteParsed.pathname,
    basePath: normalizePath(basePath)
  };
};

const normalizePath = (pathStr: string) => {
  return path.normalize(pathStr).toLowerCase();
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "proximity-chat" is now active!');
  const channel = vscode.window.createOutputChannel("Proximity Chat", { log: true });
	channel.appendLine("Proximity chat initializing");

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand('proximity-chat.helloWorld', async () => {
    // The code you place here will be executed every time your command is executed
    // Display a message box to the user
    // vscode.window.showInformationMessage('Hello World from Proximity Chat!');

    try {
      execSync("git --version");
    } catch (e) {
      vscode.window.showErrorMessage(
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

    // Spawn with starting remote, if any
    const args: string[] = [];
    // if (remote) {
    //   args.push(Buffer.from(remote, "utf8").toString("base64"));
    // }
    const electron = await electronManager.start(electronMainFile, args);
    if (!electron) throw new Error('ensure electron installation');

    vscode.window.onDidChangeActiveTextEditor(((editor) => {
      sendPath(electron, editor);
	  }));

    electron.on('exit', () => {
      // Handle spawn error
    });

    // communicate with electron main process via ipc
    // in electron-main.js use process.send() and process.on('message')
    electron.send('ping');

    electron.once('message', (message) => {
      if (typeof message !== "object" || !message || !("command" in message)) return;
      if (message.command === "request_path") {
        sendPath(electron, vscode.window.activeTextEditor);
      }
    });
  });

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }
