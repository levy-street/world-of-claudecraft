<div align="center">

# World of ClaudeCraft

**Faça missões, forme grupos e enfrente raides em um mundo feito a mão, gratuito no seu navegador. Open source, web3 e online agora mesmo.**

**Site oficial: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.32.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.pt_BR.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · **Português (Brasil)** · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Jogar agora](https://worldofclaudecraft.com/) · [Hospede seu próprio mundo](#host-your-own-world-one-command) · [Treine um agente](#train-an-agent-headless-rl) · [Web3](#web3) · [Contribuindo](CONTRIBUTING.pt_BR.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Tela de título do World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## O que é isto

World of ClaudeCraft é um MMO completo da era clássica que você pode jogar agora mesmo no seu navegador, hospedar sozinho com um único comando e até usar para treinar agentes de IA para jogar. É gratuito, open source e está no ar em [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Um único mundo compartilhado roda em três lugares, todos a partir do mesmo núcleo de jogo:

- o **servidor multiplayer autoritativo**, o mundo ao vivo que você joga em worldofclaudecraft.com, onde contas apoiadas em Postgres compartilham um único reino persistente,
- o **mundo offline no navegador**, uma Sim local para um jogador que você obtém do servidor de desenvolvimento, útil para desenvolver e para ler o núcleo do jogo de ponta a ponta,
- o **ambiente de RL headless**, onde o Python comanda o jogo de verdade através de uma interface Gym.

Mesma semente, mesmo mundo, em todo lugar. Boa parte do que você vê ainda é desenhada a partir de código em tempo de execução, e o resto é um conjunto curado de assets que acompanha o projeto, então um fork roda de imediato.

## Destaques

- **Nove classes clássicas**, cada uma com um kit completo no estilo da era clássica que ganha ranks conforme você sobe de nível, além de um **sistema de talentos** completo (três specs por classe, 27 specs no total).
- **Três zonas de mundo aberto** do nível 1 ao 20, mais de 90 missões e uma única história conectada sobre a conspiração Gravecaller.
- **Cinco masmorras instanciadas**, quatro delas raides de elite para cinco jogadores e uma cripta solo, com escalonamento de elite, mecânicas de chefe em área, loot por arquétipo de classe que se junta em conjuntos de tier e um **nível de dificuldade Heroico** com recompensas mais ricas, além de **world bosses** no mundo aberto e um final em raide de dez jogadores.
- **Duas delves escaláveis**, um modo para grupos pequenos de um ou dois jogadores mais um companheiro de IA, reconstruídas a partir de câmaras aleatórias a cada incursão, nos níveis Normal e Heroico.
- **PvP ranqueado** em dois mapas de arena: ladders 1v1 e 2v2, um modo 2v2 Fiesta mais animado e **Protect Yumi**, um modo de objetivo 3v3 e 5v5. O jogo ranqueado paga Honor, que compra um conjunto de equipamento exclusivo de PvP que nunca supera o loot de masmorra no PvE.
- **The Vale Cup**, uma liga de boarball jogada em seu próprio estádio ao sul de Eastbrook, e **Card Duel**, um jogo de cartas rápido de um contra um sediado na cidade.
- **Um Book of Deeds**: um diário de conquistas com títulos cosméticos, bordas de emblema e Renown, com Chronicles por zona mantidas por NPCs Chronicler dentro do mundo e um placar vitalício.
- **Uma economia de profissões profunda**: quatro ofícios de coleta alimentam dez ofícios de criação, de culinária e alquimia a joalheria, forja de armas e encantamento, com ferramentas em tiers, bancadas nas cidades, qualidade masterwork e encomendas, tudo alimentando um **World Market** movido pelos jogadores e o serviço de correio **Ravenpost**.
- **Multiplayer de verdade**: grupos e raides, guildas, comércio, duelos, direitos de tap, XP dividido em grupo, sussurros, status de ausência e um **Dungeon Finder** com filas por função e listagens de premade.
- **Autorado em código, não em um editor 3D**: terreno, água, clima, plantas de cidade, sombras em tempo real e efeitos são gerados em tempo de execução, e os modelos que de fato acompanham o projeto são construídos por fábricas procedurais e uma biblioteca curada de assets, em vez de esculpidos à mão.
- **Localizado em 22 idiomas** por meio de um pipeline determinístico em que a sim emite chaves.
- **Um wiki companheiro em `/wiki`**, gerado direto do conteúdo vivo do jogo, então não tem como divergir do mundo que documenta.
- **Apps nativos em todas as plataformas**: instaladores de desktop assinados para Windows, Linux e macOS com atualizações automáticas e espelhamento opcional de conquistas na Steam, além de builds para iOS e Android, todos compartilhando o cliente de navegador e o mesmo mundo online.
- **Escala para a máquina que você tem**: presets gráficos e um governador automático de taxa de quadros trocam riqueza visual por fluidez, e são mantidos sob uma regra de justiça que os impede de esconder qualquer coisa a que um jogador reaja.
- **Ambiente de RL headless** com bindings do Gymnasium, modelagem de recompensa e um modo de benchmark.
- **Utilidade do $WOC, totalmente opcional**: vincule uma carteira Solana para ter selo de holder, Daily Rewards e uma opção de pagamento com desconto na loja de cosméticos. O jogo continua gratuito para jogar e não custodial.
- **Season 1 Armory**: colecione skins cosméticas de armas pela WOC Store, usando Claudium comprado com moeda fiduciária, SOL, USDC ou $WOC. Cosméticos nunca dão poder de combate.

## Capturas de tela

![A praça central de Eastbrook, a fogueira e os NPCs de missão](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Anoitecer na fogueira de Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Anoitecer na fogueira de Eastbrook* | ![Pulls de elite na Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pulls de elite à luz das tochas na Hollow Crypt* |
| ![Os mortos inquietos na capela em ruínas](../../docs/screenshots/restless-dead.jpg)<br>*Os mortos inquietos na capela em ruínas* | ![Uma briga com os Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*Em desvantagem numérica no acampamento dos bandidos* |
| ![Old Greyjaw caçado na estrada do norte](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, o spawn raro, encurralado na estrada do norte* | ![Interface de vendedor e bolsas](../../docs/screenshots/vendor-and-bags.jpg)<br>*Se equipando na loja de Trader Wilkes, com o vendedor e as bolsas abertos* |
| ![O portal lunar na praia de Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Os afogados emergem no portal lunar de Glimmermere* | ![Ysolei no altar do Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest e o altar do Drowned Temple* |

O clima é determinado pelo bioma e existe só na renderização, então nunca toca a sim determinística:

| | | |
|:---:|:---:|:---:|
| ![Céu limpo sobre Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Tempo limpo sobre o Vale* | ![Chuva sobre Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Chuva sobre Mirefen Marsh* | ![Neve em Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Neve em Thornpeak Heights* |

## Como jogar

Jogue no navegador em [worldofclaudecraft.com](https://worldofclaudecraft.com/) ou instale o app nativo para Windows, Linux, macOS, iOS ou Android. Todo cliente se conecta ao mesmo mundo online.

### Online, com outros jogadores

Crie uma conta, crie um personagem e entre no mundo ao vivo. Para subir esse mesmo stack cliente/servidor você mesmo, veja [Hospede seu próprio mundo](#host-your-own-world-one-command) abaixo.

### Offline, no servidor de desenvolvimento

O modo offline é um mundo local para um jogador, sem conta e sem autoridade de servidor, então ele só acompanha as builds de desenvolvimento. Rode o servidor de desenvolvimento e ele aparece no seletor de modo:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Dê um nome ao seu personagem, escolha qualquer uma das nove classes e comece em **Eastbrook Vale** (níveis 1-7), uma cidade comercial cercada por polos: tocaias de lobos ao norte, prados de javalis a leste, os bosques Sableweb a oeste, Mirror Lake a noroeste, uma escavação de cobre infestada de burrowers a sudoeste e uma capela em ruínas dos mortos inquietos a nordeste, com o acampamento de bandidos de Gorrak a sudeste. A estrada do norte sobe um passo na montanha até **Mirefen Marsh** (6-13, polo Fenbridge) e continua subindo até **Thornpeak Heights** (13-20, polo Highwatch). A semente do mundo é fixa em `src/main.ts`, então é o mesmo lugar a cada visita.

### Apps de desktop para Windows, Linux e macOS

World of ClaudeCraft é distribuído como apps de desktop completos para as três principais plataformas de desktop: instaladores assinados no Windows, pacotes AppImage e deb no Linux, e builds universais assinadas e notarizadas no macOS. Eles usam o mesmo cliente de jogo e o mesmo mundo online do navegador, com empacotamento nativo e atualizações automáticas.

O login online é apenas Discord e email, exatamente o fluxo da web: email e senha entram dentro do app, e "Continue with Discord" abre seu navegador padrão na página `/desktop-login`, que devolve um código de uso único ao app por um deep link `worldofclaudecraft://` que o app troca por um token de sessão normal do World of ClaudeCraft.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Aponte o shell para outra API com `VITE_DESKTOP_API_ORIGIN`, por exemplo um servidor local ou um host de staging:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Sobrescreva a origem da API de produção em builds de staging com `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (um valor de tempo de BUILD: ele é embutido no bundle e carimbado no app empacotado, e builds instaladas o ignoram como variável de ambiente em tempo de execução). A Steam é um canal de distribuição (o mesmo bundle do Electron, enviado via SteamPipe), e jogadores de desktop podem vincular uma conta Steam para espelhar os deeds que conquistam em conquistas da Steam; o login em si continua por email e Discord. O runbook completo de release (assinatura, notarização, publicação de uma atualização automática, depots do SteamPipe, o deploy do servidor) é `docs/desktop-release.md`. iOS e Android são distribuídos pelo Capacitor, com seu próprio runbook em `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Hospede seu próprio mundo (um comando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Para **hospedagem remota**, coloque o stack do compose em qualquer VPS, defina um `POSTGRES_PASSWORD` real no ambiente e exponha a porta 8787 por trás de um proxy reverso com TLS. O Caddy resolve isso em poucas linhas; os WebSockets são encaminhados automaticamente e o cliente seleciona `wss://` sozinho em páginas https. Os endpoints de autenticação têm limite de taxa, as senhas usam hash scrypt e as sessões de login expiram. Nunca defina `ALLOW_DEV_COMMANDS=1` em produção, pois isso habilita o conjunto completo de cheats `/dev`: os cheats de nível e teleporte que os bots de teste usam, além de concessão de itens, spawn de mobs, teleportes para instâncias e a GUI de comandos de desenvolvimento dentro do jogo. O [DEPLOY.md](../../DEPLOY.md) é o guia completo de produção, incluindo a configuração de proxy reverso que mantém os endpoints de health e de métricas fora da borda pública.

<a id="develop-online-with-hot-reload"></a>

### Desenvolva online com hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Abra http://localhost:5173, escolha **Play Online**, crie uma conta, crie um personagem e Enter World. A tela de seleção de personagem mostra as novidades da última release no painel News & Updates, com selos NEW para tudo que você ainda não viu. Abra uma segunda aba e faça login de novo para verem um ao outro na cidade. `Enter` abre o chat. O wiki de jogador é o Guide dentro do repositório, servido em http://localhost:5173/wiki e em `/wiki` na produção; seu conteúdo é gerado a partir dos dados atuais do jogo por `npm run wiki:content`.

O que persiste e como o servidor mantém o controle:

- **Contas**: senhas com hash scrypt e tokens bearer que expiram.
- **Personagens**: até 10 por conta por reino; nível, equipamento, bolsas, cofre do banco, missões, talentos, profissões, progresso de PvP e de deeds, posição e dinheiro persistem como JSONB no Postgres, salvos em um timer, no logout e no desligamento do servidor. Os nomes são únicos por reino e clássicos no estilo.
- **O servidor é autoritativo**: os clientes transmitem intenção de movimento e comandos a 20 Hz; o servidor roda a única `Sim` compartilhada e retorna snapshots com escopo de interesse mais eventos por jogador. Cada rolagem de combate, queda de loot, crédito de missão e transação com vendedor é resolvida no servidor. O cliente é um renderizador.

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

env = WoWClassicEnv(player_class="warrior")   # any of the nine classes
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Os espaços de observação e ação são derivados do conteúdo.** Consulte-os na resposta `info` do ambiente na inicialização, em vez de fixá-los no código; eles crescem junto com o jogo. O espaço de ação é um `Discrete` que cobre movimento, alvo, ataque, o kit completo de habilidades, interagir e comer/beber; a observação é um `Box` que cobre você mesmo, habilidades, alvo, mobs próximos, o interagível mais próximo e o progresso de missão.
- **A recompensa** é uma soma ponderada dos deltas de contadores por tick (XP, dano causado e recebido, abates, mortes, progresso de missão, subidas de nível), ajustável a cada reset. Cada `step` aplica uma ação e avança cinco ticks de sim por padrão, então cerca de quatro decisões por segundo simulado.
- **Determinístico por construção.** Sem relógio de parede, sem `Math.random`. Defina a semente no reset e o episódio se repete exatamente igual.

O protocolo e os bindings estão documentados em `headless/CLAUDE.md` e `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft é nativo de web3 em torno do **$WOC**, nosso token de comunidade na Solana. Conecte uma carteira Solana, vincule-a à sua conta com uma única assinatura (não custodial, sem transação para aprovar), e seu saldo de $WOC somente leitura aparece no HUD ao lado de um selo cosmético de tier de holder.

O $WOC também tem utilidade opcional no jogo ao vivo:

- **WOC Store**: compre Claudium, a moeda cosmética de mão única, com moeda fiduciária, SOL, USDC ou $WOC. O trilho de pagamento em $WOC tem desconto em relação aos outros.
- **Season 1 Armory**: gaste Claudium em coleções de skins cosméticas de armas. As compras na loja não adicionam atributos nem poder de combate.
- **Daily Rewards**: holders verificados elegíveis podem ganhar pontos com um giro diário e tarefas rotativas, e então disputar uma fatia do prêmio diário.

Nada disso é necessário para jogar. Vincular a carteira é opcional e não custodial, não há pay-to-win, e o jogo inteiro funciona bem sem nunca conectar uma carteira.

**Endereço do contrato do $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Mais sobre o token em [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Um tour pelo mundo

### As nove classes

Toda classe roda sobre mecânicas de MMO da era clássica implementadas a partir dos primeiros princípios, e aprende magias com rank ao longo dos níveis 1-20, com habilidades marcantes como Low Blow, Early Grave, Skyfall, Urgent Prayer e Ancestral Strike se destravando na metade final da escalada.

- **Warrior**: rage, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (um sangramento que acompanha seus golpes), Widening Arc, Hobbling Cut, Blood Toll, Redhand (proc de esquiva).
- **Paladin**: Oathbrand liberado por Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorção), Sundering Gavel (atordoamento), Last Rite.
- **Hunter**: ataque automático à distância (8-35 yd com a zona morta no estilo clássico), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash e um pet domável a partir do nível 10.
- **Rogue**: energia e pontos de combo, Wicked Slash, Dirt Nap, Craven Thrust (por trás, adaga), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorção), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (imbuição), Mending Waters, Earthen Jolt, Thunder Ward (espinhos), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (canalizada), Bewitch, Icebind, um elemental de água invocado e Chronomancy, uma spec de cura com magia temporal.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume e sete demônios invocáveis, do Emberkin ao Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots e transformação em Wolf Form no 5, Bruin Form no 8 e Moonwing Form no 10.

Curas e buffs atingem os membros do grupo, a cura pode dar crítico, e os escudos de absorção sugam o dano antes da vida. Gaste pontos entre **três specs de talento por classe** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, e assim por diante); a alocação é validada pelo servidor e pode ser exportada como uma string de build.

### Masmorras

A história Gravecaller passa por três instâncias de elite para cinco jogadores, uma quarta espera atrás de um portal lunar com sua própria história dos afogados, e uma cripta solo fica à parte para os exploradores.

- **The Hollow Crypt** (5 jogadores) sob a Fallen Chapel: lixo de elite em pares, o minichefe Sexton Marrow e Morthen the Gravecaller com seu AoE de sombra recorrente. A porta da cripta teleporta seu grupo para uma cópia de instância privada que reseta assim que ela se esvazia.
- **The Sunken Bastion** (5 jogadores, por volta do nível 13, sudeste de Mirefen): Vael the Fogbinder invoca ondas de Drowned Thralls conforme a luta se arrasta.
- **Gravewyrm Sanctum** (5 jogadores, nível 20, sob Thornpeak): três câmaras de boneguard e scaleguard de elite, Korgath the Bound, Grand Necromancer Velkhar e Korzul the Gravewyrm, onde caem armas épicas.
- **The Drowned Temple** (5 jogadores) através do portal lunar de Glimmermere: uma instância pálida, em violeta lunar, que leva a Choirmother Selthe e depois a Ysolei, Avatar of the Drowned Moon, cujas marés lunares e Moonspawn invocados punem um grupo parado.
- **The Abandoned Crypt** (solo) em Thornpeak: um mergulho silencioso de chave mestra e diário para um só, cuja trilha destrava a porta real para **Nythraxis, Scourge of Thornpeak**, um final em raide de dez jogadores disputado em torno de três pedras de proteção de alma.

Toda instância também roda no **Heroico**: inimigos de nível mais alto, mecânicas mais afiadas e seu próprio loot e moeda de vendedor. As cadeias de missões que dão o gancho são solúveis sozinho, então a história nunca fica travada atrás de encontrar um grupo. Nossa raide automatizada de cinco bots (warrior, paladin, priest, mage, hunter com foco de fogo e IA de healer) limpa a Hollow Crypt em cerca de cinco minutos (`node scripts/crypt_raid.mjs`, precisa de `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves são um modo separado e escalável para grupos pequenos, de um ou dois jogadores, reconstruído a partir de câmaras aleatórias a cada incursão e terminando em um baú de relicário trancado que abre por um minigame de arrombamento, e não por uma rolagem de loot. **The Collapsed Reliquary** (nível 7 em diante) termina em Deacon Varric, com uma companheira de IA, Tessa, lutando ao seu lado se você for sozinho. **The Drowned Litany** (nível 12 em diante) segue a trilha até um santuário inundado na borda de Mirefen Marsh. Um quadro de delves define o tier: o Heroico eleva os níveis dos inimigos e adiciona um afixo aleatório para recompensas mais ricas.

### PvP ranqueado (o Ashen Coliseum)

Pressione `G` ou o botão da arena para entrar na fila. O matchmaking teleporta os lutadores para uma fossa privada, uma contagem regressiva curta cura e reseta todos para um começo justo, e o combate termina quando um lado se rende. Ninguém morre, e você volta exatamente para onde entrou na fila. Protect Yumi é disputado em seu próprio labirinto, e não na fossa do Coliseum.

- **Ladders ranqueadas 1v1 e 2v2**, cada uma com um rating persistente no estilo Elo e um placar de todos os tempos.
- **2v2 Fiesta**, um modo de festa mais animado em que as equipes correm até um alvo de abates enquanto coletas de aprimoramento espalham poder e um anel que se fecha força a luta a se juntar.
- **Protect Yumi**, um modo de objetivo 3v3 e 5v5 sem rating disputado em um labirinto: cada equipe guarda um familiar felino enquanto tenta derrubar o do outro lado, então escoltas e picks importam mais do que abates puros.

Vitórias ranqueadas e abates no Fiesta pagam **Honor**, que o quartermaster na cidade troca por um conjunto de equipamento Warfare. Warfare é um atributo exclusivo de PvP, então o conjunto vence duelos sem nunca superar o loot de masmorra do mesmo tier no PvE.

### Jogando juntos

- **Dungeon Finder**: abra com `Shift+I` para navegar por masmorras e raides, inspecionar chefes e loot, entrar em uma fila automática por função de tank/healer/DPS ou criar uma listagem de premade. Os grupos formados pelo Finder ainda viajam juntos até a entrada.
- **Grupos** de até 5, convertidos em uma raide de 10 jogadores com dois grupos assim que você lota: clique com o botão direito em um jogador e Invite to Party. Os membros compartilham direitos de tap e crédito de missão, dividem XP com os bônus de grupo da era clássica e aparecem como pontos no minimapa. `/p` para chat de grupo, `/roll` para decidir o loot.
- **Comércio**: clique com o direito e Trade. Os dois lados colocam itens e dinheiro, ambos precisam aceitar, e a troca é atômica e validada pelo servidor. Itens de missão não podem ser negociados, e se afastar cancela.
- **Duelos**: clique com o direito e Challenge to a Duel. Uma contagem regressiva de 3 segundos, então lutem até um lado chegar a 1 hp; o vencedor é anunciado por toda a zona e correr 60 jardas de distância significa desistência.
- **Direitos de tap e status de ausência**: o primeiro jogador a causar dano a um mob é dono do seu loot, XP e crédito de missão; `/afk` e `/dnd` marcam você como ausente com uma resposta automática aos sussurros.

### Mundo e sistemas

- **Profissões** (`Shift+P`): quatro ofícios de coleta (mineração, corte de madeira, herborismo, pesca) alimentam dez ofícios de criação, de culinária e alquimia a forja de armas, joalheria e encantamento. As ferramentas de coleta vêm em tiers que decidem em quais nós você pode trabalhar, a criação acontece nas bancadas das cidades com chance de uma qualidade masterwork que carrega a sua marca de artesão, e há um sistema de arquétipos para descobrir conforme você se especializa.
- **O World Market**: uma casa de leilões movida pelos jogadores para equipamento, materiais e consumíveis, navegável a partir das cidades-polo.
- **Correio Ravenpost**: envie itens e moedas para outros personagens, com os anexos guardados em segurança até serem retirados.
- **Guildas**: cartas, listas de membros, ranks e chat de guilda.
- **O Guide**: um wiki pesquisável dentro do site em `/wiki` cobrindo classes, criaturas, zonas e deeds, gerado direto do conteúdo vivo do jogo, então não tem como divergir do mundo que documenta.
- **The Vale Cup e Card Duel**: boarball no estádio de Sowfield ao sul de Eastbrook, em formatos de 1v1 a 5v5, e um jogo de cartas rápido de um contra um sediado pelo Card Master na cidade.
- **Daily Rewards**: holders verificados de $WOC podem ganhar pontos de placar com um giro diário e tarefas rotativas, com pagamentos automáticos do prêmio diário.
- **WOC Store e Season 1 Armory**: compre Claudium com moeda fiduciária, SOL, USDC ou $WOC, e depois gaste em skins de armas puramente cosméticas.
- **Comer e beber**: sente-se para restaurar, interrompido por dano ou ao ficar de pé, e sim, você pode comer e beber ao mesmo tempo.
- **Vendedores** que compram comida e água e vendem equipamento branco honesto, com moedas mostradas em ouro, prata e cobre.
- **Um banco pessoal** (o Gilded Strongbox): os bursars de cada cidade-polo mantêm um cofre por personagem, de 24 até 96 espaços com expansões compradas com moedas, além de espaços bônus ganhos online por email verificado, contas vinculadas e indicações.
- **O Book of Deeds**: um diário de conquistas (`Shift+Z` por padrão) de missões, abates, clears e curiosidades, que paga títulos cosméticos para você exibir na sua placa de nome, no chat e nos placares, além de um rastreador no HUD para os deeds que você está perseguindo, Chronicles por zona mantidas por NPCs Chronicler e um placar vitalício de Renown; a lista pública fica em `/wiki/deeds`.
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
| `C` `P` `L` `M` `B` `N` `T` | personagem, grimório, registro de missões, mapa-múndi, bolsas, talentos, criação |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arena, amigos e guilda, placar, calendário, Vale Cup, Dungeon Finder, profissões, deeds |
| `Z` / `X` | guardar ou sacar suas armas, roda de emotes |
| `V` / `R` / `Esc` | nameplates, autorun, fechar a janela do topo (ou abrir o menu do jogo) |

Todo atalho pode ser remapeado no painel de keybinds. Os controles de toque (um direcional de movimento, arraste de câmera e botões de ação na tela) aparecem automaticamente no celular.

## Arquitetura (uma sim, três hosts)

Três ideias seguram o projeto inteiro:

- **Uma sim, três hosts.** O mesmo código de `src/sim/` roda o mundo offline no navegador, o servidor online e o ambiente de RL. O comportamento precisa ser idêntico em todo lugar, e os testes existem para manter isso assim.
- **`IWorld` é a única costura.** `IWorld` é definida como interfaces de faceta por domínio em `src/world_api/`, agregadas por `src/world_api.ts`. A `Sim` offline a satisfaz estruturalmente, e o `ClientWorld` online a implementa espelhando os snapshots do servidor. O renderizador e o HUD falam apenas com `IWorld`, nunca com um mundo concreto, então um recurso novo estende primeiro a faceta correspondente e depois os dois mundos.
- **O servidor é autoritativo.** Os clientes enviam intenção; o servidor decide os resultados. O cliente nunca resolve combate, loot ou economia por conta própria.

A sim é um tick fixo de 20 Hz (`DT = 1/20`), toda a aleatoriedade flui por uma única `Rng` com semente, e `src/sim/` carrega zero imports de DOM, navegador ou Three.js. É isso que permite que o mesmo código seja empacotado em um servidor de ambiente Node, um loop de jogo autoritativo e uma aba de navegador sem mudar uma linha.

### Estrutura do projeto

| Caminho | O que é |
|---|---|
| `src/sim/` | Núcleo determinístico do jogo, a fonte da verdade. Sem dependências de DOM ou Three. |
| `src/sim/content/` | Dados como código: as nove classes, habilidades, zonas, masmorras, delves, itens, receitas, encantamentos, talentos, profissões, deeds. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, a costura de que o renderizador e o HUD dependem: uma interface de faceta por domínio. |
| `src/` (o resto) | Renderizador Three.js, HUD e estilos, entrada/áudio, espelho online e as SPAs de administração, guide e editor. |
| `server/` | Servidor autoritativo: HTTP e WS, loop de mundo, Postgres, autenticação, social, moderação. |
| `server/http/` | O pipeline de requisições REST: roteador por tabela, middleware e definições de rota por domínio. |
| `headless/` + `python/` | Servidor de ambiente de RL (`env_server.ts`) e bindings de Python Gym. |
| `bot/` | Bot do Discord (cargos, relay, feed de atividade). |
| `electron/`, `android/`, `ios/` | Shells de desktop (Steam) e nativos de celular. |
| `tests/` | Suíte do Vitest. |
| `scripts/` | Ferramentas de build, assets, i18n, SFX, captura de tela e E2E em navegador. |
| `deploy/` · `mediawiki/` | Assets de primeiro boot em produção e o contêiner do wiki de jogador. |
| `public/` · `docs/` | Assets estáticos (publicados literalmente no site) e docs de design. |

Nada disso fica na base da confiança: `tests/architecture.test.ts` varre cada arquivo da sim
atrás de um import proibido, um global de DOM ou uma chamada perdida de relógio ou
`Math.random`, e `tests/world_api_parity.test.ts` fixa a costura para que os dois mundos não divirjam.

A maioria dos diretórios carrega seu próprio `CLAUDE.md` com convenções locais, e o conjunto
completo de invariantes do projeto vive no [`CLAUDE.md`](../../CLAUDE.md) da raiz. Contribuidores
agentes começam por ali e depois pegam o ponto de entrada do seu runtime: [`AGENTS.md`](../../AGENTS.md)
mais o [guia do operador do Codex](../codex.md) para o Codex, [`GEMINI.md`](../../GEMINI.md) para o
Gemini. Todos eles desembocam na mesma arquitetura canônica.

## Construído como os clássicos

Combate, evolução de nível e ameaça rodam todos sobre regras autênticas da era clássica: rage e energia, tabelas de acerto e esquiva, mitigação de armadura, a curva de XP de verdade, swing timers e o cooldown global. Tem a sensação que você lembra, em vez de aproximá-la. Os números exatos vivem em `src/sim/` se você quiser lê-los.

O mundo é autorado em código, e não em um editor 3D, que é o que o mantém pequeno,
determinístico e fácil de forkar:

- Terreno, água, clima, céu, plantas de cidade, sombras em tempo real e efeitos de combate são gerados em tempo de execução a partir dos dados da própria sim.
- Os modelos que de fato acompanham o projeto são construídos do mesmo jeito: fábricas procedurais em `scripts/assets/` exportam GLBs determinísticos pelo pipeline de imagem para GLB do projeto, ao lado de uma biblioteca curada de kits de modelos CC0. As famílias de criaturas e personagens com esqueleto carregam animações completas de caminhar, atacar, conjurar, sentar e morrer.
- Os ícones são um pintor em camadas que compõe arte para qualquer coisa sem um arquivo próprio, então nada fica sem ícone, com arte pintada curada por cima para habilidades, itens e deeds.
- Um HUD clássico completo (unit frames, barras de ação, tooltips, registro de missões, mapa-múndi, minimapa, texto de combate flutuante, o Book of Deeds), efeitos sonoros espaciais e de interface amostrados, e uma trilha sonora composta proceduralmente no repositório e distribuída como remasters em streaming que fazem crossfade entre zonas, cidades, masmorras e combate.

Cada asset distribuído e sua licença estão registrados no [CREDITS.md](../../CREDITS.md), e as
dependências de terceiros empacotadas carregam seus avisos no [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Desenvolvimento

Além do cliente do jogo, o build produz o painel do operador, o editor de mundo em
`/editor` e o Guide público em `/wiki`, todos servidos pelo mesmo servidor de desenvolvimento.

Todo caminho de FFmpeg que o gate e os testes de áudio exercitam resolve os pacotes npm
`ffmpeg-static`/`ffprobe-static` empacotados, então uma contribuição normal não precisa de
nenhuma instalação de FFmpeg no sistema. Os caminhos que medem conformidade (`npm run sfx:check`,
os testes de áudio, a validação de exportação do Studio) se ligam diretamente aos binários
estáticos, sem fallback para o `PATH`: rode `npm ci` de novo se uma instalação que pulou os
scripts os tiver deixado faltando. Os spawns de reprodução e codificação do Studio e o preflight
do `npm run gate` resolvem via `scripts/sfx/ffmpeg_paths.mjs`, que de fato tem fallback para o
`PATH`. Alguns scripts autônomos de geração de áudio (por exemplo
`scripts/gen_ui_sfx.mjs`) ainda usam por padrão o `ffmpeg` do `PATH`.

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

Os testes de lógica e unidade usam o Vitest. Enquanto itera, rode um único arquivo: `npx vitest run tests/sim.test.ts`. Mudanças de interface também têm uma suíte opcional em navegador de verdade cobrindo acessibilidade, navegação por teclado e alvos de toque: `npm run test:browser`. Os scripts de captura de tela e de smoke comandam navegadores reais via `puppeteer-core` e precisam do `npm run dev` rodando; os scripts de nível de fio (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) falam direto com o servidor e precisam do `npm run server` no lugar. Os agentes de navegador podem comandar o movimento por `window.__game.controller` em vez de simular teclas pressionadas, por exemplo `controller.move({ forward: true }, facingRadians)` ou flags compactas como `{ f: 1, sr: 1 }`.

As verificações rodam em camadas, descritas em [docs/qa-gate.md](../qa-gate.md): aponte seu
clone para os hooks compartilhados com `git config core.hooksPath .githooks` e um piso rápido
roda antes de qualquer coisa sair da sua máquina.

Para os comandos do servidor veja [Desenvolva online](#develop-online-with-hot-reload) acima, o
[CONTRIBUTING.md](CONTRIBUTING.pt_BR.md) para o fluxo de contribuição, o
[tutorial do SFX Studio](../sfx-studio-tutorial.md) para autoria de som e
exportação de artefatos, o [DEPLOY.md](../../DEPLOY.md) para produção e o
[CREDITS.md](../../CREDITS.md) para as licenças dos assets.

## Localização

Toda string visível ao jogador é resolvida através de `t()`, e o jogo é distribuído em **22 idiomas** (inglês, dois espanhóis, dois franceses, inglês do Canadá, italiano, alemão, chinês simplificado e tradicional, coreano, japonês, português do Brasil, russo, tcheco, holandês, polonês, indonésio, turco, sueco, vietnamita e dinamarquês). A sim e o servidor permanecem agnósticos quanto ao idioma: eles emitem chaves estáveis ou inglês que o cliente relocaliza na fronteira, o que mantém o determinismo intacto. Os contribuidores adicionam apenas inglês; o mantenedor preenche em lote os outros idiomas antes de cada release. O fluxo de trabalho está documentado em `docs/i18n-scaling/translation-workflow.md`.

## Contribuindo

Contribuições de todo tipo são bem-vindas: código, traduções, relatórios de bug e documentação. Comece pelo [CONTRIBUTING.md](CONTRIBUTING.pt_BR.md) para a configuração, leia o [Código de Conduta](../../CODE_OF_CONDUCT.md) e confira o [SECURITY.md](../../SECURITY.md) antes de relatar uma vulnerabilidade. Novo por aqui? Procure issues marcadas com [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), abra uma [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) ou diga olá no [Discord](https://discord.com/invite/worldofclaudecraft).

O desenvolvimento ativo acontece no branch `release/vX.Y.Z` mais recente. Consulte qual é ele em vez de supor, e então crie seu branch a partir dele e aponte seu pull request para ele. Nunca crie um branch a partir do `main` nem aponte para ele, já que o `main` só recebe um branch de release quando aquela versão é publicada. O [CONTRIBUTING.md](CONTRIBUTING.pt_BR.md) traz o comando de uma linha que encontra o atual.

## Licença

**O código é [licenciado sob MIT](../../LICENSE), então faça fork, remixe e hospede seu próprio mundo.** É esse o objetivo inteiro, e nada mais nesta página ou no nosso site retira isso.

Três coisas são licenciadas separadamente, então vale trinta segundos para saber qual é qual:

| O que | Licença | Você pode redistribuir? |
|---|---|---|
| **Código-fonte**, ou seja, tudo menos os assets de mídia separados abaixo | [MIT](../../LICENSE) | Sim. Comercialmente também. |
| **Assets de mídia**: modelos, texturas, HDRIs, ícones, sons, fontes (na maior parte sob `public/`) | Por asset, registrada no [CREDITS.md](../../CREDITS.md) | Na maioria sim (a maior parte é CC0). Alguns não, veja abaixo. |
| **Nome e marca**: "World of ClaudeCraft", "Levy Street", os logos | Não licenciados | Não. |

**Faça fork e hospede seu próprio mundo. Isso funciona, e os assets não ficam no seu caminho.** A maior parte do que você vê é domínio público CC0 (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), e nossos próprios objetos, criaturas, cenários e sons de interface gerados acompanham o projeto, então um fork roda de imediato. Você só não pode tirá-los dali e vendê-los como arte avulsa.

O que você precisaria remover ou substituir antes de redistribuir:

- os **ícones de habilidade de classe da CraftPix** em `public/ui/skills/` foram comprados pela Levy Street e **não podem ser redistribuídos**, então compre sua própria licença se quiser distribuí-los;
- os **efeitos sonoros do @jamiecypher** são CC BY-NC 4.0, então compartilhe-os sem fins comerciais e com crédito, mas a permissão comercial vale só para este projeto;
- a **arte da loja e de prestígio** (Season 1 Armory, o conjunto Claudium, o conjunto de arte das profissões, os ícones do Book of Deeds, o emblema do dragão de elite) é arte comercial encomendada e **os direitos são reservados**;
- as **marcas de terceiros** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) são marcas registradas de seus donos e não cabe a nós licenciá-las adiante;
- um punhado de **ícones e gravações usados com permissão** precisa de permissão para ser repassado.

O [CREDITS.md](../../CREDITS.md) é a lista autoritativa, com uma coluna de redistribuição por asset. Onde um asset está listado ali, aquela licença prevalece sobre a licença MIT do projeto. Esse registro ainda está sendo completado, então um asset de mídia que falte nele está sem registro, não livre: pergunte antes de contar com ele. Com o código-fonte é o contrário, e tudo que não foi separado é MIT.

Nossos [Termos de Serviço](https://worldofclaudecraft.com/terms) cobrem o jogo hospedado que rodamos em worldofclaudecraft.com: contas, conduta, itens virtuais. Eles não restringem os direitos que a Licença MIT dá a você sobre este código-fonte.
