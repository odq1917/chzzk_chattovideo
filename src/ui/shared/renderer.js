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
  useLocalFonts: true, // 화면 전용: 설치된 글꼴 목록을 불러올지
  fontSize: 24,
  lineHeight: 1.4, // 글자 크기 대비 줄 높이
  letterSpacing: 0, // 글자 사이 간격 (px, 음수면 좁게)
  messageGap: 6, // 채팅 사이 간격 (px)
  textColor: '#ffffff',
  textBold: true, // 채팅 내용 굵게
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
  // 배경: 'none'(없음) | 'box'(채팅 상자 전체에 하나) | 'bubble'(채팅마다 글자 길이에 맞춘 말풍선)
  bgMode: 'bubble',
  // 상자 전체 배경
  bgColor: '#000000',
  bgOpacity: 0, // 0~1
  bgRadius: 12,
  padding: 12, // 채팅 상자 안쪽 여백 (모든 모드 공통)
  // 말풍선 (기본값은 사용자가 준 1080p 참고 화면을 재서 맞춤: 회색 반투명, 글자 좌우 12px, 둥글기 12px)
  bubbleColor: '#808080',
  bubbleOpacity: 0.25, // 0~1
  bubbleRadius: 12, // 높이의 절반 이상이면 알약 모양
  bubblePadLeft: 12, // 글자 왼쪽 여백
  bubblePadRight: 12, // 글자 오른쪽 여백
  bubblePadTop: 7, // 첫 줄 위 여백 (줄 높이 기준)
  bubblePadBottom: 7, // 마지막 줄 아래 여백 (줄 높이 기준)
  bubbleGap: 16, // 말풍선 사이 간격
  bubbleShadow: true, // 아래쪽 옅은 그림자
  // 채팅 상자 위쪽에서 서서히 사라지기
  fadeTop: true,
  fadeTopHeight: 120, // 사라지는 구간 높이 (px)
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
  runs.push({ text: m.message, color: s.textColor, bold: !!s.textBold });

  const bubble = s.bgMode === 'bubble';
  const maxW = Math.max(10, s.boxW - s.padding * 2 - (bubble ? s.bubblePadLeft + s.bubblePadRight : 0));
  // 캔버스는 글자마다 뒤에 letterSpacing을 붙여 그린다 → 폭 계산도 글자마다 더한다 (재는 동안은 0으로)
  const ls = Number(s.letterSpacing) || 0;
  ctx.letterSpacing = '0px';
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
  for (const r of runs) for (const ch of Array.from(r.text)) chars.push({ ch, color: r.color, bold: r.bold, w: charW(ch, r.bold) + ls });

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
  if (!bubble) return { lines: merged, height: merged.length * lineH + s.messageGap };
  // 말풍선 너비 = 가장 긴 줄(줄 끝 공백, 마지막 글자 뒤 글자 간격 제외) + 좌우 여백
  let textW = 0;
  for (const line of lines) {
    let end = line.length;
    while (end > 0 && line[end - 1].ch === ' ') end--;
    let w = 0;
    for (let k = 0; k < end; k++) w += line[k].w;
    if (end > 0) w -= ls;
    textW = Math.max(textW, w);
  }
  const bubbleH = merged.length * lineH + s.bubblePadTop + s.bubblePadBottom;
  return { lines: merged, bubbleW: Math.ceil(textW + s.bubblePadLeft + s.bubblePadRight), bubbleH, height: bubbleH + s.bubbleGap };
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

// newPath=false면 지금 경로에 이어 붙인다 (clip용 구멍 뚫기)
const roundRect = (ctx, x, y, w, h, r, newPath = true) => {
  const rr = Math.min(r, w / 2, h / 2);
  if (newPath) ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

// 채팅 상자 하나를 그린다. 새 채팅은 아래에서 밀고 올라오고, 예전 채팅은 위로 사라진다.
// 순서: 채팅 → 위쪽 페이드(채팅만 지움) → 상자 전체 배경을 맨 뒤에 깔기(destination-over)
export const drawFrame = (ctx, items, t, s) => {
  const { boxW: W, boxH: H } = s;
  drawChats(ctx, items, t, s);
  if (s.fadeTop && s.fadeTopHeight > 0) {
    const fh = Math.min(H, s.fadeTopHeight);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createLinearGradient(0, 0, 0, fh);
    g.addColorStop(0, 'rgba(0, 0, 0, 1)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, fh);
    ctx.restore();
  }
  if (s.bgMode === 'box' && s.bgOpacity > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.globalAlpha = s.bgOpacity;
    ctx.fillStyle = s.bgColor;
    roundRect(ctx, 0, 0, W, H, s.bgRadius);
    ctx.fill();
    ctx.restore();
  }
};

const drawChats = (ctx, items, t, s) => {
  const { boxW: W, boxH: H, padding: P } = s;
  const bubble = s.bgMode === 'bubble';
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
  ctx.letterSpacing = `${Number(s.letterSpacing) || 0}px`; // save/restore로 원래대로 돌아간다

  const lineH = s.fontSize * s.lineHeight;
  const baselineOffset = (lineH - s.fontSize) / 2 + s.fontSize * 0.86;
  let bottom = H - P + pending;
  for (let j = idx; j >= 0; j--) {
    const it = items[j];
    const top = bottom - it.height;
    if (bottom < 0) break;
    const age = t - it.t;
    const alpha = s.fadeIn ? Math.min(1, 0.15 + age / D) : 1;
    // 말풍선은 글자보다 먼저 (페이드 인도 같이 받는다)
    if (bubble && it.bubbleW && s.bubbleOpacity > 0) {
      if (s.bubbleShadow) {
        // 그림자는 말풍선 바깥에만 (반투명 말풍선 안쪽까지 어두워지지 않게)
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        roundRect(ctx, P, top, it.bubbleW, it.bubbleH, s.bubbleRadius, false);
        ctx.clip('evenodd');
        ctx.globalAlpha = alpha;
        ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(1, s.bubbleOpacity * 0.6).toFixed(3)})`;
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = '#000';
        roundRect(ctx, P, top, it.bubbleW, it.bubbleH, s.bubbleRadius);
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = alpha * s.bubbleOpacity;
      ctx.fillStyle = s.bubbleColor;
      roundRect(ctx, P, top, it.bubbleW, it.bubbleH, s.bubbleRadius);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = alpha;
    const textTop = bubble ? top + s.bubblePadTop : top;
    for (let li = 0; li < it.lines.length; li++) {
      const y = textTop + li * lineH + baselineOffset;
      if (y < -lineH || y > H + lineH) continue;
      let x = bubble ? P + s.bubblePadLeft : P;
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
