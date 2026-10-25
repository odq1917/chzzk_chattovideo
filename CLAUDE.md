# chzzk_chattovideo — 채팅 내역을 생방송 채팅 영상으로

이 문서만 읽고 이전 세션과 똑같이 개발을 이어가기 위한 기록이다. 코드를 바꾸면 이 문서도 같이 고친다.
자매 프로젝트: [`odq1917/chzzkchattest`](https://github.com/odq1917/chzzkchattest) (치지직/SOOP VOD 채팅 추출 사이트). 그 사이트에서 저장한 CSV나 클립보드 복사 텍스트가 이 프로그램의 입력이다.

---

## 1. 사용자와 일하는 방식

- **사용자는 한국어로 말한다. 답도, UI 문구도, 코드 주석도 한국어.** 커밋 메시지도 이 저장소는 한국어 (제목에 버전).
- 목표: **"사람들이 편하게 쓸 수 있게 exe로 Release"**. Windows 전용. 몇 시간짜리 VOD도 다룰 수 있게 넓게.
- 사용자는 프리미어 프로로 편집한다. 결과 영상을 원본 영상 위에 얹어 쓴다.
- **확인한 것과 추측을 구분해서 말한다** (자매 프로젝트에서 추측을 단정해서 지적받은 적이 있다). 특히 이 프로그램은 클라우드(리눅스)에서 만들었기 때문에 "리눅스에서 확인 / GitHub Windows 서버에서 확인 / 실제 PC에서는 미확인"을 나눠서 보고한다.
- 사용자가 v0.1.0을 써보고 "렌더링이 너무 느리다"고 해서 v0.2.0에서 측정 → 원인 2개를 찾아 고쳤다. 성능 얘기가 나오면 **추측하지 말고 단계별로 재서** 병목을 숫자로 보여준다 (5장).
- PR 없이 main에 바로 push한다. 릴리스는 7장.

## 2. 한눈에

- **Electron 45** + **ffmpeg-static**(ffmpeg 실행 파일 동봉). 번들러 없음. 의존성은 `ffmpeg-static` 하나, 개발 의존성은 `electron`, `electron-builder`.
- 메인/preload는 CommonJS, 화면(`src/ui/`)은 `<script type="module">` ES 모듈.
- 그리기는 화면(렌더러)의 Canvas 2D로, 인코딩은 ffmpeg 자식 프로세스로. 미리보기와 결과 영상이 **같은 그리기 코드**(`renderer.js`)를 쓴다 → 미리보기에서 본 그대로 나온다.
- 버전: `package.json`의 `version`과 `src/ui/app.js`의 `VERSION` 두 곳 (같이 올린다). 현재 0.3.0 (말풍선·이모티콘·글자 그림자 등 — 사용자가 로컬 exe로 테스트한 뒤 2026-10-25 Release 요청).

## 3. 파일 구조

| 파일 | 역할 |
|---|---|
| `src/main.js` | Electron 메인: 창, 파일 열기/저장 대화상자, 폴더 열기, 창 전체 화면(`set-fullscreen`), 점검 모드 결과 출력. **인코딩은 여기 없다** |
| `src/preload.js` | `window.api` 노출. 대화상자류는 IPC, 인코딩은 `encoder.js`를 직접 호출 |
| `src/emojiStore.js` | 이모티콘 보관함 (메인 프로세스): 앱 데이터 폴더 `emojis/` + `registry.json`, 주소에서 받기 / 파일·폴더 등록 / 삭제 |
| `src/encoder.js` | ffmpeg 실행/인코딩 (preload에서 require). 형식별 ffmpeg 인자, 프레임 쓰기(백프레셔), WebM 구간 병렬 인코딩 + 이어붙이기 |
| `src/ui/index.html` | 화면. 왼쪽 설정 패널(1 불러오기 ~ 6 연출), 오른쪽 미리보기·재생·참고 화면·7 영상 만들기 |
| `src/ui/style.css` | 2단 레이아웃. `[hidden]{display:none!important}` 필수 (label의 `display:flex`가 hidden을 덮어서 숨김이 안 되던 버그) |
| `src/ui/app.js` | 화면 로직: 설정 저장/바인딩, 채팅 불러오기, 미리보기, 참고 화면, 배율, 크게 보기, 렌더링 루프, 점검 모드 |
| `src/ui/shared/renderer.js` | 타이밍, 줄바꿈, 닉네임 색, 스크롤 연출, 그리기 (순수 함수) |
| `src/ui/shared/parse.js` | CSV / 텍스트 파싱 (+ 이모티콘 주소 `emojiUrls`) |
| `src/ui/emoji.js` | 이모티콘 화면 쪽: `ImageDecoder`로 프레임 풀기, 쓰인 이모티콘 목록·자동 받기·등록 UI (6. 이모티콘 칸) |
| `.github/workflows/release.yml` | Windows에서 점검 → exe 빌드 → 점검 → Release |
| `dev/ui-basic.cjs`, `dev/ui-reference.cjs` | Playwright로 Electron 화면을 띄워 스크린샷 찍는 개발용 스크립트 (8장) |

## 4. 동작 방식

### 입력 (`parse.js`) — 채팅 추출기의 내보내기 형식과 맞물려 있다
- **CSV**: 헤더 이름으로 열을 찾는다. `시간`/`time`, `닉네임`/`nickname`, `채팅내용`/`message`/`내용`, `후원`. RFC4180 따옴표 처리, BOM 무시.
- **텍스트** (추출기 「클립보드 복사」): 한 줄에 `{1} [00:10:05] <닉네임> [영상 후원 3,340원] 내용` — `{n}`, `<닉>`, 후원 라벨은 있어도 없어도 됨.
- 추출기에서 표시 항목을 끄고 내보내면 해당 열/부분이 빠진다. 시간이 없으면 영상화 불가.
- **이모티콘 주소 (추출기 v1.9.0~):** CSV `이모티콘` 열(처음 쓰인 채팅에 `이름=주소 이름=주소`), 텍스트 끝 `#이모티콘 이름 주소` 줄 → `parseChatText` 결과 배열의 `emojiUrls` ({이름: 주소}).
- **알려진 한계:** 여러 VOD(`{n}` 또는 `VOD` 열)가 섞인 내보내기는 VOD 구분 없이 시간으로 섞인다.
- 추출기의 내보내기 형식을 바꾸면 이 파서도 같이 고친다.

### 타이밍 (`buildTimeline`)
- VOD 채팅 기록은 1초 단위라, **같은 초에 n개면 그 1초를 n등분**해서 차례로 등장 (4개면 0.25초 간격). 사용자 요구사항.

### 레이아웃 (`prepare`)
- 채팅 하나 = [후원 라벨] + [닉네임] + 내용. 상자 폭에 맞춰 줄바꿈(공백에서 끊기 우선, 글자 폭 캐시), 스타일별 run으로 나눈다.
- 글꼴/크기/폭 등 `LAYOUT_KEYS`(app.js)가 바뀔 때만 다시 계산 (디바운스).

### 그리기 (`drawFrame`)
- 채팅 상자 크기의 OffscreenCanvas(`willReadFrequently: true`)에 그린다.
- 시각 t에서 마지막으로 등장한 채팅을 이진 탐색 → 아래에서부터 위로 쌓는다.
- **부드러운 스크롤:** 아직 올라오는 중인 채팅들의 남은 높이 `height × (1 − easeOutCubic(age / scrollDuration))`를 합쳐 전체를 그만큼 아래로 민다. 채팅이 몰려도 밀어 올리는 거리가 합쳐져 끊기지 않는다. 새 채팅은 선택적으로 서서히 나타남.
- 외곽선(stroke)을 먼저, 채우기(fill)를 나중에. **줄 단위로** 외곽선을 전부 그린 뒤 글자·이모티콘을 그린다 (조각별로 번갈아 그리면 닉네임→내용 경계에서 뒤 조각 외곽선이 앞 글자를 덮는다).
- **글자 외곽선·그림자 (v0.3.0):** 기본 외곽선 4 → 2.5, 글자 그림자(`textShadow*`, 기본 진하기 0.6 / 퍼짐 2 / 오른쪽 1 / 아래 1.5) 추가. 사용자: "외곽선이 레퍼런스랑 너무 다르고 두께가 제각각" → 참고 화면을 확대해 보니 ~1px 짙은 회색 외곽선 + 오른쪽 아래 옅은 그림자, 우리는 순검정 3~4px이라 획이 가까운 곳(ㅕ, ㅆ)에서 뭉쳤다. 변형 4개를 참고 화면 옆에 놓고 비교해서 정함. 그림자는 말풍선처럼 글자 모양을 캔버스 밖(`SHADOW_OFF`)에 그리고 그림자만 옮긴다. 저장된 설정에 `textShadow`가 없고 외곽선이 4(옛 기본값)면 2.5로 옮긴다.
- **나타나는 중(페이드 인)인 채팅은 따로 그려서 통째로 반투명하게 얹는다** (`drawItem` → `fadeLayer` → `drawImage` + `globalAlpha`). 외곽선과 글자를 각각 반투명으로 그리면 검은 외곽선이 흰 글자 밑으로 비쳐 글자가 회색으로 탁해졌다 (사용자 제보 "외곽선 넣는 과정이 어색", 무손실 렌더에서 흰 글자가 255 → 186~204). 고친 뒤 255. 대신 2분 WebM(빽빽한 예시 채팅) 6.1 → 7.6초.
- **배경 모양 `bgMode` (v0.3.0):** `bubble`(채팅마다 말풍선, 기본) / `box`(상자 전체 하나, v0.2.0 방식) / `none`.
  - 말풍선 너비 = 가장 긴 줄(줄 끝 공백 제외) + `bubblePadLeft + bubblePadRight`, 높이 = 줄 수 × 줄 높이 + `bubblePadTop + bubblePadBottom`. `layoutMessage`가 `bubbleW/bubbleH`를 계산하고, 채팅 높이 = `bubbleH + bubbleGap` (말풍선 모드에서는 `messageGap` 대신 `bubbleGap`).
  - 여백은 처음에 좌우(`bubblePadX`)/위아래(`bubblePadY`) 둘이었다가 사용자 요청으로 네 방향 따로. 예전 키는 `loadSettings`에서 옮기고 지운다.
  - 줄바꿈 폭도 좌우 여백만큼 줄어든다. 둥글기는 `min(r, 높이/2)`라 크게 넣으면 알약 모양.
  - 그림자는 **말풍선 바깥에만** 남긴다. 반투명 말풍선 밑에 그림자를 그대로 깔면 안쪽이 어두워진다 — 처음에 그렇게 해서 참고 화면 221 대비 207로 어두웠다.
  - 그림자 설정 (v0.3.0): `bubbleShadowStrength`(기본 0.08), `bubbleShadowBlur`(6), `bubbleShadowY`(2). 처음엔 진하기가 불투명도×0.6(=0.15)으로 묶여 있었는데 사용자가 원본 방송 화면과 나란히 보고 "그림자가 딱딱하다" → 원본을 재 보니 가장자리 바로 밖이 배경보다 10~13 어두운데 우리는 17~23 → 0.08로 낮추고 설정으로 뺐다. 원본은 말풍선 가장자리 자체도 2~3px 흐릿하다(영상 압축·축소 때문으로 보임, 추측). 우리 가장자리는 1px로 또렷하다.
  - 지금 방식: 그림자용 도형은 캔버스 밖(`SHADOW_OFF`)에 그리고 `shadowOffsetX`로 그림자만 제자리에 → 같은 도형으로 `destination-out`(알파 1) → 말풍선 칠하기.
  - **실패한 방식 (사용자 제보 "그림자랑 같이 까만 선"):** 도형을 제자리에 그리고 구멍 뚫은 `clip('evenodd')`으로 안쪽을 막았더니, 스크롤 중 소수점 위치에서 가장자리에 1px 검은 선(밝은 배경에서 250 → 107)이 생겼다. 미리보기만이 아니라 결과 영상에도 있었다. 그다음 지우기 방식으로 바꿨을 때는 지우기가 앞 채팅의 페이드 인 `globalAlpha`를 물려받아 덜 지워지는 버그도 있었다(말풍선 전체가 219 → 196).
  - 확인 방법: 무손실 `mov-qtrle`로 40초 렌더 → 프레임마다 글자 없는 말풍선 왼쪽 여백 칸(x=15~19)과 아래 가장자리를 밝은 배경에 얹은 밝기로 검사. VP9는 알파가 손실 압축이라 이런 검사에 쓰면 안 된다.
  - 말풍선도 채팅의 페이드 인 알파를 같이 받는다.
  - 기본값은 사용자가 준 1080p 참고 스크린샷을 픽셀로 재서 정했다: 글자 잉크 기준 좌우 ~12px, 한 줄 말풍선 51px(줄 간격 38px → 줄 위아래 ~7px), 모서리 ~12px, 말풍선 사이 ~18px, 밝은 배경 250 → 말풍선 221(= `#808080` 25%), 아래쪽으로 퍼지는 옅은 그림자, 흰 굵은 글씨 + 검은 외곽선. 우리 렌더를 같은 배경에 얹어 재면 안쪽 221로 같다. 참고 화면의 글꼴은 맑은 고딕보다 좁다(무슨 글꼴인지 모름).
  - `textBold`(채팅 내용 굵게, 기본 켬)도 v0.3.0에서 추가.
  - 예전 설정 이어받기: 저장된 설정에 `bgMode`가 없고 `bgOpacity > 0`이면 `box`로 (`loadSettings`).
- **글자 간격 `letterSpacing` (v0.3.0):** 캔버스 `ctx.letterSpacing`은 글자마다 **뒤에** 간격을 붙인다. 그래서 줄바꿈 계산의 글자 폭에도 글자마다 더하고, 말풍선 너비에서는 마지막 글자 뒤 하나를 뺀다. 폭을 잴 때는 `ctx.letterSpacing = '0px'`로 (같은 캔버스를 그리기에도 쓰니까).
- **위쪽 페이드 `fadeTop`/`fadeTopHeight` (v0.3.0, 기본 켬 120px):** `drawFrame` = `drawChats` → 위쪽 그라데이션을 `destination-out`으로 지움 → 상자 전체 배경은 그 뒤에 `destination-over`로 깐다 (배경까지 지워지지 않게). 사용자 참고 화면에도 위쪽 말풍선이 흐려지는 연출이 있다.
- **왼쪽 단계 접기 (v0.3.0):** `.panel > section`의 `h2`를 누르면 `collapsed` 클래스. 접힌 번호 목록은 localStorage `chattovideo:collapsed`.
  - 단계마다 카드(흰 바탕 + 제목 막대 + 번호 동그라미, 접히면 번호가 회색). 번호 동그라미는 `h2`의 "3. 글자" 글자를 app.js가 바꿔 만든다. 카드 안 묶음 제목은 `<p class="sub">` (점선 구분). 사용자: "각 항목이 어디부터 어디까진지 헷갈린다" → 이렇게 바꿈.
- **글꼴 목록 (v0.3.0):** `useLocalFonts`(기본 켬)면 `queryLocalFonts()`로 설치된 글꼴 전체(이 PC 963종) → 글꼴 이름 입력칸의 datalist + 「설치된 글꼴에서 고르기」 select(옵션마다 그 글꼴로 표시). 끄면 기본 7개만. 권한은 main.js가 `local-fonts`만 허용.
- **닉네임 색:** `palette`(기본 10색, 닉네임 FNV 해시로 배정 → 같은 닉네임은 항상 같은 색) / `single`(한 색) / `hidden`.
- **`frameKey`:** 움직이는 중이면 `null`, 아니면 마지막 채팅 인덱스. 렌더링 때 키가 같으면 그 프레임은 다시 그리지 않고 "직전 프레임 반복"만 보낸다 (채팅 없는 구간이 매우 빠름).

### 이모티콘 (v0.3.0)
- 채팅 내용의 `{:이름:}`(`EMOJI_RE`, renderer.js). 내용(message)에서만 바꾼다 (닉네임·후원 라벨은 그대로).
- **주소는 규칙으로 못 만든다** (이름 `marongHi` → 파일 `marong5Hi.png`). 추출기가 VOD 채팅의 `extras.emojis`를 그대로 내보낸 주소를 쓴다. 치지직 기본 이모티콘(`d_54` 등)도 같은 방식으로 주소가 와서 따로 "기본 팩"을 둘 필요가 없었다 (사용자 제안이었음). 한 번 받으면 보관함에 남는다.
- 흐름: 채팅 불러오기 → `countEmojis`(많이 쓰인 순) → 보관함 목록 → 등록된 것 읽어서 `decodeEmoji` → 주소가 있고 미등록(또는 자동으로 받은 것인데 주소가 바뀜)이면 4개씩 동시에 받기 → 다시 줄바꿈. 직접 지정한 이미지는 자동 받기가 덮어쓰지 않는다.
- 보관함: `userData/emojis/`, `registry.json` = `{이름: {file, source: 'auto'|'file', url?, at}}`. 폴더 등록은 파일 이름(확장자 뺀 것) = 이름. 화면에서는 IPC로 바이트를 받아 쓴다(`emoji-read`).
- `decodeEmoji`: `ImageDecoder`로 GIF/APNG/WebP 프레임을 전부 `ImageBitmap`으로 + 프레임 시작 시각. 10ms 이하 프레임은 100ms(브라우저와 같게). 실패하면 `createImageBitmap` 한 장.
- 레이아웃: 이모티콘은 쪼개지지 않는 한 글자(`￼`), 폭 = 높이 × 가로세로비 + `emojiGap`×2. 높이 = `fontSize × emojiScale`(기본 1.5 — 참고 화면에서 글자 ~26px에 이모티콘 ~40px). **이모티콘이 줄 높이보다 크면 그 줄만 높아진다** (`lineHs`), 글자는 그 줄 가운데.
- 미등록: `emojiMissing` = `raw`(원문 `{:이름:}`) / `name`(회색 `[이름]`) / `hide`(지움 — 이모티콘만 있던 채팅은 높이 0으로 빠진다).
- **움직이는 이모티콘:** 프레임 = `(t × 1000) mod 한 바퀴 길이`, t는 영상(VOD) 시계 (`emojiFrameAt`). 누가 언제 쳤든 같은 이모티콘은 같은 프레임, 중간부터 잘라 뽑아도 사이클 유지. 화면에 움직이는 이모티콘이 있으면 `frameKey`가 null(반복 최적화 안 됨) → `emojiAnimate` 끄면 첫 프레임 고정.
- 실측 (VOD 15822204 실제 채팅 1,948개, 48종 중 22종 움직임): 자동 받기 48/48, 60초 WebM 상자만 2.9초. 프레임마다 이모티콘 영역 해시가 다 달라서 움직임 확인. (ffmpeg `-ss`를 입력 앞에 두고 VP9 알파를 한 장씩 뽑으면 같은 그림이 나와서 처음에 "안 움직인다"고 잘못 볼 뻔했다 — `trim` + `framemd5`로 확인할 것.)

### 설정
- `DEFAULT_SETTINGS`(renderer.js)가 기준. 화면 입력은 `data-key="설정이름"`으로 자동 바인딩, localStorage `chattovideo:settings`에 저장.
- 새 설정 추가 = `DEFAULT_SETTINGS`에 기본값 + index.html에 `data-key` 입력 + (줄바꿈에 영향 주면) `LAYOUT_KEYS`에 추가.
- 영상/상자 크기는 짝수로 맞춘다(`clampBox`) — yuv420 인코딩 요구.

### 렌더링 루프 (`app.js` `renderVideo`)
- 프레임마다 `drawFrame` → `getImageData` → `window.api.encodeWrite(part, data)`.
- `encodeWrite`는 ffmpeg stdin 버퍼에 여유가 있으면 `null`, 가득 찼으면 비워질 때까지 기다리는 Promise (렌더링이 인코딩을 앞지르지 않게).
- 같은 화면이 이어지면 `encodeRepeat(part, n)` (최대 600씩 모아서).
- 기다릴 일이 없으면 100ms마다 `setTimeout 0`으로 양보해서 진행률·취소 버튼이 멈추지 않게.
- **WebM은 구간을 나눠 병렬:** `partCount` = CPU 코어 수(최대 8), 단 프레임이 `fps×20` 미만이면 1. 구간마다 async 루프가 돌고(캔버스 하나를 번갈아 쓰지만 그리기~픽셀 읽기는 동기라 섞이지 않음), 끝나면 `ffmpeg -f concat -c copy`로 재인코딩 없이 이어붙이고 `저장경로.partN.webm` 임시 파일을 지운다.
- 출력 크기: `full`(영상 전체 크기, ffmpeg `pad`로 상자 위치에 배치) / `box`(상자 크기만, 위치는 편집 프로그램에서). **상자 크기만 그려서 넘기고 배치는 ffmpeg가** 한다.

### 출력 형식 (`encoder.js` `ffmpegArgs`)
| 형식 | 인자 요지 |
|---|---|
| `webm` | libvpx-vp9, `yuva420p`, `-crf 32 -b:v 0`, `-deadline realtime -cpu-used 8 -row-mt 1 -tile-columns 2 -threads 2`, `-auto-alt-ref 0 -lag-in-frames 0`(알파 필수), GOP 10초 |
| `mov-qtrle` | QuickTime Animation, `argb` |
| `mov-prores` | `prores_ks -profile:v 4444 -pix_fmt yuva444p10le -vendor apl0` |
| `mp4-green` | 지정 색 배경 위에 overlay, libx264 veryfast crf 20, yuv420p, faststart |

- 입력은 항상 `-f rawvideo -pix_fmt rgba -s 상자WxH -r fps -i -`.
- 패키징된 exe에서는 ffmpeg 경로의 `app.asar`를 `app.asar.unpacked`로 바꿔야 한다 (package.json `asarUnpack`).

### 미리보기 기능 (v0.2.0)
- **참고 화면:** 이미지/영상을 불러오거나 끌어다 놓으면(`URL.createObjectURL`) 채팅 뒤에 비율 유지로 깐다. 영상은 채팅 시계에 맞춰 재생(`영상 0초 = 채팅 ○○:○○:○○` 오프셋, 0.5초 넘게 어긋나면 다시 맞춤, 재생 속도 최대 16배). 결과 영상에는 안 들어간다.
- **배율:** 맞춤 / 100%(영상 1px = 모니터 1px, `devicePixelRatio` 반영) / 150% / 200%. 확대하면 채팅 상자로 자동 스크롤. 캔버스는 기기 픽셀 단위로 그린다.
- **크게 보기:** `body.big` 클래스로 미리보기가 창을 덮고, IPC로 `win.setFullScreen(true)`. Space 재생, ←/→ 5초, 더블클릭/Esc 나가기. 상자 테두리는 숨긴다.
  - HTML Fullscreen API(`requestFullscreen`)는 쓰지 않는다 — 테스트 환경(xvfb)에서 Promise가 영원히 안 끝났다.

## 5. 성능 기록 (4코어 리눅스 컨테이너, 2분 = 3600프레임, 채팅 초당 ~3개, 1920×1080 / 상자 440×720, 30fps)

| 형식 · 출력 | v0.1.0 | v0.2.0 | 용량(2분) |
|---|---|---|---|
| WebM · 상자만 | 39초 | 15초 | 21.4MB |
| WebM · 전체 | 81초 | 43초 | 22.8MB |
| QuickTime Animation · 상자만 | 22초 | 11초 | 461MB |
| ProRes 4444 · 상자만 | 47.5초 | 40초 | 1.06GB |
| 그린 MP4 · 전체 | 35초 | 26초 | 14.9MB |

측정으로 찾은 것 (v0.2.0):
- 프레임당: 그리기 0.3ms, `getImageData` 1.9ms, **IPC로 메인 프로세스에 보내고 응답 기다리기 6.4ms** ← 최대 병목. preload에서 ffmpeg에 직접 쓰도록 바꿈.
- VP9 인코더 하나는 4코어에서 약 1.7코어만 쓴다. 30초 분량: 단일 7.7초 → 4조각 병렬 3.4초. concat으로 이어붙여도 프레임 수·알파 정상.
- ProRes는 이미 멀티스레드라 조각 내도 그대로(9.5초 → 9.7초). QuickTime Animation/MP4는 조금 빨라지지만 이미 빠르고 임시 파일만 커져서 **병렬은 WebM만**.
- WebM 조각 수 3 vs 4(코어 수): 4가 더 빠름 → 코어 수로.
- 측정 방법: 점검 모드에 임시로 `raw` 형식(`-f rawvideo` → /dev/null)을 넣어 인코딩 없는 파이프라인 시간을 재고, 그 raw 프레임 파일로 ffmpeg 단독 인코딩 시간을 쟀다. 측정용 코드는 커밋하지 않았다.

## 6. 시도했다가 실패/폐기한 것

1. **방식 선택 단계:** 자막(캡션) 파일, 프리미어 UXP 플러그인도 검토했지만, 닉네임 색·부드러운 스크롤이 필요해서 독립 프로그램 + 투명 영상으로 결정. 플러그인 안에서 수천 줄을 그리는 건 프리미어 API로 어렵고 느리다(검토 의견, 시험 구현은 안 함).
2. **처음 계획은 `start.bat` + 브라우저 + Node 필요**였지만 사용자가 "exe로 Release"를 원해서 Electron으로.
3. **처음에 chzzkchattest 저장소 안 `chat-video/`에 초안을 만들었다가** 사용자가 "다른 저장소에"라고 해서 이 저장소로 옮김.
4. **프레임마다 IPC로 메인 프로세스에서 인코딩 (v0.1.0):** 느렸다 → preload 직접 인코딩 (5장).
5. **ProRes 전체 크기 1080p:** 11분 만에 3.9GB, 너무 느려서 중단. ProRes/QuickTime은 "상자만" 권장.
6. **HTML Fullscreen API:** 위 4장 참고.
7. **CSP meta 태그:** 초기 index.html에 `default-src 'self'` CSP가 있었는데 첫 실행 확인 단계에서 지웠다. 지운 이유는 기록이 없다. 다시 넣는다면 참고 화면(`blob:` 이미지/영상, `media-src`)과 로컬 글꼴이 막히지 않는지 확인할 것.
8. **git 태그 push가 클라우드 세션에서 막혀서** Release를 태그 대신 workflow_dispatch로 만들게 바꿨다 (7장). 로컬 PC에서는 태그 push도 된다.

## 7. 릴리스 (exe)

1. `package.json`의 `version`과 `src/ui/app.js`의 `VERSION`을 같이 올린다. **같은 버전으로 다시 릴리스하면 기존 Release의 exe를 덮어쓴다** (`overwrite_files`).
   - 기능 추가 = 마이너(0.2 → 0.3), 수정 = 패치.
2. README의 사용법/성능 표가 바뀌었으면 같이 고친다.
3. 커밋 → `git push origin main`.
4. 둘 중 하나로 Release:
   - GitHub Actions 탭 → 「Build Windows exe」 → Run workflow (release 체크 = 기본값) — `package.json` 버전으로 `v x.y.z` 태그와 Release를 만든다.
   - 또는 로컬에서 `git tag v0.3.0 && git push origin v0.3.0`.
   - (Claude 세션에서는 GitHub MCP `actions_run_trigger`로 `release.yml`, ref `main`, inputs `{"release":"true"}`)
5. 워크플로(windows-latest, Node 22): `npm ci` → 소스로 20초 WebM 점검(병렬 구간 경로) → `npm run dist` → **패키징된 exe**로 WebM·ProRes 10초 점검 → Artifacts 업로드 → Release에 `ChzzkChatToVideo-x.y.z-portable.exe`, `-setup.exe` 첨부.
6. 끝나면 Release 링크와 함께 "어디까지 확인됐는지"를 보고한다.

- exe는 코드 서명이 없어서 SmartScreen 경고가 뜬다 (「추가 정보 → 실행」).
- 로컬 빌드: `npm run dist` → `dist/`.

## 8. 테스트

- **점검 모드(자동 렌더링):** 예시 채팅을 만들어 렌더링하고 `SMOKE_RESULT {json}`을 출력한 뒤 종료(성공 0 / 실패 1).
  ```bash
  npx electron . --smoke-test=out.webm --smoke-format=webm --smoke-seconds=120 --smoke-output=box
  # 형식: webm | mov-qtrle | mov-prores | mp4-green, 출력: full | box
  # 리눅스 헤드리스: xvfb-run -a npx electron . --no-sandbox --smoke-test=...
  ```
  결과 JSON에 `size`, `frames`, `seconds`, `parts`(WebM 조각 수), `emojis`(불러온 이모티콘 수), `emojiAnimated`, `emojiSummary`.
  - 실제 채팅 파일로: `--smoke-chat=파일.csv --smoke-start=초` (이모티콘 자동 받기까지 기다린 뒤 렌더링). 성능 비교는 `--smoke-seconds=120`으로 5장 표와 비교.
  확인: `ffprobe -count_frames`로 프레임 수, WebM은 `ALPHA_MODE=1` 태그.
- **화면 확인 (Playwright):** 전역 playwright 필요(`npm i -g playwright`).
  ```bash
  node dev/ui-basic.cjs <저장폴더>       # 붙여넣기 80개 → 스크린샷 (체크무늬 / 어두운 배경 + 한 색 닉네임)
  node dev/ui-reference.cjs <저장폴더>   # 참고 이미지·영상, 100% 확대, 크게 보기, Esc
  ```
  설정이 localStorage에 남아 이전 실행 설정으로 뜰 수 있다 (ui-reference는 시작할 때 지운다).
- **실제 PC에서만 확인 가능한 것 (아직 미확인):** 창 전체 화면 전환, 프리미어에서 QuickTime Animation MOV 투명 배경.
- **프리미어는 WebM 투명을 안 보여준다 (2026-10-24 사용자 실측, 프리미어 버전 미상):** 사용자 PC에서 만든 2시간 9분 WebM(1080p 전체, 410MB)을 프리미어에 올리니 배경이 검정. 파일 자체는 정상(`ALPHA_MODE=1`, libvpx-vp9로 풀면 93%가 알파 0) → 프리미어가 VP9 알파를 무시하는 것. 형식 목록 문구를 바꿨다 (WebM: "프리미어에서는 투명이 안 보임", QuickTime Animation: "프리미어용 추천").
  - 실제 채팅(VOD 15822204, 00:24~00:26) 2분으로 잰 크기 → 2시간 9분 환산: QuickTime Animation 전체 9.8GB / 상자만 8.2GB (2분 렌더 9.0초 / 3.0초), ProRes 4444 전체 69GB / 상자만 63GB (60초 / 10초). PNG 코덱 MOV는 QuickTime Animation보다 컸다.
- 설치된 글꼴 목록(`queryLocalFonts`)은 이 PC에서 964종 불러와짐 (확인됨).
- **로컬 Windows PC (2026-10-24 클라우드에서 옮김):** 위치 `C:\Users\ODQ\Desktop\도마\1ClaudeProject_26.10\chzzk_chattovideo`, Node 22.17. 소스로 점검 모드 `--smoke-seconds=120 --smoke-format=webm --smoke-output=box` → 3600프레임, 8조각, **3.1초**, 22.0MB (5장 리눅스 15초 대비). 다른 형식·패키징 exe·Playwright 화면 확인은 이 PC에서 아직 안 돌려봤다.

## 9. 다음 작업 (사용자가 요청했고 계획까지 합의한 것)

**말풍선 배경:** v0.3.0에서 만들었다 (4장). 사용자가 로컬 exe(`dist/`)로 테스트 중 → 피드백 반영 후 Release.
- 1차 피드백 (2026-10-24): "스크롤 모션 괜찮고 말풍선 크기·여백도 괜찮다, 더 상세히 조절하고 싶다" → 단계 접기, 여백 네 방향, 글자 간격, 위쪽 페이드 켜고 끄기, 설치된 글꼴 불러오기 켜고 끄기를 추가 (Release 전, 버전은 그대로 0.3.0).
- 이 PC 측정: 2분 WebM 상자만 3.1초(배경 없음) → 5.7초(말풍선 + 그림자), 26~30MB. 그림자 끄면 얼마나 빨라지는지는 안 재봤다.
- 패키징 exe(`dist/win-unpacked`)로 WebM·ProRes·그린 MP4 10초 점검 통과. 한글 경로에서도 `npm run dist` 됨.
- 같이 고친 것: `.panel > section > label > input {width:100%}`가 체크박스에도 걸려 「닉네임 굵게」 같은 체크박스 글자가 오른쪽으로 밀려 있던 버그 (v0.2.0부터 있었음).

**이모티콘 치환 / 움직이는 이모티콘:** v0.3.0에서 만들었다 (4장 이모티콘). 사용자 테스트 대기. 아래는 처음 합의한 계획 (기록용).

**이모티콘 치환:** 채팅 속 `{:d_41:}` → 이름 `d_41`.
- 불러온 채팅에서 쓰인 이모티콘을 사용 횟수순으로 보여주고, 등록됨/미등록을 표시한다 ("23종 중 5종 미등록").
- 등록: 이름마다 이미지 지정, 또는 폴더 통째로(파일명 = 이름). 앱 데이터 폴더에 복사해서 유지.
- 미등록 처리: 원문 그대로 / 지우기 / 회색 `[d_41]`.
- 크기는 글자 크기 대비 배율. 줄바꿈할 때 쪼개지지 않게.
- 치지직 VOD 채팅에도 `extras.emojis`(이름 → 이미지 URL)가 **있다** (2026-10-24 로컬 PC에서 실제 응답으로 확인, 예: `{"d_126":"https://ssl.pstatic.net/static/nng/glive/icon/c_54.png"}`). 추출기 CSV에 같이 내보내면 자동 등록할 수 있다 (아직 안 함, 추출기 쪽 작업 먼저).

**움직이는 이모티콘:** 프레임은 채팅 시각이 아니라 **영상(VOD) 전체 시계 기준** `(t mod 사이클 길이)`.
- 그래서 누가 언제 쳤든 같은 이모티콘은 같은 프레임으로 움직이고, 중간부터 잘라 뽑아도 사이클이 유지된다.
- GIF/APNG/WebP는 Chromium `ImageDecoder`로 프레임과 프레임별 시간을 미리 디코딩.
- 움직이는 이모티콘이 화면에 있으면 `frameKey`가 반복 최적화를 못 하므로 키에 프레임 번호를 넣어야 한다. 그 구간은 느려진다 → "움직임 멈춤(첫 프레임)" 옵션도 같이.

사용자에게 받으면 좋은 것: 이모티콘이 들어간 채팅의 클립보드 복사본, 테스트용 이모티콘 이미지(움직이는 것 포함).
