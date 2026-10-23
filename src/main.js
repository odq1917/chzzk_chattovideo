// Electron 메인 프로세스: 창, 파일 대화상자 (인코딩은 preload의 encoder.js)
const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { FORMAT_EXT } = require('./encoder');
const { createEmojiStore, IMAGE_EXT } = require('./emojiStore');

const smokeArg = process.argv.find((a) => a.startsWith('--smoke-test='));
const SMOKE_OUT = smokeArg ? path.resolve(smokeArg.split('=')[1]) : null;
const smokeSecArg = process.argv.find((a) => a.startsWith('--smoke-seconds='));
const SMOKE_SECONDS = smokeSecArg ? Number(smokeSecArg.split('=')[1]) || 4 : 4;
const smokeFmtArg = process.argv.find((a) => a.startsWith('--smoke-format='));
const SMOKE_FORMAT = smokeFmtArg ? smokeFmtArg.split('=')[1] : '';
const smokeOutputArg = process.argv.find((a) => a.startsWith('--smoke-output='));
const SMOKE_OUTPUT = smokeOutputArg ? smokeOutputArg.split('=')[1] : 'full';
// 예시 채팅 대신 실제 채팅 파일로 점검 (이모티콘 자동 받기까지): --smoke-chat=파일 --smoke-start=초
const smokeChatArg = process.argv.find((a) => a.startsWith('--smoke-chat='));
const SMOKE_CHAT = smokeChatArg ? path.resolve(smokeChatArg.slice('--smoke-chat='.length)) : '';
const smokeStartArg = process.argv.find((a) => a.startsWith('--smoke-start='));
const SMOKE_START = smokeStartArg ? Number(smokeStartArg.split('=')[1]) || 0 : 0;

let win;

const createWindow = () => {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: !SMOKE_OUT,
    title: '치지직 채팅 영상 만들기',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // 창이 뒤에 있어도 렌더링 속도 유지
    },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'), SMOKE_OUT ? { query: { smoke: SMOKE_OUT, seconds: String(SMOKE_SECONDS), format: SMOKE_FORMAT, output: SMOKE_OUTPUT, chat: SMOKE_CHAT ? '1' : '', start: String(SMOKE_START) } } : undefined);
};

app.whenReady().then(() => {
  // 설치된 글꼴 목록(queryLocalFonts) 허용
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'local-fonts'));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'local-fonts');
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ---------- 파일 ----------

ipcMain.handle('open-chat-file', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '채팅 파일 열기',
    filters: [{ name: '채팅 내역', extensions: ['csv', 'txt'] }, { name: '모든 파일', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8') };
});

ipcMain.handle('choose-output', async (e, { format, defaultName }) => {
  const ext = FORMAT_EXT[format] || 'webm';
  const r = await dialog.showSaveDialog(win, {
    title: '영상 저장 위치',
    defaultPath: path.join(app.getPath('videos'), `${defaultName || 'chat'}.${ext}`),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('reveal', (e, p) => shell.showItemInFolder(p));

// ---------- 이모티콘 보관함 ----------
let emojiStore;
const emojis = () => (emojiStore ||= createEmojiStore(path.join(app.getPath('userData'), 'emojis')));
ipcMain.handle('emoji-list', () => emojis().list());
ipcMain.handle('emoji-read', (e, name) => emojis().read(name));
ipcMain.handle('emoji-download', async (e, name, url) => {
  try {
    return { ok: true, entry: await emojis().download(name, url) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('emoji-pick-file', async (e, name) => {
  const r = await dialog.showOpenDialog(win, {
    title: `「${name}」 이모티콘 이미지 고르기`,
    filters: [{ name: '이미지', extensions: IMAGE_EXT.map((x) => x.slice(1)) }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    return { ok: true, entry: emojis().addFile(name, r.filePaths[0]) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('emoji-pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: '이모티콘 폴더 고르기 (파일 이름 = 이모티콘 이름)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return emojis().addFolder(r.filePaths[0]);
});
ipcMain.handle('emoji-remove', (e, name) => emojis().remove(name));
ipcMain.handle('emoji-open-dir', () => {
  fs.mkdirSync(emojis().dir, { recursive: true });
  return shell.openPath(emojis().dir);
});
ipcMain.on('set-fullscreen', (e, on) => win && win.setFullScreen(!!on));

// 자동 점검 모드: 렌더링이 끝나면 결과를 출력하고 종료 (CI에서 exe가 실제로 영상을 만드는지 확인용)
ipcMain.handle('smoke-chat-text', () => (SMOKE_CHAT ? fs.readFileSync(SMOKE_CHAT, 'utf8') : ''));
ipcMain.on('smoke-done', (e, result) => {
  console.log('SMOKE_RESULT ' + JSON.stringify(result));
  app.exit(result && result.ok ? 0 : 1);
});
