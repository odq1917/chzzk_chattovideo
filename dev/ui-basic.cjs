// 개발용 UI 확인 스크립트 (Playwright + Electron). 전역 playwright 필요: npm i -g playwright
//   node dev/ui-basic.cjs <스크린샷 저장 폴더>     (리눅스 헤드리스면 xvfb-run -a 를 앞에)
const path = require('path');
const { _electron } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const app = await _electron.launch({ cwd: ROOT, args: ['.', '--no-sandbox'], executablePath: require(path.join(ROOT, 'node_modules', 'electron')) });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('pageerror', e.message));
  win.on('console', (m) => m.type() === 'error' && console.log('console error', m.text()));
  await win.setViewportSize({ width: 1360, height: 900 }).catch(() => {});
  await win.waitForLoadState('domcontentloaded');
  const lines = [];
  const names = ['치즈냥', '하늘바라기', '익명의 후원자', 'player_one', '말랑볼살', '서몽의말랑볼살귀엽군'];
  for (let i = 0; i < 80; i++) lines.push(`[00:00:${String(Math.floor(i / 3)).padStart(2, '0')}] <${names[i % 6]}> ${i % 5 === 2 ? '[영상 후원 3,340원] ' : ''}채팅 ${i + 1} ${i % 4 === 0 ? 'ㅋㅋㅋㅋㅋ 이거 진짜 웃기네 ㅋㅋㅋㅋ 줄이 길어지면 어떻게 되는지 봅시다' : '안녕하세요'}`);
  await win.click('#togglePaste');
  await win.fill('#pasteText', lines.join('\n'));
  await win.click('#applyPaste');
  await win.waitForTimeout(500);
  console.log('정보:', await win.textContent('#chatInfo'));
  await win.fill('#seek', '20');
  await win.dispatchEvent('#seek', 'input');
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(process.argv[2], 'app1.png') });
  await win.selectOption('#previewBg', 'dark');
  await win.check('input[name="nickMode"][value="single"]');
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(process.argv[2], 'app2.png') });
  await app.close();
})();
