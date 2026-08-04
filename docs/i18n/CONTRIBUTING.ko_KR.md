<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · **한국어** · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# World of ClaudeCraft에 기여하기

먼저, 이곳을 찾아 주셔서 감사합니다. World of ClaudeCraft는 클래식 MMO를 사랑하는
사람들의 커뮤니티가 함께 만들어 가는 게임이며, 크고 작은 모든 기여가 게임을 더
나아지게 합니다. 오타를 고치는 일, 게임을 번역하는 일, 버그를 제보하는 일, 완전히
새로운 던전을 만드는 일까지 전부 소중하며, 여러분을 진심으로 환영합니다.

이 가이드는 개발 환경을 갖추고 첫 기여를 매끄럽게 시작하도록 도와줍니다. 전문가일
필요는 없습니다. 무엇이든 명확하지 않은 점이 있으면
[Discord](https://discord.com/invite/worldofclaudecraft)에 물어보세요. 누군가 기꺼이 도와줄 것입니다.

참여하시는 것은 곧 저희의 [행동 강령](../../CODE_OF_CONDUCT.md)을 따르겠다는 데
동의하시는 것입니다.

## 기여하는 방법

이곳에는 누구에게나 자리가 있습니다.

- **코드.** 버그를 고치거나, 기능을 추가하거나, 성능을 개선하세요.
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  와 [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  라벨이 붙은 이슈가 시작하기에 좋습니다.
- **번역.** 언어를 개선하거나 완성해서 전 세계의 플레이어를 도와주세요. 아래의
  [게임 번역하기](#translating-the-game)를 참고하세요. 시작하기 가장 쉬우면서도
  영향력이 큰 방법 중 하나입니다.
- **버그 제보와 기능 제안.** [이슈](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)를
  열어 주세요. 명확한 버그 제보 하나도 진짜 기여입니다.
- **문서.** 이 가이드를 비롯해 README, 그리고 `docs/`에 있는 설계 문서는 언제든 더
  좋아질 수 있습니다.
- **플레이테스트와 피드백.** 게임을 직접 해 보고, 어색하게 느껴지는 점을 알려 주고,
  Discord에서 아이디어를 나눠 주세요.

## 시작하기

[Node.js 26](https://nodejs.org/)와 **pnpm 10.34.x**가 필요합니다(`package.json`의 `packageManager`에 정확한 핀이 있으며, 현재는 `pnpm@10.34.5`). 더 오래된 Node 메이저는 검증되지 않았습니다. 멀티플레이어 서버를 쓰려면 Postgres용 [Docker](https://www.docker.com/)도 필요합니다.

**Corepack은 필수가 아닙니다.** Node에 포함된 npm으로 pnpm을 한 번만 설치하세요. macOS, Linux, Windows에서 같은 경로입니다.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install pnpm once (same command on macOS, Linux, Windows)
#    Match the packageManager pin in package.json (today: 10.34.5).
npm install -g pnpm@10.34.5
pnpm --version   # should print 10.34.5 (or the pin in package.json)

# 3. Install dependencies (uses the global content-addressable store)
pnpm install --frozen-lockfile

# 4. Point git at the repository hooks (once per clone)
git config core.hooksPath .githooks

# 5. Run the offline client (no server or database needed)
pnpm run dev         # open the URL it prints (usually http://localhost:5173)
```

pnpm 설치 후에도 `npm run <script>`는 동작합니다(Node가 npm을 포함)만, **설치와 lockfile 갱신은 반드시 pnpm으로** 해야 합니다. `package-lock.json`을 커밋하지 마세요. 유일한 진실 소스는 `pnpm-lock.yaml`입니다.

오프라인 월드를 즐기고 대부분의 작업을 진행하기에는 이 정도면 충분합니다. 전체
온라인 스택을 실행하려면 먼저 환경 변수에 데이터베이스 비밀번호가 있어야 합니다.

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
pnpm run db:up       # start Postgres 16 in Docker (dev DB on port 5433)
pnpm run server      # build and run the authoritative game server on :8787
pnpm run dev         # in another terminal; the client proxies to the server
```

아래의 전체 게이트를 실행할 계획이라면, 게이트가 구동하는 브라우저를 한 번 설치해
두세요. `pnpm exec playwright install chromium`.

[README](../../README.md)에는 호스팅, 개발, 플레이에 대한 전체 가이드가 담겨 있고,
저장소 곳곳에 있는 `CLAUDE.md` 파일에는 각 영역의 규칙이 정리되어 있습니다.

### TypeScript 툴체인

타입 검사는 네이티브 컴파일러인 TypeScript 7에서 동작합니다. `npx tsc --noEmit`은
이전과 똑같이 작동하며, 저장소 전체 검사가 수십 초가 아니라 몇 초 만에 끝납니다.
설치 구성은 공식적인 이중 별칭입니다. `svelte-check`가 여전히 TypeScript 6 JS API를
사용하기 때문에 `typescript` 패키지는 (`@typescript/typescript6` 래퍼를 통해) 그
API로 해석되고, `tsc` 바이너리는 `@typescript/native`가 제공합니다. 알아 두어야 할
점은 다음과 같습니다.

- **에디터.** VS Code는 내장 지원이 출시되기 전까지 네이티브 언어 서비스를 쓰려면
  "TypeScript 7" 마켓플레이스 확장(`TypeScriptTeam.native-preview`)이 필요합니다.
  `js/ts.experimental.useTsgo` 설정으로 켜고 끌 수 있으며, 확장의 "Disable
  TypeScript 7 Language Server" 명령이 TypeScript 6 tsserver로 돌아가는 공식적인
  대안입니다. JetBrains IDE는 `@typescript/native-preview` 패키지 이름에서만
  네이티브 서버를 자동 감지하므로, 이 저장소의 `@typescript/native` 별칭은 인식하지
  못합니다. IDE에 번들된 TypeScript 6 지원은 문제없이 동작합니다.
- **유용한 tsc 플래그.** `--checkers N`은 병렬 타입 검사 워커 수를 지정합니다
  (기본값 4이며, 개수와 무관하게 결과는 동일합니다). 자원이 제한된 러너에서는 값을
  낮춰 메모리를 제한하고, 코어가 많은 장비에서는 값을 올리되, 많을수록 항상 빠른
  것은 아니므로 양쪽 모두 측정해 보세요. `--singleThreaded`는 모든 병렬 처리를
  비활성화합니다. 디렉터리에 `tsconfig.json`이 있으면 단일 파일을 임시로 검사하는
  방식(`npx tsc somefile.ts`)은 오류가 납니다. 예전처럼 동작시키려면
  `--ignoreConfig`를 넘기세요.
- **잠금 파일.** 잠금 파일은 `pnpm-lock.yaml`입니다(pnpm 10 / lockfileVersion 9). 이 저장소 루트에서 `pnpm install`, `pnpm add`, `pnpm update`로만 갱신하세요(수동 편집 금지). `package.json` 변경과 함께 `pnpm-lock.yaml`을 커밋하세요. CI는 `pnpm install --frozen-lockfile`로 설치하며, 오래된 lockfile은 실패합니다. 두 번째 lockfile(`package-lock.json` / yarn.lock)을 들이지 마세요. 이중 lockfile은 조용히 어긋나며 금지됩니다. 선택적 wallet/solana 트리의 peer 의존성 노이즈는 `.npmrc`의 `strict-peer-dependencies=false`로 허용됩니다. 측정 없이 더 느슨하게 만들지 마세요.
- **언제 다시 검토할지.** 다음 두 가지가 모두 충족되면 이중 별칭을 하나의
  `typescript` 의존성으로 되돌립니다. TypeScript 7.1의 안정 JS API가 출시되고
  (TypeScript 7.0은 JS API를 전혀 제공하지 않으며, 대체 방안은
  microsoft/typescript-go 이슈 2824에서 추적 중입니다), sveltejs/language-tools
  이슈 3063이 이를 채택한 `svelte-check` 릴리스와 함께 닫히는 것입니다.
  svelte-check의 실험적 `--tsgo` 모드는 TypeScript 6 API 요구를 없애 주지 않으며,
  진행 중인 TypeScript 7 로딩(language-tools PR 3073)은 이 저장소가 이미 사용하는
  `@typescript/native` 별칭을 읽으므로 이름을 바꿀 필요는 없습니다.

## 변경 사항 만들기

1. **가장 최신 릴리스 브랜치에서 시작하고, `main`에서는 절대 시작하지 마세요.**
   진행 중인 작업은 `release/vX.Y.Z` 브랜치에 통합됩니다. `main`은 그 뒤를 따라가며
   기여의 기준 브랜치가 아닙니다. 가장 최신 브랜치를 찾아 거기서 갈라져 나오세요.

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   이 안내서에서 버전 번호를 그대로 옮겨 적지 말고 항상 이 조회를 직접 실행하세요.
   릴리스 브랜치는 자주 교체되며, 가장 최신 브랜치는 릴리스마다 바뀝니다. 브랜치
   이름은 `feature/<short-slug>` 또는 `fix/<short-slug>` 형식입니다.
2. **집중된 커밋을 만드세요.** 작고 독립적인 변경이 큰 변경보다 리뷰하고 병합하기
   쉽습니다.
3. **`src/sim/`이나 `server/`에서 동작을 바꿨다면 테스트를 추가하거나 갱신하세요.**
4. **플레이어에게 보이는 텍스트는 번역 가능하게 유지하세요.**
   [현지화](#localization)와 [게임 번역하기](#translating-the-game)를 참고하세요.

### 염두에 둘 점

다음은 코드베이스의 핵심 규칙입니다. 전체 내용은 루트의
[`CLAUDE.md`](../../CLAUDE.md)에 있지만, 짧게 정리하면 다음과 같습니다.

- **시뮬레이션 코어(`src/sim/`)가 진실의 원천입니다.** 이 코어는 DOM, 브라우저,
  Three.js를 가져오지 않은 순수한 상태로 유지되며, 그래서 똑같은 코드가
  오프라인에서도, 서버에서도, 헤드리스 RL 환경에서도 그대로 실행됩니다.
- **시뮬레이션은 결정론적입니다.** 고정된 20 Hz 틱으로 동작하고, 모든 무작위성은
  `Rng`를 거칩니다. 시뮬레이션 로직에서 `Math.random`, `Date.now`,
  `performance.now`는 절대 사용하지 마세요. 같은 시드는 언제나 같은 월드를
  만듭니다.
- **게임플레이 수치는 클래식 시대 MMO 공식을 따릅니다** (분노, 명중 표, 방어도,
  경험치 곡선). 밸런스 수치를 임의로 만들어 내지 말고, 대신 공식의 출처를 밝혀
  주세요.
- **새 로직은 큰 코디네이터 파일에 덧붙이지 말고, 기존 이음새 뒤에 자체적인 작고
  테스트된 모듈로 들어갑니다.** 렌더러나 HUD가 읽는 데이터는 `IWorld`
  인터페이스(`src/world_api/`)를 통과하며 오프라인 월드와 온라인 월드 양쪽에
  구현합니다. 새 시뮬레이션 시스템은 `SimContext` 뒤로 들어가고, 새 REST
  엔드포인트는 `pnpm run new:endpoint`로 뼈대를 만들 수 있는 라우트 모듈입니다.
- **생성된 파일을 직접 수정하지 마세요.** `*.generated.ts` 같은 파일이 그 예이며,
  빌드를 통해 다시 생성해 주세요.
- **문서 표기 규칙: em 대시, en 대시, 이모지를 어디에서도 쓰지 않습니다.** 코드,
  주석, 문서, 커밋 메시지, PR 본문, 플레이어에게 보이는 문구 모두 해당합니다. 쉼표,
  콜론, 괄호를 쓰고, 범위에는 "to"를 쓰세요. 푸시 전 검사가 여러분의 diff를
  훑어보고 하나라도 발견되면 푸시를 막습니다.
- **비밀 값이나 `.env` 파일을 절대 커밋하지 마세요.** 또한 `ALLOW_DEV_COMMANDS`는
  치트를 풀어 주므로 프로덕션 경로에서는 절대 활성화하지 마세요.

### 코드 스타일

포매팅은 `biome.json`에 설정된 [Biome](https://biomejs.dev/)를 따릅니다. 2칸 들여쓰기,
100열 줄 길이, 작은따옴표, 후행 쉼표입니다. 여러분이 건드린 파일만 포매팅하고
(`npx @biomejs/biome check --write <your-file.ts>`) `pnpm run ci:changed`로 확인하세요.
CI는 변경된 파일만 검사하므로 저장소 전체를 다시 포매팅하지는 말아 주세요. 전체
실행은 여러분이 고칠 몫이 아닌 오래된 부채를 드러냅니다.

## 풀 리퀘스트를 열기 전에

저장소 게이트를 로컬에서 실행하세요. CI가 강제하는 것과 동일한 계약입니다.

```bash
pnpm run gate
```

작업하는 동안에는 단일 스위트(`npx vitest run tests/sim.test.ts`)와 포매팅 확인용
`pnpm run ci:changed`를 실행하세요. `pnpm test`는 전부를 실행하며, 스위트 지도는
`tests/CLAUDE.md`에 있습니다. 전체 `pnpm run gate`는 생성 산출물의 최신 여부, 악성
코드 스캔, 변경된 파일 포매팅, 효과음 적합성 검사, 전체 테스트 스위트, 실제 브라우저
회귀 검사, 엄격한 타입 검사, 그리고 클라이언트, 서버, 헤드리스 빌드를 포함합니다.
푸시 전 최소 검사부터 시작하는 계층별 검사는 [`docs/qa-gate.md`](../qa-gate.md)에
설명되어 있습니다.

그런 다음, 플레이어에게 보이는 부분을 건드렸다면 데스크톱과 모바일 양쪽에서, 세로와
가로 방향의 휴대폰 크기 화면을 포함해 변경 사항을 테스트하세요. 터치 영역은 최소
40x40px, 폼 입력의 글자 크기는 최소 16px를 유지해야 합니다. UI 표준은
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md)에 정리되어 있습니다.

## 풀 리퀘스트 열기

브랜치를 푸시하고 **시작할 때 사용한 것과 같은 최신 `release/vX.Y.Z` 브랜치를
대상으로** PR을 여세요. **`main`은 절대 대상으로 삼지 마세요.** `main`은 기여의
기준이 아니라 릴리스 시점의 통합 브랜치입니다. GitHub는 종종 `main`을 미리 선택해
두므로, 제출하기 전에 기준 브랜치를 바꿔 주세요.
[풀 리퀘스트 템플릿](../../.github/PULL_REQUEST_TEMPLATE.md)이 짧은 체크리스트를
따라가도록 안내해 줍니다. 빠짐없이 채워 주세요.

- **무엇이** 바뀌었고 **왜** 바뀌었는지 설명하세요.
- 관련된 이슈가 있으면 연결하세요 (예: "Closes #123").
- **UI 변경에는 스크린샷이나 짧은 클립을** 데스크톱과 모바일 모두에 대해 첨부하세요.
- `pnpm run gate`가 통과하는지, 그리고 플레이어에게 보이는 새 문자열이 아래의
  영어 우선 기여자 정책을 따르는지 확인하세요.

여러분의 PR에서 CI는 변경된 파일에 대한 포매팅과 린트, 네 개의 병렬 샤드로 나눈 전체
테스트 스위트, 브라우저 회귀 검사, 그리고 타입 검사와 클라이언트, 서버, 헤드리스
빌드를 실행합니다. 이는 로컬에서 `pnpm run gate`가 실행하는 것과 같으므로, 게이트가
초록색이면 PR도 초록색일 가능성이 높습니다.

병합 전에 저희가 보는 것은 통과한 CI 실행과 빠짐없이 채워진 체크리스트입니다.
메인테이너가 변경을 제안할 수도 있습니다. 이는 거절이 아니라 함께 만들어 가는 과정의
자연스러운 일부입니다. 저희는 리뷰에서 친절하고 건설적이려 노력하며, 여러분께도 같은
마음을 부탁드립니다.

> 커밋 메시지와 PR 제목은 스코프를 붙여
> [Conventional Commits](https://www.conventionalcommits.org/)를 따릅니다
> (`feat(talents): ...`, `fix(net): ...`). 모든 커밋에는 본문도 함께 들어갑니다. 빈
> 줄 다음에, 무엇이 바뀌었고 왜 바뀌었는지 말하는 한 문장에서 네 문장의 평이한
> 서술을 72열 근처에서 줄바꿈해 적습니다. 제목만 있는 커밋은 충분하지 않습니다.

<a id="localization"></a>

## 현지화

World of ClaudeCraft는 여러 언어로 제공됩니다. 플레이어에게 보이는 모든 문자열은
번역 키여야 하지만, 기능을 기여하는 분은 보통 영어 원문만 추가하면 됩니다.

- 사용자에게 보이는 모든 텍스트는 `t()` 키입니다. 새 영어 문구는
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) 아래의 해당 도메인 모듈에
  추가한 다음(새 HUD 크롬은 `hud_chrome.ts`로 갑니다), `t('dotted.key', values)`로
  렌더링하세요. 기능 PR에서는 영어만 있는 것이 정확히 맞습니다. 나머지 로케일은
  메인테이너가 릴리스 시점에 채우므로, 여러분은 `src/ui/i18n.locales/` 오버레이를
  수정하지 않으며 그 안에 영어 자리표시자나 `// TODO`를 남기지도 않습니다. M16
  예외는 길이가 긴 새 영어 값으로, 이 경우
  [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md)에 설명된 다섯 개의 비라틴 문자
  로케일 채움도 함께 필요합니다.
- 숫자, 화폐, 날짜, 단위, 백분율은 문자열을 직접 조립하지 말고
  포매터(`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`)를 거치게 하세요.
- 언어 중립을 유지하는 `src/sim/`이나 `server/`에서 내보내는, 플레이어에게 보이는
  텍스트는 같은 변경 안에서 클라이언트 경계에서 다시 현지화해야 합니다. 가드 테스트
  `npx vitest run tests/localization_fixes.test.ts`가 이를 강제합니다.
- 문자열을 추가하거나 변경한 뒤에는 `pnpm run i18n:gen`을 실행하고 다시 생성된 번들을
  같은 변경 안에서 커밋하세요. 게이트와 CI 모두 커밋된 산출물을 새로 생성한 결과와
  비교하므로, 오래된 번들은 빌드를 실패시킵니다.

그러니 문자열은 영어로 추가하고 PR을 여세요. 직접 번역하실 필요는 없습니다. 번역을
도와주고 싶으시다면 다음 절을 참고하세요.

<a id="translating-the-game"></a>

## 게임 번역하기

어떤 언어를 개선하거나, 게임을 새로운 언어로 옮기는 데 힘을 보태고 싶으신가요?
그렇게 하는 데 게임 코드를 작성할 필요는 전혀 없습니다.

1. 플레이어에게 보이는 번역의 대부분은
   [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) 아래의 언어별 오버레이
   파일(로케일당 하나)에 있으며,
   [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/)의 영어 키를 그대로
   반영합니다. 시뮬레이션과 서버가 내보내는 텍스트는 `src/ui/sim_i18n.ts`와
   `src/ui/server_i18n.ts`에서, 특성 문구는 `talent_i18n` 모듈에서 번역하며, 관리자
   대시보드는 `src/admin/i18n.locales/` 아래에 자체 세트를 가지고 있습니다.
2. 기존 번역을 다듬거나, 어색하게 읽히는 부분을 채워 넣으세요.
3. `pnpm run i18n:gen`을 실행하고 다시 생성된 번들을 오버레이 수정과 함께 커밋한 다음,
   현지화 스위트
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)를
   실행하고 PR을 여세요. 오버레이는 의도적으로 성기게 작성되어 있으므로, 타입 검사만
   으로는 키가 빠졌는지 알 수 없습니다.

완전히 새로운 로케일을 제안하거나 어조와 용어에 대해 의논하고 싶다면
[Discord](https://discord.com/invite/worldofclaudecraft)에서 스레드를 시작하세요. 저희가 연결 작업을
도와드리겠습니다. 원어민과 유창한 분들을 특히 환영합니다. 좋은 번역은 어디에 있는
플레이어에게든 게임을 내 집처럼 느끼게 해 줍니다.

## 버그 제보와 기능 요청

[이슈 템플릿](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)을
사용해 주세요.

- **버그 제보.** 중복을 피하기 위해 먼저
  [기존 이슈](https://github.com/levy-street/world-of-claudecraft/issues)를 검색한
  다음, 재현 단계, 기대한 결과, 실제로 일어난 일, 그리고 사용 환경(오프라인 또는
  온라인, 브라우저, 데스크톱 또는 모바일)을 함께 적어 주세요.
- **기능 요청.** 해결책만이 아니라 풀고자 하는 문제를 설명해 주세요. 맥락이 있으면
  저희가 알맞은 것을 설계하는 데 도움이 됩니다.
- **보안 취약점.** 공개 이슈로 열지 말아 주세요. [SECURITY.md](../../SECURITY.md)를
  따라 비공개로 제보해 주시면, 수정과 공개 절차를 함께 진행하겠습니다.

## 도움받기

막혔거나, 그냥 인사를 건네고 싶으신가요?
[커뮤니티 Discord](https://discord.com/invite/worldofclaudecraft)에 들어오세요. 너무 사소해서 못 할
질문은 없으며, 새로운 기여자는 언제나 환영합니다.

## 라이선스

코드를 기여하시면, 여러분의 코드 기여가 프로젝트의
[MIT 라이선스](../../LICENSE), 즉 프로젝트 전체를 다루는 것과 같은 라이선스로
배포되는 데 동의하시는 것입니다.

MIT 라이선스는 문자 그대로를 뜻합니다. 누구든 상업적으로든 아니든 코드를 사용하고,
수정하고, 재배포할 수 있습니다. 저희의
[이용 약관](https://worldofclaudecraft.com/terms)은 worldofclaudecraft.com에서
저희가 운영하는 호스팅 게임(계정, 행동 규범, 가상 아이템)에 적용되며, MIT 라이선스가
이 코드에 대해 여러분이나 다른 누구에게 주는 권리를 제한하지 않습니다. "World of
ClaudeCraft"와 "Levy Street"라는 이름과 브랜딩은 MIT 라이선스의 적용 대상이
아닙니다.

원본 창작 자산(녹음, 음악, 아트, 그리고 이와 유사한 저작물)은 예외입니다. 여러분이
직접 만든 원본 자산을 기여하는 경우, 저작권을 그대로 보유한 채 원하는
라이선스(예: CC BY-NC 4.0)로 기여할 수 있으며, 다음 조건을 충족해야 합니다.

- 라이선스, 그 라이선스가 적용되는 자산 경로, 그리고 여러분의 저작자 표시가 같은 풀
  리퀘스트 안에서 [CREDITS.md](../../CREDITS.md)의 라이선스 표에 기록되어야 하며,
- 공식 릴리스와 인게임 상점을 포함해 World of ClaudeCraft에서 해당 자산을 상업적으로
  사용할 수 있도록, Levy Street에 최소한 영구적이고 로열티 없는 이용 허락을 부여해야
  합니다.

CREDITS.md 표에 등재된 자산에 대해서는, 기록된 그 라이선스가 프로젝트의 기본 MIT
라이선스보다 우선합니다.

**CREDITS.md 항목이 없는 미디어 자산은 MIT 라이선스가 적용되지 않습니다.** 등록부는
아직 채워 나가는 중이므로, 항목이 없다는 것은 조건이 기록되지 않았다는 뜻이지 자산을
자유롭게 가져다 써도 된다는 뜻이 아닙니다. 이는 의도적인 설계로, 등록되지 않은 기여가
기본값으로 넘겨져 버리는 일을 막습니다. 코드는 그 반대여서, CREDITS.md에서 따로
떼어 두지 않은 모든 것은 MIT입니다.

그렇기 때문에 등록부 항목은 선택적인 서류 작업이 아닙니다. CREDITS.md 행 없이 자산을
기여하면, 하류의 누구도 그 자산을 사용할 수 없고 여러분이 저희에게 무엇을 허락했는지
기록도 남지 않습니다. **재배포** 열도 정직하게 기록해 주세요. 이 프로젝트를 포크하는
사람에게 여러분의 자산을 넘겨줘도 되는지 알려 주는 것이 바로 그 열이며, 일부 행이
"No, permission required"로 표시된 데에는 실제로 넘겨줄 수 없다는 이유가 있습니다.

---

World of ClaudeCraft에 기여해 주셔서 감사합니다. 여러분이 저희와 함께 만들어 갈 것을
어서 보고 싶습니다.
