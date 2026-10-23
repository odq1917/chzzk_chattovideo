// Electron 메인 프로세스: 창, 파일 대화상자 (인코딩은 preload의 encoder.js)
const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { FORMAT_EXT } = require('./encoder');

const smokeArg = process.argv.find((a) => a.startsWith('--smoke-test='));
const SMOKE_OUT = smokeArg ? path.resolve(smokeArg.split('=')[1]) : null;
const smokeSecArg = process.argv.find((a) => a.startsWith('--smoke-seconds='));
const SMOKE_SECONDS = smokeSecArg ? Number(smokeSecArg.split('=')[1]) || 4 : 4;
const smokeFmtArg = process.argv.find((a) => a.startsWith('--smoke-format='));
const SMOKE_FORMAT = smokeFmtArg ? smokeFmtArg.split('=')[1] : '';
const smokeOutputArg = process.argv.find((a) => a.startsWith('--smoke-output='));
const SMOKE_OUTPUT = smokeOutputArg ? smokeOutputArg.split('=')[1] : 'full';

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
  win.loadFile(path.join(__dirname, 'ui', 'index.html'), SMOKE_OUT ? { query: { smoke: SMOKE_OUT, seconds: String(SMOKE_SECONDS), format: SMOKE_FORMAT, output: SMOKE_OUTPUT } } : undefined);
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
ipcMain.on('set-fullscreen', (e, on) => win && win.setFullScreen(!!on));

// 자동 점검 모드: 렌더링이 끝나면 결과를 출력하고 종료 (CI에서 exe가 실제로 영상을 만드는지 확인용)
ipcMain.on('smoke-done', (e, result) => {
  console.log('SMOKE_RESULT ' + JSON.stringify(result));
  app.exit(result && result.ok ? 0 : 1);
});
