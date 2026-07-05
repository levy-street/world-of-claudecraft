<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · **한국어** · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# World of ClaudeCraft에 기여하기

먼저, 이곳을 찾아 주셔서 감사합니다. World of ClaudeCraft는 클래식 MMO를 사랑하는 사람들의 커뮤니티가 함께 만들어 가는 게임이며, 크고 작은 모든 기여가 게임을 더 나아지게 합니다. 오타를 고치는 일, 게임을 번역하는 일, 버그를 제보하는 일, 완전히 새로운 던전을 만드는 일까지 전부 소중하며, 여러분을 진심으로 환영합니다.

이 가이드는 개발 환경을 갖추고 첫 기여를 매끄럽게 시작하도록 도와줍니다. 전문가일 필요는 없습니다. 무엇이든 명확하지 않은 점이 있으면 [Discord](https://discord.gg/GjhnUsBtw)에 물어보세요. 누군가 기꺼이 도와줄 것입니다.

참여하시는 것은 곧 저희의 [행동 강령](../../CODE_OF_CONDUCT.md)을 따르겠다는 데 동의하시는 것입니다.

## 기여하는 방법

이곳에는 누구에게나 자리가 있습니다.

- **코드.** 버그를 고치거나, 기능을 추가하거나, 성능을 개선하세요.
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  와 [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  라벨이 붙은 이슈가 시작하기에 좋습니다.
- **번역.** 언어를 개선하거나 완성해서 전 세계의 플레이어를 도와주세요. 아래의 [게임 번역하기](#translating-the-game)를 참고하세요. 시작하기 가장 쉬우면서도 영향력이 큰 방법 중 하나입니다.
- **버그 제보와 기능 제안.** [이슈](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)를 열어 주세요. 명확한 버그 제보 하나도 진짜 기여입니다.
- **문서.** 이 가이드를 비롯해 README, 그리고 `docs/`에 있는 설계 문서는 언제든 더 좋아질 수 있습니다.
- **플레이테스트와 피드백.** 게임을 직접 해 보고, 어색하게 느껴지는 점을 알려 주고, Discord에서 아이디어를 나눠 주세요.

## 시작하기

[Node.js 22+](https://nodejs.org/)와 npm이 필요합니다. 멀티플레이어 서버를 실행하려면 Postgres를 구동하기 위한 [Docker](https://www.docker.com/)도 필요합니다.

```bash
# 1. GitHub에서 저장소를 포크한 다음, 포크한 저장소를 클론합니다
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. 의존성을 설치합니다
npm ci

# 3. 오프라인 클라이언트를 실행합니다 (서버나 데이터베이스가 필요 없습니다)
npm run dev          # 출력되는 URL을 엽니다 (보통 http://localhost:5173)
```

오프라인 월드를 즐기고 대부분의 작업을 진행하기에는 이 정도면 충분합니다. 전체 온라인 스택을 실행하려면 다음과 같이 합니다.

```bash
npm run db:up        # Docker에서 Postgres 16을 시작합니다 (개발 DB는 port 5433)
npm run server       # 권한을 가진 게임 서버를 빌드해 :8787에서 실행합니다
npm run dev          # 다른 터미널에서 실행합니다. 클라이언트가 서버로 프록시합니다
```

[README](../../README.md)에는 호스팅, 개발, 플레이에 대한 전체 가이드가 담겨 있고, 저장소 곳곳에 있는 `CLAUDE.md` 파일에는 각 영역의 규칙이 정리되어 있습니다.

## 변경 사항 만들기

1. **`main`에서 브랜치를 만듭니다.** `feature/<short-slug>` 또는 `fix/<short-slug>` 형식을 사용하세요.
2. **집중된 커밋을 만드세요.** 작고 독립적인 변경이 큰 변경보다 리뷰하고 병합하기 쉽습니다.
3. **`src/sim/`이나 `server/`에서 동작을 바꿨다면 테스트를 추가하거나 갱신하세요.**
4. **플레이어에게 보이는 텍스트는 번역 가능하게 유지하세요.** [현지화](#localization)와 [게임 번역하기](#translating-the-game)를 참고하세요.

### 염두에 둘 점

다음은 코드베이스의 핵심 규칙입니다. 전체 내용은 루트의 [`CLAUDE.md`](../../CLAUDE.md)에 있지만, 짧게 정리하면 다음과 같습니다.

- **시뮬레이션 코어(`src/sim/`)가 진실의 원천입니다.** 이 코어는 DOM, 브라우저, Three.js를 가져오지 않은 순수한 상태로 유지되며, 그래서 똑같은 코드가 오프라인에서도, 서버에서도, 헤드리스 RL 환경에서도 그대로 실행됩니다.
- **시뮬레이션은 결정론적입니다.** 고정된 20 Hz 틱으로 동작하고, 모든 무작위성은 `Rng`를 거칩니다. 시뮬레이션 로직에서 `Math.random`, `Date.now`, `performance.now`는 절대 사용하지 마세요. 같은 시드는 언제나 같은 월드를 만듭니다.
- **게임플레이 수치는 클래식 시대 MMO 공식을 따릅니다** (분노, 명중 표, 방어도, 경험치 곡선). 밸런스 수치를 임의로 만들어 내지 말고, 대신 공식의 출처를 밝혀 주세요.
- **생성된 파일을 직접 수정하지 마세요.** `*.generated.ts` 같은 파일이 그 예이며, 빌드를 통해 다시 생성해 주세요.
- **비밀 값이나 `.env` 파일을 절대 커밋하지 마세요.** 또한 `ALLOW_DEV_COMMANDS`는 치트를 풀어 주므로 프로덕션 경로에서는 절대 활성화하지 마세요.

## 풀 리퀘스트를 열기 전에

다음 명령들을 로컬에서 실행해 주세요. CI가 돌리는 검사와 동일합니다.

```bash
npm test                    # Vitest 스위트
npx tsc --noEmit            # TypeScript 타입 검사 (프로젝트는 strict 모드입니다)
npm run build               # 프로덕션 클라이언트 빌드
```

서버나 헤드리스 코드를 변경했다면 `npm run build:server`와 `npm run build:env`도 실행하세요.

그런 다음, 플레이어에게 보이는 부분을 건드렸다면 데스크톱과 모바일 양쪽에서, 세로와 가로 방향의 휴대폰 크기 화면을 포함해 변경 사항을 테스트하세요. 터치 영역은 최소 40x40px, 폼 입력의 글자 크기는 최소 16px를 유지해야 합니다. UI 표준은 [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md)에 정리되어 있습니다.

## 풀 리퀘스트 열기

브랜치를 푸시하고 `main`을 대상으로 PR을 여세요. [풀 리퀘스트 템플릿](../../.github/PULL_REQUEST_TEMPLATE.md)이 짧은 체크리스트를 따라가도록 안내해 줍니다. 빠짐없이 채워 주세요.

- **무엇이** 바뀌었고 **왜** 바뀌었는지 설명하세요.
- 관련된 이슈가 있으면 연결하세요 (예: "Closes #123").
- **UI 변경에는 스크린샷이나 짧은 클립을** 데스크톱과 모바일 모두에 대해 첨부하세요.
- 테스트, 타입 검사, 빌드가 통과하는지, 그리고 새로 추가된 문자열이 번역되었는지 확인하세요.

병합 전에 저희가 보는 것은 통과한 CI 실행과 빠짐없이 채워진 체크리스트입니다. 메인테이너가 변경을 제안할 수도 있습니다. 이는 거절이 아니라 함께 만들어 가는 과정의 자연스러운 일부입니다. 저희는 리뷰에서 친절하고 건설적이려 노력하며, 여러분께도 같은 마음을 부탁드립니다.

> 커밋 메시지와 PR 제목은 적절한 곳에 스코프를 붙여 [Conventional Commits](https://www.conventionalcommits.org/)를 따릅니다 (`feat(talents): ...`, `fix(net): ...`). 엄격한 규칙이라기보다 저희가 선호하는 관례입니다. 완벽한 형식보다 명확하고 설명이 잘 된 메시지가 더 중요합니다.

<a id="localization"></a>

## 현지화

World of ClaudeCraft는 여러 언어로 제공되며, 게임이 성장하는 동안에도 계속 그렇게 유지합니다. 플레이어에게 보이는 모든 문자열은 지원하는 모든 로케일로 번역됩니다.

- 사용자에게 보이는 모든 텍스트는 [`src/ui/i18n.ts`](../../src/ui/i18n.ts)에 정의된 `t()` 키입니다. 새 문자열은 먼저 `en` 로케일에 추가한 다음, `supportedLanguages`의 나머지 모든 로케일에 실제 번역을 제공하세요. 영어 자리표시자나 `// TODO`는 안 됩니다.
- 숫자, 화폐, 날짜, 단위, 백분율은 문자열을 직접 조립하지 말고 포매터(`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`)를 거치게 하세요.
- 언어 중립을 유지하는 `src/sim/`이나 `server/`에서 내보내는, 플레이어에게 보이는 텍스트는 같은 변경 안에서 클라이언트 경계에서 다시 현지화해야 합니다. 가드 테스트 `npx vitest run tests/localization_fixes.test.ts`가 이를 강제합니다.

변경하면서 문자열을 추가했는데 일부 언어로만 작성할 수 있어도 괜찮습니다. PR을 열고 설명에 나머지에 대한 도움을 요청하세요. 여러분이 망설이며 멈추는 것보다, 저희가 함께 마무리하도록 돕는 편이 훨씬 좋습니다.

<a id="translating-the-game"></a>

## 게임 번역하기

어떤 언어를 개선하거나, 게임을 새로운 언어로 옮기는 데 힘을 보태고 싶으신가요? 그렇게 하는 데 게임 코드를 작성할 필요는 전혀 없습니다.

1. [`src/ui/i18n.ts`](../../src/ui/i18n.ts)를 열어 작업하고 싶은 로케일을 찾으세요. 각 로케일 객체에는 `en`과 동일한 키들이 들어 있습니다.
2. 기존 번역을 다듬거나, 어색하게 읽히는 부분을 채워 넣으세요.
3. `npx tsc --noEmit`을 실행해 빠진 것이 없는지 확인한 다음 PR을 여세요.

완전히 새로운 로케일을 제안하거나 어조와 용어에 대해 의논하고 싶다면 [Discord](https://discord.gg/GjhnUsBtw)에서 스레드를 시작하세요. 저희가 연결 작업을 도와드리겠습니다. 원어민과 유창한 분들을 특히 환영합니다. 좋은 번역은 어디에 있는 플레이어에게든 게임을 내 집처럼 느끼게 해 줍니다.

## 버그 제보와 기능 요청

[이슈 템플릿](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)을 사용해 주세요.

- **버그 제보.** 중복을 피하기 위해 먼저 [기존 이슈](https://github.com/levy-street/world-of-claudecraft/issues)를 검색한 다음, 재현 단계, 기대한 결과, 실제로 일어난 일, 그리고 사용 환경(오프라인 또는 온라인, 브라우저, 데스크톱 또는 모바일)을 함께 적어 주세요.
- **기능 요청.** 해결책만이 아니라 풀고자 하는 문제를 설명해 주세요. 맥락이 있으면 저희가 알맞은 것을 설계하는 데 도움이 됩니다.

## 도움받기

막혔거나, 그냥 인사를 건네고 싶으신가요? [커뮤니티 Discord](https://discord.gg/GjhnUsBtw)에 들어오세요. 너무 사소해서 못 할 질문은 없으며, 새로운 기여자는 언제나 환영합니다.

## 라이선스

기여하시면, 여러분의 기여가 프로젝트의 [MIT 라이선스](../../LICENSE), 즉 프로젝트 전체를 다루는 것과 같은 라이선스로 배포되는 데 동의하시는 것입니다.

---

World of ClaudeCraft에 기여해 주셔서 감사합니다. 여러분이 저희와 함께 만들어 갈 것을 어서 보고 싶습니다.
