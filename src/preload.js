const { contextBridge, ipcRenderer } = require('electron');
const encoder = require('./encoder');

contextBridge.exposeInMainWorld('api', {
  openChatFile: () => ipcRenderer.invoke('open-chat-file'),
  chooseOutput: (opts) => ipcRenderer.invoke('choose-output', opts),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  setFullScreen: (on) => ipcRenderer.send('set-fullscreen', on),
  // 이모티콘 보관함 (src/emojiStore.js)
  emojiList: () => ipcRenderer.invoke('emoji-list'),
  emojiRead: (name) => ipcRenderer.invoke('emoji-read', name),
  emojiDownload: (name, url) => ipcRenderer.invoke('emoji-download', name, url),
  emojiPickFile: (name) => ipcRenderer.invoke('emoji-pick-file', name),
  emojiPickFolder: () => ipcRenderer.invoke('emoji-pick-folder'),
  emojiRemove: (name) => ipcRenderer.invoke('emoji-remove', name),
  emojiOpenDir: () => ipcRenderer.invoke('emoji-open-dir'),
  // 인코딩은 여기서 바로 ffmpeg로 (프레임마다 메인 프로세스를 거치지 않는다)
  encodePartCount: (format, frames, fps) => encoder.partCount(format, frames, fps),
  encodeStart: (opts, parts) => encoder.start(opts, parts),
  encodeWrite: (part, data) => encoder.write(part, data),
  encodeRepeat: (part, n) => encoder.repeat(part, n),
  encodeFinish: () => encoder.finish(),
  encodeCancel: () => encoder.cancel(),
  smokeDone: (result) => ipcRenderer.send('smoke-done', result),
  smokeChatText: () => ipcRenderer.invoke('smoke-chat-text'),
});
