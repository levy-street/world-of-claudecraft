<div align="center">

# World of ClaudeCraft

**브라우저에서 무료로 직접 만든 세계를 모험하고, 파티를 맺고, 레이드하세요. 오픈 소스, web3, 그리고 지금 바로 온라인.**

**공식 웹사이트: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.24.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.ko_KR.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/GjhnUsBtw)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · **한국어** · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[지금 플레이](https://worldofclaudecraft.com/) · [직접 세계 호스팅하기](#host-your-own-world-one-command) · [에이전트 훈련하기](#train-an-agent-headless-rl) · [Web3](#web3) · [기여하기](CONTRIBUTING.ko_KR.md) · [Discord](https://discord.gg/GjhnUsBtw)

![World of ClaudeCraft 타이틀 화면](../../docs/screenshots/title-screen.jpg)

</div>

## 이것은 무엇인가

World of ClaudeCraft는 지금 바로 브라우저에서 플레이할 수 있고, 명령어 하나로 직접 호스팅할 수 있으며, 심지어 AI 에이전트를 훈련시켜 플레이하게 할 수도 있는 완성된 클래식 시대 MMO입니다. 무료이고, 오픈 소스이며, [worldofclaudecraft.com](https://worldofclaudecraft.com/)에서 실시간으로 운영됩니다.

하나의 공유 세계가 동일한 게임 코어에서 세 곳에서 실행됩니다:

- **오프라인 브라우저 세계**, Play Offline을 클릭하면 바로 들어갑니다,
- **권위 있는 멀티플레이어 서버**, Postgres 기반 계정들이 실시간 세계를 공유합니다,
- **헤드리스 RL 환경**, Python이 Gym 인터페이스를 통해 실제 게임을 구동합니다.

같은 시드, 같은 세계, 어디서나. 그리고 거의 아무것도 출하된 에셋이 아닙니다: 마을, 생명체, 주문 아이콘, 사운드 모두 런타임에 생성됩니다.

## 주요 특징

- **아홉 가지 클래식 클래스**, 각각 레벨이 오르면서 등급이 올라가는 진짜 바닐라 스타일 기술 세트를 갖추고, 거기에 완전한 **특성 시스템**(클래스당 세 가지 전문화, 총 27가지 전문화)을 더했습니다.
- 레벨 1부터 20까지 이어지는 **세 개의 오픈 월드 존**, 거의 80개의 퀘스트, 그리고 Gravecaller 음모를 다루는 하나로 연결된 스토리라인.
- **다섯 개의 인스턴스 던전**, 그중 넷은 5인 정예 레이드이고 하나는 솔로 묘지로, 정예 스케일링, 광역 보스 메커니즘, 클래스 원형 전리품을 갖췄습니다.
- **확장형 델브**, 한두 명의 플레이어와 AI 동료를 위한 소규모 모드로, 일반과 영웅 등급에 걸쳐 매 진행마다 무작위 방으로 재구축됩니다.
- **the Ashen Coliseum**, 1대1과 2대2 래더에 더해 2대2 Fiesta 모드(증강 획득, 줄어드는 링, 먼저 15회 처치)를 갖춘 랭크 PvP 투기장입니다.
- **진짜 멀티플레이어**: 파티, 거래, 결투, 선점 권리, 파티 분배 경험치, 귓속말, 자리비움 상태, 그리고 모든 전투 판정을 소유하는 서버.
- **모든 것이 절차적 생성**: 목조 골조 마을, 리깅된 생명체 가족, 캔버스에 그려진 주문 아이콘, WebAudio 사운드, 생물군계 날씨, 실시간 그림자. 세계를 위한 3D 모델 파일은 없습니다.
- 결정론적이고 시뮬레이션이 키를 방출하는 파이프라인을 통해 **21개 로케일로 현지화**되었습니다.
- Gymnasium 바인딩, 보상 셰이핑, 벤치마크 모드를 갖춘 **헤드리스 RL 환경**.
- **Web3 네이티브**: Solana 지갑을 연결하여 $WOC 잔액과 장식용 보유자 배지를 표시하며, 완전히 선택 사항이고 비수탁형입니다.

## 스크린샷

![Eastbrook의 약초상 밖에 파티가 모인다](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Eastbrook 모닥불의 황혼](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Eastbrook 모닥불의 황혼* | ![the Hollow Crypt의 정예 풀링](../../docs/screenshots/hollow-crypt.jpg)<br>*the Hollow Crypt의 횃불에 비친 정예 풀링* |
| ![폐허가 된 예배당의 안식 없는 망자](../../docs/screenshots/restless-dead.jpg)<br>*폐허가 된 예배당의 안식 없는 망자* | ![Vale Bandits와의 난투](../../docs/screenshots/vale-bandits.jpg)<br>*산적 야영지에서 수적으로 밀리다* |
| ![북쪽 길에서 사냥당한 Old Greyjaw](../../docs/screenshots/old-greyjaw.jpg)<br>*희귀 출현 몹 Old Greyjaw, 북쪽 길에서 쫓겨 잡히다* | ![상인과 가방 UI](../../docs/screenshots/vendor-and-bags.jpg)<br>*Smith Haldren의 상점에서 장비를 갖추다, 툴팁, 가방, 동전과 함께* |
| ![Glimmermere 기슭의 달의 문](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Glimmermere의 달의 문에서 익사한 자들이 기어 올라온다* | ![the Drowned Temple 제단의 Ysolei](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire와 the Drowned Temple의 제단* |

날씨는 생물군계 기반이며 렌더 전용이라, 결정론적 시뮬레이션에는 결코 영향을 주지 않습니다:

| | | |
|:---:|:---:|:---:|
| ![Eastbrook Vale 위로 맑은 하늘](../../docs/screenshots/weather-vale_clear.jpg)<br>*Vale 위로 맑음* | ![Mirefen Marsh 위로 내리는 비](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Mirefen Marsh 위로 비* | ![Thornpeak Heights에 내리는 눈](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Thornpeak Heights에 눈* |

## 플레이하기

들어가는 방법은 두 가지이고, 둘 다 같은 세계를 실행합니다.

### 오프라인, 브라우저에서

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

캐릭터 이름을 정하고, 아홉 클래스 중 하나를 고르면, **Eastbrook Vale**(레벨 1-7)에서 시작합니다. 이곳은 여섯 거점으로 둘러싸인 시장 마을입니다: 북쪽으로 늑대 사냥터, 동쪽으로 멧돼지 초원, 서쪽으로 the Webwood, 북서쪽으로 Mirror Lake, 남서쪽으로 코볼트 구리 채굴장, 북동쪽으로 안식 없는 망자가 있는 폐허가 된 예배당, 그리고 남동쪽으로 Gorrak의 산적 야영지가 있습니다. 북쪽 길은 산길을 따라 **Mirefen Marsh**(6-13, 거점 Fenbridge)로 오르고, 거기서 더 올라 **Thornpeak Heights**(13-20, 거점 Highwatch)에 닿습니다. 세계 시드는 `src/main.ts`에 고정되어 있어, 방문할 때마다 같은 장소입니다.

### 온라인, 다른 플레이어와 함께

계정과 영구 캐릭터를 갖춘 실제 클라이언트/서버 게임을 띄우려면 아래 [직접 세계 호스팅하기](#host-your-own-world-one-command)를 참고하세요.

<a id="host-your-own-world-one-command"></a>

## 직접 세계 호스팅하기 (명령어 하나)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

**원격 호스팅**의 경우, compose 스택을 아무 VPS에나 올리고, 환경에 실제 `POSTGRES_PASSWORD`를 설정한 뒤, 8787 포트 앞에 TLS 리버스 프록시를 둡니다. Caddy를 쓰면 두 줄이면 됩니다(`your.domain { reverse_proxy localhost:8787 }`); WebSocket은 자동으로 프록시되고 클라이언트는 https 페이지에서 `wss://`를 자동 선택합니다. 인증 엔드포인트는 IP별로 속도가 제한되고, 비밀번호는 scrypt로 해시되며, 토큰은 7일 후 만료됩니다. 프로덕션에서는 절대 `ALLOW_DEV_COMMANDS=1`을 설정하지 마세요. 테스트 봇이 쓰는 레벨 및 순간이동 치트가 활성화되기 때문입니다. 전체 프로덕션 가이드는 [DEPLOY.md](../../DEPLOY.md)를 참고하세요.

<a id="develop-online-with-hot-reload"></a>

### 핫 리로드로 온라인 개발하기

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

http://localhost:5173 을 열고 **Play Online**을 선택해 계정을 만들고, 캐릭터를 만든 뒤 Enter World로 들어갑니다. 두 번째 탭을 열어 다시 로그인하면 마을에서 서로를 볼 수 있습니다. `Enter`로 채팅을 엽니다. 진짜 MediaWiki 플레이어 위키가 Docker Compose 스택과 함께 http://localhost:8080/wiki/ 에 뜹니다; 그 시드 페이지들은 `npm run wiki:seed`로 현재 게임 콘텐츠에서 생성됩니다.

무엇이 유지되고 서버가 어떻게 주도권을 쥐는가:

- **계정**: scrypt로 해시된 비밀번호와 7일짜리 베어러 토큰(`auth_tokens`).
- **캐릭터**: 계정당 최대 10개; 레벨, 장비, 가방, 퀘스트, 특성, 위치, 돈이 Postgres에 JSONB로 유지되며, 30초마다, 로그아웃 시, 서버 종료 시 저장됩니다. 이름은 전역적으로 고유하고, 글자만 가능하며, 클래식 스타일입니다.
- **서버가 권위를 가짐**: 클라이언트는 이동 의도와 명령을 20 Hz로 스트리밍하고; 서버는 하나의 공유 `Sim`을 실행하여 관심 범위 스냅샷(~120 yd)과 플레이어별 이벤트를 반환합니다. 모든 전투 판정, 전리품 드롭, 퀘스트 적립, 상인 거래는 서버 측에서 해결됩니다. 클라이언트는 렌더러입니다.

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

env = WoWClassicEnv(player_class="warrior")   # warrior or mage
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **관찰 공간과 행동 공간은 콘텐츠에서 파생됩니다.** 하드코딩하지 말고 시작 시 환경의 `info` 응답에서 질의하세요; 게임과 함께 늘어납니다. 현재 행동 공간은 `Discrete(44)`(이동, 타겟, 공격, 전체 기술 세트, 상호작용, 먹기/마시기)이고 관찰은 276개 실수의 `Box`(자기 자신, 기술, 타겟, 주변 몹, 가장 가까운 상호작용 대상, 퀘스트 진행)입니다.
- **보상**은 틱당 카운터 변화량(경험치, 가한 피해와 받은 피해, 처치, 사망, 퀘스트 진행, 레벨업)의 가중 합이며, 리셋마다 조정할 수 있습니다. 각 `step`은 하나의 행동을 적용하고 기본적으로 다섯 시뮬레이션 틱을 진행하므로, 시뮬레이션 1초당 대략 네 번의 결정입니다.
- **설계상 결정론적입니다.** 벽시계 시간도, `Math.random`도 없습니다. 리셋에 시드를 주면 에피소드가 정확히 재현됩니다.

프로토콜과 바인딩은 `headless/CLAUDE.md`와 `python/CLAUDE.md`에 문서화되어 있습니다.

<a id="web3"></a>

## Web3

World of ClaudeCraft는 Solana 위의 커뮤니티 토큰 **$WOC**를 중심으로 web3 네이티브입니다. Solana 지갑을 연결하고, 서명 한 번으로 계정에 연동하면(비수탁형, 승인할 트랜잭션 없음), 읽기 전용 $WOC 잔액이 장식용 보유자 등급 배지와 함께 HUD에 표시됩니다.

이는 장식용일 뿐이며 플레이에 필요하지 않습니다. 게임 안에서 소비되거나 획득되는 것은 없고, pay-to-win도 없으며, 지갑을 한 번도 연결하지 않아도 게임 전체가 멀쩡히 플레이됩니다.

**$WOC 컨트랙트 주소 (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

토큰에 대한 더 자세한 내용은 [worldofclaudecraft.com](https://worldofclaudecraft.com/)에 있습니다.

## 세계 둘러보기

### 아홉 클래스

모든 클래스는 진짜 바닐라 스타일 메커니즘을 사용하고 레벨 1-20에 걸쳐 등급 주문을 배웁니다(Lightning Bolt는 R2가 8레벨, R3가 14레벨, R4가 20레벨이고, Execute, Kidney Shot, Flash Heal, Stormstrike, Starfire 같은 고대역 기술들이 클래식 레벨에 맞춰 도착합니다).

- **Warrior**: 분노, Heroic Strike(다음 휘두르기에, GCD 외), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower(회피 발동).
- **Paladin**: Judgement로 터뜨리는 Seal of Righteousness, Holy Light, Devotion Aura, Blessing of Might, Divine Protection(흡수), Hammer of Justice(기절), Lay on Hands.
- **Hunter**: 원거리 Auto Shot(클래식 데드존이 있는 8-35 yd), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip, 그리고 레벨 10부터 길들일 수 있는 펫.
- **Rogue**: 기력과 연계 점수, Sinister Strike, Eviscerate, Backstab(뒤에서, 단검), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield(흡수), Renew(지속 치유), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon(인챈트), Healing Wave, Earth Shock, Lightning Shield(가시), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles(정신 집중), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life, 그리고 Imp부터 Doomguard까지 소환 가능한 일곱 악마.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, 10레벨의 Bear Form.

치유와 버프는 파티원에게 적용되고, 치유는 치명타가 날 수 있으며, 흡수 보호막은 체력보다 먼저 피해를 흡수합니다. **클래스당 세 가지 특성 전문화**(Arms/Fury/Protection, Balance/Feral/Restoration 등)에 점수를 분배하세요; 분배는 서버에서 검증되며 빌드 문자열로 내보낼 수 있습니다.

### 던전

the Gravecaller 스토리라인은 네 개의 5인 정예 인스턴스를 관통하고, 탐험가를 위한 솔로 묘지가 한쪽에 자리합니다.

- **the Hollow Crypt** (5인) the Fallen Chapel 아래: 짝지은 정예 잡몹, Sexton Marrow 중간 보스, 그리고 10초마다 Shadow Pulse 광역을 떨어뜨리는 Morthen the Gravecaller. 묘지 문은 파티를 비공개 인스턴스 사본으로 순간이동시키며, 비어 있은 지 5분 후 리셋됩니다.
- **the Sunken Bastion** (5인, 레벨 13 부근, 남동쪽 Mirefen): Vael the Mistcaller가 체력 60%와 30%에서 Drowned Thralls 무리를 소환합니다.
- **Gravewyrm Sanctum** (5인, 레벨 20, Thornpeak 아래): 정예 본가드와 드라코니드가 있는 세 개의 방, Korgath the Bound(30% 미만에서 격노), Grand Necromancer Velkhar, 그리고 에픽 무기가 드롭되는 Korzul the Gravewyrm.
- **the Drowned Temple** (5인) Glimmermere의 달의 문을 통과: 창백한 보랏빛 달이 비치는 인스턴스로, Choirmother Selthe를 거쳐 Ysolei, Avatar of the Drowned Moon에 이릅니다. 그녀는 9초마다 Lunar Tide를 내뿜고 60%와 30%에서 Moonspawn을 소환합니다.
- **the Abandoned Crypt** (솔로) Thornpeak에 위치: 한 명을 위한 조용한 열쇠돌과 일기 탐험으로, 그 흔적이 왕실 문을 봉인 해제하여 **Nythraxis, Scourge of Thornpeak**로 이어집니다. 세 개의 영혼 수호석에 걸쳐 싸우는 10인 레이드 피날레입니다.

도입부 퀘스트 사슬은 솔로로 진행할 수 있어, 스토리가 결코 파티 찾기 뒤에 막혀 있지 않습니다. 우리의 자동화된 5봇 레이드(집중 공격과 힐러 AI를 갖춘 warrior, paladin, priest, mage, hunter)는 the Hollow Crypt를 약 5분 만에 클리어합니다(`node scripts/crypt_raid.mjs`, `ALLOW_DEV_COMMANDS=1` 필요).

### 델브

델브는 한두 명의 플레이어를 위한 별개의 확장형 소규모 모드입니다. **the Collapsed Reliquary**(레벨 7 이상)는 매 진행마다 무작위 방으로 재구축되는 묘지로, Deacon Varric에서 끝납니다. 솔로로 진행하면 AI 동료 Tessa가 곁에서 함께 싸웁니다. 성유물 보관소 폐허의 Brother Halven이 델브 게시판을 운영하며, 일반과 영웅 중 선택은 당신 몫입니다: 영웅은 적 레벨을 올리고 무작위 접사를 추가하여 더 풍부한 보상을 줍니다.

### the Ashen Coliseum (랭크 PvP)

`G` 또는 투기장 버튼을 눌러 대기열에 듭니다. 매치메이킹이 전사들을 비공개의 횃불 밝힌 구덩이로 순간이동시키고, 짧은 카운트다운이 모두를 치유하고 리셋하여 공정한 시작을 만들며, 한쪽이 1 hp에서 항복하면 대결이 끝납니다. 아무도 죽지 않고, 당신은 대기열에 든 바로 그 자리로 돌아옵니다.

- **1대1과 2대2 랭크 래더**, 각각 영구적인 Elo 방식 평점(모두 1500에서 시작)과 역대 리더보드(`GET /api/arena/leaderboard`)를 갖췄습니다.
- **2대2 Fiesta**, 더 활기찬 파티 모드: 먼저 15회 처치한 팀이 6분 제한 안에서 승리하고, 플레이어는 점점 늘어나는 타이머에 따라 부활하며, 증강 획득물이 세 번의 웨이브에 걸쳐 힘을 떨어뜨리고, 닫혀오는 링이 싸움을 한데 몰아넣습니다.

### 함께 플레이하기

- **파티** 최대 5인: 플레이어를 우클릭하고 파티 초대를 누릅니다. 멤버는 선점 권리와 퀘스트 적립을 공유하고, 진짜 바닐라 그룹 보너스(3/4/5인에 1.166 / 1.3 / 1.43)로 경험치를 분배하며, 미니맵에 점으로 표시됩니다. 파티 채팅은 `/p`, 전리품 분배는 `/roll`.
- **거래**: 우클릭하고 거래. 양쪽이 아이템과 돈을 올리고, 양쪽이 수락해야 하며, 교환은 원자적이고 서버에서 검증됩니다. 퀘스트 아이템은 거래할 수 없고, 멀리 걸어가면 취소됩니다.
- **결투**: 우클릭하고 결투 신청. 3초 카운트다운 후, 한쪽이 1 hp에 닿을 때까지 싸웁니다; 승자는 존 전체에 알려지고 60야드 밖으로 달아나면 기권입니다.
- **선점 권리와 자리비움 상태**: 몹에 처음 피해를 준 플레이어가 그 전리품, 경험치, 퀘스트 적립을 소유합니다; `/afk`와 `/dnd`는 귓속말에 자동 응답하며 당신을 자리비움으로 표시합니다.

### 세계와 시스템

- **먹기와 마시기**: 앉아서 18초에 걸쳐 회복하고, 피해를 입거나 일어서면 중단되며, 그렇습니다, 먹기와 마시기를 동시에 할 수 있습니다.
- **상인**, 음식과 물을 사들이고 정직한 흰색 장비를 팔며, 동전은 금화, 은화, 동화로 표시됩니다.
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
| `C` `P` `L` `M` `B` `G` | 캐릭터, 주문서, 퀘스트 로그, 세계 지도, 가방, 투기장 |
| `V` / `R` / `Esc` | 이름표, 자동 달리기, 창 닫기 또는 타겟 해제 |

터치 조작(이동 스틱, 카메라 드래그, 화면 액션 버튼)은 모바일에서 자동으로 나타납니다.

## 아키텍처 (하나의 시뮬레이션, 세 호스트)

세 가지 아이디어가 프로젝트를 하나로 묶습니다:

- **하나의 시뮬레이션, 세 호스트.** 같은 `src/sim/` 코드가 오프라인 브라우저 세계, 온라인 서버, RL 환경을 실행합니다. 동작은 어디서나 동일해야 하고, 테스트는 그 상태를 유지하기 위해 존재합니다.
- **`IWorld`가 유일한 이음매.** `src/world_api.ts`가 `IWorld`를 정의합니다. 오프라인 `Sim`은 구조적으로 이를 만족하고 온라인 `ClientWorld`는 서버 스냅샷을 미러링하여 구현합니다. 렌더러와 HUD는 오직 `IWorld`와만 대화하고, 결코 구체적인 세계와 대화하지 않으므로, 새 기능은 먼저 인터페이스를 확장한 뒤 양쪽 세계를 확장합니다.
- **서버가 권위를 가짐.** 클라이언트는 의도를 보내고; 서버가 결과를 결정합니다. 클라이언트는 결코 전투, 전리품, 경제를 스스로 해결하지 않습니다.

시뮬레이션은 고정 20 Hz 틱(`DT = 1/20`)이고, 모든 무작위성은 시드가 주어진 하나의 `Rng`를 거치며, `src/sim/`은 DOM, 브라우저, Three.js 임포트가 전혀 없습니다. 이것이 같은 코드를 한 줄도 바꾸지 않고 Node 환경 서버, 권위 있는 게임 루프, 브라우저 탭으로 묶을 수 있게 해줍니다.

### 프로젝트 구조

| 경로 | 무엇인가 |
|---|---|
| `src/sim/` | 결정론적 게임 코어, 진실의 원천. DOM이나 Three 의존성 없음. |
| `src/sim/content/` | 코드로서의 데이터: 아홉 클래스, 기술, 존, 던전, 아이템, 특성. |
| `src/render/` | Three.js 렌더러(절차적 지오메트리, 텍스처, VFX). 세계를 읽고, 결코 변형하지 않음. |
| `src/game/` | 로컬 입력, 카메라, 키 바인딩, 모바일 조작, 절차적 WebAudio. |
| `src/ui/` | 클래식 HUD(프레임, 창, 툴팁, 지도, 떠다니는 전투 텍스트), 절차적 아이콘, i18n. |
| `src/net/` | 온라인 클라이언트: REST 인증과 WebSocket 세계 미러(`ClientWorld`). |
| `src/admin/` | 관리자 대시보드 SPA(별도 `admin.html` 진입점). |
| `server/` | 권위 있는 서버: HTTP와 WS, 세계 루프, Postgres, 인증, 소셜, 조정. |
| `headless/` + `python/` | RL 환경 서버(`env_server.ts`)와 Python Gym 바인딩. |
| `tests/` | Vitest 스위트. |
| `scripts/` | 에셋 빌드와 브라우저 E2E, 스크린샷, 통합 스크립트. |
| `public/` · `docs/` | 정적 에셋(GLB 모델, 텍스처, HDRI)과 디자인 문서. |

대부분의 디렉터리는 로컬 규칙이 담긴 자체 `CLAUDE.md`를 갖고 있습니다. 프로젝트 불변식의 전체 모음은 루트 [`CLAUDE.md`](../../CLAUDE.md)에 있습니다.

## 클래식처럼 만들어짐

전투, 레벨링, 위협 수준 모두 진짜 클래식 시대 규칙으로 돌아갑니다: 분노와 기력, 명중과 회피 표, 방어구 경감, 진짜 경험치 곡선, 휘두르기 타이머, 그리고 글로벌 쿨다운. 근사치가 아니라 기억하는 그 느낌 그대로입니다. 정확한 수치는 읽어보고 싶다면 `src/sim/`에 있습니다.

그리고 그중 거의 아무것도 출하된 에셋이 아닙니다. 세계는 코드로부터 그려집니다:

- 절차적 마을, 생명체, 지형, 물, 날씨, 실시간 그림자, 세계를 위한 3D 모델 파일은 없습니다.
- 걷기, 공격, 시전, 앉기, 죽음 애니메이션을 모두 갖춘 열두 리깅된 생명체 가족.
- 런타임에 캔버스에 그려지는 주문, 아이템, 버프 아이콘.
- 완전한 클래식 HUD(유닛 프레임, 액션 바, 툴팁, 퀘스트 로그, 세계 지도, 미니맵, 떠다니는 전투 텍스트)와 모든 사운드를 위한 절차적 WebAudio.

## 개발

```bash
npm test                        # vitest: formulas, combat, AI, quests, all 9 classes, parties, duels, trades, dungeons
npm run build                   # production web build
node scripts/smoke_browser.mjs  # warrior end-to-end (needs npm run dev)
node scripts/smoke_mage.mjs     # mage: casting, polymorph, conjure and drink, death and release
node scripts/visual_tour.mjs    # screenshot tour of the zone and UI into tmp/
node scripts/tour_temple.mjs    # screenshot tour of the Glimmermere and Drowned Temple into tmp/
node scripts/mp_integration.mjs # API, WS, and persistence checks (server running)
node scripts/social_e2e.mjs     # trade and duel over the wire (ALLOW_DEV_COMMANDS=1)
node scripts/arena_visual.mjs   # two clients queue and fight a ranked 1v1
node scripts/crypt_raid.mjs     # five bots clear the Hollow Crypt (ALLOW_DEV_COMMANDS=1)
```

로직과 단위 테스트는 Vitest를 씁니다. 반복하는 동안에는 단일 파일을 실행하세요: `npx vitest run tests/sim.test.ts`. E2E와 시각 스크립트는 `puppeteer-core`로 실제 브라우저를 구동하며 `npm run dev` 실행이 필요합니다(흔히 `npm run server`도). 브라우저 에이전트는 눌린 키를 시뮬레이션하는 대신 `window.__game.controller`를 통해 이동을 구동할 수 있습니다, 예를 들어 `controller.move({ forward: true }, facingRadians)` 또는 `{ f: 1, sr: 1 }` 같은 압축 플래그.

서버 명령은 위의 [온라인 개발하기](#develop-online-with-hot-reload)를, 프로덕션은 [DEPLOY.md](../../DEPLOY.md)를, 에셋 라이선스는 [CREDITS.md](../../CREDITS.md)를 참고하세요.

## 현지화

모든 플레이어에게 보이는 문자열은 `t()`를 거쳐 해석되며, 게임은 **21개 로케일**(영어, 두 가지 스페인어, 두 가지 프랑스어, 캐나다 영어, 이탈리아어, 독일어, 간체 및 번체 중국어, 한국어, 일본어, 브라질 포르투갈어, 러시아어, 네덜란드어, 폴란드어, 인도네시아어, 터키어, 스웨덴어, 베트남어, 덴마크어)로 출하됩니다. 시뮬레이션과 서버는 언어 비종속적으로 유지됩니다: 안정적인 키나 영어를 방출하고 클라이언트가 경계에서 다시 현지화하므로, 결정론이 온전히 유지됩니다. 기여자는 영어만 추가하고; 관리자가 매 릴리스 전에 다른 로케일을 일괄 채웁니다. 워크플로는 `docs/i18n-scaling/translation-workflow.md`에 문서화되어 있습니다.

## 기여하기

모든 종류의 기여를 환영합니다: 코드, 번역, 버그 신고, 문서. 설정은 [CONTRIBUTING.ko_KR.md](CONTRIBUTING.ko_KR.md)로 시작하고, [행동 강령](../../CODE_OF_CONDUCT.md)을 읽으며, 취약점을 신고하기 전에 [SECURITY.md](../../SECURITY.md)를 확인하세요. 여기가 처음이신가요? [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue) 라벨이 붙은 이슈를 찾거나, [이슈](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)를 열거나, [Discord](https://discord.gg/GjhnUsBtw)에서 인사를 건네세요.

<div align="center">

![World of Claude](../../worldofclaude.png)

![World of ClaudeCraft 커뮤니티](../../woc_community.png)

</div>

## 라이선스

코드는 [MIT 라이선스](../../LICENSE)이므로, 포크하고, 리믹스하고, 직접 세계를 호스팅하세요.

번들된 서드파티 아트 에셋(모델, 텍스처, HDRI)은 자체 라이선스를 유지하며, MIT 물 노멀 맵을 제외하고 모두 CC0 퍼블릭 도메인이고, 팩별로 [CREDITS.md](../../CREDITS.md)에 문서화되어 있습니다.
