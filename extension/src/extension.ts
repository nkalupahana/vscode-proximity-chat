import * as vscode from 'vscode';
import { ElectronManager } from 'vscode-electron-manager';
import path from "node:path";
import { ChildProcess, execSync } from 'node:child_process';
import gitUrlParse from 'git-url-parse';
import { ExtensionIncomingMessage, extensionIncomingMessageSchema } from './ipc';
import { ParticipantsTreeViewDataProvider } from './participantsTreeView';
import { debounce } from "lodash";
import { info, error } from './log';
import { ERR_NO_REMOTES, ERR_NOT_IN_GIT_REPO, getRepoAttributes, trySendPath } from './path';

const STATUS_BAR_WARNING_BACKGROUND = new vscode.ThemeColor("statusBarItem.warningBackground");

export function activate(context: vscode.ExtensionContext) {
  const channel = vscode.window.createOutputChannel("Proximity Chat", { log: true });
  const debug = (message: string) => {
    channel.appendLine("[Extension]" + message);
  };

  const muteIcon = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  const deafenIcon = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  const participantsTreeViewDataProvider = new ParticipantsTreeViewDataProvider();
  vscode.window.registerTreeDataProvider("proximity-chat-participants", participantsTreeViewDataProvider);
  context.subscriptions.push(muteIcon);
  context.subscriptions.push(deafenIcon);

  const setNameCommand = vscode.commands.registerCommand('proximity-chat.set-name', async () => {
    const name = await vscode.window.showInputBox({
      prompt: "Set your public display name. Enter nothing to be anonymous.",
      value: vscode.workspace.getConfiguration().get("proximityChat.name") ?? ""
    });
    if (name === undefined) return;
    vscode.workspace.getConfiguration().update("proximityChat.name", name, true);
  });
  context.subscriptions.push(setNameCommand);

  const startCommand = vscode.commands.registerCommand('proximity-chat.start', async () => {
    // Reset state
    participantsTreeViewDataProvider.setActiveSessions(null);

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

    context.subscriptions.push({
      dispose: () => {
        if (electron.connected && electron.exitCode === null) {
          electron.kill();
        }
      }
    });

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
    // package.json > contributes > commands does not allow duplicate commands
    const muteCommand = vscode.commands.registerCommand('proximity-chat.mute', sendMute);
    const unmuteCommand = vscode.commands.registerCommand('proximity-chat.unmute', sendMute);
    const deafenCommand = vscode.commands.registerCommand('proximity-chat.deafen', sendDeafen);
    const undeafenCommand = vscode.commands.registerCommand('proximity-chat.undeafen', sendDeafen);

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("proximityChat.name")) {
        const name = vscode.workspace.getConfiguration().get("proximityChat.name") ?? "";
        electron.send({
          command: "set_name",
          name: name
        });
      }
    });

    if (!vscode.window.activeTextEditor || vscode.window.activeTextEditor.document.uri.scheme !== "file") {
      info("Chat started! Open a file to begin.");
    } else {
      const checkRemote = getRepoAttributes(vscode.window.activeTextEditor.document.uri.fsPath, debug);
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
      info("Chat ended.");
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
      debug(JSON.stringify(message));
      switch (message.command) {
        case "request_path":
          trySendPath(electron, vscode.window.activeTextEditor, debug);
          break;
        case "request_name":
          const name = vscode.workspace.getConfiguration().get("proximityChat.name") ?? "";
          if (name) {
            electron.send({
              command: "set_name",
              name
            });
          }
          break;
        case "debug":
          channel.appendLine("[Electron]" + message.message);
          break;
        case "info":
          info(message.message);
          break;
        case "error":
          error(message.message);
          electron.kill(); // errors are fatal
          break;
        case "mute_status":
          vscode.commands.executeCommand('setContext', 'proximity-chat.muted', message.muted);
          if (message.muted) {
            muteIcon.text = "$(mic) Muted";
            muteIcon.backgroundColor = STATUS_BAR_WARNING_BACKGROUND;
          } else {
            muteIcon.text = "$(mic-filled)";
            muteIcon.backgroundColor = undefined;
          }
          break;
        case "deafen_status":
          vscode.commands.executeCommand('setContext', 'proximity-chat.deafened', message.deafened);
          if (message.deafened) {
            deafenIcon.text = "$(mute) Deafened";
            deafenIcon.backgroundColor = STATUS_BAR_WARNING_BACKGROUND;
          } else {
            deafenIcon.text = "$(unmute)";
            deafenIcon.backgroundColor = undefined;
          }
          break;
        case "active_sessions":
          participantsTreeViewDataProvider.setActiveSessions(message);
          break;
        case "reset_active_sessions":
          participantsTreeViewDataProvider.setActiveSessions(null);
          break;
        default:
          const _message: never = message;
          debug("Unknown message received: " + JSON.stringify(message));
      }
    });
  });

  context.subscriptions.push(startCommand);
}

export function deactivate() { }
