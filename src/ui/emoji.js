// 이모티콘 (화면 쪽): 보관함(src/emojiStore.js)에서 이미지를 읽어 프레임으로 풀어 두고,
// 불러온 채팅에 쓰인 이모티콘 목록(등록됨 / 미등록)을 보여준다.
import { EMOJI_RE } from './shared/renderer.js';

const MIME = { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const DOWNLOAD_CONCURRENCY = 4;

// 이미지 → { frames: [ImageBitmap], starts: [ms], total(ms), aspect, animated }
// GIF / APNG / 움직이는 WebP는 ImageDecoder로 프레임과 프레임별 시간을 미리 다 풀어 둔다
export const decodeEmoji = async (bytes, ext) => {
  const type = MIME[ext] || 'image/png';
  if (window.ImageDecoder) {
    try {
      const dec = new ImageDecoder({ data: bytes, type });
      await dec.tracks.ready;
      await dec.completed;
      const count = dec.tracks.selectedTrack.frameCount;
      const frames = [];
      const starts = [];
      let total = 0;
      for (let i = 0; i < count; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        starts.push(total);
        // 브라우저처럼 10ms 이하 프레임은 100ms로 본다 (0이면 무한히 빠르게 돌아버림)
        const ms = (image.duration ?? 0) / 1000;
        total += ms > 10 ? ms : 100;
        frames.push(await createImageBitmap(image));
        image.close();
      }
      dec.close();
      if (frames.length) return { frames, starts, total, aspect: frames[0].width / frames[0].height || 1, animated: frames.length > 1 };
    } catch {}
  }
  const bmp = await createImageBitmap(new Blob([bytes], { type }));
  return { frames: [bmp], starts: [0], total: 1, aspect: bmp.width / bmp.height || 1, animated: false };
};

// 채팅에 쓰인 이모티콘 [이름, 횟수] (많이 쓰인 순)
export const countEmojis = (chats) => {
  const n = new Map();
  for (const c of chats) {
    if (!c.message || !c.message.includes('{:')) continue;
    for (const m of c.message.matchAll(EMOJI_RE)) n.set(m[1], (n.get(m[1]) || 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

// 화면의 6. 이모티콘 칸 + 불러온 이미지 보관. onChange(layoutChanged)는 미리보기를 다시 그리게 한다
export const createEmojiPanel = ({ $, api, onChange }) => {
  const lib = new Map(); // 이름 → 풀어 둔 이미지 (renderer.js가 lib.get으로 쓴다)
  const loadedAt = new Map(); // 이름 → 보관함 등록 시각 (바뀌었으면 다시 읽기)
  const thumbs = new Map(); // 이름 → 미리보기 그림 주소 (blob:)
  let registry = {};
  let usage = []; // [이름, 횟수]
  let urls = {}; // 채팅 파일에 들어 있던 이름 → 주소
  let busy = '';

  const load = async (name) => {
    const entry = registry[name];
    if (!entry) {
      lib.delete(name);
      loadedAt.delete(name);
      return;
    }
    if (loadedAt.get(name) === entry.at && lib.has(name)) return;
    const data = await api.emojiRead(name);
    if (!data) return;
    const bytes = data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes);
    try {
      lib.set(name, await decodeEmoji(bytes, data.ext));
      loadedAt.set(name, entry.at);
      if (thumbs.has(name)) URL.revokeObjectURL(thumbs.get(name));
      thumbs.set(name, URL.createObjectURL(new Blob([bytes], { type: MIME[data.ext] || 'image/png' })));
    } catch {
      lib.delete(name);
    }
  };

  const refresh = async (layout = true) => {
    registry = await api.emojiList();
    await Promise.all(usage.map(([name]) => load(name)));
    render();
    onChange(layout);
  };

  // 주소를 아는데 아직 없거나(또는 자동으로 받은 것인데 주소가 바뀐) 이모티콘을 받는다. 직접 지정한 건 덮어쓰지 않는다
  const downloadMissing = async (force = false) => {
    const todo = usage
      .map(([name]) => name)
      .filter((name) => urls[name] && (!registry[name] || (registry[name].source === 'auto' && (force || registry[name].url !== urls[name]))));
    if (!todo.length) return;
    let done = 0;
    const failed = [];
    const worker = async () => {
      while (todo.length) {
        const name = todo.shift();
        busy = `이모티콘 받는 중... ${done + 1}종째`;
        render();
        const r = await api.emojiDownload(name, urls[name]);
        if (!r.ok) failed.push(`${name} (${r.error})`);
        done++;
      }
    };
    await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
    busy = failed.length ? `받지 못한 이모티콘: ${failed.join(', ')}` : '';
    await refresh();
  };

  // 새 채팅을 불러왔을 때
  const setChats = async (chats) => {
    usage = countEmojis(chats);
    urls = chats.emojiUrls || {};
    registry = await api.emojiList();
    render();
    await refresh();
    await downloadMissing();
  };

  function render() {
    const total = usage.reduce((a, [, n]) => a + n, 0);
    const missing = usage.filter(([name]) => !lib.has(name));
    $('emojiSummary').textContent = usage.length
      ? `이모티콘 ${usage.length}종 (총 ${total.toLocaleString()}번)${missing.length ? ` · ${missing.length}종 미등록` : ' · 모두 등록됨'}${busy ? ` · ${busy}` : ''}`
      : busy || '불러온 채팅에 이모티콘이 없어요.';
    const list = $('emojiList');
    list.innerHTML = '';
    // 미등록을 먼저 (해야 할 일이 위에 보이게)
    const rows = [...usage].sort((a, b) => lib.has(a[0]) - lib.has(b[0]));
    for (const [name, n] of rows) {
      const row = document.createElement('div');
      row.className = 'emojiRow';
      const ok = lib.has(name);
      if (ok) {
        const img = document.createElement('img');
        img.src = thumbs.get(name) || '';
        img.alt = name;
        row.append(img);
      } else {
        const miss = document.createElement('span');
        miss.className = 'emojiMiss';
        miss.textContent = '⚠';
        row.append(miss);
      }
      const label = document.createElement('span');
      label.className = 'emojiName';
      label.textContent = name;
      label.title = urls[name] ? `${name}\n${urls[name]}` : name;
      const count = document.createElement('span');
      count.className = 'emojiCount';
      count.textContent = `×${n.toLocaleString()}`;
      const state = document.createElement('span');
      state.className = ok ? 'emojiState' : 'emojiState miss';
      state.textContent = !ok ? (urls[name] ? '못 받음' : '미등록') : registry[name]?.source === 'auto' ? '자동' : '직접';
      const pick = document.createElement('button');
      pick.className = 'ghost small';
      pick.textContent = ok ? '바꾸기' : '지정';
      pick.title = '이미지 파일 고르기';
      pick.addEventListener('click', async () => {
        const r = await api.emojiPickFile(name);
        if (r && !r.ok) busy = r.error;
        await refresh();
      });
      row.append(label, count, state, pick);
      if (registry[name]) {
        const del = document.createElement('button');
        del.className = 'ghost small';
        del.textContent = '삭제';
        del.title = '보관함에서 지우기';
        del.addEventListener('click', async () => {
          await api.emojiRemove(name);
          await refresh();
        });
        row.append(del);
      }
      list.append(row);
    }
    $('emojiDownload').hidden = !usage.some(([name]) => urls[name]);
  }

  $('emojiDownload').addEventListener('click', () => downloadMissing(true));
  $('emojiFolder').addEventListener('click', async () => {
    const added = await api.emojiPickFolder();
    if (added) busy = `폴더에서 ${added.length}종 등록`;
    await refresh();
  });
  $('emojiOpenDir').addEventListener('click', () => api.emojiOpenDir());

  return { lib, setChats, render };
};
