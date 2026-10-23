// 이모티콘 보관함 (메인 프로세스). 앱 데이터 폴더의 emojis/ 에 이미지를 복사해 두고 registry.json에 이름 → 파일을 적는다.
// 한 번 등록(자동 받기 / 파일 지정 / 폴더 등록)한 이모티콘은 다음에 다시 안 해도 된다.
const fs = require('fs');
const path = require('path');

const IMAGE_EXT = ['.png', '.gif', '.webp', '.jpg', '.jpeg', '.apng'];
const TYPE_EXT = { 'image/png': '.png', 'image/apng': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/jpeg': '.jpg' };
const MAX_BYTES = 10 * 1024 * 1024;

const createEmojiStore = (dir) => {
  const regPath = path.join(dir, 'registry.json');
  let reg = {};
  try {
    reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  } catch {}
  const save = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(regPath, JSON.stringify(reg, null, 1));
  };
  // 파일 이름에 못 쓰는 글자만 바꾼다 (이모티콘 이름은 보통 marongHi, d_41 같은 형태)
  const fileBase = (name) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);

  const put = (name, bytes, ext, info) => {
    fs.mkdirSync(dir, { recursive: true });
    const old = reg[name];
    const file = fileBase(name) + ext;
    fs.writeFileSync(path.join(dir, file), bytes);
    if (old && old.file !== file) fs.rmSync(path.join(dir, old.file), { force: true });
    reg[name] = { file, ...info, at: Date.now() };
    save();
    return reg[name];
  };

  return {
    list: () => reg,
    read: (name) => {
      const e = reg[name];
      if (!e) return null;
      try {
        return { bytes: fs.readFileSync(path.join(dir, e.file)), ext: path.extname(e.file).toLowerCase() };
      } catch {
        return null;
      }
    },
    // 채팅 기록에 들어 있던 주소에서 받기 (https만)
    download: async (name, url) => {
      if (!/^https:\/\//i.test(url)) throw new Error('https 주소가 아니에요');
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const urlExt = path.extname(new URL(url).pathname).toLowerCase();
      const ext = TYPE_EXT[type] || (IMAGE_EXT.includes(urlExt) ? urlExt : null);
      if (!ext) throw new Error(`이미지가 아니에요 (${type || '형식 모름'})`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_BYTES) throw new Error('파일이 너무 커요');
      return put(name, bytes, ext, { source: 'auto', url });
    },
    addFile: (name, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (!IMAGE_EXT.includes(ext)) throw new Error('png / gif / webp / jpg 이미지만 돼요');
      return put(name, fs.readFileSync(filePath), ext === '.apng' ? '.png' : ext, { source: 'file' });
    },
    // 폴더 안 이미지 전부: 파일 이름(확장자 뺀 것) = 이모티콘 이름
    addFolder: (folder) => {
      const added = [];
      for (const f of fs.readdirSync(folder)) {
        const ext = path.extname(f).toLowerCase();
        if (!IMAGE_EXT.includes(ext)) continue;
        const name = path.basename(f, path.extname(f));
        put(name, fs.readFileSync(path.join(folder, f)), ext === '.apng' ? '.png' : ext, { source: 'file' });
        added.push(name);
      }
      return added;
    },
    remove: (name) => {
      const e = reg[name];
      if (!e) return;
      fs.rmSync(path.join(dir, e.file), { force: true });
      delete reg[name];
      save();
    },
    dir,
  };
};

module.exports = { createEmojiStore, IMAGE_EXT };
