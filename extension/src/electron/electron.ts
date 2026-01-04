import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from "node:path";

// Menu.setApplicationMenu(null);
// const lockAcquired = app.requestSingleInstanceLock();
// if (!lockAcquired) {
//   // TODO: send message to user
//   app.quit();
//   process.exit(0);
// }

app.dock?.hide();

const createWindow = () => {
  const win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, "views", "preload.js"),
    }
  });

  process.on('message', (message) => {
    if (typeof message !== "object" || !message || !("command" in message)) return;
    win.webContents.send(message.command as string, message);
  });

  ipcMain.on('request_path', () => {
    process.send?.({
      command: "request_path"
    });
  });

  ipcMain.on('debug', (_, message) => {
    process.send?.({
      command: "debug",
      message
    });
  });

  ipcMain.on('info', (_, message) => {
    process.send?.({
      command: "info",
      message
    });
  });
  
  ipcMain.on('error', (_, message) => {
    process.send?.({
      command: "error",
      message
    });
  });

  win.loadFile(path.join("views", "index.html"));


  // TODO: hide this thing from the user
  // win.hide();
};

// ipcMain.on("set_path", (event, pathValue) => {
//   const webContents = event.sender;
//   webContents.send("set_path", pathValue);
// });

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});