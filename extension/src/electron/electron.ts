import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from "node:path";
import { ExtensionOutgoingMessage, extensionOutgoingMessageSchema } from '../ipc';

const debug = (message: string) => {
  process.send?.({ command: "debug", message });
};

const error = (message: string) => {
  process.send?.({ command: "error", message });
};

Menu.setApplicationMenu(null);
const lockAcquired = app.requestSingleInstanceLock();
if (!lockAcquired) {
  error("Proximity Chat is already running somewhere else. Please stop that instance and try again.");
  app.quit();
  process.exit(0);
}

app.dock?.hide();

const createWindow = () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "views", "preload.js"),
      backgroundThrottling: false,
    }
  });

  process.on('message', (data) => {
    if (typeof data !== "object" || !data) return;

    let message: ExtensionOutgoingMessage;
    try {
      message = extensionOutgoingMessageSchema.parse(data);
    } catch (e: any) {
      debug("Failed to parse message: " + JSON.stringify(data));
      debug(e.message);
      return;
    }

    win.webContents.send(message.command, message);
  });

  // Pass messages from renderer to extension transparently
  ipcMain.on('message', (_, message) => {
    process.send?.(message);
  });

  win.loadFile(path.join("views", "index.html"));
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});