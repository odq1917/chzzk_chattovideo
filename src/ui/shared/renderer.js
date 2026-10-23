// 채팅 영상 렌더러. 브라우저 미리보기(CanvasRenderingContext2D)와 Node 렌더링(@napi-rs/canvas)이 같은 코드를 쓴다.
// 그리기 좌표는 모두 "채팅 상자" 기준(0,0 = 상자 왼쪽 위)이다.

export const NICK_PALETTE = [
  '#ff8a80', // 코랄
  '#ffb74d', // 주황
  '#ffe066', // 노랑
  '#a5d66b', // 연두
  '#4dd0a7', // 민트
  '#4fc3f7', // 하늘
  '#7c9cff', // 파랑
  '#b388ff', // 보라
  '#f48fb1', // 분홍
  '#90a4ae', // 회청
];

export const DEFAULT_SETTINGS = {
  // 영상 전체 크기와 채팅 상자 위치/크기 (px)
  width: 1920,
  height: 1080,
  boxX: 1440,
  boxY: 280,
  boxW: 440,
  boxH: 720,
  // 글자
  fontFamily: 'Malgun Gothic',
  fontSize: 24,
  lineHeight: 1.4, // 글자 크기 대비 줄 높이
  messageGap: 6, // 채팅 사이 간격 (px)
  textColor: '#ffffff',
  outlineWidth: 4, // 글자 외곽선 두께 (0이면 없음)
  outlineColor: '#000000',
  // 닉네임: 'palette'(10색 중 닉네임별 자동 배정) | 'single'(한 가지 색) | 'hidden'(표시 안 함)
  nickMode: 'palette',
  nickColor: '#00ffa3',
  palette: NICK_PALETTE,
  nickBold: true,
  nickSeparator: ' ', // 닉네임과 내용 사이
  showDonation: true, // 후원 라벨이 있으면 표시
  donationColor: '#fbbf24',
  // 배경 상자
  bgColor: '#000000',
  bgOpacity: 0, // 0~1
  bgRadius: 12,
  padding: 12,
  // 연출
  scrollDuration: 0.22, // 새 채팅이 밀고 올라오는 시간(초)
  fadeIn: true,
  // 렌더링
  fps: 30,
  startSec: 0,
  endSec: null, // null이면 마지막 채팅 + 5초
  format: 'webm', // webm | mov-qtrle | mov-prores | mp4-green
  outputMode: 'full', // full(영상 전체 크기, 상자 위치 그대로) | box(채팅 상자 크기만)
  greenColor: '#00ff00',
};

// 같은 1초 안의 채팅 N개는 그 1초를 N등분해서 차례로 등장시킨다 (VOD 기록이 1초 단위라서)
export const buildTimeline = (chats) => {
  const sorted = chats
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => a.ms - b.ms || a.i - b.i);
  const out = [];
  for (let i = 0; i < sorted.length; ) {
    const sec = Math.floor(sorted[i].ms / 1000);
    let j = i;
    while (j < sorted.length && Math.floor(sorted[j].ms / 1000) === sec) j++;
    const n = j - i;
    for (let k = 0; k < n; k++) {
      const c = sorted[i + k];
      out.push({ t: sec + k / n, nickname: c.nickname || '', message: c.message || '', donation: c.donation || '' });
    }
    i = j;
  }
  return out;
};

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const nicknameColor = (nickname, s) => {
  if (s.nickMode === 'single') return s.nickColor;
  const palette = s.palette && s.palette.length ? s.palette : NICK_PALETTE;
  return palette[hash(nickname) % palette.length];
};

const fontOf = (s, bold) => `${bold ? 'bold ' : ''}${s.fontSize}px "${s.fontFamily}", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK KR", sans-serif`;

// 채팅 하나를 상자 폭에 맞춰 줄바꿈한다. 결과: { lines: [[{text, color, bold}...]...], height }
const layoutMessage = (ctx, m, s, widthCache) => {
  const runs = [];
  if (s.showDonation && m.donation) runs.push({ text: `[${m.donation}]${s.nickSeparator}`, color: s.donationColor, bold: false });
  if (s.nickMode !== 'hidden' && m.nickname) runs.push({ text: m.nickname + s.nickSeparator, color: nicknameColor(m.nickname, s), bold: s.nickBold });
  runs.push({ text: m.message, color: s.textColor, bold: false });

  const maxW = Math.max(10, s.boxW - s.padding * 2);
  const charW = (ch, bold) => {
    const key = (bold ? 'b' : 'n') + ch;
    let w = widthCache.get(key);
    if (w === undefined) {
      ctx.font = fontOf(s, bold);
      w = ctx.measureText(ch).width;
      widthCache.set(key, w);
    }
    return w;
  };

  // 글자 단위로 펼친 뒤, 폭을 넘으면 줄바꿈 (가능하면 마지막 공백에서)
  const chars = [];
  for (const r of runs) for (const ch of Array.from(r.text)) chars.push({ ch, color: r.color, bold: r.bold, w: charW(ch, r.bold) });

  const lines = [];
  let start = 0;
  while (start < chars.length) {
    let w = 0;
    let end = start;
    let lastSpace = -1;
    while (end < chars.length && (w + chars[end].w <= maxW || end === start)) {
      if (chars[end].ch === ' ') lastSpace = end;
      w += chars[end].w;
      end++;
    }
    if (end < chars.length && lastSpace > start + (end - start) / 2) end = lastSpace + 1;
    lines.push(chars.slice(start, end));
    start = end;
    while (start < chars.length && chars[start].ch === ' ' && lines.length) start++; // 줄 머리 공백 제거
  }

  // 같은 스타일끼리 다시 묶기
  const merged = lines.map((line) => {
    const out = [];
    for (const c of line) {
      const last = out[out.length - 1];
      if (last && last.color === c.color && last.bold === c.bold) {
        last.text += c.ch;
        last.w += c.w;
      } else out.push({ text: c.ch, color: c.color, bold: c.bold, w: c.w });
    }
    return out;
  });
  const lineH = s.fontSize * s.lineHeight;
  return { lines: merged, height: merged.length * lineH + s.messageGap };
};

// 채팅 전체를 미리 줄바꿈/높이 계산해 둔다 (설정이 바뀌면 다시)
export const prepare = (ctx, timeline, s) => {
  const cache = new Map();
  return timeline.map((m) => ({ t: m.t, ...layoutMessage(ctx, m, s, cache) }));
};

// t초 시점까지 올라온 마지막 채팅 인덱스 (없으면 -1)
const lastIndexAt = (items, t) => {
  let lo = 0;
  let hi = items.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
};

const easeOutCubic = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

// 이 시점의 화면이 바로 앞 프레임과 똑같은지 판단하는 키 (애니메이션 중이 아니고 새 채팅도 없으면 같음)
export const frameKey = (items, t, s) => {
  const idx = lastIndexAt(items, t);
  if (idx >= 0 && t - items[idx].t < s.scrollDuration) return null; // 움직이는 중
  return idx;
};

const roundRect = (ctx, x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

// 채팅 상자 하나를 그린다. 새 채팅은 아래에서 밀고 올라오고, 예전 채팅은 위로 사라진다.
export const drawFrame = (ctx, items, t, s) => {
  const { boxW: W, boxH: H, padding: P } = s;
  if (s.bgOpacity > 0) {
    ctx.save();
    ctx.globalAlpha = s.bgOpacity;
    ctx.fillStyle = s.bgColor;
    roundRect(ctx, 0, 0, W, H, s.bgRadius);
    ctx.fill();
    ctx.restore();
  }

  const idx = lastIndexAt(items, t);
  if (idx < 0) return;

  // 방금 올라온 채팅들의 높이만큼 아직 덜 올라간 거리 (여러 개가 몰리면 합쳐져서 자연스럽게 이어짐)
  const D = Math.max(0.001, s.scrollDuration);
  let pending = 0;
  for (let j = idx; j >= 0 && t - items[j].t < D; j--) pending += items[j].height * (1 - easeOutCubic((t - items[j].t) / D));

  ctx.save();
  ctx.beginPath();
  ctx.rect(P / 2, P / 2, W - P, H - P);
  ctx.clip();
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const lineH = s.fontSize * s.lineHeight;
  const baselineOffset = (lineH - s.fontSize) / 2 + s.fontSize * 0.86;
  let bottom = H - P + pending;
  for (let j = idx; j >= 0; j--) {
    const it = items[j];
    const top = bottom - it.height;
    if (bottom < 0) break;
    const age = t - it.t;
    ctx.globalAlpha = s.fadeIn ? Math.min(1, 0.15 + age / D) : 1;
    for (let li = 0; li < it.lines.length; li++) {
      const y = top + li * lineH + baselineOffset;
      if (y < -lineH || y > H + lineH) continue;
      let x = P;
      for (const run of it.lines[li]) {
        ctx.font = fontOf(s, run.bold);
        if (s.outlineWidth > 0) {
          ctx.lineWidth = s.outlineWidth;
          ctx.strokeStyle = s.outlineColor;
          ctx.strokeText(run.text, x, y);
        }
        ctx.fillStyle = run.color;
        ctx.fillText(run.text, x, y);
        x += run.w;
      }
    }
    bottom = top;
  }
  ctx.restore();
};

export const formatClock = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const parseClock = (str) => {
  const m = String(str || '').trim().match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})$/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};
