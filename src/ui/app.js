import { DEFAULT_SETTINGS, NICK_PALETTE, buildTimeline, prepare, drawFrame, frameKey, formatClock, parseClock } from './shared/renderer.js';
import { parseChatText } from './shared/parse.js';
import { createEmojiPanel } from './emoji.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'chattovideo:settings';
const VERSION = '0.3.0';
$('version').textContent = `v${VERSION}`;

// ---------- 상태 ----------
const loadSettings = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    // v0.2.0까지 저장된 설정: 배경 모양이 없었다. 상자 배경을 켜 두고 쓰던 사람은 상자 모드로 이어서
    if (saved.bgMode === undefined && saved.bgOpacity > 0) saved.bgMode = 'box';
    // 0.3.0 테스트판의 좌우/위아래 여백 → 왼쪽·오른쪽·위·아래 따로
    if (saved.bubblePadX !== undefined && saved.bubblePadLeft === undefined) saved.bubblePadLeft = saved.bubblePadRight = saved.bubblePadX;
    if (saved.bubblePadY !== undefined && saved.bubblePadTop === undefined) saved.bubblePadTop = saved.bubblePadBottom = saved.bubblePadY;
    delete saved.bubblePadX;
    delete saved.bubblePadY;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};
const s = loadSettings();
const saveSettings = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
};

let chats = [];
let timeline = [];
let items = [];
let duration = 0; // 마지막 채팅 시각(초)
let t = 0;
let playing = false;
let speed = 1;
let rendering = false;
let cancelRequested = false;

// 6. 이모티콘 칸. 이미지를 새로 불러오면 줄바꿈(이모티콘 폭)부터 다시 계산
let emojiReady = Promise.resolve();
const emoji = createEmojiPanel({ $, api: window.api, onChange: (layout) => (layout ? reprepare() : draw()) });

// 채팅 상자 크기의 캔버스에 그린다 (미리보기와 영상 출력이 같은 그림을 쓴다)
let boxCanvas = new OffscreenCanvas(s.boxW, s.boxH);
let boxCtx = boxCanvas.getContext('2d', { willReadFrequently: true });
const ensureBoxCanvas = () => {
  if (boxCanvas.width !== s.boxW || boxCanvas.height !== s.boxH) {
    boxCanvas = new OffscreenCanvas(s.boxW, s.boxH);
    boxCtx = boxCanvas.getContext('2d', { willReadFrequently: true });
  }
};

const fontReady = async () => {
  try {
    await document.fonts.load(`${s.fontSize}px "${s.fontFamily}"`, '가A');
    await document.fonts.load(`bold ${s.fontSize}px "${s.fontFamily}"`, '가A');
  } catch {}
};

// 줄바꿈/높이 계산은 글꼴·크기·상자 폭 등이 바뀔 때만 다시
let prepareTimer = null;
const reprepare = (immediate = false) => {
  clearTimeout(prepareTimer);
  const run = async () => {
    await fontReady();
    ensureBoxCanvas();
    items = prepare(boxCtx, timeline, s, emoji.lib);
    draw();
  };
  if (immediate) return run();
  prepareTimer = setTimeout(run, 120);
};

const setChats = (list, label) => {
  chats = list;
  timeline = buildTimeline(chats);
  duration = timeline.length ? timeline[timeline.length - 1].t : 0;
  $('seek').max = String(Math.max(1, duration + 5));
  t = 0;
  $('chatInfo').textContent = chats.length
    ? `${label ? label + ' · ' : ''}채팅 ${chats.length.toLocaleString()}개 · 길이 ${formatClock(duration)}`
    : '읽을 수 있는 채팅이 없어요. 형식을 확인해주세요.';
  $('rangeStart').value = formatClock(0);
  $('rangeEnd').value = formatClock(Math.ceil(duration) + 5);
  // 쓰인 이모티콘 확인 → 보관함에서 불러오기 → 주소가 있으면 미등록분 자동으로 받기 (끝나면 다시 그림)
  emojiReady = emoji.setChats(chats).catch((err) => ($('emojiSummary').textContent = `이모티콘 불러오기 오류: ${err.message}`));
  return reprepare(true);
};

// ---------- 설정 입력 ----------
const LAYOUT_KEYS = new Set(['fontFamily', 'fontSize', 'lineHeight', 'messageGap', 'textColor', 'textBold', 'boxW', 'padding', 'nickMode', 'nickColor', 'nickBold', 'showDonation', 'donationColor', 'palette', 'bgMode', 'bubblePadLeft', 'bubblePadRight', 'bubblePadTop', 'bubblePadBottom', 'bubbleGap', 'letterSpacing', 'emojiScale', 'emojiGap', 'emojiMissing']);

const clampBox = () => {
  s.width = Math.max(16, Math.round(s.width / 2) * 2); // 영상 코덱은 짝수 크기가 필요
  s.height = Math.max(16, Math.round(s.height / 2) * 2);
  s.boxW = Math.max(40, Math.min(Math.round(s.boxW / 2) * 2, s.width));
  s.boxH = Math.max(40, Math.min(Math.round(s.boxH / 2) * 2, s.height));
  s.boxX = Math.max(0, Math.min(Math.round(s.boxX), s.width - s.boxW));
  s.boxY = Math.max(0, Math.min(Math.round(s.boxY), s.height - s.boxH));
};

const syncInputs = () => {
  for (const el of document.querySelectorAll('[data-key]')) {
    const v = s[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v ?? '';
  }
  for (const r of document.querySelectorAll('input[name="nickMode"]')) r.checked = r.value === s.nickMode;
  $('singleColorRow').hidden = s.nickMode !== 'single';
  $('paletteRow').hidden = s.nickMode !== 'palette';
  $('greenRow').hidden = s.format !== 'mp4-green';
  const bubble = s.bgMode === 'bubble';
  for (const id of ['bubbleSub', 'bubbleRows', 'bubbleShadowRow', 'bubbleHint']) $(id).hidden = !bubble;
  for (const id of ['boxBgSub', 'boxBgRows']) $(id).hidden = s.bgMode !== 'box';
  $('messageGapRow').hidden = bubble; // 말풍선 모드에서는 「말풍선 사이 간격」을 쓴다
  $('fadeTopRow').hidden = !s.fadeTop;
  $('fontPickRow').hidden = !s.useLocalFonts;
  if ($('fontPick').value !== s.fontFamily) $('fontPick').value = s.fontFamily; // 목록에 없으면 빈칸
  renderPalette();
};

const onSettingChanged = (key) => {
  clampBox();
  saveSettings();
  if (['width', 'height', 'boxX', 'boxY', 'boxW', 'boxH'].includes(key)) syncInputs();
  if (['format', 'nickMode', 'bgMode', 'fadeTop', 'useLocalFonts', 'fontFamily'].includes(key)) syncInputs();
  if (key === 'useLocalFonts') loadFontList();
  if (LAYOUT_KEYS.has(key)) reprepare();
  else {
    ensureBoxCanvas();
    if (key === 'boxH') reprepare();
    resizePreview();
    draw();
  }
};

for (const el of document.querySelectorAll('[data-key]')) {
  el.addEventListener(el.type === 'range' || el.type === 'color' ? 'input' : 'change', () => {
    const key = el.dataset.key;
    if (el.type === 'checkbox') s[key] = el.checked;
    else if (el.type === 'number' || el.type === 'range' || key === 'fps') s[key] = Number(el.value);
    else s[key] = el.value;
    onSettingChanged(key);
  });
}
for (const r of document.querySelectorAll('input[name="nickMode"]')) {
  r.addEventListener('change', () => {
    s.nickMode = r.value;
    onSettingChanged('nickMode');
  });
}

const renderPalette = () => {
  const box = $('palette');
  box.innerHTML = '';
  (s.palette || NICK_PALETTE).forEach((c, i) => {
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = c;
    inp.addEventListener('input', () => {
      s.palette = [...s.palette];
      s.palette[i] = inp.value;
      onSettingChanged('palette');
    });
    box.appendChild(inp);
  });
};
$('resetPalette').addEventListener('click', () => {
  s.palette = [...NICK_PALETTE];
  renderPalette();
  onSettingChanged('palette');
});

const PRESETS = {
  right: () => ({ boxW: Math.round(s.width * 0.23), boxH: Math.round(s.height * 0.66), boxX: Math.round(s.width * 0.75), boxY: Math.round(s.height * 0.26) }),
  left: () => ({ boxW: Math.round(s.width * 0.23), boxH: Math.round(s.height * 0.66), boxX: Math.round(s.width * 0.02), boxY: Math.round(s.height * 0.26) }),
  'bottom-left': () => ({ boxW: Math.round(s.width * 0.3), boxH: Math.round(s.height * 0.4), boxX: Math.round(s.width * 0.02), boxY: Math.round(s.height * 0.57) }),
  full: () => ({ boxW: s.width, boxH: s.height, boxX: 0, boxY: 0 }),
};
for (const b of document.querySelectorAll('[data-preset]')) {
  b.addEventListener('click', () => {
    Object.assign(s, PRESETS[b.dataset.preset]());
    clampBox();
    saveSettings();
    syncInputs();
    reprepare();
    resizePreview();
  });
}

// 글꼴 목록: 「설치된 글꼴 불러오기」를 켜면 PC의 글꼴 전체, 끄면 기본 몇 개만
const FALLBACK_FONTS = ['Malgun Gothic', 'NanumGothic', 'NanumSquare', 'Pretendard', 'Gulim', 'Dotum', 'Arial'];
let localFonts = null; // 한 번 불러오면 다시 묻지 않는다
const escAttr = (f) => f.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
async function loadFontList() {
  let families = FALLBACK_FONTS;
  if (s.useLocalFonts) {
    try {
      if (!localFonts && window.queryLocalFonts) {
        const fonts = await window.queryLocalFonts();
        localFonts = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b, 'ko'));
      }
    } catch {}
    if (localFonts && localFonts.length) families = localFonts;
    $('fontInfo').textContent = localFonts && localFonts.length ? `설치된 글꼴 ${localFonts.length}종을 불러왔어요. 목록의 글자는 그 글꼴로 보여요.` : '설치된 글꼴 목록을 불러오지 못했어요. 글꼴 이름을 직접 입력해 주세요.';
  } else {
    $('fontInfo').textContent = '글꼴 이름을 직접 입력하거나 기본 목록에서 고르세요.';
  }
  $('fontList').innerHTML = families.map((f) => `<option value="${escAttr(f)}"></option>`).join('');
  $('fontPick').innerHTML = '<option value="">— 글꼴 고르기 —</option>' + families.map((f) => `<option value="${escAttr(f)}" style="font-family:&quot;${escAttr(f)}&quot;">${escAttr(f)}</option>`).join('');
  $('fontPick').value = families.includes(s.fontFamily) ? s.fontFamily : '';
}
$('fontPick').addEventListener('change', () => {
  if (!$('fontPick').value) return;
  s.fontFamily = $('fontPick').value;
  onSettingChanged('fontFamily');
});
loadFontList();

// 왼쪽 단계(1~6)를 제목 눌러 접고 펴기. 접힌 상태는 이 PC에 기억
const COLLAPSE_KEY = 'chattovideo:collapsed';
let collapsed = [];
try {
  collapsed = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]');
} catch {}
document.querySelectorAll('.panel > section').forEach((sec, i) => {
  const h = sec.querySelector('h2');
  // "3. 글자" → 번호 동그라미 + 제목 (구분이 잘 보이게)
  const m = h.textContent.match(/^(\d+)\.\s*(.*)$/);
  if (m) h.innerHTML = `<span class="num">${m[1]}</span><span class="title">${m[2]}</span>`;
  sec.classList.toggle('collapsed', collapsed.includes(i));
  h.addEventListener('click', () => {
    sec.classList.toggle('collapsed');
    collapsed = [...document.querySelectorAll('.panel > section')].flatMap((x, j) => (x.classList.contains('collapsed') ? [j] : []));
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
    } catch {}
  });
});

// ---------- 채팅 불러오기 ----------
$('openFile').addEventListener('click', async () => {
  const f = await window.api.openChatFile();
  if (f) setChats(parseChatText(f.text), f.name);
});
$('togglePaste').addEventListener('click', () => ($('pasteBox').hidden = !$('pasteBox').hidden));
$('applyPaste').addEventListener('click', () => setChats(parseChatText($('pasteText').value), '붙여넣기'));
// 파일을 창에 끌어다 놓아도 열림
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  // 이미지/영상이면 참고 화면으로, 아니면 채팅 파일로
  if (/^(image|video)\//.test(file.type)) loadRef(file);
  else setChats(parseChatText(await file.text()), file.name);
});

// ---------- 미리보기 ----------
const preview = $('preview');
const pctx = preview.getContext('2d');
let scale = 1;

let bigView = false;
const isBigView = () => bigView;

// scale: 영상 1픽셀이 화면에서 차지하는 CSS 픽셀. 캔버스는 기기 픽셀 단위로 선명하게 그린다
const resizePreview = () => {
  const wrap = $('previewWrap');
  const dpr = window.devicePixelRatio || 1;
  const zoom = $('zoom').value;
  const pad = isBigView() ? 0 : 16;
  const fit = Math.min((wrap.clientWidth - pad) / s.width, (wrap.clientHeight - pad) / s.height);
  // '실제 크기'는 영상 1픽셀 = 모니터 1픽셀
  scale = zoom === 'fit' ? fit : Number(zoom) / dpr;
  const cssW = Math.max(1, Math.round(s.width * scale));
  const cssH = Math.max(1, Math.round(s.height * scale));
  preview.style.width = `${cssW}px`;
  preview.style.height = `${cssH}px`;
  preview.width = Math.round(cssW * dpr);
  preview.height = Math.round(cssH * dpr);
  draw();
};
new ResizeObserver(resizePreview).observe($('previewWrap'));

const checker = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#d9d9d9';
  x.fillRect(0, 0, 16, 16);
  x.fillStyle = '#f2f2f2';
  x.fillRect(0, 0, 8, 8);
  x.fillRect(8, 8, 8, 8);
  return c;
})();

function draw() {
  if (rendering) return;
  const k = preview.width / s.width; // 캔버스 픽셀 / 영상 픽셀
  const dpr = window.devicePixelRatio || 1;
  const bg = $('previewBg').value;
  pctx.clearRect(0, 0, preview.width, preview.height);
  pctx.fillStyle = bg === 'checker' ? pctx.createPattern(checker, 'repeat') : bg === 'light' ? '#f5f5f5' : '#1b1d21';
  pctx.fillRect(0, 0, preview.width, preview.height);
  if (bg === 'ref') drawRef();

  ensureBoxCanvas();
  boxCtx.clearRect(0, 0, s.boxW, s.boxH);
  drawFrame(boxCtx, items, t, s, emoji.lib);
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(boxCanvas, s.boxX * k, s.boxY * k, s.boxW * k, s.boxH * k);

  // 채팅 상자 테두리와 크기 조절 손잡이 (크게 보기에서는 실제 모습만)
  if (!isBigView()) {
    pctx.save();
    pctx.setLineDash([5 * dpr, 4 * dpr]);
    pctx.lineWidth = dpr;
    pctx.strokeStyle = 'rgba(0, 195, 137, 0.9)';
    pctx.strokeRect(s.boxX * k + 0.5, s.boxY * k + 0.5, s.boxW * k - 1, s.boxH * k - 1);
    pctx.setLineDash([]);
    pctx.fillStyle = '#00c389';
    pctx.fillRect((s.boxX + s.boxW) * k - 9 * dpr, (s.boxY + s.boxH) * k - 9 * dpr, 9 * dpr, 9 * dpr);
    pctx.restore();
  }

  $('clock').textContent = formatClock(t);
  $('seek').value = String(t);
}
$('previewBg').addEventListener('change', () => {
  if ($('previewBg').value === 'ref' && !ref) $('refFile').click();
  syncRefVideo();
  draw();
});
// 확대하면 채팅 상자가 화면 가운데 오도록 스크롤
$('zoom').addEventListener('change', () => {
  resizePreview();
  const wrap = $('previewWrap');
  wrap.scrollLeft = preview.offsetLeft + (s.boxX + s.boxW / 2) * scale - wrap.clientWidth / 2;
  wrap.scrollTop = preview.offsetTop + (s.boxY + s.boxH / 2) * scale - wrap.clientHeight / 2;
});

// ---------- 참고 화면 (미리보기 전용 — 결과 영상에는 들어가지 않는다) ----------
let ref = null; // { kind: 'image' | 'video', el, url }
const refOffset = () => parseClock($('refOffset').value) ?? 0;

// 영상 전체 크기에 맞춰 비율 유지로 깐다 (편집 프로그램의 '프레임 크기에 맞춤'처럼)
function drawRef() {
  if (!ref) return;
  const el = ref.el;
  const w = ref.kind === 'video' ? el.videoWidth : el.naturalWidth;
  const h = ref.kind === 'video' ? el.videoHeight : el.naturalHeight;
  if (!w || !h) return;
  const fit = Math.min(preview.width / w, preview.height / h);
  const dw = w * fit;
  const dh = h * fit;
  pctx.fillStyle = '#000';
  pctx.fillRect(0, 0, preview.width, preview.height);
  pctx.drawImage(el, (preview.width - dw) / 2, (preview.height - dh) / 2, dw, dh);
}

// 참고 영상을 채팅 시계에 맞춘다 (영상 0초 = 채팅 refOffset)
function syncRefVideo(force = false) {
  if (!ref || ref.kind !== 'video') return;
  const v = ref.el;
  const showing = $('previewBg').value === 'ref';
  const target = Math.max(0, t - refOffset());
  if (!showing || !playing || target >= (v.duration || Infinity)) {
    v.pause();
    if (showing && (force || Math.abs(v.currentTime - target) > 0.05)) v.currentTime = Math.min(target, v.duration || target);
    return;
  }
  v.playbackRate = Math.min(speed, 16);
  if (force || Math.abs(v.currentTime - target) > 0.5) v.currentTime = target;
  if (v.paused) v.play().catch(() => {});
}

function loadRef(file) {
  clearRef();
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('video/')) {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.addEventListener('loadeddata', () => {
      syncRefVideo(true);
      draw();
    });
    v.addEventListener('seeked', draw);
    v.addEventListener('error', () => ($('refName').textContent = `${file.name} — 이 영상은 열 수 없어요 (MP4/WebM 권장)`));
    v.src = url;
    ref = { kind: 'video', el: v, url };
  } else {
    const img = new Image();
    img.onload = draw;
    img.src = url;
    ref = { kind: 'image', el: img, url };
  }
  $('refName').textContent = file.name;
  $('refOffsetRow').hidden = ref.kind !== 'video';
  $('refClear').hidden = false;
  $('previewBg').value = 'ref';
  draw();
}

function clearRef() {
  if (!ref) return;
  if (ref.kind === 'video') ref.el.pause();
  URL.revokeObjectURL(ref.url);
  ref = null;
  $('refName').textContent = '참고 화면 없음';
  $('refOffsetRow').hidden = true;
  $('refClear').hidden = true;
  if ($('previewBg').value === 'ref') $('previewBg').value = 'checker';
  draw();
}

$('refOpen').addEventListener('click', () => $('refFile').click());
$('refFile').addEventListener('change', () => {
  const file = $('refFile').files[0];
  if (file) loadRef(file);
  $('refFile').value = '';
});
$('refClear').addEventListener('click', clearRef);
$('refOffset').addEventListener('change', () => syncRefVideo(true));

// ---------- 크게 보기 ----------
// 미리보기가 창 전체를 덮고, 창도 전체 화면으로 (영상 1픽셀 ≈ 모니터 1픽셀에 가깝게 체감)
const setBigView = (on) => {
  if (on === bigView || rendering) return;
  bigView = on;
  document.body.classList.toggle('big', on);
  window.api.setFullScreen(on);
  resizePreview();
};
$('bigView').addEventListener('click', () => setBigView(true));
preview.addEventListener('dblclick', () => setBigView(!bigView));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && bigView) return setBigView(false);
  if (rendering || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPlaying(!playing);
  } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault();
    t = Math.max(0, Math.min(duration + 5, t + (e.code === 'ArrowLeft' ? -5 : 5)));
    syncRefVideo(true);
    draw();
  }
});

// 상자 끌어서 옮기기 / 모서리 끌어서 크기 바꾸기
let drag = null;
preview.addEventListener('mousedown', (e) => {
  const r = preview.getBoundingClientRect();
  const x = (e.clientX - r.left) / scale;
  const y = (e.clientY - r.top) / scale;
  const nearCorner = Math.abs(x - (s.boxX + s.boxW)) < 14 / scale && Math.abs(y - (s.boxY + s.boxH)) < 14 / scale;
  const inside = x >= s.boxX && x <= s.boxX + s.boxW && y >= s.boxY && y <= s.boxY + s.boxH;
  if (!nearCorner && !inside) return;
  drag = { mode: nearCorner ? 'resize' : 'move', x, y, box: { boxX: s.boxX, boxY: s.boxY, boxW: s.boxW, boxH: s.boxH } };
});
window.addEventListener('mousemove', (e) => {
  const r = preview.getBoundingClientRect();
  const x = (e.clientX - r.left) / scale;
  const y = (e.clientY - r.top) / scale;
  if (!drag) {
    const nearCorner = Math.abs(x - (s.boxX + s.boxW)) < 14 / scale && Math.abs(y - (s.boxY + s.boxH)) < 14 / scale;
    const inside = x >= s.boxX && x <= s.boxX + s.boxW && y >= s.boxY && y <= s.boxY + s.boxH;
    preview.style.cursor = nearCorner ? 'nwse-resize' : inside ? 'move' : 'default';
    return;
  }
  const dx = x - drag.x;
  const dy = y - drag.y;
  if (drag.mode === 'move') {
    s.boxX = drag.box.boxX + dx;
    s.boxY = drag.box.boxY + dy;
  } else {
    s.boxW = drag.box.boxW + dx;
    s.boxH = drag.box.boxH + dy;
  }
  clampBox();
  syncInputs();
  if (drag.mode === 'resize') reprepare();
  else draw();
});
window.addEventListener('mouseup', () => {
  if (drag) saveSettings();
  drag = null;
});

// ---------- 재생 ----------
let lastTs = 0;
const tick = (ts) => {
  if (!playing) return;
  const dt = lastTs ? (ts - lastTs) / 1000 : 0;
  lastTs = ts;
  t = Math.min(t + dt * speed, duration + 5);
  syncRefVideo();
  draw();
  if (t >= duration + 5) setPlaying(false);
  else requestAnimationFrame(tick);
};
const setPlaying = (on) => {
  playing = on;
  $('play').textContent = on ? '⏸' : '▶';
  if (on) {
    lastTs = 0;
    requestAnimationFrame(tick);
  }
  syncRefVideo(true);
};
$('play').addEventListener('click', () => setPlaying(!playing));
$('seek').addEventListener('input', () => {
  t = Number($('seek').value);
  syncRefVideo(true);
  draw();
});
$('speed').addEventListener('change', () => {
  speed = Number($('speed').value);
  syncRefVideo();
});

// ---------- 영상 만들기 ----------
const setRenderUi = (on) => {
  rendering = on;
  $('render').disabled = on;
  $('cancel').hidden = !on;
  $('progress').hidden = !on;
  for (const el of document.querySelectorAll('.panel input, .panel select, .panel button, .renderPanel select, .renderPanel input')) el.disabled = on;
};

const formatBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}MB` : `${Math.round(n / 1e3)}KB`);

// 실제 렌더링: 채팅 상자 크기만 그려서 ffmpeg로 보내고, 화면이 그대로인 구간은 "직전 프레임 반복"만 알린다
const renderVideo = async ({ outPath, startSec, endSec, onProgress }) => {
  await reprepare(true);
  const fps = Number(s.fps) || 30;
  const total = Math.max(1, Math.round((endSec - startSec) * fps));
  const parts = window.api.encodePartCount(s.format, total, fps);
  await window.api.encodeStart({ ...s, fps, outPath }, parts);
  const began = performance.now();
  let done = 0;
  let lastReport = 0;
  let lastYield = performance.now();

  // 구간 하나를 그려서 자기 ffmpeg에 넘긴다. 여러 구간이 번갈아 진행된다
  // (한 구간이 인코더를 기다리는 동안 다른 구간이 그린다. 캔버스는 하나를 같이 쓰지만 그리기~픽셀 읽기는 끊기지 않는다)
  const runPart = async (p) => {
    const from = Math.floor((total * p) / parts);
    const to = Math.floor((total * (p + 1)) / parts);
    let prevKey;
    let repeat = 0;
    for (let f = from; f < to; f++) {
      if (cancelRequested) return;
      const ft = startSec + f / fps;
      const key = frameKey(items, ft, s);
      if (f > from && key !== null && key === prevKey) {
        if (++repeat >= 600) {
          await window.api.encodeRepeat(p, repeat);
          repeat = 0;
        }
      } else {
        if (repeat) {
          await window.api.encodeRepeat(p, repeat);
          repeat = 0;
        }
        boxCtx.clearRect(0, 0, s.boxW, s.boxH);
        drawFrame(boxCtx, items, ft, s, emoji.lib);
        const wait = window.api.encodeWrite(p, boxCtx.getImageData(0, 0, s.boxW, s.boxH).data);
        if (wait) await wait;
        prevKey = key;
      }
      done++;
      const now = performance.now();
      if (onProgress && now - lastReport > 250) {
        lastReport = now;
        onProgress(done, total, done / ((now - began) / 1000));
      }
      // 인코더가 계속 받아주면 기다릴 일이 없으니, 화면(진행률·취소 버튼)이 멈추지 않게 가끔 양보한다
      if (now - lastYield > 100) {
        await new Promise((r) => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }
    if (repeat && !cancelRequested) await window.api.encodeRepeat(p, repeat);
  };

  try {
    await Promise.all(Array.from({ length: parts }, (_, p) => runPart(p)));
  } catch (err) {
    cancelRequested = true;
    await window.api.encodeCancel();
    throw err;
  }
  if (cancelRequested) {
    await window.api.encodeCancel();
    return null;
  }
  const result = await window.api.encodeFinish();
  return { ...result, frames: total, seconds: (performance.now() - began) / 1000 };
};

$('render').addEventListener('click', async () => {
  if (!items.length) {
    $('renderInfo').textContent = '먼저 채팅을 불러와주세요.';
    return;
  }
  const startSec = parseClock($('rangeStart').value) ?? 0;
  const endSec = parseClock($('rangeEnd').value) ?? Math.ceil(duration) + 5;
  if (endSec <= startSec) {
    $('renderInfo').textContent = '끝 시각이 시작 시각보다 뒤여야 해요.';
    return;
  }
  const outPath = await window.api.chooseOutput({ format: s.format, defaultName: `chat_${formatClock(startSec).replace(/:/g, '')}-${formatClock(endSec).replace(/:/g, '')}` });
  if (!outPath) return;

  setPlaying(false);
  cancelRequested = false;
  setRenderUi(true);
  const videoSec = endSec - startSec;
  $('renderInfo').textContent = '렌더링 준비 중...';
  try {
    const result = await renderVideo({
      outPath,
      startSec,
      endSec,
      onProgress: (done, total, fps) => {
        $('bar').style.width = `${(done / total) * 100}%`;
        const remain = (total - done) / Math.max(fps, 0.001);
        $('renderInfo').textContent = `${((done / total) * 100).toFixed(1)}% · ${done.toLocaleString()} / ${total.toLocaleString()} 프레임 · 실시간의 ${(fps / (Number(s.fps) || 30)).toFixed(1)}배 속도 · 남은 시간 약 ${formatClock(remain)}`;
      },
    });
    if (!result) $('renderInfo').textContent = '취소했어요.';
    else {
      $('renderInfo').innerHTML = '';
      const msg = document.createElement('span');
      msg.textContent = `완료! ${formatClock(videoSec)} 분량 · ${formatBytes(result.size)} · 걸린 시간 ${formatClock(result.seconds)}  `;
      const open = document.createElement('button');
      open.textContent = '폴더 열기';
      open.addEventListener('click', () => window.api.reveal(result.path));
      $('renderInfo').append(msg, open);
    }
  } catch (err) {
    $('renderInfo').textContent = `오류: ${err.message}`;
  } finally {
    setRenderUi(false);
    draw();
  }
});
$('cancel').addEventListener('click', () => (cancelRequested = true));

// ---------- 시작 ----------
clampBox();
syncInputs();
resizePreview();

// 자동 점검 모드 (CI): 예시 채팅으로 짧은 영상을 만들고 결과를 알린 뒤 종료
const smokeOut = new URLSearchParams(location.search).get('smoke');
if (smokeOut) {
  (async () => {
    try {
      const seconds = Number(new URLSearchParams(location.search).get('seconds')) || 4;
      const sample = [];
      const names = ['치즈냥', '하늘바라기', '익명의 후원자', 'player_one', '말랑볼살'];
      // 초당 0~6개, 가끔 조용한 구간
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let sec = 0; sec < seconds; sec++) {
        const n = sec % 37 >= 32 ? 0 : Math.floor(rnd() * 7);
        for (let k = 0; k < n; k++) {
          const i = sample.length;
          sample.push({ ms: sec * 1000, nickname: names[i % names.length], message: `테스트 채팅 ${i + 1} 입니다 ㅋㅋㅋ${rnd() < 0.3 ? ' 줄바꿈이 되는지 보려고 조금 길게 써봅니다' : ''}`, donation: i === 7 ? '영상 후원 3,000원' : '' });
        }
      }
      const fmtParam = new URLSearchParams(location.search).get('format');
      const outputParam = new URLSearchParams(location.search).get('output') || 'full';
      Object.assign(s, DEFAULT_SETTINGS, { outputMode: outputParam, format: fmtParam || (/\.mov$/i.test(smokeOut) ? 'mov-qtrle' : /\.mp4$/i.test(smokeOut) ? 'mp4-green' : 'webm') });
      const q = new URLSearchParams(location.search);
      const startSec = Number(q.get('start')) || 0;
      if (q.get('chat')) {
        await setChats(parseChatText(await window.api.smokeChatText()), 'smoke-chat');
        await emojiReady;
      } else await setChats(sample, 'smoke');
      const result = await renderVideo({ outPath: smokeOut, startSec, endSec: startSec + seconds });
      window.api.smokeDone({ ok: !!result && result.size > 0, ...result, emojis: emoji.lib.size, emojiAnimated: [...emoji.lib.values()].filter((e) => e.animated).length, emojiSummary: $('emojiSummary').textContent });
    } catch (err) {
      window.api.smokeDone({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  })();
}
