'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  status: () => ipcRenderer.invoke('status'),
  flatpaks: () => ipcRenderer.invoke('flatpaks'),
  setupStatus: () => ipcRenderer.invoke('setup-status'),
  run: (action, arg) => ipcRenderer.invoke('run', action, arg),
  cancel: () => ipcRenderer.invoke('cancel'),
  appInfo: () => ipcRenderer.invoke('app-info'),
  appUpdateCheck: () => ipcRenderer.invoke('app-update-check'),
  appUpdateInstall: () => ipcRenderer.invoke('app-update-install'),
  onUpdateProgress: listen('app-update-progress'),
  onStart: listen('start'),
  onStep: listen('step'),
  onLog: listen('log'),
});
