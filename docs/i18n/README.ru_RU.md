<div align="center">

# World of ClaudeCraft

**Выполняйте задания, собирайтесь в группы и штурмуйте вручную созданный мир, бесплатно прямо в браузере. Открытый исходный код, web3 и онлайн прямо сейчас.**

**Официальный сайт: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.27.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.ru_RU.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · **Русский** · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Играть сейчас](https://worldofclaudecraft.com/) · [Разверните свой мир](#host-your-own-world-one-command) · [Обучите агента](#train-an-agent-headless-rl) · [Web3](#web3) · [Участие в разработке](CONTRIBUTING.ru_RU.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Титульный экран World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Что это такое

World of ClaudeCraft — это полноценная MMO классической эпохи, в которую можно играть прямо сейчас в браузере, развернуть самостоятельно одной командой и даже обучать ИИ-агентов игре. Она бесплатна, имеет открытый исходный код и работает по адресу [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Один общий мир работает в трёх местах, и всё из одного игрового ядра:

- **офлайновый браузерный мир**, где вы нажимаете Play Offline и сразу оказываетесь в игре,
- **авторитетный многопользовательский сервер**, где аккаунты, хранящиеся в Postgres, разделяют живой мир,
- **headless RL-окружение**, где Python управляет настоящей игрой через интерфейс Gym.

Один сид, один мир, везде. И почти ничего не является готовым ассетом: города, существа, иконки заклинаний и звук генерируются во время выполнения.

## Ключевые особенности

- **Девять классических классов**, у каждого реальный набор способностей в духе vanilla, который получает ранги по мере роста уровня, плюс полноценная **система талантов** (три специализации на класс, всего 27 специализаций).
- **Три зоны открытого мира** с уровня 1 до 20, почти 80 заданий и единая связная сюжетная линия о заговоре Gravecaller.
- **Пять инстансовых подземелий**, четыре из которых — элитные рейды на пять игроков, и один одиночный склеп, с масштабированием элиты, AoE-механиками боссов и добычей по архетипам классов.
- **Масштабируемые delves**, режим для малых групп на одного или двух игроков плюс ИИ-спутник, заново собираемые из случайных залов на каждом заходе, на сложностях Normal и Heroic.
- **The Ashen Coliseum**, рейтинговая PvP-арена с лестницами 1v1 и 2v2, плюс режим 2v2 Fiesta (подбираемые усиления, сжимающееся кольцо, первый до пятнадцати убийств).
- **Настоящая многопользовательская игра**: группы, торговля, дуэли, права на добычу, разделённый по группе опыт, шёпот, статус отсутствия и сервер, который владеет каждым боевым броском.
- **Всё процедурное**: фахверковые города, оснащённые скелетами семейства существ, нарисованные на canvas иконки заклинаний, звук WebAudio, погода по биомам и тени в реальном времени. Никаких файлов 3D-моделей для мира.
- **Локализация на 21 язык** через детерминированный конвейер, в котором симуляция выдаёт ключи.
- **Headless RL-окружение** с привязками Gymnasium, формированием награды и режимом бенчмарка.
- **Web3-native**: привяжите кошелёк Solana, чтобы показать ваш баланс $WOC и косметический значок держателя, полностью опционально и без передачи средств на хранение.

## Скриншоты

![Группа собирается у аптеки в Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Сумерки у костра в Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Сумерки у костра в Eastbrook* | ![Элитные пуллы в the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Освещённые факелами элитные пуллы в the Hollow Crypt* |
| ![Беспокойные мертвецы у разрушенной часовни](../../docs/screenshots/restless-dead.jpg)<br>*Беспокойные мертвецы у разрушенной часовни* | ![Стычка с Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*В меньшинстве у бандитского лагеря* |
| ![Old Greyjaw, загнанный на северной дороге](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, редкий спавн, загнанный на северной дороге* | ![Интерфейс торговца и сумок](../../docs/screenshots/vendor-and-bags.jpg)<br>*Экипировка у Smith Haldren, с подсказками, сумками и монетами* |
| ![Лунные врата на берегу Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Утопленники выбираются у лунных врат Glimmermere* | ![Ysolei на алтаре the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire и алтарь the Drowned Temple* |

Погода управляется биомами и существует только на стороне рендера, поэтому она никогда не затрагивает детерминированную симуляцию:

| | | |
|:---:|:---:|:---:|
| ![Ясное небо над Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Ясно над the Vale* | ![Дождь над Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Дождь над Mirefen Marsh* | ![Снег на Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Снег на Thornpeak Heights* |

## Как играть

У вас есть два способа войти, и оба запускают один и тот же мир.

### Офлайн, в браузере

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Назовите своего персонажа, выберите любой из девяти классов, и вы начинаете в **Eastbrook Vale** (уровни 1-7), торговом городе, окружённом шестью хабами: волчьи тропы на севере, кабаньи луга на востоке, the Webwood на западе, Mirror Lake на северо-западе, кобольдская медная шахта на юго-западе и разрушенная часовня беспокойных мертвецов на северо-востоке, с бандитским лагерем Gorrak на юго-востоке. Северная дорога поднимается через горный перевал в **Mirefen Marsh** (6-13, хаб Fenbridge) и далее наверх к **Thornpeak Heights** (13-20, хаб Highwatch). Сид мира зафиксирован в `src/main.ts`, так что это одно и то же место при каждом посещении.

### Онлайн, с другими игроками

Смотрите [Разверните свой мир](#host-your-own-world-one-command) ниже, чтобы поднять настоящую клиент-серверную игру с аккаунтами и постоянными персонажами.

<a id="host-your-own-world-one-command"></a>

## Разверните свой мир (одной командой)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Для **удалённого хостинга** разместите compose-стек на любом VPS, задайте настоящий `POSTGRES_PASSWORD` в окружении и выставьте порт 8787 за TLS reverse proxy. С Caddy это две строки (`your.domain { reverse_proxy localhost:8787 }`); WebSockets проксируются автоматически, а клиент сам выбирает `wss://` на https-страницах. Эндпоинты авторизации ограничены по частоте запросов на IP, пароли хешируются через scrypt, а токены истекают через 7 дней. Никогда не устанавливайте `ALLOW_DEV_COMMANDS=1` в продакшене, поскольку это включает читы на уровень и телепортацию, которые используют тестовые боты. Полное руководство по продакшену смотрите в [DEPLOY.md](../../DEPLOY.md).

<a id="develop-online-with-hot-reload"></a>

### Разработка онлайн с горячей перезагрузкой

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Откройте http://localhost:5173, выберите **Play Online**, создайте аккаунт, создайте персонажа и нажмите Enter World. Откройте вторую вкладку и войдите снова, чтобы увидеть друг друга в городе. `Enter` открывает чат. Рядом с Docker Compose стеком поднимается настоящая пользовательская вики на MediaWiki по адресу http://localhost:8080/wiki/; её стартовые страницы генерируются из текущего игрового контента командой `npm run wiki:seed`.

Что сохраняется и как сервер сохраняет контроль:

- **Аккаунты**: пароли с хешированием scrypt и 7-дневные bearer-токены (`auth_tokens`).
- **Персонажи**: до 10 на аккаунт; уровень, экипировка, сумки, задания, таланты, позиция и деньги сохраняются как JSONB в Postgres, записываясь каждые 30 секунд, при выходе и при остановке сервера. Имена глобально уникальны, только буквы, в классическом стиле.
- **Сервер авторитетен**: клиенты транслируют намерение движения и команды на частоте 20 Hz; сервер запускает один общий `Sim` и возвращает снапшоты в зоне интереса (~120 yd) плюс события для каждого игрока. Каждый боевой бросок, выпадение добычи, зачёт задания и транзакция у торговца разрешаются на стороне сервера. Клиент — это рендерер.

<a id="train-an-agent-headless-rl"></a>

## Обучите агента (headless RL)

То же детерминированное ядро работает как окружение [Gymnasium](https://gymnasium.farama.org/), поэтому агент учится против настоящей игры, а не её реализации заново. Env-сервер (`headless/env_server.ts`) оборачивает один `Sim` и общается через JSON с разделением по строкам по stdio; привязки Python в `python/` запускают его как подпроцесс и предоставляют привычный цикл `reset` / `step` / `close`.

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

- **Пространства наблюдений и действий выводятся из контента.** Запрашивайте их из ответа `info` окружения при старте, а не задавайте жёстко; они растут вместе с игрой. Сегодня пространство действий — это `Discrete(44)` (движение, цель, атака, полный набор способностей, взаимодействие, еда/питьё), а наблюдение — это `Box` из 276 float-значений (сам персонаж, способности, цель, ближайшие мобы, ближайший объект взаимодействия, прогресс заданий).
- **Награда** — это взвешенная сумма дельт счётчиков за тик (опыт, нанесённый и полученный урон, убийства, смерти, прогресс заданий, повышения уровня), настраиваемая для каждого reset. Каждый `step` применяет одно действие и продвигает по умолчанию пять тиков симуляции, то есть примерно четыре решения за симулированную секунду.
- **Детерминированность по построению.** Никаких системных часов, никакого `Math.random`. Задайте сид для reset, и эпизод воспроизведётся в точности.

Протокол и привязки описаны в `headless/CLAUDE.md` и `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft является web3-native вокруг **$WOC**, нашего общественного токена на Solana. Подключите кошелёк Solana, привяжите его к своему аккаунту одной подписью (без передачи на хранение, без транзакции для подтверждения), и ваш баланс $WOC только для чтения появится в HUD рядом с косметическим значком уровня держателя.

Это исключительно косметика и не требуется для игры. Ничего не тратится и не зарабатывается в игре, нет pay-to-win, и вся игра прекрасно проходится без единого подключения кошелька.

**Адрес контракта $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Подробнее о токене на [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Тур по миру

### Девять классов

Каждый класс использует реальные механики в духе vanilla и изучает ранговые заклинания на уровнях 1-20 (Lightning Bolt R2 на 8, R3 на 14, R4 на 20, при этом способности высоких диапазонов, такие как Execute, Kidney Shot, Flash Heal, Stormstrike и Starfire, появляются на своём классическом уровне).

- **Warrior**: ярость, Heroic Strike (на следующий удар, вне GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (прок от уклонения).
- **Paladin**: Seal of Righteousness, высвобождаемая через Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (поглощение), Hammer of Justice (оглушение), Lay on Hands.
- **Hunter**: дальняя Auto Shot (8-35 yd с классической мёртвой зоной), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip и приручаемый питомец с уровня 10.
- **Rogue**: энергия и комбо-очки, Sinister Strike, Eviscerate, Backstab (со спины, кинжал), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (поглощение), Renew (HoT), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon (зачарование), Healing Wave, Earth Shock, Lightning Shield (шипы), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (направляемое), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life и семь призываемых демонов от Imp до Doomguard.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form на 10.

Лечение и баффы накладываются на членов группы, лечение может критовать, а щиты поглощения впитывают урон до здоровья. Распределяйте очки между **тремя специализациями талантов на класс** (Arms/Fury/Protection, Balance/Feral/Restoration и так далее); распределение проверяется на сервере и экспортируется как строка билда.

### Подземелья

Сюжетная линия the Gravecaller проходит через четыре элитных инстанса на пять игроков, а одиночный склеп стоит в стороне для исследователей.

- **The Hollow Crypt** (5 игроков) под the Fallen Chapel: парный элитный мусор, минибосс Sexton Marrow и Morthen the Gravecaller, который сбрасывает AoE Shadow Pulse каждые десять секунд. Дверь склепа телепортирует вашу группу в приватную копию инстанса, которая сбрасывается через пять минут пустоты.
- **The Sunken Bastion** (5 игроков, около уровня 13, юго-восток Mirefen): Vael the Mistcaller призывает волны Drowned Thralls на 60% и 30% здоровья.
- **Gravewyrm Sanctum** (5 игроков, уровень 20, под Thornpeak): три зала элитных костяных стражей и драконидов, Korgath the Bound (впадает в ярость ниже 30%), Grand Necromancer Velkhar и Korzul the Gravewyrm, где выпадает эпическое оружие.
- **The Drowned Temple** (5 игроков) через лунные врата Glimmermere: бледный, лунно-фиолетовый инстанс, ведущий к Choirmother Selthe, а затем к Ysolei, Avatar of the Drowned Moon, которая пульсирует Lunar Tide каждые девять секунд и призывает Moonspawn на 60% и 30%.
- **The Abandoned Crypt** (одиночный) в Thornpeak: тихое погружение с ключом и дневником для одного, чей след распечатывает королевскую дверь к **Nythraxis, Scourge of Thornpeak**, финалу-рейду на десять игроков, проходимому через три камня-стража душ.

Подводящие цепочки заданий проходятся в одиночку, поэтому сюжет никогда не заблокирован поиском группы. Наш автоматизированный рейд из пяти ботов (warrior, paladin, priest, mage, hunter с фокус-огнём и ИИ хилера) зачищает the Hollow Crypt примерно за пять минут (`node scripts/crypt_raid.mjs`, требует `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves — это отдельный масштабируемый режим для малых групп на одного или двух игроков. **The Collapsed Reliquary** (уровень 7 и выше) — это склеп, заново собираемый из случайных залов на каждом заходе, заканчивающийся на Deacon Varric. Пройдите в одиночку, и ИИ-спутник Tessa будет сражаться рядом с вами. Brother Halven у руин реликвария ведёт доску delve, где Normal или Heroic — ваш выбор: Heroic повышает уровни врагов и добавляет случайный аффикс ради более богатых наград.

### The Ashen Coliseum (рейтинговый PvP)

Нажмите `G` или кнопку арены, чтобы встать в очередь. Подбор соперников телепортирует бойцов в приватную, освещённую факелами яму, короткий отсчёт лечит и сбрасывает всех для честного старта, а бой заканчивается, когда сторона сдаётся на 1 hp. Никто не умирает, и вы возвращаетесь ровно туда, откуда встали в очередь.

- **Рейтинговые лестницы 1v1 и 2v2**, у каждой постоянный рейтинг в стиле Elo (все начинают с 1500) и таблица лидеров за всё время (`GET /api/arena/leaderboard`).
- **2v2 Fiesta**, более живой групповой режим: первая команда до пятнадцати убийств побеждает в рамках шестиминутного лимита, игроки возрождаются по растущим таймерам, подбираемые усиления роняют силу через три волны, а сжимающееся кольцо сводит бой вместе.

### Игра вместе

- **Группы** до 5 человек: щёлкните правой кнопкой по игроку и Invite to Party. Участники делят права на добычу и зачёт заданий, делят опыт с настоящими групповыми бонусами vanilla (1.166 / 1.3 / 1.43 для 3/4/5) и отображаются метками на миникарте. `/p` для группового чата, `/roll` для розыгрыша добычи.
- **Торговля**: правый клик и Trade. Обе стороны выставляют предметы и деньги, обе должны принять, а обмен атомарен и проверяется сервером. Предметы заданий нельзя торговать, и расхождение в стороны отменяет сделку.
- **Дуэли**: правый клик и Challenge to a Duel. Отсчёт в 3 секунды, затем бой, пока сторона не достигнет 1 hp; победитель объявляется на всю зону, а пробежка на 60 ярдов прочь означает поражение.
- **Права на добычу и статус отсутствия**: первый игрок, нанёсший урон мобу, владеет его добычей, опытом и зачётом задания; `/afk` и `/dnd` отмечают вас отсутствующим с автоответом на шёпот.

### Мир и системы

- **Еда и питьё**: сядьте, чтобы восстановиться за 18 секунд, прерывается уроном или вставанием, и да, можно есть и пить одновременно.
- **Торговцы**, которые покупают еду и воду и продают честную белую экипировку, с монетами в золоте, серебре и меди.
- **ИИ мобов**: блуждание, агро по близости в зависимости от разницы уровней, социальные пуллы, погоня, привязка и сброс, добыча с трупов и респавны, с редким спавном (Old Greyjaw) на долгом таймере.
- **Места для рыбалки** со своими таблицами добычи и редкими уловами.
- **Косметические скины**, выпадающие с редкостью uncommon, rare и epic, чисто для внешнего вида.
- **Смерть и восстановление**: отпустите дух на кладбище, получайте урон от падения и замедляйтесь при плавании.
- **Погода по биомам**: ясно в the Vale, дождь в the Marsh, снег на the Peaks, с плавным переходом по мере перемещения между зонами.

### Управление (классическая раскладка)

| Ввод | Действие |
|---|---|
| `W` / `S` | бег / шаг назад. `A`/`D` поворот (стрейф при зажатой правой кнопке мыши), `Q`/`E` стрейф |
| правый перетаск / левый перетаск | обзор мышью / орбита камеры. Колесо приближает, `Space` прыгает |
| `Tab` | перебор ближайших врагов. левый клик для выбора цели, правый клик для атаки, добычи или разговора |
| `1`-`9`, `0`, `-`, `=` | панель действий |
| `F` | взаимодействие (обыскать труп, поднять объект, поговорить) |
| `C` `P` `L` `M` `B` `G` | персонаж, книга заклинаний, журнал заданий, карта мира, сумки, арена |
| `V` / `R` / `Esc` | таблички имён, автобег, закрыть окна или сбросить цель |

Сенсорное управление (стик движения, перетаскивание камеры и экранные кнопки действий) появляется автоматически на мобильных устройствах.

## Архитектура (одна симуляция, три хоста)

Три идеи скрепляют проект:

- **Одна симуляция, три хоста.** Тот же код `src/sim/` работает в офлайновом браузерном мире, на онлайн-сервере и в RL-окружении. Поведение должно быть идентичным везде, и тесты существуют, чтобы это поддерживать.
- **`IWorld` — единственный шов.** `src/world_api.ts` определяет `IWorld`. Офлайновый `Sim` удовлетворяет ему структурно, а онлайновый `ClientWorld` реализует его, зеркаля снапшоты сервера. Рендерер и HUD общаются только с `IWorld`, никогда с конкретным миром, так что новая фича сначала расширяет интерфейс, а затем оба мира.
- **Сервер авторитетен.** Клиенты отправляют намерение; сервер решает исходы. Клиент никогда не разрешает бой, добычу или экономику самостоятельно.

Симуляция — это фиксированный тик 20 Hz (`DT = 1/20`), вся случайность проходит через один сидированный `Rng`, а `src/sim/` не несёт ни одного импорта DOM, браузера или Three.js. Именно это позволяет одному и тому же коду собираться в Node env-сервер, авторитетный игровой цикл и вкладку браузера без единой изменённой строки.

### Структура проекта

| Путь | Что это |
|---|---|
| `src/sim/` | Детерминированное игровое ядро, источник истины. Никаких зависимостей DOM или Three. |
| `src/sim/content/` | Данные как код: девять классов, способности, зоны, подземелья, предметы, таланты. |
| `src/render/` | Рендерер Three.js (процедурная геометрия, текстуры, VFX). Читает мир, никогда его не меняет. |
| `src/game/` | Локальный ввод, камера, привязки клавиш, мобильное управление, процедурный WebAudio. |
| `src/ui/` | Классический HUD (фреймы, окна, подсказки, карта, всплывающий боевой текст), процедурные иконки, i18n. |
| `src/net/` | Онлайн-клиент: REST-авторизация плюс зеркало мира через WebSocket (`ClientWorld`). |
| `src/admin/` | SPA админ-панели (отдельная точка входа `admin.html`). |
| `server/` | Авторитетный сервер: HTTP и WS, цикл мира, Postgres, авторизация, социальное, модерация. |
| `headless/` + `python/` | RL env-сервер (`env_server.ts`) и привязки Python Gym. |
| `tests/` | Набор Vitest. |
| `scripts/` | Сборка ассетов плюс браузерные E2E, скриншоты и интеграционные скрипты. |
| `public/` · `docs/` | Статические ассеты (модели GLB, текстуры, HDRI) и проектные документы. |

Большинство директорий несут собственный `CLAUDE.md` с локальными конвенциями. Полный набор инвариантов проекта живёт в корневом [`CLAUDE.md`](../../CLAUDE.md).

## Построено как классика

Бой, прокачка и угроза работают на аутентичных правилах классической эпохи: ярость и энергия, таблицы попаданий и уклонений, поглощение урона бронёй, настоящая кривая опыта, таймеры ударов и глобальный кулдаун. Это ощущается так, как вы помните, а не приближённо. Точные числа живут в `src/sim/`, если хотите их прочитать.

И почти ничего из этого не является готовым ассетом. Мир рисуется из кода:

- Процедурные города, существа, рельеф, вода, погода и тени в реальном времени, без файлов 3D-моделей для мира.
- Двенадцать оснащённых скелетами семейств существ с полными анимациями ходьбы, атаки, каста, сидения и смерти.
- Иконки заклинаний, предметов и баффов, рисуемые на canvas во время выполнения.
- Полный классический HUD (фреймы юнитов, панели действий, подсказки, журнал заданий, карта мира, миникарта, всплывающий боевой текст) и процедурный WebAudio для каждого звука.

## Разработка

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

Логические и модульные тесты используют Vitest. Во время итераций запускайте один файл: `npx vitest run tests/sim.test.ts`. E2E- и визуальные скрипты управляют настоящими браузерами через `puppeteer-core` и требуют запущенного `npm run dev` (часто также `npm run server`). Браузерные агенты могут управлять движением через `window.__game.controller` вместо имитации зажатых клавиш, например `controller.move({ forward: true }, facingRadians)` или компактные флаги вроде `{ f: 1, sr: 1 }`.

Команды сервера смотрите в [Разработка онлайн](#develop-online-with-hot-reload) выше, [DEPLOY.md](../../DEPLOY.md) для продакшена и [CREDITS.md](../../CREDITS.md) для лицензий ассетов.

## Локализация

Каждая видимая игроку строка разрешается через `t()`, и игра поставляется на **21 языке** (английский, два испанских, два французских, английский Канады, итальянский, немецкий, упрощённый и традиционный китайский, корейский, японский, бразильский португальский, русский, нидерландский, польский, индонезийский, турецкий, шведский, вьетнамский и датский). Симуляция и сервер остаются языково-нейтральными: они выдают стабильные ключи или английский, который клиент релокализует на границе, что сохраняет детерминизм нетронутым. Контрибьюторы добавляют только английский; сопровождающий пакетно заполняет остальные языки перед каждым релизом. Рабочий процесс описан в `docs/i18n-scaling/translation-workflow.md`.

## Участие в разработке

Приветствуется вклад любого рода: код, переводы, баг-репорты и документация. Начните с [CONTRIBUTING.ru_RU.md](CONTRIBUTING.ru_RU.md) для настройки, прочитайте [Кодекс поведения](../../CODE_OF_CONDUCT.md) и проверьте [SECURITY.md](../../SECURITY.md) перед сообщением об уязвимости. Впервые здесь? Ищите issue с меткой [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), откройте [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) или поздоровайтесь в [Discord](https://discord.com/invite/worldofclaudecraft).

<div align="center">

![World of Claude](../../worldofclaude.png)

![Сообщество World of ClaudeCraft](../../woc_community.png)

</div>

## Лицензия

Код [лицензирован по MIT](../../LICENSE), так что форкайте его, ремиксите и разворачивайте свой мир.

Поставляемые сторонние художественные ассеты (модели, текстуры, HDRI) сохраняют собственные лицензии, все CC0 public domain, кроме нормал-карт воды под MIT, задокументированных по каждому паку в [CREDITS.md](../../CREDITS.md).
