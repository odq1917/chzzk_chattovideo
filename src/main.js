// Electron 메인 프로세스: 창, 파일 대화상자, ffmpeg 인코딩 파이프라인
const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// 패키징되면 ffmpeg 실행 파일은 app.asar.unpacked 안에 있다
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

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

const FORMAT_EXT = { webm: 'webm', 'mov-qtrle': 'mov', 'mov-prores': 'mov', 'mp4-green': 'mp4' };

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

// ---------- 렌더링 (ffmpeg) ----------

let job = null; // { proc, outPath, lastFrame, stderr, closed }

const ffmpegArgs = (o) => {
  const { boxW, boxH, fps } = o;
  // '채팅 상자만' 출력이면 영상 크기 = 상자 크기 (편집 프로그램에서 위치를 직접 잡는다)
  const boxOnly = o.outputMode === 'box';
  const W = boxOnly ? boxW : o.width;
  const H = boxOnly ? boxH : o.height;
  const X = boxOnly ? 0 : o.boxX;
  const Y = boxOnly ? 0 : o.boxY;
  const input = ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${boxW}x${boxH}`, '-r', String(fps), '-i', '-'];
  // 채팅 상자 크기로만 그려서 넘기고, ffmpeg가 전체 화면 크기의 지정 위치에 놓는다
  const place = `[0:v]format=rgba,pad=${W}:${H}:${X}:${Y}:color=0x00000000[v]`;
  switch (o.format) {
    case 'mov-qtrle':
      return [...input, '-filter_complex', place, '-map', '[v]', '-c:v', 'qtrle', '-pix_fmt', 'argb', o.outPath];
    case 'mov-prores':
      return [...input, '-filter_complex', place, '-map', '[v]', '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', o.outPath];
    case 'mp4-green': {
      const green = (o.greenColor || '#00ff00').replace('#', '0x');
      const fc = `color=c=${green}:s=${W}x${H}:r=${fps}[bg];[bg][0:v]overlay=${X}:${Y}:shortest=1,format=yuv420p[v]`;
      return [...input, '-filter_complex', fc, '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', o.outPath];
    }
    case 'webm':
    default:
      return [
        ...input, '-filter_complex', place, '-map', '[v]',
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '32',
        '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-tile-columns', '2', '-threads', '8',
        '-auto-alt-ref', '0', '-lag-in-frames', '0',
        '-g', String(Math.max(1, Math.round(fps * 10))),
        o.outPath,
      ];
  }
};

// stdin에 쓰고, 버퍼가 차면 비워질 때까지 기다린다 (렌더링이 인코딩보다 앞서 나가지 않도록)
const writeFrame = (buf) =>
  new Promise((resolve, reject) => {
    if (!job || job.closed) return reject(new Error(job?.stderr || 'ffmpeg가 종료되었습니다.'));
    if (job.proc.stdin.write(buf)) resolve();
    else job.proc.stdin.once('drain', resolve);
  });

ipcMain.handle('render-start', async (e, opts) => {
  if (job) throw new Error('이미 렌더링 중입니다.');
  const proc = spawn(ffmpegPath, ffmpegArgs(opts), { windowsHide: true });
  job = { proc, outPath: opts.outPath, lastFrame: null, stderr: '', closed: false };
  const current = job;
  proc.stderr.on('data', (d) => (current.stderr = (current.stderr + d.toString()).slice(-4000)));
  proc.stdin.on('error', () => {}); // ffmpeg가 먼저 죽으면 EPIPE — close 이벤트에서 처리
  current.done = new Promise((resolve) => proc.on('close', (code) => { current.closed = true; resolve(code); }));
  return true;
});

ipcMain.handle('render-frame', async (e, arrayBuffer) => {
  const buf = Buffer.from(arrayBuffer);
  job.lastFrame = buf;
  await writeFrame(buf);
});

// 바로 앞 프레임과 똑같은 화면이 n번 이어질 때 (채팅이 없는 구간) — 픽셀을 다시 보내지 않는다
ipcMain.handle('render-repeat', async (e, n) => {
  for (let i = 0; i < n; i++) await writeFrame(job.lastFrame);
});

ipcMain.handle('render-finish', async () => {
  const current = job;
  current.proc.stdin.end();
  const code = await current.done;
  job = null;
  if (code !== 0) throw new Error(`ffmpeg 오류 (코드 ${code}): ${current.stderr.trim()}`);
  return { path: current.outPath, size: fs.statSync(current.outPath).size };
});

ipcMain.handle('render-cancel', async () => {
  if (!job) return;
  const current = job;
  job = null;
  current.proc.kill();
  await current.done;
  try {
    fs.unlinkSync(current.outPath);
  } catch {}
});

// 자동 점검 모드: 렌더링이 끝나면 결과를 출력하고 종료 (CI에서 exe가 실제로 영상을 만드는지 확인용)
ipcMain.on('smoke-done', (e, result) => {
  console.log('SMOKE_RESULT ' + JSON.stringify(result));
  app.exit(result && result.ok ? 0 : 1);
});
