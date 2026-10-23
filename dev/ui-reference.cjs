// 개발용 UI 확인 스크립트 (Playwright + Electron). 전역 playwright 필요: npm i -g playwright
//   node dev/ui-reference.cjs <스크린샷 저장 폴더>     (리눅스 헤드리스면 xvfb-run -a 를 앞에)
const path = require('path');
const { _electron } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const ROOT = path.resolve(__dirname, '..');
const dir = process.argv[2];
// 참고 화면용 테스트 이미지/영상 (없으면 ffmpeg-static으로 만든다)
{
  const fs = require('fs');
  const ff = require(path.join(ROOT, 'node_modules', 'ffmpeg-static'));
  const { execFileSync } = require('child_process');
  if (!fs.existsSync(path.join(dir, 'ref.mp4'))) execFileSync(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'ref.mp4')]);
  if (!fs.existsSync(path.join(dir, 'ref.png'))) execFileSync(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080', '-frames:v', '1', path.join(dir, 'ref.png')]);
}
(async () => {
  const app = await _electron.launch({ cwd: ROOT, args: ['.', '--no-sandbox'], executablePath: require(path.join(ROOT, 'node_modules', 'electron')) });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('pageerror', e.message));
  win.on('console', (m) => m.type() === 'error' && console.log('console error', m.text()));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => localStorage.clear());
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  const names = ['치즈냥', '하늘바라기', '익명의 후원자', 'player_one', '말랑볼살', '서몽의말랑볼살귀엽군'];
  const lines = [];
  for (let i = 0; i < 80; i++) lines.push(`[00:00:${String(Math.floor(i / 3)).padStart(2, '0')}] <${names[i % 6]}> 채팅 ${i + 1} ${i % 4 === 0 ? 'ㅋㅋㅋㅋㅋ 이거 진짜 웃기네' : '안녕하세요'}`);
  await win.click('#togglePaste');
  await win.fill('#pasteText', lines.join('\n'));
  await win.click('#applyPaste');
  await win.waitForTimeout(400);
  await win.setInputFiles('#refFile', path.join(dir, 'ref.png'));
  await win.waitForTimeout(500);
  await win.fill('#seek', '20'); await win.dispatchEvent('#seek', 'input');
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(dir, 'r1-image.png') });
  await win.selectOption('#zoom', '1');
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(dir, 'r2-zoom100.png') });
  await win.selectOption('#zoom', 'fit');
  await win.setInputFiles('#refFile', path.join(dir, 'ref.mp4'));
  await win.waitForTimeout(1200);
  console.log('refName:', await win.textContent('#refName'), 'offsetHidden:', await win.$eval('#refOffsetRow', (e) => e.hidden));
  await win.fill('#seek', '12'); await win.dispatchEvent('#seek', 'input');
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(dir, 'r3-video.png') });
  await win.click('#play');
  await win.waitForTimeout(1500);
  await win.click('#play');
  await win.waitForTimeout(500);
  console.log('clock after play:', await win.textContent('#clock'));
  await win.click('#bigView');
  await win.waitForTimeout(800);
  console.log('big:', await win.evaluate(() => [document.body.classList.contains('big'), document.getElementById('preview').style.width]));
  await win.screenshot({ path: path.join(dir, 'r4-big.png') });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);
  console.log('after esc:', await win.evaluate(() => [document.body.classList.contains('big'), document.getElementById('preview').style.width]));
  await win.selectOption('#zoom', '1');
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(dir, 'r5-zoom-scrolled.png') });
  await app.close();
})();
