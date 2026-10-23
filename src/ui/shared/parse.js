// 채팅 내역 읽기: 채팅 추출기에서 저장한 CSV, 또는 클립보드 복사 형식([00:10:05] <닉네임> 내용)

const parseTime = (s) => {
  const m = String(s).trim().match(/^\[?(\d{1,3}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]?$/);
  if (!m) return null;
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + ms;
};

// RFC 4180 CSV (따옴표 안의 쉼표/줄바꿈/"" 처리)
const parseCsvRows = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
};

const parseCsv = (text) => {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return null;
  const header = rows[0].map((h) => h.trim());
  const col = (...names) => header.findIndex((h) => names.includes(h));
  const iTime = col('시간', 'time');
  const iNick = col('닉네임', 'nickname');
  const iMsg = col('채팅내용', 'message', '내용');
  const iDonation = col('후원');
  if (iTime < 0 || (iMsg < 0 && iNick < 0)) return null;
  const chats = [];
  for (const r of rows.slice(1)) {
    const ms = parseTime(r[iTime] ?? '');
    if (ms === null) continue;
    chats.push({
      ms,
      nickname: iNick >= 0 ? r[iNick] ?? '' : '',
      message: iMsg >= 0 ? r[iMsg] ?? '' : '',
      donation: iDonation >= 0 ? r[iDonation] ?? '' : '',
    });
  }
  return chats;
};

// [00:10:05] <닉네임> 내용   (앞에 {1} 같은 VOD 번호, [텍스트 후원 1,000원] 같은 후원 라벨이 있어도 됨)
const LINE = /^(?:\{\d+\}\s*)?\[(\d{1,3}:\d{2}:\d{2})\]\s*(?:<([^>]*)>\s*)?(?:\[((?:텍스트|영상|미션)?\s*후원[^\]]*)\]\s*)?(.*)$/;

const parseLines = (text) => {
  const chats = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LINE);
    if (!m) continue;
    chats.push({ ms: parseTime(m[1]), nickname: m[2] ?? '', message: m[4] ?? '', donation: m[3] ?? '' });
  }
  return chats;
};

export const parseChatText = (raw) => {
  const text = String(raw || '').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const chats = /(^|,)"?(시간|time)"?(,|$)/.test(firstLine) ? parseCsv(text) : parseLines(text);
  return (chats || []).filter((c) => c.ms !== null);
};
