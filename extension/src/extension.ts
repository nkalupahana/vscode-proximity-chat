// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ElectronManager } from 'vscode-electron-manager';
import path from "node:path";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "proximity-chat" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('proximity-chat.helloWorld', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		// vscode.window.showInformationMessage('Hello World from Proximity Chat!');

		    // install dir is the root folder in which electron is installed and extension has access
			const installDir = context.globalStorageUri.fsPath;
			const envVars = process.env;
			const electronManager = new ElectronManager(installDir, envVars);

			// returns { path, version } of electron installed
			const installed = await electronManager.getInstalled();

			// if its old you can use .upgrade() to upgrade it,

			if (!installed) {
				// installs the latest version of electron,
				await electronManager.install();

				// if anyone needs older version and wants to specify semver version like ^13.0.0, open an issue
			}

			// bundle electron-main process file with webpack, and specify its path
			const electronMainFile = path.resolve(
				__dirname,
				'electron.js'
			);

			// spawns electron child process
			// can also pass additional electron executable args in second argument
			const electron = await electronManager.start(electronMainFile);
			if (!electron) throw new Error('ensure electron installation');

			electron.on('exit', () => {
				// Handle spawn error
			});

			// communicate with electron main process via ipc
			// in electron-main.js use process.send() and process.on('message')
			electron.send('ping');

			electron.once('message', () => {
				// Handle message
			});
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
