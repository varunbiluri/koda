const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kodaDesktop', {
  openProject() {
    return ipcRenderer.invoke('koda-open-project');
  },
  requestInitialProject() {
    return ipcRenderer.invoke('koda-open-initial');
  },
  onSessionReady(callback) {
    ipcRenderer.on('koda-session-ready', (_event, session) => callback(session));
  },
  onSessionError(callback) {
    ipcRenderer.on('koda-session-error', (_event, message) => callback(message));
  },
  onSessionLoading(callback) {
    ipcRenderer.on('koda-session-loading', () => callback());
  },
});
