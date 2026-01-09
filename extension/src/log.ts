import * as vscode from "vscode";

export const error = (message: string) => {
  vscode.window.showErrorMessage("Proximity Chat: " + message);
};

export const info = (message: string) => {
  vscode.window.showInformationMessage("Proximity Chat: " + message);
};