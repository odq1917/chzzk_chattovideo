// ffmpeg 인코딩 — preload에서 불러 쓴다.
// 프레임을 메인 프로세스(IPC)를 거치지 않고 바로 ffmpeg stdin에 쓴다. (IPC 왕복이 프레임당 가장 큰 비용이었다)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// 패키징되면 ffmpeg 실행 파일은 app.asar.unpacked 안에 있다
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

const FORMAT_EXT = { webm: 'webm', 'mov-qtrle': 'mov', 'mov-prores': 'mov', 'mp4-green': 'mp4' };

const ffmpegArgs = (o, outPath) => {
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
      return [...input, '-filter_complex', place, '-map', '[v]', '-c:v', 'qtrle', '-pix_fmt', 'argb', outPath];
    case 'mov-prores':
      return [...input, '-filter_complex', place, '-map', '[v]', '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', outPath];
    case 'mp4-green': {
      const green = (o.greenColor || '#00ff00').replace('#', '0x');
      const fc = `color=c=${green}:s=${W}x${H}:r=${fps}[bg];[bg][0:v]overlay=${X}:${Y}:shortest=1,format=yuv420p[v]`;
      return [...input, '-filter_complex', fc, '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', outPath];
    }
    case 'webm':
    default:
      return [
        ...input, '-filter_complex', place, '-map', '[v]',
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '32',
        '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-tile-columns', '2', '-threads', '2',
        '-auto-alt-ref', '0', '-lag-in-frames', '0',
        '-g', String(Math.max(1, Math.round(fps * 10))),
        outPath,
      ];
  }
};

// ffmpeg 프로세스 하나 (영상 한 조각)
class Part {
  constructor(opts, outPath) {
    this.outPath = outPath;
    this.lastFrame = null;
    this.stderr = '';
    this.closed = false;
    this.waiting = [];
    this.proc = spawn(ffmpegPath, ffmpegArgs(opts, outPath), { windowsHide: true });
    this.proc.stderr.on('data', (d) => (this.stderr = (this.stderr + d.toString()).slice(-4000)));
    this.proc.stdin.on('error', () => {}); // ffmpeg가 먼저 죽으면 EPIPE — close에서 처리
    this.proc.stdin.on('drain', () => this.waiting.splice(0).forEach(([resolve]) => resolve()));
    this.done = new Promise((resolve) =>
      this.proc.on('close', (code) => {
        this.closed = true;
        this.waiting.splice(0).forEach(([, reject]) => reject(this.error(code)));
        resolve(code);
      }),
    );
  }
  error(code) {
    return new Error(`ffmpeg 오류 (코드 ${code}): ${this.stderr.trim() || 'ffmpeg가 종료되었습니다.'}`);
  }
  // 버퍼에 여유가 있으면 null, 가득 찼으면 비워질 때까지 기다리는 Promise (렌더링이 인코딩보다 앞서 나가지 않도록)
  write(buf) {
    if (this.closed) return Promise.reject(this.error(this.proc.exitCode));
    if (this.proc.stdin.write(buf)) return null;
    return new Promise((resolve, reject) => this.waiting.push([resolve, reject]));
  }
}

let job = null; // { parts: Part[], outPath, format }

// WebM(VP9)은 인코더 하나가 코어를 다 못 쓴다 → 구간을 나눠 동시에 인코딩하고 마지막에 이어붙인다.
// 다른 형식은 나눠도 빨라지지 않거나(ProRes) 이미 충분히 빠르고 임시 파일만 커진다.
const partCount = (format, frames, fps) => {
  if (format !== 'webm' || frames < fps * 20) return 1;
  return Math.max(1, Math.min(8, os.cpus().length));
};

const start = (opts, parts) => {
  if (job) throw new Error('이미 렌더링 중입니다.');
  const ext = FORMAT_EXT[opts.format] || 'webm';
  const n = Math.max(1, parts | 0);
  const paths = n === 1 ? [opts.outPath] : Array.from({ length: n }, (_, i) => `${opts.outPath}.part${i + 1}.${ext}`);
  job = { parts: paths.map((p) => new Part(opts, p)), outPath: opts.outPath };
};

const write = (i, data) => {
  const part = job.parts[i];
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  part.lastFrame = buf;
  return part.write(buf);
};

// 바로 앞 프레임과 똑같은 화면이 n번 이어질 때 (채팅이 없는 구간) — 픽셀을 다시 넘기지 않는다
const repeat = async (i, n) => {
  const part = job.parts[i];
  for (let k = 0; k < n; k++) {
    const wait = part.write(part.lastFrame);
    if (wait) await wait;
  }
};

const removeQuietly = (p) => {
  try {
    fs.unlinkSync(p);
  } catch {}
};

// 조각들을 재인코딩 없이 이어붙인다
const concat = (paths, outPath) =>
  new Promise((resolve, reject) => {
    const list = path.join(os.tmpdir(), `chattovideo-concat-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(list, paths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    const proc = spawn(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', outPath], { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      removeQuietly(list);
      code === 0 ? resolve() : reject(new Error(`조각 합치기 오류 (코드 ${code}): ${stderr.trim()}`));
    });
  });

const finish = async () => {
  const current = job;
  job = null;
  current.parts.forEach((p) => p.proc.stdin.end());
  const codes = await Promise.all(current.parts.map((p) => p.done));
  try {
    const bad = codes.findIndex((c) => c !== 0);
    if (bad >= 0) throw current.parts[bad].error(codes[bad]);
    if (current.parts.length > 1) await concat(current.parts.map((p) => p.outPath), current.outPath);
  } finally {
    if (current.parts.length > 1) current.parts.forEach((p) => removeQuietly(p.outPath));
  }
  return { path: current.outPath, size: fs.statSync(current.outPath).size, parts: current.parts.length };
};

const cancel = async () => {
  if (!job) return;
  const current = job;
  job = null;
  current.parts.forEach((p) => p.proc.kill());
  await Promise.all(current.parts.map((p) => p.done));
  current.parts.forEach((p) => removeQuietly(p.outPath));
  removeQuietly(current.outPath);
};

module.exports = { FORMAT_EXT, partCount, start, write, repeat, finish, cancel };
