<div align="center">

# World of ClaudeCraft

**브라우저에서 무료로 직접 만든 세계를 모험하고, 파티를 맺고, 레이드하세요. 오픈 소스, web3, 그리고 지금 바로 온라인.**

**공식 웹사이트: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.33.1-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.ko_KR.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · **한국어** · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[지금 플레이](https://worldofclaudecraft.com/) · [직접 세계 호스팅하기](#host-your-own-world-one-command) · [에이전트 훈련하기](#train-an-agent-headless-rl) · [Web3](#web3) · [기여하기](CONTRIBUTING.ko_KR.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft 타이틀 화면](../../docs/screenshots/title-screen.jpg)

</div>

## 이것은 무엇인가

World of ClaudeCraft는 지금 바로 브라우저에서 플레이할 수 있고, 명령어 하나로 직접 호스팅할 수 있으며, 심지어 AI 에이전트를 훈련시켜 플레이하게 할 수도 있는 완성된 클래식 시대 MMO입니다. 무료이고, 오픈 소스이며, [worldofclaudecraft.com](https://worldofclaudecraft.com/)에서 실시간으로 운영됩니다.

하나의 공유 세계가 모두 같은 게임 코어에서 세 곳에 걸쳐 실행됩니다:

- **권위 있는 멀티플레이어 서버**, worldofclaudecraft.com에서 플레이하는 실시간 세계로, Postgres 기반 계정들이 하나의 영속적인 렐름을 공유합니다,
- **오프라인 브라우저 세계**, 개발 서버에서 얻는 로컬 싱글플레이 Sim으로, 개발할 때나 게임 코어를 처음부터 끝까지 읽어볼 때 유용합니다,
- **헤드리스 RL 환경**, Python이 Gym 인터페이스를 통해 실제 게임을 구동합니다.

같은 시드, 같은 세계, 어디서나. 보이는 것의 상당 부분은 여전히 런타임에 코드로부터 그려지고, 나머지는 프로젝트와 함께 출하되는 엄선된 에셋 세트이므로, 포크한 저장소도 그대로 실행됩니다.

## 주요 특징

- **아홉 가지 클래식 클래스**, 각각 레벨이 오르면서 등급이 올라가는 완전한 클래식 시대 스타일 기술 세트를 갖추고, 거기에 완전한 **특성 시스템**(클래스당 세 가지 전문화, 총 27가지 전문화)을 더했습니다.
- 레벨 1부터 20까지 이어지는 **세 개의 오픈 월드 존**, 90개가 넘는 퀘스트, 그리고 Gravecaller 음모를 다루는 하나로 연결된 스토리라인.
- **다섯 개의 인스턴스 던전**, 그중 넷은 5인 정예 레이드이고 하나는 솔로 묘지로, 정예 스케일링, 광역 보스 메커니즘, 티어 세트로 모이는 클래스 원형 전리품, 그리고 더 풍성한 보상을 주는 **영웅 난이도 등급**을 갖췄으며, 여기에 오픈 월드 **월드 보스**와 10인 레이드 피날레가 더해집니다.
- **두 개의 확장형 델브**, 한두 명의 플레이어와 AI 동료를 위한 소규모 모드로, 일반과 영웅 등급에 걸쳐 매 진행마다 무작위 방으로 재구축됩니다.
- 두 개의 투기장 맵에서 벌어지는 **랭크 PvP**: 1대1과 2대2 래더, 더 활기찬 2대2 Fiesta 모드, 그리고 3대3과 5대5 목표 모드인 **Protect Yumi**. 랭크 플레이는 Honor를 지급하고, Honor로는 PvE에서 던전 전리품을 결코 앞지르지 않는 PvP 전용 장비 세트를 살 수 있습니다.
- **The Vale Cup**, Eastbrook 남쪽 전용 경기장에서 열리는 보어볼 리그, 그리고 **Card Duel**, 마을에서 열리는 빠른 1대1 카드 게임.
- **Book of Deeds**: 장식용 칭호, 배지 테두리, Renown을 담은 업적 일지로, 세계 속 Chronicler NPC들이 관리하는 존별 Chronicle과 평생 리더보드를 갖췄습니다.
- **깊이 있는 전문 기술 경제**: 네 가지 채집 기술이 열 가지 제작 기술을 먹여 살립니다. 요리와 연금술부터 보석세공, 무기제작, 마법부여까지 이어지며, 등급별 도구, 마을 작업대, 명품 품질, 의뢰가 있고, 이 모두가 플레이어 주도의 **World Market**과 **Ravenpost** 우편 서비스로 흘러갑니다.
- **진짜 멀티플레이어**: 파티와 레이드, 길드, 거래, 결투, 선점 권리, 파티 분배 경험치, 귓속말, 자리비움 상태, 그리고 역할 대기열과 사전 구성 목록을 갖춘 **Dungeon Finder**.
- **3D 에디터가 아니라 코드로 저작**: 지형, 물, 날씨, 마을 배치, 실시간 그림자, 이펙트가 런타임에 생성되고, 함께 출하되는 모델도 손으로 조각한 것이 아니라 절차적 팩토리와 엄선된 에셋 라이브러리로 만들어집니다.
- 결정론적이고 시뮬레이션이 키를 방출하는 파이프라인을 통해 **22개 로케일로 현지화**되었습니다.
- **`/wiki`의 동반 위키**, 실시간 게임 콘텐츠에서 바로 생성되므로 그것이 문서화하는 세계와 어긋날 수 없습니다.
- **모든 플랫폼의 네이티브 앱**: 자동 업데이트와 선택적 Steam 업적 미러링을 갖춘 Windows, Linux, macOS용 서명된 데스크톱 설치 프로그램, 그리고 iOS와 Android 빌드까지, 모두 브라우저 클라이언트와 동일한 온라인 세계를 공유합니다.
- **가진 기기에 맞춰 확장**: 그래픽 프리셋과 자동 프레임률 조절기가 시각적 풍부함을 부드러움과 맞바꾸며, 플레이어가 반응하는 정보는 결코 숨기지 않도록 공정성 규칙의 적용을 받습니다.
- Gymnasium 바인딩, 보상 셰이핑, 벤치마크 모드를 갖춘 **헤드리스 RL 환경**.
- **$WOC 유틸리티, 완전히 선택 사항**: Solana 지갑을 연동하면 보유자 표식, Daily Rewards, 그리고 장식용 상점의 할인 결제 옵션을 이용할 수 있습니다. 게임은 계속 무료 플레이이고 비수탁형입니다.
- **Season 1 Armory**: 법정 화폐, SOL, USDC, $WOC로 구매한 Claudium을 사용해 WOC Store에서 장식용 무기 스킨을 수집하세요. 장식품은 결코 전투력을 제공하지 않습니다.

## 스크린샷

![Eastbrook 마을 광장, 모닥불과 퀘스트 제공자들](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Eastbrook 모닥불의 황혼](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Eastbrook 모닥불의 황혼* | ![the Hollow Crypt의 정예 풀링](../../docs/screenshots/hollow-crypt.jpg)<br>*the Hollow Crypt의 횃불에 비친 정예 풀링* |
| ![폐허가 된 예배당의 안식 없는 망자](../../docs/screenshots/restless-dead.jpg)<br>*폐허가 된 예배당의 안식 없는 망자* | ![Vale Bandits와의 난투](../../docs/screenshots/vale-bandits.jpg)<br>*산적 야영지에서 수적으로 밀리다* |
| ![북쪽 길에서 사냥당한 Old Greyjaw](../../docs/screenshots/old-greyjaw.jpg)<br>*희귀 출현 몹 Old Greyjaw, 북쪽 길에서 쫓겨 잡히다* | ![상인과 가방 UI](../../docs/screenshots/vendor-and-bags.jpg)<br>*Trader Wilkes의 상점에서 상인 창과 가방을 열어 두고 장비를 갖추다* |
| ![Glimmermere 기슭의 달의 문](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Glimmermere의 달의 문에서 익사한 자들이 기어 올라온다* | ![the Drowned Temple 제단의 Ysolei](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest와 the Drowned Temple의 제단* |

날씨는 생물군계 기반이며 렌더 전용이라, 결정론적 시뮬레이션에는 결코 영향을 주지 않습니다:

| | | |
|:---:|:---:|:---:|
| ![Eastbrook Vale 위로 맑은 하늘](../../docs/screenshots/weather-vale_clear.jpg)<br>*Vale 위로 맑음* | ![Mirefen Marsh 위로 내리는 비](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Mirefen Marsh 위로 비* | ![Thornpeak Heights에 내리는 눈](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Thornpeak Heights에 눈* |

## 플레이하기

[worldofclaudecraft.com](https://worldofclaudecraft.com/)에서 브라우저로 플레이하거나, Windows, Linux, macOS, iOS, Android용 네이티브 앱을 설치하세요. 모든 클라이언트가 같은 온라인 세계에 접속합니다.

### 온라인, 다른 플레이어와 함께

계정을 만들고, 캐릭터를 만들고, 실시간 세계로 들어가세요. 그 클라이언트/서버 스택을 직접 실행하려면 아래 [직접 세계 호스팅하기](#host-your-own-world-one-command)를 참고하세요.

### 오프라인, 개발 서버에서

오프라인 모드는 계정도 서버 권위도 없는 로컬 싱글플레이 세계이므로, 개발 빌드에만 포함됩니다. 개발 서버를 실행하면 모드 선택 화면에 나타납니다:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

캐릭터 이름을 정하고, 아홉 클래스 중 하나를 고르면, **Eastbrook Vale**(레벨 1-7)에서 시작합니다. 이곳은 여러 거점으로 둘러싸인 시장 마을입니다: 북쪽으로 늑대 사냥터, 동쪽으로 멧돼지 초원, 서쪽으로 the Sableweb 숲, 북서쪽으로 Mirror Lake, 남서쪽으로 굴파는 짐승이 들끓는 구리 채굴장, 북동쪽으로 안식 없는 망자가 있는 폐허가 된 예배당, 그리고 남동쪽으로 Gorrak의 산적 야영지가 있습니다. 북쪽 길은 산길을 따라 **Mirefen Marsh**(6-13, 거점 Fenbridge)로 오르고, 거기서 더 올라 **Thornpeak Heights**(13-20, 거점 Highwatch)에 닿습니다. 세계 시드는 `src/main.ts`에 고정되어 있어, 방문할 때마다 같은 장소입니다.

### Windows, Linux, macOS용 데스크톱 앱

World of ClaudeCraft는 세 주요 데스크톱 플랫폼 모두에 완전한 데스크톱 앱으로 출하됩니다: 서명된 Windows 설치 프로그램, Linux AppImage와 deb 패키지, 그리고 서명 및 공증된 macOS 유니버설 빌드입니다. 브라우저와 동일한 게임 클라이언트와 온라인 세계를 쓰면서, 네이티브 패키징과 자동 업데이트를 더했습니다.

온라인 로그인은 웹과 정확히 같은 방식으로 Discord와 이메일만 지원합니다: 이메일/비밀번호는 앱 안에서 로그인하고, "Continue with Discord"는 기본 브라우저에서 `/desktop-login` 페이지를 열어 일회용 코드를 `worldofclaudecraft://` 딥 링크로 앱에 돌려주며, 앱은 이를 일반적인 World of ClaudeCraft 세션 토큰으로 교환합니다.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

`VITE_DESKTOP_API_ORIGIN`으로 셸이 다른 API를 바라보게 할 수 있습니다. 예를 들어 로컬 서버나 스테이징 호스트로:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

스테이징 빌드에서 프로덕션 API 오리진을 덮어쓰려면 `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com`을 쓰세요(BUILD 시점 값입니다: 번들에 구워지고 패키징된 앱에 각인되며, 설치된 빌드는 이를 런타임 환경 변수로 무시합니다). Steam은 배포 채널이고(동일한 Electron 번들을 SteamPipe로 업로드), 데스크톱 플레이어는 Steam 계정을 연동해 획득한 deed를 Steam 업적으로 미러링할 수 있습니다; 로그인 자체는 이메일과 Discord로 유지됩니다. 전체 릴리스 런북(서명, 공증, 자동 업데이트 게시, SteamPipe depot, 서버 배포)은 `docs/desktop-release.md`에 있습니다. iOS와 Android는 Capacitor를 통해 출하되며, 자체 런북은 `docs/mobile-store-release.md`에 있습니다.

<a id="host-your-own-world-one-command"></a>

## 직접 세계 호스팅하기 (명령어 하나)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

**원격 호스팅**의 경우, compose 스택을 아무 VPS에나 올리고, 환경에 실제 `POSTGRES_PASSWORD`를 설정한 뒤, 8787 포트 앞에 TLS 리버스 프록시를 둡니다. Caddy를 쓰면 몇 줄이면 됩니다; WebSocket은 자동으로 프록시되고 클라이언트는 https 페이지에서 `wss://`를 자동 선택합니다. 인증 엔드포인트는 속도가 제한되고, 비밀번호는 scrypt로 해시되며, 로그인 세션은 만료됩니다. 프로덕션에서는 절대 `ALLOW_DEV_COMMANDS=1`을 설정하지 마세요. 전체 `/dev` 치트 세트가 활성화되기 때문입니다: 테스트 봇이 쓰는 레벨 및 순간이동 치트에 더해 아이템 지급, 몹 소환, 인스턴스 순간이동, 게임 내 개발 명령 GUI까지 열립니다. [DEPLOY.md](../../DEPLOY.md)는 전체 프로덕션 가이드이며, 상태 확인과 메트릭 엔드포인트를 공개 엣지에서 차단하는 리버스 프록시 설정도 담고 있습니다.

<a id="develop-online-with-hot-reload"></a>

### 핫 리로드로 온라인 개발하기

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

http://localhost:5173 을 열고 **Play Online**을 선택해 계정을 만들고, 캐릭터를 만든 뒤 Enter World로 들어갑니다. 캐릭터 선택 화면의 News & Updates 패널에는 최신 릴리스 소식이 표시되고, 아직 보지 않은 항목에는 NEW 배지가 붙습니다. 두 번째 탭을 열어 다시 로그인하면 마을에서 서로를 볼 수 있습니다. `Enter`로 채팅을 엽니다. 플레이어 위키는 저장소에 포함된 Guide이며, http://localhost:5173/wiki 와 프로덕션의 `/wiki`에서 제공됩니다; 그 콘텐츠는 `npm run wiki:content`로 현재 게임 데이터에서 생성됩니다.

무엇이 유지되고 서버가 어떻게 주도권을 쥐는가:

- **계정**: scrypt로 해시된 비밀번호와 만료되는 베어러 토큰.
- **캐릭터**: 렐름당 계정마다 최대 10개; 레벨, 장비, 가방, 은행 금고, 퀘스트, 특성, 전문 기술, PvP와 deed 진행도, 위치, 돈이 Postgres에 JSONB로 유지되며, 타이머에 따라, 로그아웃 시, 서버 종료 시 저장됩니다. 이름은 렐름별로 고유하고 클래식 스타일입니다.
- **서버가 권위를 가짐**: 클라이언트는 이동 의도와 명령을 20 Hz로 스트리밍하고; 서버는 하나의 공유 `Sim`을 실행하여 관심 범위 스냅샷과 플레이어별 이벤트를 반환합니다. 모든 전투 판정, 전리품 드롭, 퀘스트 적립, 상인 거래는 서버 측에서 해결됩니다. 클라이언트는 렌더러입니다.

<a id="train-an-agent-headless-rl"></a>

## 에이전트 훈련하기 (헤드리스 RL)

같은 결정론적 코어가 [Gymnasium](https://gymnasium.farama.org/) 환경으로 실행되므로, 에이전트는 게임의 재구현이 아니라 실제 게임을 상대로 학습합니다. 환경 서버(`headless/env_server.ts`)는 하나의 `Sim`을 감싸고 stdio를 통해 개행 구분 JSON으로 통신합니다; `python/`의 Python 바인딩이 이를 하위 프로세스로 실행하고 익숙한 `reset` / `step` / `close` 루프를 노출합니다.

```bash
npm run build:env    # bundle the env server to dist-env/env_server.cjs
npm run env          # run it directly (NDJSON on stdio)
npm run bench        # in-process throughput benchmark (no IPC)

# drive it from Python
pip install gymnasium numpy
python python/example_random_agent.py
```

```python
from wow_env import WoWClassicEnv

env = WoWClassicEnv(player_class="warrior")   # any of the nine classes
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **관찰 공간과 행동 공간은 콘텐츠에서 파생됩니다.** 하드코딩하지 말고 시작 시 환경의 `info` 응답에서 질의하세요; 게임과 함께 늘어납니다. 행동 공간은 이동, 타겟, 공격, 전체 기술 세트, 상호작용, 먹기/마시기를 아우르는 `Discrete`이고, 관찰은 자기 자신, 기술, 타겟, 주변 몹, 가장 가까운 상호작용 대상, 퀘스트 진행을 아우르는 `Box`입니다.
- **보상**은 틱당 카운터 변화량(경험치, 가한 피해와 받은 피해, 처치, 사망, 퀘스트 진행, 레벨업)의 가중 합이며, 리셋마다 조정할 수 있습니다. 각 `step`은 하나의 행동을 적용하고 기본적으로 다섯 시뮬레이션 틱을 진행하므로, 시뮬레이션 1초당 대략 네 번의 결정입니다.
- **설계상 결정론적입니다.** 벽시계 시간도, `Math.random`도 없습니다. 리셋에 시드를 주면 에피소드가 정확히 재현됩니다.

프로토콜과 바인딩은 `headless/CLAUDE.md`와 `python/CLAUDE.md`에 문서화되어 있습니다.

<a id="web3"></a>

## Web3

World of ClaudeCraft는 Solana 위의 커뮤니티 토큰 **$WOC**를 중심으로 web3 네이티브입니다. Solana 지갑을 연결하고, 서명 한 번으로 계정에 연동하면(비수탁형, 승인할 트랜잭션 없음), 읽기 전용 $WOC 잔액이 장식용 보유자 등급 배지와 함께 HUD에 표시됩니다.

$WOC는 실시간 게임 안에서 선택적인 용도도 갖습니다:

- **WOC Store**: 일방향 장식용 화폐인 Claudium을 법정 화폐, SOL, USDC, $WOC로 구매합니다. $WOC 결제 경로는 다른 수단보다 할인됩니다.
- **Season 1 Armory**: Claudium을 장식용 무기 스킨 컬렉션에 사용합니다. 상점 구매는 능력치나 전투력을 더하지 않습니다.
- **Daily Rewards**: 자격을 갖춘 인증 보유자는 일일 스핀과 순환 과제로 포인트를 모아, 매일의 상금 풀 지분을 두고 경쟁할 수 있습니다.

이 중 어느 것도 플레이에 필요하지 않습니다. 지갑 연동은 선택 사항이며 비수탁형이고, pay-to-win은 없으며, 지갑을 한 번도 연결하지 않아도 게임 전체가 멀쩡히 플레이됩니다.

**$WOC 컨트랙트 주소 (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

토큰에 대한 더 자세한 내용은 [worldofclaudecraft.com](https://worldofclaudecraft.com/)에 있습니다.

## 세계 둘러보기

### 아홉 클래스

모든 클래스는 클래식 시대 MMO 메커니즘을 처음부터 직접 구현해 돌아가며, 레벨 1-20에 걸쳐 등급 주문을 배웁니다. Low Blow, Early Grave, Skyfall, Urgent Prayer, Ancestral Strike 같은 대표 기술은 여정 후반부에 걸쳐 해금됩니다.

- **Warrior**: 분노, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds(당신의 타격에 얹히는 출혈), Widening Arc, Hobbling Cut, Blood Toll, Redhand(회피 발동).
- **Paladin**: Verdict로 터뜨리는 Oathbrand, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith(흡수), Sundering Gavel(기절), Last Rite.
- **Hunter**: 원거리 자동 공격(클래식 스타일 데드존이 있는 8-35 yd), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash, 그리고 레벨 10부터 길들일 수 있는 펫.
- **Rogue**: 기력과 연계 점수, Wicked Slash, Dirt Nap, Craven Thrust(뒤에서, 단검), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding(흡수), Lingering Grace(지속 치유), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon(무기 부여), Mending Waters, Earthen Jolt, Thunder Ward(가시), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts(정신 집중), Bewitch, Icebind, 소환하는 물의 정령, 그리고 시간 마법 치유 전문화인 Chronomancy.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume, 그리고 Emberkin부터 Wraithborn까지 소환 가능한 일곱 악마.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots, 그리고 5레벨의 Wolf Form, 8레벨의 Bruin Form, 10레벨의 Moonwing Form 변신.

치유와 버프는 파티원에게 적용되고, 치유는 치명타가 날 수 있으며, 흡수 보호막은 체력보다 먼저 피해를 흡수합니다. **클래스당 세 가지 특성 전문화**(Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart 등)에 점수를 분배하세요; 분배는 서버에서 검증되며 빌드 문자열로 내보낼 수 있습니다.

### 던전

the Gravecaller 스토리라인은 세 개의 5인 정예 인스턴스를 관통하고, 네 번째는 자체적인 익사 설화를 품은 채 달의 문 뒤에서 기다리며, 탐험가를 위한 솔로 묘지가 한쪽에 자리합니다.

- **The Hollow Crypt**(5인) the Fallen Chapel 아래: 짝지은 정예 잡몹, Sexton Marrow 중간 보스, 그리고 그림자 광역을 반복해서 떨어뜨리는 Morthen the Gravecaller. 묘지 문은 파티를 비공개 인스턴스 사본으로 순간이동시키며, 그 사본은 비워지면 리셋됩니다.
- **The Sunken Bastion**(5인, 레벨 13 부근, 남동쪽 Mirefen): Vael the Fogbinder가 전투가 길어질수록 Drowned Thralls 무리를 소환합니다.
- **Gravewyrm Sanctum**(5인, 레벨 20, Thornpeak 아래): 정예 본가드와 비늘수호병이 있는 세 개의 방, Korgath the Bound, Grand Necromancer Velkhar, 그리고 에픽 무기가 드롭되는 Korzul the Gravewyrm.
- **The Drowned Temple**(5인) Glimmermere의 달의 문을 통과: 창백한 보랏빛 달이 비치는 인스턴스로, Choirmother Selthe를 거쳐 Ysolei, Avatar of the Drowned Moon에 이릅니다. 그녀의 달 조수와 소환된 Moonspawn은 한자리에 머무는 파티를 응징합니다.
- **The Abandoned Crypt**(솔로) Thornpeak에 위치: 한 명을 위한 조용한 열쇠돌과 일기 탐험으로, 그 흔적이 왕실 문을 봉인 해제하여 세 개의 영혼 수호석에 걸쳐 싸우는 10인 레이드 피날레 **Nythraxis, Scourge of Thornpeak**로 이어집니다.

모든 인스턴스는 **영웅**으로도 돌아갑니다: 더 높은 레벨의 적, 더 날카로운 메커니즘, 그리고 자체 전리품과 상인 화폐를 갖췄습니다. 도입부 퀘스트 사슬은 솔로로 진행할 수 있어, 스토리가 결코 파티 찾기 뒤에 막혀 있지 않습니다. 우리의 자동화된 5봇 레이드(집중 공격과 힐러 AI를 갖춘 warrior, paladin, priest, mage, hunter)는 the Hollow Crypt를 약 5분 만에 클리어합니다(`node scripts/crypt_raid.mjs`, `ALLOW_DEV_COMMANDS=1` 필요).

### 델브

델브는 한두 명의 플레이어를 위한 별개의 확장형 소규모 모드로, 매 진행마다 무작위 방으로 재구축되고, 전리품 굴림이 아니라 자물쇠 따기 미니게임으로 열리는 잠긴 성유물 상자에서 끝납니다. **The Collapsed Reliquary**(레벨 7 이상)는 Deacon Varric에서 끝나며, 솔로로 진행하면 AI 동료 Tessa가 곁에서 함께 싸웁니다. **The Drowned Litany**(레벨 12 이상)는 그 흔적을 따라 Mirefen Marsh 가장자리의 물에 잠긴 사원으로 이어집니다. 델브 게시판에서 등급을 정합니다: 영웅은 적 레벨을 올리고 무작위 접사를 추가하여 더 풍부한 보상을 줍니다.

### 랭크 PvP (the Ashen Coliseum)

`G` 또는 투기장 버튼을 눌러 대기열에 듭니다. 매치메이킹이 전사들을 비공개 구덩이로 순간이동시키고, 짧은 카운트다운이 모두를 치유하고 리셋하여 공정한 시작을 만들며, 한쪽이 항복하면 대결이 끝납니다. 아무도 죽지 않고, 당신은 대기열에 든 바로 그 자리로 돌아옵니다. Protect Yumi는 Coliseum 구덩이가 아니라 자체 미로에서 벌어집니다.

- **1대1과 2대2 랭크 래더**, 각각 영구적인 Elo 방식 평점과 역대 리더보드를 갖췄습니다.
- **2대2 Fiesta**, 더 활기찬 파티 모드로, 팀들이 처치 목표를 향해 달리는 동안 증강 획득물이 힘을 떨어뜨리고 닫혀오는 링이 싸움을 한데 몰아넣습니다.
- **Protect Yumi**, 미로에서 벌어지는 등급 없는 3대3과 5대5 목표 모드: 각 팀은 고양이 수호물을 지키면서 상대편의 것을 쓰러뜨리려 하므로, 순수한 처치 수보다 호위와 끊어치기가 더 중요합니다.

랭크 승리와 Fiesta 처치는 **Honor**를 지급하고, 마을의 병참장교가 이를 Warfare 장비 세트로 교환해 줍니다. Warfare는 PvP 전용 능력치이므로, 이 세트는 PvE에서 같은 등급의 던전 전리품을 앞지르는 일 없이 결투를 승리로 이끕니다.

### 함께 플레이하기

- **Dungeon Finder**: `Shift+I`로 열어 던전과 레이드를 둘러보고, 보스와 전리품을 살펴보고, 자동 탱커/힐러/딜러 역할 대기열에 들거나, 사전 구성 목록을 만드세요. Finder로 맺어진 파티도 입구까지는 함께 이동합니다.
- **파티** 최대 5인, 가득 차면 두 그룹으로 이루어진 10인 레이드로 전환됩니다: 플레이어를 우클릭하고 파티 초대를 누릅니다. 멤버는 선점 권리와 퀘스트 적립을 공유하고, 클래식 시대 그룹 보너스로 경험치를 분배하며, 미니맵에 점으로 표시됩니다. 파티 채팅은 `/p`, 전리품 분배는 `/roll`.
- **거래**: 우클릭하고 거래. 양쪽이 아이템과 돈을 올리고, 양쪽이 수락해야 하며, 교환은 원자적이고 서버에서 검증됩니다. 퀘스트 아이템은 거래할 수 없고, 멀리 걸어가면 취소됩니다.
- **결투**: 우클릭하고 결투 신청. 3초 카운트다운 후, 한쪽이 1 hp에 닿을 때까지 싸웁니다; 승자는 존 전체에 알려지고 60야드 밖으로 달아나면 기권입니다.
- **선점 권리와 자리비움 상태**: 몹에 처음 피해를 준 플레이어가 그 전리품, 경험치, 퀘스트 적립을 소유합니다; `/afk`와 `/dnd`는 귓속말에 자동 응답하며 당신을 자리비움으로 표시합니다.

### 세계와 시스템

- **전문 기술**(`Shift+P`): 네 가지 채집 기술(채광, 벌목, 약초학, 낚시)이 열 가지 제작 기술을 먹여 살립니다. 요리와 연금술부터 무기제작, 보석세공, 마법부여까지 이어집니다. 채집 도구는 어떤 자원을 다룰 수 있는지 결정하는 등급으로 나뉘고, 제작은 마을 작업대에서 이루어지며 제작자의 각인이 새겨지는 명품 품질이 나올 확률이 있고, 전문화를 진행하며 발견해 나가는 원형 시스템도 있습니다.
- **The World Market**: 장비, 재료, 소모품을 위한 플레이어 주도 경매장으로, 거점 마을에서 둘러볼 수 있습니다.
- **Ravenpost 우편**: 다른 캐릭터에게 아이템과 동전을 보내며, 첨부물은 수령할 때까지 안전하게 보관됩니다.
- **길드**: 헌장, 명단, 등급, 길드 채팅.
- **The Guide**: `/wiki`의 검색 가능한 사이트 내 위키로, 클래스, 생명체, 존, deed를 다루며 실시간 게임 콘텐츠에서 바로 생성되므로 그것이 문서화하는 세계와 어긋날 수 없습니다.
- **The Vale Cup과 Card Duel**: Eastbrook 남쪽 Sowfield 경기장에서 1대1부터 5대5까지의 형식으로 벌어지는 보어볼, 그리고 마을의 Card Master가 여는 빠른 1대1 카드 게임.
- **Daily Rewards**: 인증된 $WOC 보유자는 일일 스핀과 순환 과제로 리더보드 포인트를 얻고, 매일의 상금 풀에서 자동으로 지급받습니다.
- **WOC Store와 Season 1 Armory**: 법정 화폐, SOL, USDC, $WOC로 Claudium을 사서 순수 장식용 무기 스킨에 사용하세요.
- **먹기와 마시기**: 앉아서 회복하고, 피해를 입거나 일어서면 중단되며, 그렇습니다, 먹기와 마시기를 동시에 할 수 있습니다.
- **상인**, 음식과 물을 사들이고 정직한 흰색 장비를 팔며, 동전은 금화, 은화, 동화로 표시됩니다.
- **개인 은행**(the Gilded Strongbox): 각 거점 마을의 금고지기가 캐릭터마다 금고를 관리하며, 24칸에서 시작해 동전으로 확장하면 96칸까지 늘어나고, 이메일 인증, 계정 연동, 추천으로 온라인에서 보너스 칸을 얻을 수 있습니다.
- **The Book of Deeds**: 퀘스트, 처치, 클리어, 소소한 즐거움을 담은 업적 일지(기본 `Shift+Z`)로, 이름표와 채팅, 게시판에 달 수 있는 장식용 칭호를 지급하고, 쫓고 있는 deed를 위한 HUD 추적기, Chronicler NPC들이 관리하는 존별 Chronicle, 평생 Renown 리더보드를 갖췄습니다; 공개 목록은 `/wiki/deeds`에 있습니다.
- **몹 AI**: 배회, 레벨 차이에 따른 근접 어그로, 군집 끌기, 추격, 끈 풀림과 리셋, 시체 약탈, 그리고 재출현, 거기에 긴 타이머의 희귀 출현 몹(Old Greyjaw).
- **낚시** 지점, 자체 전리품 표와 희귀 어획물을 갖췄습니다.
- **장식 스킨**, 비범, 희귀, 에픽 등급으로 굴리며, 순전히 외형용입니다.
- **죽음과 회복**: 영혼을 묘지로 풀어주고, 낙하 피해를 입으며, 수영 중에는 느려집니다.
- **생물군계 날씨**: Vale에는 맑음, Marsh에는 비, Peaks에는 눈, 존 사이를 이동하면 서로 교차 페이드됩니다.

### 조작 (클래식 배치)

| 입력 | 동작 |
|---|---|
| `W` / `S` | 달리기 / 뒷걸음. `A`/`D`는 회전(우클릭을 누른 채로는 측면 이동), `Q`/`E`는 측면 이동 |
| 우클릭 드래그 / 좌클릭 드래그 | 마우스룩 / 카메라 공전. 휠로 줌, `Space`로 점프 |
| `Tab` | 가장 가까운 적들을 순환. 좌클릭으로 타겟, 우클릭으로 공격, 약탈, 또는 대화 |
| `1`-`9`, `0`, `-`, `=` | 액션 바 |
| `F` | 상호작용 (시체 약탈, 물건 줍기, 대화) |
| `C` `P` `L` `M` `B` `N` `T` | 캐릭터, 주문서, 퀘스트 로그, 세계 지도, 가방, 특성, 제작 |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | 투기장, 친구와 길드, 리더보드, 캘린더, Vale Cup, Dungeon Finder, 전문 기술, deed |
| `Z` / `X` | 무기 넣기 또는 뽑기, 감정 표현 휠 |
| `V` / `R` / `Esc` | 이름표, 자동 달리기, 맨 위 창 닫기(또는 게임 메뉴 열기) |

모든 키 바인딩은 키 설정 패널에서 재지정할 수 있습니다. 터치 조작(이동 스틱, 카메라 드래그, 화면 액션 버튼)은 모바일에서 자동으로 나타납니다.

## 아키텍처 (하나의 시뮬레이션, 세 호스트)

세 가지 아이디어가 프로젝트를 하나로 묶습니다:

- **하나의 시뮬레이션, 세 호스트.** 같은 `src/sim/` 코드가 오프라인 브라우저 세계, 온라인 서버, RL 환경을 실행합니다. 동작은 어디서나 동일해야 하고, 테스트는 그 상태를 유지하기 위해 존재합니다.
- **`IWorld`가 유일한 이음매.** `IWorld`는 `src/world_api/` 아래 도메인별 파셋 인터페이스로 정의되고, `src/world_api.ts`가 이를 모읍니다. 오프라인 `Sim`은 구조적으로 이를 만족하고 온라인 `ClientWorld`는 서버 스냅샷을 미러링하여 구현합니다. 렌더러와 HUD는 오직 `IWorld`와만 대화하고 결코 구체적인 세계와 대화하지 않으므로, 새 기능은 먼저 해당 파셋을 확장한 뒤 양쪽 세계를 확장합니다.
- **서버가 권위를 가짐.** 클라이언트는 의도를 보내고; 서버가 결과를 결정합니다. 클라이언트는 결코 전투, 전리품, 경제를 스스로 해결하지 않습니다.

시뮬레이션은 고정 20 Hz 틱(`DT = 1/20`)이고, 모든 무작위성은 시드가 주어진 하나의 `Rng`를 거치며, `src/sim/`은 DOM, 브라우저, Three.js 임포트가 전혀 없습니다. 이것이 같은 코드를 한 줄도 바꾸지 않고 Node 환경 서버, 권위 있는 게임 루프, 브라우저 탭으로 묶을 수 있게 해줍니다.

### 프로젝트 구조

| 경로 | 무엇인가 |
|---|---|
| `src/sim/` | 결정론적 게임 코어, 진실의 원천. DOM이나 Three 의존성 없음. |
| `src/sim/content/` | 코드로서의 데이터: 아홉 클래스, 기술, 존, 던전, 델브, 아이템, 제조법, 마법부여, 특성, 전문 기술, deed. |
| `src/world_api.ts` + `src/world_api/` | 렌더러와 HUD가 의존하는 이음매 `IWorld`: 도메인마다 하나의 파셋 인터페이스. |
| `src/` (나머지) | Three.js 렌더러, HUD와 스타일, 입력/오디오, 온라인 미러, 그리고 관리자, 가이드, 에디터 SPA. |
| `server/` | 권위 있는 서버: HTTP와 WS, 세계 루프, Postgres, 인증, 소셜, 조정. |
| `server/http/` | REST 요청 파이프라인: 테이블 라우터, 미들웨어, 도메인별 라우트 정의. |
| `headless/` + `python/` | RL 환경 서버(`env_server.ts`)와 Python Gym 바인딩. |
| `bot/` | Discord 봇(역할, 중계, 활동 피드). |
| `electron/`, `android/`, `ios/` | 데스크톱(Steam)과 네이티브 모바일 셸. |
| `tests/` | Vitest 스위트. |
| `scripts/` | 빌드, 에셋, i18n, SFX, 스크린샷, 브라우저 E2E 도구. |
| `deploy/` · `mediawiki/` | 프로덕션 최초 부팅 에셋과 플레이어 위키 컨테이너. |
| `public/` · `docs/` | 정적 에셋(사이트에 그대로 배포됨)과 설계 문서. |

이 모두는 양심에만 맡기지 않습니다: `tests/architecture.test.ts`가 모든 시뮬레이션 파일에서 금지된
임포트, DOM 전역, 떠도는 시계나 `Math.random` 호출을 찾아내고,
`tests/world_api_parity.test.ts`가 이음매를 고정해 두 세계가 어긋날 수 없게 합니다.

대부분의 디렉터리는 로컬 규칙이 담긴 자체 `CLAUDE.md`를 갖고 있으며, 프로젝트 불변식의 전체
모음은 루트 [`CLAUDE.md`](../../CLAUDE.md)에 있습니다. 에이전트 기여자는 거기서 시작한 뒤
자기 런타임의 진입점을 집어 듭니다: Codex는 [`AGENTS.md`](../../AGENTS.md)와
[Codex 운영자 가이드](../codex.md), Gemini는 [`GEMINI.md`](../../GEMINI.md)입니다. 이
모두가 같은 정본 아키텍처로 이어집니다.

## 클래식처럼 만들어짐

전투, 레벨링, 위협 수준 모두 진짜 클래식 시대 규칙으로 돌아갑니다: 분노와 기력, 명중과 회피 표, 방어구 경감, 진짜 경험치 곡선, 휘두르기 타이머, 그리고 글로벌 쿨다운. 근사치가 아니라 기억하는 그 느낌 그대로입니다. 정확한 수치는 읽어보고 싶다면 `src/sim/`에 있습니다.

세계는 3D 에디터가 아니라 코드로 저작되며, 그 덕분에 작고, 결정론적이고, 포크하기 쉽게
유지됩니다:

- 지형, 물, 날씨, 하늘, 마을 배치, 실시간 그림자, 전투 이펙트는 시뮬레이션 자체의 데이터로부터 런타임에 생성됩니다.
- 함께 출하되는 모델도 같은 방식으로 만들어집니다: `scripts/assets/` 아래의 절차적 팩토리가 프로젝트의 image-to-GLB 파이프라인을 통해 결정론적 GLB를 내보내며, 엄선된 CC0 모델 키트 라이브러리가 함께합니다. 리깅된 생명체와 캐릭터 가족은 걷기, 공격, 시전, 앉기, 죽음 애니메이션을 모두 갖췄습니다.
- 아이콘은 파일이 없는 대상에도 그림을 합성해 주는 레이어드 페인터라 아이콘이 빠지는 일이 없으며, 기술, 아이템, deed에는 엄선된 그림 아트가 그 위에 얹힙니다.
- 완전한 클래식 HUD(유닛 프레임, 액션 바, 툴팁, 퀘스트 로그, 세계 지도, 미니맵, 떠다니는 전투 텍스트, the Book of Deeds), 샘플링된 공간 및 인터페이스 사운드, 그리고 저장소 안에서 절차적으로 작곡되어 존, 마을, 던전, 전투 사이를 교차 페이드하는 스트리밍 리마스터로 출하되는 사운드트랙.

출하되는 모든 에셋과 그 라이선스는 [CREDITS.md](../../CREDITS.md)에 기록되어 있고, 번들된
서드파티 의존성의 고지는 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)에 있습니다.

## 개발

게임 클라이언트 외에도 빌드는 운영자 대시보드, `/editor`의 월드 에디터, `/wiki`의 공개
Guide를 생성하며, 모두 같은 개발 서버에서 제공됩니다.

게이트와 오디오 테스트가 사용하는 모든 FFmpeg 경로는 번들된 `ffmpeg-static`/`ffprobe-static`
npm 패키지를 해석하므로, 일반적인 기여에는 시스템 FFmpeg 설치가 필요 없습니다. 적합성을
측정하는 경로(`npm run sfx:check`, 오디오 테스트, Studio의 내보내기 검증)는 `PATH` 폴백 없이
정적 바이너리에 직접 바인딩됩니다: 스크립트를 건너뛴 설치로 그것들이 빠졌다면 `npm ci`를 다시
실행하세요. Studio의 재생 및 인코딩 프로세스와 `npm run gate` 사전 점검은
`scripts/sfx/ffmpeg_paths.mjs`를 통해 해석되며, 이쪽은 `PATH`로 폴백합니다. 일부 독립 실행형
오디오 생성 스크립트(예를 들어 `scripts/gen_ui_sfx.mjs`)는 여전히 기본적으로 `PATH`의
`ffmpeg`를 씁니다.

```bash
npm test                        # vitest: formulas, combat, AI, quests, all 9 classes, parties, duels, trades, dungeons
npm run gate                    # complete CI-equivalent contribution gate
npm run build                   # production web build
npm run sfx:studio              # local SFX authoring, runtime mix, and production export
node scripts/smoke_browser.mjs  # warrior end-to-end (needs npm run dev)
node scripts/smoke_mage.mjs     # mage: casting, polymorph, conjure and drink, death and release
node scripts/visual_tour.mjs    # screenshot tour of the zone and UI into tmp/
node scripts/tour_temple.mjs    # screenshot tour of the Glimmermere and Drowned Temple into tmp/
node scripts/mp_integration.mjs # API, WS, and persistence checks (server running)
node scripts/social_e2e.mjs     # trade and duel over the wire (ALLOW_DEV_COMMANDS=1)
node scripts/arena_visual.mjs   # two clients queue and fight a ranked 1v1
node scripts/crypt_raid.mjs     # five bots clear the Hollow Crypt (ALLOW_DEV_COMMANDS=1)
```

로직과 단위 테스트는 Vitest를 씁니다. 반복하는 동안에는 단일 파일을 실행하세요: `npx vitest run tests/sim.test.ts`. 인터페이스 변경에는 접근성, 키보드 탐색, 터치 대상을 다루는 선택형 실제 브라우저 스위트도 있습니다: `npm run test:browser`. 스크린샷과 스모크 스크립트는 `puppeteer-core`로 실제 브라우저를 구동하며 `npm run dev` 실행이 필요합니다; 와이어 수준 스크립트(`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`)는 서버와 직접 통신하므로 대신 `npm run server`가 필요합니다. 브라우저 에이전트는 눌린 키를 시뮬레이션하는 대신 `window.__game.controller`를 통해 이동을 구동할 수 있습니다, 예를 들어 `controller.move({ forward: true }, facingRadians)` 또는 `{ f: 1, sr: 1 }` 같은 압축 플래그.

검사는 [docs/qa-gate.md](../qa-gate.md)에 설명된 대로 여러 층으로 실행됩니다: `git config
core.hooksPath .githooks`로 클론을 공유 훅에 연결해 두면, 무엇이든 머신을 떠나기 전에 빠른
최소 검사가 돌아갑니다.

서버 명령은 위의 [온라인 개발하기](#develop-online-with-hot-reload)를, 기여 워크플로는
[CONTRIBUTING.ko_KR.md](CONTRIBUTING.ko_KR.md)를, 사운드 저작과 아티팩트 내보내기는
[SFX Studio 튜토리얼](../sfx-studio-tutorial.md)을, 프로덕션은
[DEPLOY.md](../../DEPLOY.md)를, 에셋 라이선스는
[CREDITS.md](../../CREDITS.md)를 참고하세요.

## 현지화

모든 플레이어에게 보이는 문자열은 `t()`를 거쳐 해석되며, 게임은 **22개 로케일**(영어, 두 가지 스페인어, 두 가지 프랑스어, 캐나다 영어, 이탈리아어, 독일어, 간체 및 번체 중국어, 한국어, 일본어, 브라질 포르투갈어, 러시아어, 체코어, 네덜란드어, 폴란드어, 인도네시아어, 터키어, 스웨덴어, 베트남어, 덴마크어)로 출하됩니다. 시뮬레이션과 서버는 언어 비종속적으로 유지됩니다: 안정적인 키나 영어를 방출하고 클라이언트가 경계에서 다시 현지화하므로, 결정론이 온전히 유지됩니다. 기여자는 영어만 추가하고; 관리자가 매 릴리스 전에 다른 로케일을 일괄 채웁니다. 워크플로는 `docs/i18n-scaling/translation-workflow.md`에 문서화되어 있습니다.

## 기여하기

모든 종류의 기여를 환영합니다: 코드, 번역, 버그 신고, 문서. 설정은 [CONTRIBUTING.ko_KR.md](CONTRIBUTING.ko_KR.md)로 시작하고, [행동 강령](../../CODE_OF_CONDUCT.md)을 읽으며, 취약점을 신고하기 전에 [SECURITY.md](../../SECURITY.md)를 확인하세요. 여기가 처음이신가요? [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue) 라벨이 붙은 이슈를 찾거나, [이슈](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)를 열거나, [Discord](https://discord.com/invite/worldofclaudecraft)에서 인사를 건네세요.

활발한 개발은 가장 최신 `release/vX.Y.Z` 브랜치에서 진행됩니다. 짐작하지 말고 직접 확인한 다음, 그 브랜치에서 분기하고 풀 리퀘스트도 그쪽을 대상으로 하세요. 릴리스 브랜치가 출시될 때만 병합되는 `main`에서 분기하거나 `main`을 대상으로 하지 마세요. 현재 브랜치를 찾아 주는 한 줄 명령은 [CONTRIBUTING.md](CONTRIBUTING.ko_KR.md)에 있습니다.

## 라이선스

**코드는 [MIT 라이선스](../../LICENSE)이므로, 포크하고, 리믹스하고, 직접 세계를 호스팅하세요.** 그것이 이 프로젝트의 요점이며, 이 페이지나 우리 웹사이트의 어떤 내용도 그것을 되돌리지 않습니다.

세 가지가 별도로 라이선스되므로, 어느 것이 어느 것인지 30초만 들여 알아 둘 가치가 있습니다:

| 무엇 | 라이선스 | 재배포할 수 있나요? |
|---|---|---|
| **소스 코드**, 아래에서 따로 떼어낸 미디어 에셋을 제외한 전부 | [MIT](../../LICENSE) | 예. 상업적으로도 가능합니다. |
| **미디어 에셋**: 모델, 텍스처, HDRI, 아이콘, 사운드, 폰트(대부분 `public/` 아래) | 에셋별로 [CREDITS.md](../../CREDITS.md)에 기록됨 | 대체로 예(대부분 CC0). 일부는 아닙니다, 아래를 보세요. |
| **이름과 브랜딩**: "World of ClaudeCraft", "Levy Street", 로고 | 라이선스되지 않음 | 아니요. |

**포크해서 직접 세계를 호스팅하세요. 그것은 잘 작동하고, 에셋이 발목을 잡지 않습니다.** 보이는 것의 대부분은 CC0 퍼블릭 도메인이고(KayKit, Quaternius, Kenney, ambientCG, Poly Haven), 우리가 직접 생성한 소품, 생명체, 배경, 인터페이스 사운드는 프로젝트와 함께 출하되므로 포크한 저장소도 그대로 실행됩니다. 다만 그것들을 떼어내 독립된 아트로 판매할 수는 없습니다.

재배포하기 전에 제거하거나 교체해야 할 것들:

- `public/ui/skills/` 아래의 **CraftPix 클래스 기술 아이콘**은 Levy Street가 구매한 것으로 **재배포할 수 없습니다**. 함께 배포하고 싶다면 직접 라이선스를 구매하세요;
- **@jamiecypher 사운드 효과**는 CC BY-NC 4.0이므로 출처를 밝히고 비상업적으로 공유할 수 있지만, 상업적 허가는 이 프로젝트에만 적용됩니다;
- **상점과 프레스티지 아트**(Season 1 Armory, Claudium 세트, 전문 기술 아트 세트, Book of Deeds 아이콘, 정예 용 문장)는 의뢰 제작된 상업 아트로 **권리가 유보되어 있습니다**;
- **서드파티 브랜드 마크**(Twitch, X, Kick, YouTube, Discord, Solana, USDC)는 각 소유자의 상표이며 우리가 넘겨 줄 수 있는 것이 아닙니다;
- **허가를 받아 사용한 소수의 아이콘과 녹음**은 넘겨주려면 허가가 필요합니다.

[CREDITS.md](../../CREDITS.md)가 권위 있는 목록이며, 에셋별 재배포 열을 담고 있습니다. 어떤 에셋이 거기에 기재되어 있다면, 프로젝트의 MIT 라이선스보다 그 라이선스가 우선합니다. 이 대장은 아직 작성 중이므로, 목록에 없는 미디어 에셋은 자유롭다는 뜻이 아니라 아직 기록되지 않았다는 뜻입니다: 의존하기 전에 문의하세요. 소스 코드는 반대이며, 따로 떼어내지 않은 모든 것은 MIT입니다.

우리의 [이용 약관](https://worldofclaudecraft.com/terms)은 worldofclaudecraft.com에서 우리가 운영하는 호스팅 게임을 다룹니다: 계정, 행동 규범, 가상 아이템. 약관은 이 소스 코드에서 MIT 라이선스가 부여하는 권리를 제한하지 않습니다.
