/**
 * Arduino Cloud IDE - Preload Script
 * Exposes secure IPC channels to renderer process
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // ==========================================================================
  // AUTHENTICATION
  // ==========================================================================
  login: (data) => ipcRenderer.invoke("auth-login", data),
  register: (data) => ipcRenderer.invoke("auth-register", data),
  logout: () => ipcRenderer.invoke("auth-logout"),
  getCurrentUser: () => ipcRenderer.invoke("auth-get-user"),

  // ==========================================================================
  // BOARD MANAGEMENT
  // ==========================================================================
  listBoards: () => ipcRenderer.invoke("boards-list"),
  createBoard: (data) => ipcRenderer.invoke("boards-create", data),
  getBoard: (boardId) => ipcRenderer.invoke("boards-get", boardId),
  updateBoard: (id, data) => ipcRenderer.invoke("boards-update", { id, data }),
  deleteBoard: (boardId) => ipcRenderer.invoke("boards-delete", boardId),
  regenerateBoardToken: (boardId) => ipcRenderer.invoke("boards-regenerate-token", boardId),

  // ==========================================================================
  // COMPILATION
  // ==========================================================================
  compileArduino: (data) => ipcRenderer.invoke("compile-arduino", data),
  installBoardPackage: (data) => ipcRenderer.invoke("install-board-package", data),
  installBoardPackage: (data) => ipcRenderer.invoke("install-board-package", data),
  removeBoardPackage: (data) => ipcRenderer.invoke("remove-board-package", data),
  listInstalledBoards: () => ipcRenderer.invoke("list-installed-boards"),
  searchBoardPlatforms: (query) => ipcRenderer.invoke("search-board-platforms", query),
  listInstalledPlatforms: () => ipcRenderer.invoke("list-installed-platforms"),
  onInstallProgress: (callback) => ipcRenderer.on("install-progress", (event, data) => callback(data)),

  // ==========================================================================
  // LIBRARY MANAGEMENT
  // ==========================================================================
  searchLibraries: (query) => ipcRenderer.invoke("libraries-search", query),
  installLibrary: (name, version) => ipcRenderer.invoke("libraries-install", { name, version }),
  listInstalledLibraries: () => ipcRenderer.invoke("libraries-list"),

  // ==========================================================================
  // FIRMWARE & OTA
  // ==========================================================================
  uploadToCloud: (data) => ipcRenderer.invoke("firmware-upload", data),
  getFirmwareHistory: (boardId) => ipcRenderer.invoke("firmware-history", boardId),
  deployFirmware: (firmwareId) => ipcRenderer.invoke("firmware-deploy", firmwareId),
  deleteFirmware: (firmwareId) => ipcRenderer.invoke("firmware-delete", firmwareId),

  // ==========================================================================
  // PROVISIONING
  // ==========================================================================
  listPorts: () => ipcRenderer.invoke("ports-list"),
  provisionBoard: (data) => ipcRenderer.invoke("provision-board", data),
  installESP32Support: () => ipcRenderer.invoke("install-esp32-support"),

  // ==========================================================================
  // LIBRARY MANAGER
  // ==========================================================================
  searchLibraries: (query) => ipcRenderer.invoke("libraries-search", query),
  getFeaturedLibraries: () => ipcRenderer.invoke("libraries-featured"),
  installLibrary: (name, version) => ipcRenderer.invoke("libraries-install", { name, version }),
  listInstalledLibraries: () => ipcRenderer.invoke("libraries-list"),

  // ==========================================================================
  // UTILITIES
  // ==========================================================================
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getAppwriteConfig: () => ipcRenderer.invoke("get-appwrite-config"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // ==========================================================================
  // MENU EVENT LISTENERS
  // ==========================================================================
  onMenuEvent: (channel, callback) => {
    const validChannels = [
      "menu-new-sketch",
      "menu-open-sketch",
      "menu-close-sketch",
      "menu-save",
      "menu-save-as",
      "menu-page-setup",
      "menu-preferences",
      "menu-copy-forum",
      "menu-copy-html",
      "menu-comment",
      "menu-indent-increase",
      "menu-indent-decrease",
      "menu-find",
      "menu-find-next",
      "menu-find-previous",
      "menu-compile",
      "menu-upload",
      "menu-upload-programmer",
      "menu-export-binary",
      "menu-show-sketch-folder",
      "menu-manage-libraries",
      "menu-add-zip-library",
      "menu-add-file",
      "menu-auto-format",
      "menu-archive-sketch",
      "menu-fix-encoding",
      "menu-serial-monitor",
      "menu-boards-manager",
      "menu-burn-bootloader",
      "menu-find-reference",
      "menu-about",
      "menu-install-esp32"
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },

  removeMenuListener: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // ==========================================================================
  // FILE SYSTEM
  // ==========================================================================
  openFolder: () => ipcRenderer.invoke("fs-open-folder"),
  showSaveDialog: (options) => ipcRenderer.invoke("fs-show-save-dialog", options),
  getLastWorkspace: () => ipcRenderer.invoke("fs-get-last-workspace"),
  readDirectory: (dirPath) => ipcRenderer.invoke("fs-read-directory", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("fs-read-file", filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke("fs-write-file", { filePath, content }),
  createFile: (folderPath, fileName, content) => ipcRenderer.invoke("fs-create-file", { folderPath, fileName, content }),
  createFolder: (parentPath, folderName) => ipcRenderer.invoke("fs-create-folder", { parentPath, folderName }),
  deleteFile: (targetPath) => ipcRenderer.invoke("fs-delete", targetPath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke("fs-rename", { oldPath, newPath }),
  addRecentFile: (filePath) => ipcRenderer.invoke("add-recent-file", filePath),

  // Terminal
  createTerminal: (options) => ipcRenderer.invoke('terminal-create', options),
  writeTerminal: (data) => ipcRenderer.send('terminal-write', data),
  resizeTerminal: (dims) => ipcRenderer.send('terminal-resize', dims),
  onTerminalData: (callback) => {
    ipcRenderer.on('terminal-incoming-data', (event, data) => callback(data));
  }
});
