<div align="center">

# World of ClaudeCraft

**Faça missões, forme grupos e enfrente raides em um mundo feito a mão, gratuito no seu navegador. Open source, web3 e online agora mesmo.**

**Site oficial: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r185-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.27.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.pt_BR.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · **Português (Brasil)** · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Jogar agora](https://worldofclaudecraft.com/) · [Hospede seu próprio mundo](#host-your-own-world-one-command) · [Treine um agente](#train-an-agent-headless-rl) · [Web3](#web3) · [Contribuindo](CONTRIBUTING.pt_BR.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Tela de título do World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## O que é isto

World of ClaudeCraft é um MMO completo da era clássica que você pode jogar agora mesmo no seu navegador, hospedar sozinho com um único comando e até usar para treinar agentes de IA para jogar. É gratuito, open source e está no ar em [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Um único mundo compartilhado roda em três lugares, todos a partir do mesmo núcleo de jogo:

- o **mundo offline no navegador**, onde você clica em Play Offline e já está dentro,
- o **servidor multiplayer autoritativo**, onde contas apoiadas em Postgres compartilham um mundo ao vivo,
- o **ambiente de RL headless**, onde o Python comanda o jogo de verdade através de uma interface Gym.

Mesma semente, mesmo mundo, em todo lugar. E quase nada é um asset pré-pronto: as cidades, criaturas, ícones de magia e o som são todos gerados em tempo de execução.

## Destaques

- **Nove classes clássicas**, cada uma com um kit autêntico no estilo vanilla que ganha ranks conforme você sobe de nível, além de um **sistema de talentos** completo (três specs por classe, 27 specs no total).
- **Três zonas de mundo aberto** do nível 1 ao 20, quase 80 missões e uma única história conectada sobre a conspiração Gravecaller.
- **Cinco masmorras instanciadas**, quatro delas raides de elite para cinco jogadores e uma cripta solo, com escalonamento de elite, mecânicas de chefe em área e loot por arquétipo de classe.
- **Delves escaláveis**, um modo para grupos pequenos de um ou dois jogadores mais um companheiro de IA, reconstruídos a partir de câmaras aleatórias a cada incursão, nos níveis Normal e Heroico.
- **The Ashen Coliseum**, uma arena de PvP ranqueada com ladders 1v1 e 2v2, mais um modo 2v2 Fiesta (coleta de aprimoramentos, um anel que encolhe, o primeiro a quinze abates vence).
- **Multiplayer de verdade**: grupos, comércio, duelos, direitos de tap, XP dividido em grupo, sussurros, status de ausência e um servidor que é dono de cada rolagem de combate.
- **Tudo procedural**: cidades de estrutura de madeira, famílias de criaturas com esqueleto, ícones de magia pintados em canvas, som via WebAudio, clima por bioma e sombras em tempo real. Nenhum arquivo de modelo 3D para o mundo.
- **Localizado em 21 idiomas** por meio de um pipeline determinístico em que a sim emite chaves.
- **Ambiente de RL headless** com bindings do Gymnasium, modelagem de recompensa e um modo de benchmark.
- **Nativo de web3**: vincule uma carteira Solana para mostrar seu saldo de $WOC e um selo cosmético de holder, totalmente opcional e não custodial.

## Capturas de tela

![Um grupo se reúne em frente ao boticário em Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Anoitecer na fogueira de Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Anoitecer na fogueira de Eastbrook* | ![Pulls de elite na Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pulls de elite à luz das tochas na Hollow Crypt* |
| ![Os mortos inquietos na capela em ruínas](../../docs/screenshots/restless-dead.jpg)<br>*Os mortos inquietos na capela em ruínas* | ![Uma briga com os Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*Em desvantagem numérica no acampamento dos bandidos* |
| ![Old Greyjaw caçado na estrada do norte](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, o spawn raro, encurralado na estrada do norte* | ![Interface de vendedor e bolsas](../../docs/screenshots/vendor-and-bags.jpg)<br>*Se equipando na loja de Smith Haldren, com tooltips, bolsas e moedas* |
| ![O portal lunar na praia de Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Os afogados emergem no portal lunar de Glimmermere* | ![Ysolei no altar do Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire e o altar do Drowned Temple* |

O clima é determinado pelo bioma e existe só na renderização, então nunca toca a sim determinística:

| | | |
|:---:|:---:|:---:|
| ![Céu limpo sobre Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Tempo limpo sobre o Vale* | ![Chuva sobre Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Chuva sobre Mirefen Marsh* | ![Neve em Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Neve em Thornpeak Heights* |

## Como jogar

Você tem dois caminhos de entrada, e ambos rodam o mesmo mundo.

### Offline, no seu navegador

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Dê um nome ao seu personagem, escolha qualquer uma das nove classes e comece em **Eastbrook Vale** (níveis 1-7), uma cidade comercial cercada por seis polos: tocaias de lobos ao norte, prados de javalis a leste, a Webwood a oeste, Mirror Lake a noroeste, uma escavação de cobre de kobolds a sudoeste e uma capela em ruínas dos mortos inquietos a nordeste, com o acampamento de bandidos de Gorrak a sudeste. A estrada do norte sobe um passo na montanha até **Mirefen Marsh** (6-13, polo Fenbridge) e continua subindo até **Thornpeak Heights** (13-20, polo Highwatch). A semente do mundo é fixa em `src/main.ts`, então é o mesmo lugar a cada visita.

### Online, com outros jogadores

Veja [Hospede seu próprio mundo](#host-your-own-world-one-command) abaixo para colocar de pé o jogo cliente/servidor de verdade, com contas e personagens persistentes.

<a id="host-your-own-world-one-command"></a>

## Hospede seu próprio mundo (um comando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Para **hospedagem remota**, coloque o stack do compose em qualquer VPS, defina um `POSTGRES_PASSWORD` real no ambiente e exponha a porta 8787 por trás de um proxy reverso com TLS. O Caddy resolve isso em duas linhas (`your.domain { reverse_proxy localhost:8787 }`); os WebSockets são encaminhados automaticamente e o cliente seleciona `wss://` sozinho em páginas https. Os endpoints de autenticação têm limite de taxa por IP, as senhas usam hash scrypt e os tokens expiram após 7 dias. Nunca defina `ALLOW_DEV_COMMANDS=1` em produção, pois isso habilita os cheats de nível e teleporte que os bots de teste usam. Veja [DEPLOY.md](../../DEPLOY.md) para o guia completo de produção.

<a id="develop-online-with-hot-reload"></a>

### Desenvolva online com hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Abra http://localhost:5173, escolha **Play Online**, crie uma conta, crie um personagem e Enter World. Abra uma segunda aba e faça login de novo para verem um ao outro na cidade. `Enter` abre o chat. Um wiki de jogador de verdade em MediaWiki sobe junto com o stack do Docker Compose em http://localhost:8080/wiki/; suas páginas iniciais são geradas a partir do conteúdo atual do jogo com `npm run wiki:seed`.

O que persiste e como o servidor mantém o controle:

- **Contas**: senhas com hash scrypt e tokens bearer de 7 dias (`auth_tokens`).
- **Personagens**: até 10 por conta; nível, equipamento, bolsas, missões, talentos, posição e dinheiro persistem como JSONB no Postgres, salvos a cada 30 segundos, no logout e no desligamento do servidor. Os nomes são globalmente únicos, apenas letras, no estilo clássico.
- **O servidor é autoritativo**: os clientes transmitem intenção de movimento e comandos a 20 Hz; o servidor roda a única `Sim` compartilhada e retorna snapshots com escopo de interesse (~120 yd) mais eventos por jogador. Cada rolagem de combate, queda de loot, crédito de missão e transação com vendedor é resolvida no servidor. O cliente é um renderizador.

<a id="train-an-agent-headless-rl"></a>

## Treine um agente (RL headless)

O mesmo núcleo determinístico roda como um ambiente [Gymnasium](https://gymnasium.farama.org/), então um agente aprende contra o jogo de verdade, não contra uma reimplementação dele. O servidor do ambiente (`headless/env_server.ts`) encapsula uma `Sim` e fala JSON delimitado por novas linhas sobre stdio; os bindings de Python em `python/` o iniciam como um subprocesso e expõem o loop habitual de `reset` / `step` / `close`.

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

- **Os espaços de observação e ação são derivados do conteúdo.** Consulte-os na resposta `info` do ambiente na inicialização, em vez de fixá-los no código; eles crescem junto com o jogo. Hoje o espaço de ação é `Discrete(44)` (movimento, alvo, ataque, o kit completo de habilidades, interagir, comer/beber) e a observação é um `Box` de 276 floats (você mesmo, habilidades, alvo, mobs próximos, interagível mais próximo, progresso de missão).
- **A recompensa** é uma soma ponderada dos deltas de contadores por tick (XP, dano causado e recebido, abates, mortes, progresso de missão, subidas de nível), ajustável a cada reset. Cada `step` aplica uma ação e avança cinco ticks de sim por padrão, então cerca de quatro decisões por segundo simulado.
- **Determinístico por construção.** Sem relógio de parede, sem `Math.random`. Defina a semente no reset e o episódio se repete exatamente igual.

O protocolo e os bindings estão documentados em `headless/CLAUDE.md` e `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft é nativo de web3 em torno do **$WOC**, nosso token de comunidade na Solana. Conecte uma carteira Solana, vincule-a à sua conta com uma única assinatura (não custodial, sem transação para aprovar), e seu saldo de $WOC somente leitura aparece no HUD ao lado de um selo cosmético de tier de holder.

É apenas cosmético e não é necessário para jogar. Nada é gasto ou ganho dentro do jogo, não há pay-to-win, e o jogo inteiro funciona bem sem nunca conectar uma carteira.

**Endereço do contrato do $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Mais sobre o token em [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Um tour pelo mundo

### As nove classes

Toda classe usa mecânicas autênticas no estilo vanilla e aprende magias com rank ao longo dos níveis 1-20 (Lightning Bolt R2 no 8, R3 no 14, R4 no 20, com habilidades de faixa alta como Execute, Kidney Shot, Flash Heal, Stormstrike e Starfire chegando no seu nível clássico).

- **Warrior**: rage, Heroic Strike (no próximo golpe, fora do GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (proc de esquiva).
- **Paladin**: Seal of Righteousness liberado por Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (absorção), Hammer of Justice (atordoamento), Lay on Hands.
- **Hunter**: Auto Shot à distância (8-35 yd com a zona morta clássica), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip e um pet domável a partir do nível 10.
- **Rogue**: energia e pontos de combo, Sinister Strike, Eviscerate, Backstab (por trás, adaga), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (absorção), Renew (HoT), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon (imbuição), Healing Wave, Earth Shock, Lightning Shield (espinhos), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (canalizada), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life e sete demônios invocáveis, do Imp ao Doomguard.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form no 10.

Curas e buffs atingem os membros do grupo, a cura pode dar crítico, e os escudos de absorção sugam o dano antes da vida. Gaste pontos entre **três specs de talento por classe** (Arms/Fury/Protection, Balance/Feral/Restoration, e assim por diante); a alocação é validada pelo servidor e pode ser exportada como uma string de build.

### Masmorras

A história Gravecaller passa por quatro instâncias de elite para cinco jogadores, e uma cripta solo fica à parte para os exploradores.

- **The Hollow Crypt** (5 jogadores) sob a Fallen Chapel: lixo de elite em pares, o minichefe Sexton Marrow e Morthen the Gravecaller, que solta um Shadow Pulse em área a cada dez segundos. A porta da cripta teleporta seu grupo para uma cópia de instância privada que reseta após cinco minutos vazia.
- **The Sunken Bastion** (5 jogadores, por volta do nível 13, sudeste de Mirefen): Vael the Mistcaller invoca ondas de Drowned Thralls aos 60% e 30% de vida.
- **Gravewyrm Sanctum** (5 jogadores, nível 20, sob Thornpeak): três câmaras de boneguard de elite e drakonid, Korgath the Bound (entra em fúria abaixo de 30%), Grand Necromancer Velkhar e Korzul the Gravewyrm, onde caem armas épicas.
- **The Drowned Temple** (5 jogadores) através do portal lunar de Glimmermere: uma instância pálida, em violeta lunar, que leva a Choirmother Selthe e depois a Ysolei, Avatar of the Drowned Moon, que pulsa Lunar Tide a cada nove segundos e invoca Moonspawn aos 60% e 30%.
- **The Abandoned Crypt** (solo) em Thornpeak: um mergulho silencioso de chave mestra e diário para um só, cuja trilha destrava a porta real para **Nythraxis, Scourge of Thornpeak**, um final em raide de dez jogadores travado em torno de três pedras de proteção de alma.

As cadeias de missões que dão o gancho são solúveis sozinho, então a história nunca fica travada atrás de encontrar um grupo. Nossa raide automatizada de cinco bots (warrior, paladin, priest, mage, hunter com foco de fogo e IA de healer) limpa a Hollow Crypt em cerca de cinco minutos (`node scripts/crypt_raid.mjs`, precisa de `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves são um modo separado e escalável para grupos pequenos, de um ou dois jogadores. **The Collapsed Reliquary** (nível 7 em diante) é uma cripta reconstruída a partir de câmaras aleatórias a cada incursão, terminando em Deacon Varric. Faça sozinho e uma companheira de IA, Tessa, luta ao seu lado. Brother Halven, na ruína do relicário, comanda o quadro de delves, onde escolher Normal ou Heroico é com você: o Heroico eleva os níveis dos inimigos e adiciona um afixo aleatório para recompensas mais ricas.

### The Ashen Coliseum (PvP ranqueado)

Pressione `G` ou o botão da arena para entrar na fila. O matchmaking teleporta os lutadores para uma fossa privada iluminada por tochas, uma contagem regressiva curta cura e reseta todos para um começo justo, e o combate termina quando um lado se rende com 1 hp. Ninguém morre, e você volta exatamente para onde entrou na fila.

- **Ladders ranqueadas 1v1 e 2v2**, cada uma com um rating persistente no estilo Elo (todos começam em 1500) e um placar de todos os tempos (`GET /api/arena/leaderboard`).
- **2v2 Fiesta**, um modo de festa mais animado: a primeira equipe a quinze abates vence dentro de um limite de seis minutos, os jogadores renascem em timers crescentes, coletas de aprimoramento espalham poder ao longo de três ondas, e um anel que se fecha força a luta a se juntar.

### Jogando juntos

- **Grupos** de até 5: clique com o botão direito em um jogador e Invite to Party. Os membros compartilham direitos de tap e crédito de missão, dividem XP com os bônus de grupo vanilla de verdade (1.166 / 1.3 / 1.43 para 3/4/5) e aparecem como pontos no minimapa. `/p` para chat de grupo, `/roll` para decidir o loot.
- **Comércio**: clique com o direito e Trade. Os dois lados colocam itens e dinheiro, ambos precisam aceitar, e a troca é atômica e validada pelo servidor. Itens de missão não podem ser negociados, e se afastar cancela.
- **Duelos**: clique com o direito e Challenge to a Duel. Uma contagem regressiva de 3 segundos, então lutem até um lado chegar a 1 hp; o vencedor é anunciado por toda a zona e correr 60 jardas de distância significa desistência.
- **Direitos de tap e status de ausência**: o primeiro jogador a causar dano a um mob é dono do seu loot, XP e crédito de missão; `/afk` e `/dnd` marcam você como ausente com uma resposta automática aos sussurros.

### Mundo e sistemas

- **Comer e beber**: sente-se para restaurar ao longo de 18 segundos, interrompido por dano ou ao ficar de pé, e sim, você pode comer e beber ao mesmo tempo.
- **Vendedores** que compram comida e água e vendem equipamento branco honesto, com moedas mostradas em ouro, prata e cobre.
- **IA de mobs**: vagar, aggro por proximidade conforme a diferença de nível, pulls sociais, perseguição, leash e reset, loot de cadáver e respawns, com um spawn raro (Old Greyjaw) em um timer longo.
- **Pontos de pesca** com suas próprias tabelas de loot e capturas raras.
- **Skins cosméticas** sorteadas em raridade incomum, rara e épica, puramente para aparência.
- **Morte e recuperação**: liberte seu espírito até o cemitério, sofra dano de queda e fique mais lento ao nadar.
- **Clima por bioma**: limpo no Vale, chuva no Marsh, neve nos Peaks, com transições suaves conforme você se move entre as zonas.

### Controles (layout clássico)

| Entrada | Ação |
|---|---|
| `W` / `S` | correr / recuar. `A`/`D` viram (strafe com o botão direito do mouse pressionado), `Q`/`E` fazem strafe |
| arrastar com o direito / arrastar com o esquerdo | mouselook / orbitar a câmera. A roda dá zoom, `Space` pula |
| `Tab` | alternar entre os inimigos mais próximos. clique esquerdo para mirar, clique direito para atacar, saquear ou conversar |
| `1`-`9`, `0`, `-`, `=` | barra de ação |
| `F` | interagir (saquear um cadáver, pegar um objeto, conversar) |
| `C` `P` `L` `M` `B` `G` | personagem, grimório, registro de missões, mapa-múndi, bolsas, arena |
| `V` / `R` / `Esc` | nameplates, autorun, fechar janelas ou limpar o alvo |

Os controles de toque (um direcional de movimento, arraste de câmera e botões de ação na tela) aparecem automaticamente no celular.

## Arquitetura (uma sim, três hosts)

Três ideias seguram o projeto inteiro:

- **Uma sim, três hosts.** O mesmo código de `src/sim/` roda o mundo offline no navegador, o servidor online e o ambiente de RL. O comportamento precisa ser idêntico em todo lugar, e os testes existem para manter isso assim.
- **`IWorld` é a única costura.** `src/world_api.ts` define `IWorld`. A `Sim` offline a satisfaz estruturalmente, e o `ClientWorld` online a implementa espelhando os snapshots do servidor. O renderizador e o HUD falam apenas com `IWorld`, nunca com um mundo concreto, então um recurso novo estende a interface primeiro e depois os dois mundos.
- **O servidor é autoritativo.** Os clientes enviam intenção; o servidor decide os resultados. O cliente nunca resolve combate, loot ou economia por conta própria.

A sim é um tick fixo de 20 Hz (`DT = 1/20`), toda a aleatoriedade flui por uma única `Rng` com semente, e `src/sim/` carrega zero imports de DOM, navegador ou Three.js. É isso que permite que o mesmo código seja empacotado em um servidor de ambiente Node, um loop de jogo autoritativo e uma aba de navegador sem mudar uma linha.

### Estrutura do projeto

| Caminho | O que é |
|---|---|
| `src/sim/` | Núcleo determinístico do jogo, a fonte da verdade. Sem dependências de DOM ou Three. |
| `src/sim/content/` | Dados como código: as nove classes, habilidades, zonas, masmorras, itens, talentos. |
| `src/render/` | Renderizador Three.js (geometria, texturas e VFX procedurais). Lê o mundo, nunca o muta. |
| `src/game/` | Entrada local, câmera, atalhos, controles de celular, WebAudio procedural. |
| `src/ui/` | HUD clássico (frames, janelas, tooltips, mapa, texto de combate flutuante), ícones procedurais, i18n. |
| `src/net/` | Cliente online: autenticação REST mais um espelho de mundo via WebSocket (`ClientWorld`). |
| `src/admin/` | SPA do painel de administração (entrada `admin.html` separada). |
| `server/` | Servidor autoritativo: HTTP e WS, loop de mundo, Postgres, autenticação, social, moderação. |
| `headless/` + `python/` | Servidor de ambiente de RL (`env_server.ts`) e bindings de Python Gym. |
| `tests/` | Suíte do Vitest. |
| `scripts/` | Build de assets mais scripts de E2E em navegador, captura de tela e integração. |
| `public/` · `docs/` | Assets estáticos (modelos GLB, texturas, HDRIs) e docs de design. |

A maioria dos diretórios carrega seu próprio `CLAUDE.md` com convenções locais. O conjunto completo de invariantes do projeto vive no [`CLAUDE.md`](../../CLAUDE.md) da raiz.

## Construído como os clássicos

Combate, evolução de nível e ameaça rodam todos sobre regras autênticas da era clássica: rage e energia, tabelas de acerto e esquiva, mitigação de armadura, a curva de XP de verdade, swing timers e o cooldown global. Tem a sensação que você lembra, em vez de aproximá-la. Os números exatos vivem em `src/sim/` se você quiser lê-los.

E quase nada disso é um asset pré-pronto. O mundo é desenhado a partir de código:

- Cidades, criaturas, terreno, água, clima e sombras em tempo real, todos procedurais, sem nenhum arquivo de modelo 3D para o mundo.
- Doze famílias de criaturas com esqueleto e animações completas de caminhar, atacar, conjurar, sentar e morrer.
- Ícones de magia, item e buff pintados em canvas em tempo de execução.
- Um HUD clássico completo (unit frames, barras de ação, tooltips, registro de missões, mapa-múndi, minimapa, texto de combate flutuante) e WebAudio procedural para cada som.

## Desenvolvimento

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

Os testes de lógica e unidade usam o Vitest. Enquanto itera, rode um único arquivo: `npx vitest run tests/sim.test.ts`. Os scripts de E2E e visuais comandam navegadores reais via `puppeteer-core` e precisam do `npm run dev` rodando (muitas vezes do `npm run server` também). Os agentes de navegador podem comandar o movimento por `window.__game.controller` em vez de simular teclas pressionadas, por exemplo `controller.move({ forward: true }, facingRadians)` ou flags compactas como `{ f: 1, sr: 1 }`.

Para os comandos do servidor veja [Desenvolva online](#develop-online-with-hot-reload) acima, [DEPLOY.md](../../DEPLOY.md) para produção e [CREDITS.md](../../CREDITS.md) para as licenças dos assets.

## Localização

Toda string visível ao jogador é resolvida através de `t()`, e o jogo é distribuído em **21 idiomas** (inglês, dois espanhóis, dois franceses, inglês do Canadá, italiano, alemão, chinês simplificado e tradicional, coreano, japonês, português do Brasil, russo, holandês, polonês, indonésio, turco, sueco, vietnamita e dinamarquês). A sim e o servidor permanecem agnósticos quanto ao idioma: eles emitem chaves estáveis ou inglês que o cliente relocaliza na fronteira, o que mantém o determinismo intacto. Os contribuidores adicionam apenas inglês; o mantenedor preenche em lote os outros idiomas antes de cada release. O fluxo de trabalho está documentado em `docs/i18n-scaling/translation-workflow.md`.

## Contribuindo

Contribuições de todo tipo são bem-vindas: código, traduções, relatórios de bug e documentação. Comece pelo [CONTRIBUTING.md](CONTRIBUTING.pt_BR.md) para a configuração, leia o [Código de Conduta](../../CODE_OF_CONDUCT.md) e confira o [SECURITY.md](../../SECURITY.md) antes de relatar uma vulnerabilidade. Novo por aqui? Procure issues marcadas com [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), abra uma [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) ou diga olá no [Discord](https://discord.com/invite/worldofclaudecraft).

<div align="center">

![World of Claude](../../worldofclaude.png)

![Comunidade do World of ClaudeCraft](../../woc_community.png)

</div>

## Licença

O código é [licenciado sob MIT](../../LICENSE), então faça fork, remixe e hospede seu próprio mundo.

Os assets de arte de terceiros incluídos (modelos, texturas, HDRIs) mantêm suas próprias licenças, todas CC0 de domínio público exceto os mapas de normais de água em MIT, documentados por pacote em [CREDITS.md](../../CREDITS.md).
