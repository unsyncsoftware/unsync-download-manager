const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // main.js expects: { url, fileName, threads, headers }
  startDownload: ({ url, fileName, threads, headers }) =>
    ipcRenderer.send('start-download', { url, fileName, threads, headers }),

  pauseDownload: (fileName) =>
    ipcRenderer.send('pause-download', fileName),

  resumeDownload: (fileName) =>
    ipcRenderer.send('resume-download', fileName),

  exit: () =>
    ipcRenderer.send('exit-app'),

  // Listener - returns an unsubscribe function
  onDownloadProgress: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },
});
