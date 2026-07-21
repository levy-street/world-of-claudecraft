<div align="center">

# World of ClaudeCraft

**Nhận nhiệm vụ, lập nhóm và raid một thế giới được dựng thủ công, miễn phí ngay trên trình duyệt. Mã nguồn mở, web3 và trực tuyến ngay bây giờ.**

**Trang web chính thức: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r185-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.28.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.vi_VN.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · **Tiếng Việt** · [Dansk](README.da_DK.md)

[Chơi ngay](https://worldofclaudecraft.com/) · [Tự dựng thế giới của bạn](#host-your-own-world-one-command) · [Huấn luyện một agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Đóng góp](CONTRIBUTING.vi_VN.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Màn hình tiêu đề World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Đây là gì

World of ClaudeCraft là một tựa MMO kinh điển hoàn chỉnh mà bạn có thể chơi ngay bây giờ trên trình duyệt, tự dựng với một lệnh duy nhất, và thậm chí còn huấn luyện được các agent AI để chơi. Trò chơi miễn phí, mã nguồn mở, và đang chạy trực tiếp tại [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Một thế giới chung chạy ở ba nơi, tất cả đều từ cùng một lõi game:

- **thế giới ngoại tuyến trên trình duyệt**, nơi bạn bấm Play Offline là vào ngay,
- **máy chủ multiplayer giữ quyền quyết định**, nơi các tài khoản lưu trên Postgres cùng chia sẻ một thế giới sống động,
- **môi trường RL không giao diện**, nơi Python điều khiển trò chơi thật qua giao diện Gym.

Cùng một seed, cùng một thế giới, ở mọi nơi. Và gần như không có gì là tài nguyên đóng gói sẵn: các thị trấn, sinh vật, biểu tượng phép, và âm thanh đều được tạo ra lúc chạy.

## Điểm nổi bật

- **Chín class kinh điển**, mỗi class có một bộ kỹ năng đúng phong cách vanilla, lên rank khi bạn lên cấp, cùng một **hệ thống talent** đầy đủ (ba spec mỗi class, tổng cộng 27 spec).
- **Ba vùng đất mở** từ cấp 1 đến 20, gần 80 nhiệm vụ, và một cốt truyện liền mạch xoay quanh âm mưu Gravecaller.
- **Năm dungeon dạng instance**, bốn trong số đó là các raid tinh nhuệ năm người chơi và một crypt đơn, với cơ chế scale tinh nhuệ, cơ chế boss AoE, và loot theo nguyên mẫu class.
- **Delve có thể scale**, một chế độ nhóm nhỏ cho một hoặc hai người chơi cộng thêm một bạn đồng hành AI, được dựng lại từ các phòng ngẫu nhiên qua mỗi lượt chơi, trải qua bậc Normal và Heroic.
- **The Ashen Coliseum**, một đấu trường PvP xếp hạng với bảng xếp hạng 1v1 và 2v2 cộng thêm chế độ 2v2 Fiesta (nhặt vật phẩm tăng lực, vòng tròn thu hẹp, đội nào hạ gục mười lăm lần trước thì thắng).
- **Multiplayer thực thụ**: nhóm, giao dịch, đấu tay đôi, quyền tap, chia XP trong nhóm, lời thì thầm, trạng thái vắng mặt, và một máy chủ nắm giữ mọi lượt roll combat.
- **Mọi thứ đều procedural**: các thị trấn khung gỗ, các họ sinh vật được rig, biểu tượng phép vẽ trên canvas, âm thanh WebAudio, thời tiết theo quần xã, và bóng đổ thời gian thực. Không có tệp mô hình 3D nào cho thế giới.
- **Bản địa hóa sang 21 ngôn ngữ** thông qua một pipeline tất định, sim-phát-ra-key.
- **Môi trường RL không giao diện** với các ràng buộc Gymnasium, định hình phần thưởng, và một chế độ benchmark.
- **Bản địa web3**: liên kết một ví Solana để hiển thị số dư $WOC của bạn và một huy hiệu người nắm giữ mang tính trang trí, hoàn toàn tùy chọn và không giữ tài sản hộ.

## Ảnh chụp màn hình

![Một nhóm tụ họp bên ngoài tiệm thuốc ở Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Hoàng hôn bên đống lửa trại Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Hoàng hôn bên đống lửa trại Eastbrook* | ![Kéo quái tinh nhuệ trong the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Kéo quái tinh nhuệ dưới ánh đuốc trong the Hollow Crypt* |
| ![Những kẻ chết không yên ở nhà nguyện đổ nát](../../docs/screenshots/restless-dead.jpg)<br>*Những kẻ chết không yên ở nhà nguyện đổ nát* | ![Một trận hỗn chiến với Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*Bị áp đảo quân số tại trại cướp* |
| ![Old Greyjaw bị truy đuổi trên con đường phía bắc](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, quái rare spawn, bị truy đuổi trên con đường phía bắc* | ![Giao diện người bán và túi đồ](../../docs/screenshots/vendor-and-bags.jpg)<br>*Trang bị tại chỗ của Smith Haldren, với tooltip, túi đồ, và tiền xu* |
| ![Cổng trăng trên bờ Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Những kẻ chết đuối leo lên tại cổng trăng Glimmermere* | ![Ysolei trên bàn thờ của the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire và bàn thờ của the Drowned Temple* |

Thời tiết do quần xã chi phối và chỉ thuộc về render, nên nó không bao giờ chạm tới sim tất định:

| | | |
|:---:|:---:|:---:|
| ![Trời quang trên Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Trời quang trên the Vale* | ![Mưa trên Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Mưa trên Mirefen Marsh* | ![Tuyết trên Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Tuyết trên Thornpeak Heights* |

## Chơi đi

Bạn có hai cách vào, và chúng đều chạy cùng một thế giới.

### Ngoại tuyến, trên trình duyệt của bạn

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Đặt tên cho nhân vật, chọn bất kỳ class nào trong chín class, và bạn bắt đầu ở **Eastbrook Vale** (cấp 1 đến 7), một thị trấn chợ được bao quanh bởi sáu trung tâm: bãi sói ở phía bắc, đồng cỏ lợn rừng ở phía đông, the Webwood ở phía tây, Mirror Lake ở phía tây bắc, một hầm khai thác đồng của kobold ở phía tây nam, và một nhà nguyện đổ nát đầy kẻ chết không yên ở phía đông bắc, cùng trại cướp của Gorrak ở phía đông nam. Con đường phía bắc leo qua một đèo núi vào **Mirefen Marsh** (6 đến 13, trung tâm Fenbridge) và lên tiếp tới **Thornpeak Heights** (13 đến 20, trung tâm Highwatch). Seed của thế giới được cố định trong `src/main.ts`, nên đây là cùng một nơi mỗi lần ghé thăm.

### Trực tuyến, cùng những người chơi khác

Xem [Tự dựng thế giới của bạn](#host-your-own-world-one-command) bên dưới để dựng trò chơi client/server thật với tài khoản và nhân vật lưu bền.

<a id="host-your-own-world-one-command"></a>

## Tự dựng thế giới của bạn (một lệnh)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Để **lưu trữ từ xa**, đặt ngăn xếp compose lên bất kỳ VPS nào, đặt một `POSTGRES_PASSWORD` thật trong môi trường, và đặt một reverse proxy TLS trước cổng 8787. Caddy chỉ cần hai dòng cho việc này (`your.domain { reverse_proxy localhost:8787 }`); WebSocket được proxy tự động và client tự chọn `wss://` trên các trang https. Các điểm cuối xác thực bị giới hạn tốc độ theo từng IP, mật khẩu được băm bằng scrypt, và token hết hạn sau 7 ngày. Đừng bao giờ đặt `ALLOW_DEV_COMMANDS=1` trong môi trường production, vì nó kích hoạt các gian lận lên cấp và dịch chuyển mà các bot kiểm thử sử dụng. Xem [DEPLOY.md](../../DEPLOY.md) để có hướng dẫn production đầy đủ.

<a id="develop-online-with-hot-reload"></a>

### Phát triển trực tuyến với hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Mở http://localhost:5173, chọn **Play Online**, tạo một tài khoản, tạo một nhân vật, và Enter World. Mở một tab thứ hai và đăng nhập lại để thấy nhau trong thị trấn. `Enter` mở khung chat. Một wiki người chơi MediaWiki thật xuất hiện cùng với ngăn xếp Docker Compose tại http://localhost:8080/wiki/; các trang seed của nó được tạo từ nội dung game hiện tại bằng `npm run wiki:seed`.

Những gì được lưu bền và cách máy chủ giữ quyền kiểm soát:

- **Tài khoản**: mật khẩu băm scrypt và token bearer 7 ngày (`auth_tokens`).
- **Nhân vật**: tối đa 10 mỗi tài khoản; cấp độ, trang bị, túi đồ, nhiệm vụ, talent, vị trí, và tiền được lưu bền dưới dạng JSONB trong Postgres, lưu mỗi 30 giây, khi đăng xuất, và khi máy chủ tắt. Tên là duy nhất trên toàn cục, chỉ gồm chữ cái, theo phong cách kinh điển.
- **Máy chủ giữ quyền quyết định**: client truyền ý định di chuyển và lệnh ở tốc độ 20 Hz; máy chủ chạy một `Sim` chung duy nhất và trả về các snapshot giới hạn theo vùng quan tâm (~120 yd) cộng thêm các sự kiện theo từng người chơi. Mọi lượt roll combat, rớt loot, ghi nhận nhiệm vụ, và giao dịch với người bán đều được giải quyết phía máy chủ. Client là một bộ render.

<a id="train-an-agent-headless-rl"></a>

## Huấn luyện một agent (RL không giao diện)

Cùng một lõi tất định chạy như một môi trường [Gymnasium](https://gymnasium.farama.org/), nên một agent học đối kháng với chính trò chơi thật, chứ không phải một bản tái hiện của nó. Máy chủ env (`headless/env_server.ts`) bọc một `Sim` và trao đổi JSON phân tách bằng dòng mới qua stdio; các ràng buộc Python trong `python/` khởi chạy nó như một tiến trình con và phơi ra vòng lặp `reset` / `step` / `close` thường gặp.

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

- **Không gian quan sát và hành động được suy ra từ nội dung.** Hãy truy vấn chúng từ phản hồi `info` của env lúc khởi động thay vì hard-code; chúng lớn lên cùng trò chơi. Hôm nay không gian hành động là `Discrete(44)` (di chuyển, chọn mục tiêu, tấn công, toàn bộ bộ kỹ năng, tương tác, ăn/uống) và quan sát là một `Box` gồm 276 số thực (bản thân, các kỹ năng, mục tiêu, quái lân cận, vật tương tác gần nhất, tiến độ nhiệm vụ).
- **Phần thưởng** là tổng có trọng số của các delta bộ đếm theo từng tick (XP, sát thương gây ra và nhận vào, số lần giết, số lần chết, tiến độ nhiệm vụ, lên cấp), có thể tinh chỉnh theo mỗi lần reset. Mỗi `step` áp dụng một hành động và mặc định tiến năm tick sim, nên xấp xỉ bốn quyết định trên mỗi giây mô phỏng.
- **Tất định theo thiết kế.** Không có đồng hồ thực, không có `Math.random`. Hãy seed lần reset và tập huấn luyện sẽ phát lại y hệt.

Giao thức và các ràng buộc được tài liệu hóa trong `headless/CLAUDE.md` và `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft mang bản chất web3 xoay quanh **$WOC**, token cộng đồng của chúng tôi trên Solana. Kết nối một ví Solana, liên kết nó với tài khoản của bạn bằng một chữ ký (không giữ tài sản hộ, không có giao dịch nào cần duyệt), và số dư $WOC chỉ đọc của bạn sẽ hiện lên trong HUD cùng với một huy hiệu bậc người nắm giữ mang tính trang trí.

Nó chỉ mang tính trang trí và không cần thiết để chơi. Không có gì bị tiêu hay kiếm được trong game, không có pay-to-win, và toàn bộ trò chơi vẫn chơi tốt mà không cần kết nối ví bao giờ.

**Địa chỉ hợp đồng $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Tìm hiểu thêm về token tại [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Một chuyến tham quan thế giới

### Chín class

Mỗi class dùng cơ chế đúng phong cách vanilla và học các phép có rank trải qua cấp 1 đến 20 (Lightning Bolt R2 ở cấp 8, R3 ở cấp 14, R4 ở cấp 20, với các kỹ năng dải cao như Execute, Kidney Shot, Flash Heal, Stormstrike, và Starfire xuất hiện đúng cấp kinh điển của chúng).

- **Warrior**: rage, Heroic Strike (kích hoạt ở đòn đánh kế, ngoài GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (proc khi né).
- **Paladin**: Seal of Righteousness được giải phóng bởi Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (hấp thụ), Hammer of Justice (choáng), Lay on Hands.
- **Hunter**: Auto Shot tầm xa (8 đến 35 yd với vùng chết kinh điển), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip, và một thú cưng có thể thuần hóa từ cấp 10.
- **Rogue**: energy và combo point, Sinister Strike, Eviscerate, Backstab (từ phía sau, dao găm), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (hấp thụ), Renew (HoT), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon (phù phép), Healing Wave, Earth Shock, Lightning Shield (gai), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (kênh dẫn), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life, và bảy quỷ có thể triệu hồi từ Imp đến Doomguard.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form ở cấp 10.

Hồi máu và buff áp lên các thành viên nhóm, hồi máu có thể crit, và khiên hấp thụ thấm sát thương trước khi mất máu. Chuyên hóa qua **ba nhánh talent mỗi class** (Arms/Fury/Protection, Balance/Feral/Restoration, và cứ thế); việc phân bổ được máy chủ xác thực và có thể xuất ra dưới dạng một chuỗi build.

### Dungeon

Cốt truyện the Gravecaller chạy qua bốn instance tinh nhuệ năm người chơi, và một crypt đơn nằm tách sang một bên cho những người thích khám phá.

- **The Hollow Crypt** (5 người chơi) bên dưới the Fallen Chapel: trash tinh nhuệ theo cặp, miniboss Sexton Marrow, và Morthen the Gravecaller, kẻ thả một Shadow Pulse AoE mỗi mười giây. Cửa crypt dịch chuyển nhóm của bạn vào một bản sao instance riêng tư, bản này reset sau năm phút trống người.
- **The Sunken Bastion** (5 người chơi, khoảng cấp 13, đông nam Mirefen): Vael the Mistcaller triệu hồi các đợt Drowned Thralls ở mức 60% và 30% máu.
- **Gravewyrm Sanctum** (5 người chơi, cấp 20, bên dưới Thornpeak): ba phòng boneguard và drakonid tinh nhuệ, Korgath the Bound (nổi điên khi dưới 30%), Grand Necromancer Velkhar, và Korzul the Gravewyrm, nơi rớt vũ khí epic.
- **The Drowned Temple** (5 người chơi) qua cổng trăng Glimmermere: một instance nhợt nhạt, tím trăng dẫn tới Choirmother Selthe rồi tới Ysolei, Avatar of the Drowned Moon, kẻ tỏa Lunar Tide mỗi chín giây và triệu hồi Moonspawn ở mức 60% và 30%.
- **The Abandoned Crypt** (đơn) trong Thornpeak: một chuyến lặn yên tĩnh với chìa khóa và nhật ký cho một người, dấu vết của nó mở khóa cánh cửa hoàng gia dẫn tới **Nythraxis, Scourge of Thornpeak**, một màn kết raid mười người chơi giao tranh qua ba viên đá trấn linh hồn.

Các chuỗi nhiệm vụ dẫn vào đều có thể chơi đơn, nên cốt truyện không bao giờ bị chặn sau việc tìm nhóm. Đợt raid năm bot tự động của chúng tôi (warrior, paladin, priest, mage, hunter với AI tập trung hỏa lực và hồi máu) dọn sạch the Hollow Crypt trong khoảng năm phút (`node scripts/crypt_raid.mjs`, cần `ALLOW_DEV_COMMANDS=1`).

### Delve

Delve là một chế độ nhóm nhỏ có thể scale riêng biệt cho một hoặc hai người chơi. **The Collapsed Reliquary** (cấp 7 trở lên) là một crypt được dựng lại từ các phòng ngẫu nhiên ở mỗi lượt chơi, kết thúc tại Deacon Varric. Chơi đơn thì một bạn đồng hành AI, Tessa, sẽ chiến đấu bên cạnh bạn. Brother Halven tại tàn tích thánh tích điều hành bảng delve, nơi Normal hay Heroic là tùy bạn: Heroic nâng cấp độ kẻ thù và thêm một affix ngẫu nhiên để có phần thưởng hậu hĩnh hơn.

### The Ashen Coliseum (PvP xếp hạng)

Nhấn `G` hoặc nút đấu trường để vào hàng chờ. Ghép trận dịch chuyển các đấu sĩ vào một hố đấu riêng tư rọi ánh đuốc, một đếm ngược ngắn hồi máu và reset mọi người cho một khởi đầu công bằng, và trận đấu kết thúc khi một bên đầu hàng ở mức 1 hp. Không ai chết, và bạn quay về đúng nơi đã vào hàng chờ.

- **Bảng xếp hạng 1v1 và 2v2**, mỗi bảng có một rating kiểu Elo lưu bền (ai cũng bắt đầu ở 1500) và một bảng xếp hạng mọi thời đại (`GET /api/arena/leaderboard`).
- **2v2 Fiesta**, một chế độ nhóm sôi động hơn: đội nào hạ gục mười lăm lần trước thì thắng trong giới hạn sáu phút, người chơi hồi sinh theo các bộ đếm thời gian tăng dần, các vật phẩm tăng lực rớt sức mạnh qua ba đợt, và một vòng tròn khép lại ép trận chiến dồn vào nhau.

### Chơi cùng nhau

- **Nhóm** tối đa 5: chuột phải vào một người chơi và Invite to Party. Các thành viên chia sẻ quyền tap và ghi nhận nhiệm vụ, chia XP với các thưởng nhóm vanilla thật (1.166 / 1.3 / 1.43 cho 3/4/5), và hiện lên như các chấm trên minimap. `/p` cho chat nhóm, `/roll` để phân xử loot.
- **Giao dịch**: chuột phải và Trade. Cả hai bên đặt vật phẩm và tiền, cả hai phải chấp nhận, và việc trao đổi là nguyên tử và được máy chủ xác thực. Vật phẩm nhiệm vụ không thể giao dịch, và đi tách ra sẽ hủy.
- **Đấu tay đôi**: chuột phải và Challenge to a Duel. Một đếm ngược 3 giây, rồi đánh cho tới khi một bên còn 1 hp; người thắng được thông báo toàn vùng và chạy ra xa 60 yard sẽ bị xử thua.
- **Quyền tap và trạng thái vắng mặt**: người chơi đầu tiên gây sát thương lên một con quái sở hữu loot, XP, và ghi nhận nhiệm vụ của nó; `/afk` và `/dnd` đánh dấu bạn vắng mặt với một câu trả lời tự động cho các lời thì thầm.

### Thế giới và các hệ thống

- **Ăn và uống**: ngồi để hồi phục trong hơn 18 giây, bị ngắt khi nhận sát thương hoặc khi đứng dậy, và đúng vậy, bạn có thể vừa ăn vừa uống cùng lúc.
- **Người bán** mua thức ăn và nước và bán trang bị trắng tử tế, với tiền hiển thị bằng vàng, bạc, và đồng.
- **AI của quái**: lang thang, aggro theo khoảng cách dựa trên chênh lệch cấp, kéo theo bầy, đuổi, leash và reset, loot xác, và respawn, với một rare spawn (Old Greyjaw) trên một bộ đếm thời gian dài.
- **Câu cá** có các bảng loot riêng và những mẻ hiếm.
- **Skin trang trí** roll ra ở độ hiếm uncommon, rare, và epic, hoàn toàn để ngắm.
- **Cái chết và hồi phục**: giải phóng linh hồn về nghĩa địa, nhận sát thương rơi ngã, và chậm lại khi bơi.
- **Thời tiết theo quần xã**: trời quang ở the Vale, mưa ở the Marsh, tuyết trên the Peaks, hòa tan chuyển cảnh khi bạn di chuyển giữa các vùng.

### Điều khiển (bố cục kinh điển)

| Phím | Hành động |
|---|---|
| `W` / `S` | chạy / lùi. `A`/`D` xoay (strafe khi giữ chuột phải), `Q`/`E` strafe |
| kéo phải / kéo trái | mouselook / xoay camera quanh trục. Lăn để zoom, `Space` để nhảy |
| `Tab` | luân chuyển qua các kẻ thù gần nhất. chuột trái để chọn mục tiêu, chuột phải để tấn công, loot, hoặc nói chuyện |
| `1`-`9`, `0`, `-`, `=` | thanh hành động |
| `F` | tương tác (loot một xác, nhặt một vật, nói chuyện) |
| `C` `P` `L` `M` `B` `G` | nhân vật, sách phép, nhật ký nhiệm vụ, bản đồ thế giới, túi đồ, đấu trường |
| `V` / `R` / `Esc` | nameplate, tự chạy, đóng cửa sổ hoặc bỏ chọn mục tiêu |

Điều khiển cảm ứng (một cần di chuyển, kéo camera, và các nút hành động trên màn hình) tự động hiện lên trên thiết bị di động.

## Kiến trúc (một sim, ba host)

Ba ý tưởng giữ cho dự án gắn kết với nhau:

- **Một sim, ba host.** Cùng một mã `src/sim/` chạy thế giới ngoại tuyến trên trình duyệt, máy chủ trực tuyến, và env RL. Hành vi phải giống hệt nhau ở mọi nơi, và các bài kiểm thử tồn tại để giữ điều đó.
- **`IWorld` là mối nối duy nhất.** `src/world_api.ts` định nghĩa `IWorld`. `Sim` ngoại tuyến thỏa mãn nó về mặt cấu trúc và `ClientWorld` trực tuyến hiện thực nó bằng cách phản chiếu các snapshot của máy chủ. Bộ render và HUD chỉ nói chuyện với `IWorld`, không bao giờ với một world cụ thể, nên một tính năng mới mở rộng giao diện trước rồi mới tới cả hai world.
- **Máy chủ giữ quyền quyết định.** Client gửi ý định; máy chủ quyết định kết quả. Client không bao giờ tự giải quyết combat, loot, hay kinh tế.

Sim là một tick 20 Hz cố định (`DT = 1/20`), mọi tính ngẫu nhiên chảy qua một `Rng` được seed duy nhất, và `src/sim/` không mang import DOM, trình duyệt, hay Three.js nào. Đó là điều cho phép cùng một mã đóng gói vào một máy chủ env Node, một vòng lặp game giữ quyền quyết định, và một tab trình duyệt mà không đổi một dòng nào.

### Bố cục dự án

| Đường dẫn | Đây là gì |
|---|---|
| `src/sim/` | Lõi game tất định, nguồn chân lý. Không phụ thuộc DOM hay Three. |
| `src/sim/content/` | Dữ liệu dạng mã: chín class, các kỹ năng, vùng đất, dungeon, vật phẩm, talent. |
| `src/render/` | Bộ render Three.js (hình học procedural, texture, VFX). Đọc thế giới, không bao giờ thay đổi nó. |
| `src/game/` | Đầu vào cục bộ, camera, gán phím, điều khiển di động, WebAudio procedural. |
| `src/ui/` | HUD kinh điển (khung, cửa sổ, tooltip, bản đồ, văn bản combat nổi), biểu tượng procedural, i18n. |
| `src/net/` | Client trực tuyến: xác thực REST cộng thêm một bản phản chiếu thế giới WebSocket (`ClientWorld`). |
| `src/admin/` | SPA bảng điều khiển quản trị (mục `admin.html` riêng). |
| `server/` | Máy chủ giữ quyền quyết định: HTTP và WS, vòng lặp thế giới, Postgres, xác thực, xã hội, kiểm duyệt. |
| `headless/` + `python/` | Máy chủ env RL (`env_server.ts`) và các ràng buộc Python Gym. |
| `tests/` | Bộ Vitest. |
| `scripts/` | Build tài nguyên cộng thêm các script E2E trình duyệt, ảnh chụp màn hình, và tích hợp. |
| `public/` · `docs/` | Tài nguyên tĩnh (mô hình GLB, texture, HDRI) và tài liệu thiết kế. |

Hầu hết các thư mục đều mang `CLAUDE.md` riêng với các quy ước cục bộ. Toàn bộ tập các bất biến của dự án nằm trong [`CLAUDE.md`](../../CLAUDE.md) ở gốc.

## Dựng như các tựa kinh điển

Combat, lên cấp, và threat đều chạy theo luật đúng thời kinh điển: rage và energy, bảng hit và dodge, giảm trừ giáp, đường cong XP thật, bộ đếm đòn đánh, và global cooldown. Cảm giác đúng như bạn nhớ chứ không phải xấp xỉ nó. Những con số chính xác nằm trong `src/sim/` nếu bạn muốn đọc chúng.

Và gần như không có gì trong đó là tài nguyên đóng gói sẵn. Thế giới được vẽ ra từ mã:

- Thị trấn, sinh vật, địa hình, nước, thời tiết, và bóng đổ thời gian thực procedural, không có tệp mô hình 3D nào cho thế giới.
- Mười hai họ sinh vật được rig với đầy đủ animation đi, tấn công, niệm phép, ngồi, và chết.
- Biểu tượng phép, vật phẩm, và buff vẽ trên canvas lúc chạy.
- Một HUD kinh điển hoàn chỉnh (khung đơn vị, thanh hành động, tooltip, nhật ký nhiệm vụ, bản đồ thế giới, minimap, văn bản combat nổi) và WebAudio procedural cho mọi âm thanh.

## Phát triển

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

Các bài kiểm thử logic và unit dùng Vitest. Khi lặp đi lặp lại, hãy chạy một tệp đơn: `npx vitest run tests/sim.test.ts`. Các script E2E và visual điều khiển trình duyệt thật qua `puppeteer-core` và cần `npm run dev` đang chạy (thường cả `npm run server` nữa). Các agent trình duyệt có thể điều khiển di chuyển qua `window.__game.controller` thay vì mô phỏng các phím được giữ, ví dụ `controller.move({ forward: true }, facingRadians)` hoặc các cờ gọn như `{ f: 1, sr: 1 }`.

Để biết các lệnh máy chủ xem [Phát triển trực tuyến](#develop-online-with-hot-reload) ở trên, [DEPLOY.md](../../DEPLOY.md) cho production, và [CREDITS.md](../../CREDITS.md) cho giấy phép tài nguyên.

## Bản địa hóa

Mọi chuỗi hiển thị với người chơi đều phân giải qua `t()`, và trò chơi xuất xưởng với **21 ngôn ngữ** (English, hai bản Spanish, hai bản French, English Canada, Italian, German, Chinese Giản thể và Phồn thể, Korean, Japanese, Brazilian Portuguese, Russian, Dutch, Polish, Indonesian, Turkish, Swedish, Vietnamese, và Danish). Sim và máy chủ giữ tính trung lập về ngôn ngữ: chúng phát ra các key ổn định hoặc English mà client bản địa hóa lại tại ranh giới, điều này giữ nguyên tính tất định. Người đóng góp chỉ thêm English; người bảo trì sẽ điền hàng loạt các ngôn ngữ khác trước mỗi lần phát hành. Quy trình được tài liệu hóa trong `docs/i18n-scaling/translation-workflow.md`.

## Đóng góp

Mọi kiểu đóng góp đều được hoan nghênh: mã, bản dịch, báo cáo lỗi, và tài liệu. Hãy bắt đầu với [CONTRIBUTING.md](CONTRIBUTING.vi_VN.md) để thiết lập, đọc [Quy tắc ứng xử](../../CODE_OF_CONDUCT.md), và xem [SECURITY.md](../../SECURITY.md) trước khi báo cáo một lỗ hổng. Mới ở đây? Hãy tìm các issue được gắn nhãn [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), mở một [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), hoặc chào một tiếng trên [Discord](https://discord.com/invite/worldofclaudecraft).

<div align="center">

![World of Claude](../../worldofclaude.png)

![Cộng đồng World of ClaudeCraft](../../woc_community.png)

</div>

## Giấy phép

Mã được [cấp phép MIT](../../LICENSE), nên cứ fork nó, remix nó, và tự dựng thế giới của bạn.

Các tài nguyên nghệ thuật bên thứ ba được đóng gói kèm (mô hình, texture, HDRI) giữ giấy phép riêng của chúng, tất cả đều CC0 thuộc phạm vi công cộng ngoại trừ các water normal map cấp phép MIT, được tài liệu hóa theo từng gói trong [CREDITS.md](../../CREDITS.md).
