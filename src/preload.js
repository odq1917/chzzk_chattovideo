const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openChatFile: () => ipcRenderer.invoke('open-chat-file'),
  chooseOutput: (opts) => ipcRenderer.invoke('choose-output', opts),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  renderStart: (opts) => ipcRenderer.invoke('render-start', opts),
  renderFrame: (buf) => ipcRenderer.invoke('render-frame', buf),
  renderRepeat: (n) => ipcRenderer.invoke('render-repeat', n),
  renderFinish: () => ipcRenderer.invoke('render-finish'),
  renderCancel: () => ipcRenderer.invoke('render-cancel'),
  smokeDone: (result) => ipcRenderer.send('smoke-done', result),
});
