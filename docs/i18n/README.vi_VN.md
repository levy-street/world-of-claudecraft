<div align="center">

# World of ClaudeCraft

**Nhận nhiệm vụ, lập nhóm và raid một thế giới được dựng thủ công, miễn phí ngay trên trình duyệt. Mã nguồn mở, web3 và trực tuyến ngay bây giờ.**

**Trang web chính thức: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.32.3-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.vi_VN.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · **Tiếng Việt** · [Dansk](README.da_DK.md)

[Chơi ngay](https://worldofclaudecraft.com/) · [Tự dựng thế giới của bạn](#host-your-own-world-one-command) · [Huấn luyện một agent](#train-an-agent-headless-rl) · [Web3](#web3) · [Đóng góp](CONTRIBUTING.vi_VN.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Màn hình tiêu đề World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Đây là gì

World of ClaudeCraft là một tựa MMO thời kinh điển hoàn chỉnh mà bạn có thể chơi ngay bây giờ trên trình duyệt, tự dựng với một lệnh duy nhất, và thậm chí còn huấn luyện được các agent AI để chơi. Trò chơi miễn phí, mã nguồn mở, và đang chạy trực tiếp tại [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Một thế giới chung chạy ở ba nơi, tất cả đều từ cùng một lõi game:

- **máy chủ multiplayer giữ quyền quyết định**, thế giới sống động bạn chơi tại worldofclaudecraft.com, nơi các tài khoản lưu trên Postgres cùng chia sẻ một realm bền vững,
- **thế giới ngoại tuyến trên trình duyệt**, một Sim đơn người chơi cục bộ mà bạn có được từ máy chủ dev, hữu ích cho việc phát triển và để đọc lõi game từ đầu đến cuối,
- **môi trường RL không giao diện**, nơi Python điều khiển trò chơi thật qua giao diện Gym.

Cùng một seed, cùng một thế giới, ở mọi nơi. Phần lớn những gì bạn thấy vẫn được vẽ ra từ mã lúc chạy, phần còn lại là một bộ tài nguyên được tuyển chọn đi kèm dự án, nên một bản fork chạy được ngay.

## Điểm nổi bật

- **Chín class kinh điển**, mỗi class có một bộ kỹ năng đầy đủ theo phong cách thời kinh điển, lên rank khi bạn lên cấp, cùng một **hệ thống talent** đầy đủ (ba spec mỗi class, tổng cộng 27 spec).
- **Ba vùng đất mở** từ cấp 1 đến 20, hơn 90 nhiệm vụ, và một cốt truyện liền mạch xoay quanh âm mưu Gravecaller.
- **Năm dungeon dạng instance**, bốn trong số đó là các raid tinh nhuệ năm người chơi và một crypt đơn, với cơ chế scale tinh nhuệ, cơ chế boss AoE, loot theo nguyên mẫu class gom lại thành các bộ tier, và một **bậc độ khó Heroic** với phần thưởng hậu hĩnh hơn, cộng thêm các **world boss** ngoài thế giới mở và một màn kết raid mười người chơi.
- **Hai delve có thể scale**, một chế độ nhóm nhỏ cho một hoặc hai người chơi cộng thêm một bạn đồng hành AI, được dựng lại từ các phòng ngẫu nhiên qua mỗi lượt chơi, trải qua bậc Normal và Heroic.
- **PvP xếp hạng** trên hai bản đồ đấu trường: bảng xếp hạng 1v1 và 2v2, một chế độ 2v2 Fiesta sôi động hơn, và **Protect Yumi**, một chế độ mục tiêu 3v3 và 5v5. Chơi xếp hạng trả Honor, thứ mua được một bộ trang bị chỉ dành cho PvP và không bao giờ vượt mặt loot dungeon trong PvE.
- **The Vale Cup**, một giải boarball chơi trong sân vận động riêng ở phía nam Eastbrook, và **Card Duel**, một trò chơi bài đối đầu nhanh gọn tổ chức trong thị trấn.
- **Một Book of Deeds**: nhật ký thành tựu gồm các danh hiệu trang trí, viền huy hiệu, và Renown, với Chronicle theo từng vùng do các NPC Chronicler trong thế giới lưu giữ và một bảng xếp hạng trọn đời.
- **Một nền kinh tế nghề sâu sắc**: bốn nghề thu thập nuôi mười nghề chế tạo, từ nấu ăn và giả kim tới chế tác trang sức, rèn vũ khí, và phù phép, với công cụ theo bậc, bàn chế tác trong thị trấn, phẩm chất masterwork, và các đơn đặt hàng, tất cả đổ về một **World Market** do người chơi vận hành và dịch vụ thư **Ravenpost**.
- **Multiplayer thực thụ**: nhóm và raid, guild, giao dịch, đấu tay đôi, quyền tap, chia XP trong nhóm, lời thì thầm, trạng thái vắng mặt, và một **Dungeon Finder** với hàng chờ theo vai trò và danh sách nhóm dựng sẵn.
- **Được viết bằng mã, không phải trong trình biên tập 3D**: địa hình, nước, thời tiết, bố cục thị trấn, bóng đổ thời gian thực, và hiệu ứng đều được tạo ra lúc chạy, còn các mô hình có đi kèm thì được dựng bởi các nhà máy procedural và một thư viện tài nguyên tuyển chọn chứ không phải nặn tay.
- **Bản địa hóa sang 22 ngôn ngữ** thông qua một pipeline tất định, sim-phát-ra-key.
- **Một wiki đồng hành tại `/wiki`**, sinh thẳng từ nội dung game sống nên nó không thể lệch khỏi thế giới mà nó mô tả.
- **Ứng dụng gốc trên mọi nền tảng**: trình cài đặt desktop có ký số cho Windows, Linux, và macOS với cập nhật tự động và tùy chọn phản chiếu thành tựu Steam, cộng thêm bản dựng iOS và Android, tất cả dùng chung client trình duyệt và cùng một thế giới trực tuyến.
- **Co giãn theo cỗ máy bạn có**: các preset đồ họa và một bộ điều tiết khung hình tự động đánh đổi độ phong phú hình ảnh lấy sự mượt mà, và bị ràng buộc bởi một luật công bằng ngăn chúng che giấu bất cứ thứ gì người chơi phải phản ứng.
- **Môi trường RL không giao diện** với các ràng buộc Gymnasium, định hình phần thưởng, và một chế độ benchmark.
- **Tiện ích $WOC, hoàn toàn tùy chọn**: liên kết một ví Solana để có huy hiệu người nắm giữ, Daily Rewards, và một tùy chọn thanh toán được giảm giá trong cửa hàng trang trí. Trò chơi vẫn miễn phí và không giữ tài sản hộ.
- **Season 1 Armory**: sưu tầm các skin vũ khí trang trí qua WOC Store, dùng Claudium mua bằng tiền pháp định, SOL, USDC, hoặc $WOC. Đồ trang trí không bao giờ mang lại sức mạnh chiến đấu.

## Ảnh chụp màn hình

![Quảng trường thị trấn Eastbrook, đống lửa trại và những người giao nhiệm vụ](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Hoàng hôn bên đống lửa trại Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Hoàng hôn bên đống lửa trại Eastbrook* | ![Kéo quái tinh nhuệ trong the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Kéo quái tinh nhuệ dưới ánh đuốc trong the Hollow Crypt* |
| ![Những kẻ chết không yên ở nhà nguyện đổ nát](../../docs/screenshots/restless-dead.jpg)<br>*Những kẻ chết không yên ở nhà nguyện đổ nát* | ![Một trận hỗn chiến với Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*Bị áp đảo quân số tại trại cướp* |
| ![Old Greyjaw bị truy đuổi trên con đường phía bắc](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, quái rare spawn, bị truy đuổi trên con đường phía bắc* | ![Giao diện người bán và túi đồ](../../docs/screenshots/vendor-and-bags.jpg)<br>*Sắm sửa tại chỗ của Trader Wilkes, với cửa sổ người bán và túi đồ đang mở* |
| ![Cổng trăng trên bờ Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Những kẻ chết đuối leo lên tại cổng trăng Glimmermere* | ![Ysolei trên bàn thờ của the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest và bàn thờ của the Drowned Temple* |

Thời tiết do quần xã chi phối và chỉ thuộc về render, nên nó không bao giờ chạm tới sim tất định:

| | | |
|:---:|:---:|:---:|
| ![Trời quang trên Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Trời quang trên the Vale* | ![Mưa trên Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Mưa trên Mirefen Marsh* | ![Tuyết trên Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Tuyết trên Thornpeak Heights* |

## Chơi đi

Chơi trên trình duyệt tại [worldofclaudecraft.com](https://worldofclaudecraft.com/), hoặc cài ứng dụng gốc cho Windows, Linux, macOS, iOS, hoặc Android. Mọi client đều kết nối tới cùng một thế giới trực tuyến.

### Trực tuyến, cùng những người chơi khác

Tạo một tài khoản, tạo một nhân vật, và bước vào thế giới sống động. Để tự chạy đúng bộ client/server đó, xem [Tự dựng thế giới của bạn](#host-your-own-world-one-command) bên dưới.

### Ngoại tuyến, trong máy chủ dev

Chế độ ngoại tuyến là một thế giới đơn người chơi cục bộ không có tài khoản và không có quyền quyết định từ máy chủ, nên nó chỉ đi kèm các bản dựng phát triển. Chạy máy chủ dev và nó sẽ xuất hiện trong bộ chọn chế độ:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Đặt tên cho nhân vật, chọn bất kỳ class nào trong chín class, và bạn bắt đầu ở **Eastbrook Vale** (cấp 1-7), một thị trấn chợ được bao quanh bởi các trung tâm: bãi sói ở phía bắc, đồng cỏ lợn rừng ở phía đông, rừng Sableweb ở phía tây, Mirror Lake ở phía tây bắc, một hầm khai thác đồng đầy burrower ở phía tây nam, và một nhà nguyện đổ nát đầy kẻ chết không yên ở phía đông bắc, cùng trại cướp của Gorrak ở phía đông nam. Con đường phía bắc leo qua một đèo núi vào **Mirefen Marsh** (6-13, trung tâm Fenbridge) và lên tiếp tới **Thornpeak Heights** (13-20, trung tâm Highwatch). Seed của thế giới được cố định trong `src/main.ts`, nên đây là cùng một nơi mỗi lần ghé thăm.

### Ứng dụng desktop cho Windows, Linux, và macOS

World of ClaudeCraft xuất xưởng dưới dạng ứng dụng desktop đầy đủ cho cả ba nền tảng desktop lớn: trình cài đặt Windows có ký số, gói AppImage và deb cho Linux, và bản dựng macOS universal có ký số và công chứng. Chúng dùng cùng client game và cùng thế giới trực tuyến như trình duyệt, với đóng gói gốc và cập nhật tự động.

Đăng nhập trực tuyến chỉ qua Discord và email, đúng như luồng trên web: email/mật khẩu đăng nhập ngay trong ứng dụng, còn "Continue with Discord" mở trình duyệt mặc định của bạn ở trang `/desktop-login`, trang này trả một mã dùng một lần về cho ứng dụng qua một deep link `worldofclaudecraft://` mà ứng dụng đổi lấy một token phiên World of ClaudeCraft bình thường.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Trỏ vỏ ứng dụng tới một API khác bằng `VITE_DESKTOP_API_ORIGIN`, ví dụ một máy chủ cục bộ hoặc một host staging:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Ghi đè origin API production cho các bản dựng staging bằng `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (một giá trị lúc BUILD: nó được nướng vào bundle và đóng dấu vào ứng dụng đã đóng gói, còn các bản đã cài thì bỏ qua nó như một biến môi trường lúc chạy). Steam là một kênh phân phối (cùng một bundle Electron, tải lên qua SteamPipe), và người chơi desktop có thể liên kết một tài khoản Steam để phản chiếu các deed họ kiếm được thành thành tựu Steam; bản thân việc đăng nhập vẫn là email và Discord. Runbook phát hành đầy đủ (ký số, công chứng, xuất bản một bản cập nhật tự động, các depot SteamPipe, việc triển khai máy chủ) nằm ở `docs/desktop-release.md`. iOS và Android xuất xưởng qua Capacitor, với runbook riêng trong `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Tự dựng thế giới của bạn (một lệnh)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Để **lưu trữ từ xa**, đặt ngăn xếp compose lên bất kỳ VPS nào, đặt một `POSTGRES_PASSWORD` thật trong môi trường, và đặt một reverse proxy TLS trước cổng 8787. Caddy chỉ cần vài dòng cho việc này; WebSocket được proxy tự động và client tự chọn `wss://` trên các trang https. Các điểm cuối xác thực bị giới hạn tốc độ, mật khẩu được băm bằng scrypt, và các phiên đăng nhập sẽ hết hạn. Đừng bao giờ đặt `ALLOW_DEV_COMMANDS=1` trong môi trường production, vì nó kích hoạt toàn bộ tập gian lận `/dev`: các gian lận lên cấp và dịch chuyển mà bot kiểm thử sử dụng, cộng thêm cấp vật phẩm, spawn quái, dịch chuyển vào instance, và giao diện lệnh dev trong game. [DEPLOY.md](../../DEPLOY.md) là hướng dẫn production đầy đủ, bao gồm cả cấu hình reverse proxy giữ cho các điểm cuối health và metrics nằm ngoài rìa công khai.

<a id="develop-online-with-hot-reload"></a>

### Phát triển trực tuyến với hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Mở http://localhost:5173, chọn **Play Online**, tạo một tài khoản, tạo một nhân vật, và Enter World. Màn hình chọn nhân vật hiển thị tin tức phát hành mới nhất trong bảng News & Updates, với huy hiệu NEW cho bất cứ thứ gì bạn chưa xem. Mở một tab thứ hai và đăng nhập lại để thấy nhau trong thị trấn. `Enter` mở khung chat. Wiki người chơi chính là Guide trong repo, phục vụ tại http://localhost:5173/wiki và tại `/wiki` trên production; nội dung của nó được sinh từ dữ liệu game hiện tại bằng `npm run wiki:content`.

Những gì được lưu bền và cách máy chủ giữ quyền kiểm soát:

- **Tài khoản**: mật khẩu băm scrypt và token bearer có hạn.
- **Nhân vật**: tối đa 10 mỗi tài khoản trên mỗi realm; cấp độ, trang bị, túi đồ, hầm ngân hàng, nhiệm vụ, talent, nghề, tiến độ PvP và deed, vị trí, và tiền được lưu bền dưới dạng JSONB trong Postgres, lưu theo hẹn giờ, khi đăng xuất, và khi máy chủ tắt. Tên là duy nhất trên mỗi realm và theo phong cách kinh điển.
- **Máy chủ giữ quyền quyết định**: client truyền ý định di chuyển và lệnh ở tốc độ 20 Hz; máy chủ chạy một `Sim` chung duy nhất và trả về các snapshot giới hạn theo vùng quan tâm cộng thêm các sự kiện theo từng người chơi. Mọi lượt roll combat, rớt loot, ghi nhận nhiệm vụ, và giao dịch với người bán đều được giải quyết phía máy chủ. Client là một bộ render.

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

env = WoWClassicEnv(player_class="warrior")   # any of the nine classes
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Không gian quan sát và hành động được suy ra từ nội dung.** Hãy truy vấn chúng từ phản hồi `info` của env lúc khởi động thay vì hard-code; chúng lớn lên cùng trò chơi. Không gian hành động là một `Discrete` bao trùm di chuyển, chọn mục tiêu, tấn công, toàn bộ bộ kỹ năng, tương tác, và ăn/uống; phần quan sát là một `Box` bao trùm bản thân, các kỹ năng, mục tiêu, quái lân cận, vật tương tác gần nhất, và tiến độ nhiệm vụ.
- **Phần thưởng** là tổng có trọng số của các delta bộ đếm theo từng tick (XP, sát thương gây ra và nhận vào, số lần giết, số lần chết, tiến độ nhiệm vụ, lên cấp), có thể tinh chỉnh theo mỗi lần reset. Mỗi `step` áp dụng một hành động và mặc định tiến năm tick sim, nên xấp xỉ bốn quyết định trên mỗi giây mô phỏng.
- **Tất định theo thiết kế.** Không có đồng hồ thực, không có `Math.random`. Hãy seed lần reset và tập huấn luyện sẽ phát lại y hệt.

Giao thức và các ràng buộc được tài liệu hóa trong `headless/CLAUDE.md` và `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft mang bản chất web3 xoay quanh **$WOC**, token cộng đồng của chúng tôi trên Solana. Kết nối một ví Solana, liên kết nó với tài khoản của bạn bằng một chữ ký (không giữ tài sản hộ, không có giao dịch nào cần duyệt), và số dư $WOC chỉ đọc của bạn sẽ hiện lên trong HUD cùng với một huy hiệu bậc người nắm giữ mang tính trang trí.

$WOC cũng có tiện ích tùy chọn trong trò chơi trực tiếp:

- **WOC Store**: mua Claudium, đồng tiền trang trí một chiều, bằng tiền pháp định, SOL, USDC, hoặc $WOC. Kênh thanh toán $WOC được giảm giá so với các kênh còn lại.
- **Season 1 Armory**: tiêu Claudium vào các bộ sưu tập skin vũ khí trang trí. Các giao dịch mua trong cửa hàng không thêm chỉ số hay sức mạnh chiến đấu.
- **Daily Rewards**: những người nắm giữ đã xác minh và đủ điều kiện có thể kiếm điểm qua một lượt quay mỗi ngày và các nhiệm vụ luân phiên, rồi cạnh tranh giành một phần quỹ thưởng hằng ngày.

Không có thứ nào trong số này là cần thiết để chơi. Việc liên kết ví là tùy chọn và không giữ tài sản hộ, không có pay-to-win, và toàn bộ trò chơi vẫn chơi tốt mà không cần kết nối ví bao giờ.

**Địa chỉ hợp đồng $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Tìm hiểu thêm về token tại [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Một chuyến tham quan thế giới

### Chín class

Mỗi class chạy trên cơ chế MMO thời kinh điển được hiện thực từ những nguyên lý đầu tiên, và học các phép có rank trải qua cấp 1-20, với các kỹ năng đặc trưng như Low Blow, Early Grave, Skyfall, Urgent Prayer, và Ancestral Strike mở khóa dần ở nửa sau chặng leo cấp.

- **Warrior**: rage, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (một hiệu ứng chảy máu bám theo các đòn đánh của bạn), Widening Arc, Hobbling Cut, Blood Toll, Redhand (proc khi né).
- **Paladin**: Oathbrand được giải phóng bởi Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (hấp thụ), Sundering Gavel (choáng), Last Rite.
- **Hunter**: đánh thường tầm xa (8-35 yd với vùng chết theo phong cách kinh điển), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash, và một thú cưng có thể thuần hóa từ cấp 10.
- **Rogue**: energy và combo point, Wicked Slash, Dirt Nap, Craven Thrust (từ phía sau, dao găm), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (hấp thụ), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (phù phép), Mending Waters, Earthen Jolt, Thunder Ward (gai), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (kênh dẫn), Bewitch, Icebind, một thủy nguyên tố được triệu hồi, và Chronomancy, một spec hồi máu dùng ma thuật thời gian.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume, và bảy quỷ có thể triệu hồi từ Emberkin đến Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots, và biến hình thành Wolf Form ở cấp 5, Bruin Form ở cấp 8, và Moonwing Form ở cấp 10.

Hồi máu và buff áp lên các thành viên nhóm, hồi máu có thể crit, và khiên hấp thụ thấm sát thương trước khi mất máu. Chuyên hóa qua **ba nhánh talent mỗi class** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, và cứ thế); việc phân bổ được máy chủ xác thực và có thể xuất ra dưới dạng một chuỗi build.

### Dungeon

Cốt truyện Gravecaller chạy qua ba instance tinh nhuệ năm người chơi, một instance thứ tư chờ sau một cổng trăng với truyền thuyết chết đuối của riêng nó, và một crypt đơn nằm tách sang một bên cho những người thích khám phá.

- **The Hollow Crypt** (5 người chơi) bên dưới the Fallen Chapel: trash tinh nhuệ theo cặp, miniboss Sexton Marrow, và Morthen the Gravecaller cùng đòn AoE bóng tối lặp lại của hắn. Cửa crypt dịch chuyển nhóm của bạn vào một bản sao instance riêng tư, bản này reset khi không còn ai bên trong.
- **The Sunken Bastion** (5 người chơi, khoảng cấp 13, đông nam Mirefen): Vael the Fogbinder triệu hồi các đợt Drowned Thralls khi trận đấu kéo dài.
- **Gravewyrm Sanctum** (5 người chơi, cấp 20, bên dưới Thornpeak): ba phòng boneguard và scaleguard tinh nhuệ, Korgath the Bound, Grand Necromancer Velkhar, và Korzul the Gravewyrm, nơi rớt vũ khí epic.
- **The Drowned Temple** (5 người chơi) qua cổng trăng Glimmermere: một instance nhợt nhạt, tím trăng dẫn tới Choirmother Selthe rồi tới Ysolei, Avatar of the Drowned Moon, kẻ có những con nước trăng và bầy Moonspawn triệu hồi trừng phạt một nhóm đứng yên.
- **The Abandoned Crypt** (đơn) trong Thornpeak: một chuyến lặn yên tĩnh với chìa khóa và nhật ký cho một người, dấu vết của nó mở khóa cánh cửa hoàng gia dẫn tới **Nythraxis, Scourge of Thornpeak**, một màn kết raid mười người chơi giao tranh qua ba viên đá trấn linh hồn.

Mọi instance cũng chạy được ở **Heroic**: kẻ thù cấp cao hơn, cơ chế gắt hơn, và loot cùng đồng tiền người bán riêng. Các chuỗi nhiệm vụ dẫn vào đều có thể chơi đơn, nên cốt truyện không bao giờ bị chặn sau việc tìm nhóm. Đợt raid năm bot tự động của chúng tôi (warrior, paladin, priest, mage, hunter với AI tập trung hỏa lực và hồi máu) dọn sạch the Hollow Crypt trong khoảng năm phút (`node scripts/crypt_raid.mjs`, cần `ALLOW_DEV_COMMANDS=1`).

### Delve

Delve là một chế độ nhóm nhỏ có thể scale riêng biệt cho một hoặc hai người chơi, được dựng lại từ các phòng ngẫu nhiên ở mỗi lượt chơi và kết thúc tại một rương thánh tích bị khóa, mở ra qua một minigame cạy khóa chứ không phải một lượt roll loot. **The Collapsed Reliquary** (cấp 7 trở lên) kết thúc tại Deacon Varric, với một bạn đồng hành AI, Tessa, chiến đấu bên cạnh bạn nếu bạn đi một mình. **The Drowned Litany** (cấp 12 trở lên) lần theo dấu vết vào một ngôi đền ngập nước ở rìa Mirefen Marsh. Một bảng delve đặt bậc chơi: Heroic nâng cấp độ kẻ thù và thêm một affix ngẫu nhiên để có phần thưởng hậu hĩnh hơn.

### PvP xếp hạng (the Ashen Coliseum)

Nhấn `G` hoặc nút đấu trường để vào hàng chờ. Ghép trận dịch chuyển các đấu sĩ vào một hố đấu riêng tư, một đếm ngược ngắn hồi máu và reset mọi người cho một khởi đầu công bằng, và trận đấu kết thúc khi một bên đầu hàng. Không ai chết, và bạn quay về đúng nơi đã vào hàng chờ. Protect Yumi diễn ra trong mê cung riêng của nó chứ không phải hố đấu Coliseum.

- **Bảng xếp hạng 1v1 và 2v2**, mỗi bảng có một rating kiểu Elo lưu bền và một bảng xếp hạng mọi thời đại.
- **2v2 Fiesta**, một chế độ nhóm sôi động hơn, nơi các đội đua tới một mốc hạ gục trong khi các vật phẩm tăng lực rớt sức mạnh và một vòng tròn khép lại ép trận chiến dồn vào nhau.
- **Protect Yumi**, một chế độ mục tiêu 3v3 và 5v5 không xếp hạng, chơi trong một mê cung: mỗi đội canh giữ một mèo linh thú trong khi cố hạ con của đối phương, nên việc hộ tống và bắt lẻ quan trọng hơn số mạng thuần túy.

Chiến thắng xếp hạng và các pha hạ gục trong Fiesta trả **Honor**, thứ mà quân nhu quan trong thị trấn đổi lấy một bộ trang bị Warfare. Warfare là một chỉ số chỉ dành cho PvP, nên bộ đồ này thắng các trận đấu tay đôi mà không bao giờ vượt mặt loot dungeon cùng bậc trong PvE.

### Chơi cùng nhau

- **Dungeon Finder**: mở nó bằng `Shift+I` để duyệt các dungeon và raid, xem trước boss và loot, tham gia một hàng chờ vai trò tank/healer/DPS tự động, hoặc tạo một danh sách nhóm dựng sẵn. Các nhóm do Finder tạo vẫn cùng nhau đi tới lối vào.
- **Nhóm** tối đa 5, chuyển thành một raid 10 người chơi gồm hai nhóm khi đã đầy: chuột phải vào một người chơi và Invite to Party. Các thành viên chia sẻ quyền tap và ghi nhận nhiệm vụ, chia XP với các thưởng nhóm thời kinh điển, và hiện lên như các chấm trên minimap. `/p` cho chat nhóm, `/roll` để phân xử loot.
- **Giao dịch**: chuột phải và Trade. Cả hai bên đặt vật phẩm và tiền, cả hai phải chấp nhận, và việc trao đổi là nguyên tử và được máy chủ xác thực. Vật phẩm nhiệm vụ không thể giao dịch, và đi tách ra sẽ hủy.
- **Đấu tay đôi**: chuột phải và Challenge to a Duel. Một đếm ngược 3 giây, rồi đánh cho tới khi một bên còn 1 hp; người thắng được thông báo toàn vùng và chạy ra xa 60 yard sẽ bị xử thua.
- **Quyền tap và trạng thái vắng mặt**: người chơi đầu tiên gây sát thương lên một con quái sở hữu loot, XP, và ghi nhận nhiệm vụ của nó; `/afk` và `/dnd` đánh dấu bạn vắng mặt với một câu trả lời tự động cho các lời thì thầm.

### Thế giới và các hệ thống

- **Nghề nghiệp** (`Shift+P`): bốn nghề thu thập (khai khoáng, đốn gỗ, hái thảo dược, câu cá) nuôi mười nghề chế tạo, từ nấu ăn và giả kim tới rèn vũ khí, chế tác trang sức, và phù phép. Công cụ thu thập có nhiều bậc quyết định bạn khai thác được node nào, việc chế tạo diễn ra tại các bàn chế tác trong thị trấn với cơ hội đạt phẩm chất masterwork mang dấu ấn của người làm ra nó, và có một hệ thống nguyên mẫu để khám phá khi bạn chuyên sâu.
- **The World Market**: một nhà đấu giá do người chơi vận hành cho trang bị, nguyên liệu, và vật phẩm tiêu hao, duyệt được từ các thị trấn trung tâm.
- **Thư Ravenpost**: gửi vật phẩm và tiền cho các nhân vật khác, với phần đính kèm được giữ an toàn cho tới khi nhận.
- **Guild**: hiến chương, danh sách thành viên, cấp bậc, và chat guild.
- **The Guide**: một wiki tìm kiếm được ngay trong trang tại `/wiki`, bao quát các class, sinh vật, vùng đất, và deed, sinh thẳng từ nội dung game sống nên nó không thể lệch khỏi thế giới mà nó mô tả.
- **The Vale Cup và Card Duel**: boarball tại sân vận động Sowfield phía nam Eastbrook, ở các thể thức từ 1v1 tới 5v5, và một trò chơi bài đối đầu nhanh gọn do Card Master trong thị trấn tổ chức.
- **Daily Rewards**: những người nắm giữ $WOC đã xác minh có thể kiếm điểm bảng xếp hạng từ một lượt quay mỗi ngày và các nhiệm vụ luân phiên, với chi trả tự động từ quỹ thưởng hằng ngày.
- **WOC Store và Season 1 Armory**: mua Claudium bằng tiền pháp định, SOL, USDC, hoặc $WOC, rồi tiêu nó vào các skin vũ khí thuần túy trang trí.
- **Ăn và uống**: ngồi để hồi phục, bị ngắt khi nhận sát thương hoặc khi đứng dậy, và đúng vậy, bạn có thể vừa ăn vừa uống cùng lúc.
- **Người bán** mua thức ăn và nước và bán trang bị trắng tử tế, với tiền hiển thị bằng vàng, bạc, và đồng.
- **Một ngân hàng cá nhân** (the Gilded Strongbox): các thủ quỹ ở mỗi thị trấn trung tâm giữ một hầm cho mỗi nhân vật, từ 24 ô lên tới 96 ô với các lần mở rộng mua bằng tiền, cộng thêm các ô thưởng kiếm được khi trực tuyến nhờ email đã xác minh, tài khoản đã liên kết, và giới thiệu bạn bè.
- **The Book of Deeds**: một nhật ký thành tựu (mặc định `Shift+Z`) gồm nhiệm vụ, số quái giết, số lần dọn dungeon, và những niềm vui nhỏ, trả về các danh hiệu trang trí bạn có thể đeo trên nameplate, trong chat, và trên các bảng xếp hạng, cộng thêm một bộ theo dõi trên HUD cho những deed bạn đang đuổi theo, các Chronicle theo từng vùng do các NPC Chronicler lưu giữ, và một bảng xếp hạng Renown trọn đời; danh sách công khai nằm ở `/wiki/deeds`.
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
| `C` `P` `L` `M` `B` `N` `T` | nhân vật, sách phép, nhật ký nhiệm vụ, bản đồ thế giới, túi đồ, talent, chế tạo |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | đấu trường, bạn bè và guild, bảng xếp hạng, lịch, Vale Cup, Dungeon Finder, nghề nghiệp, deed |
| `Z` / `X` | cất hoặc rút vũ khí, bánh xe emote |
| `V` / `R` / `Esc` | nameplate, tự chạy, đóng cửa sổ trên cùng (hoặc mở menu game) |

Mọi phím gán đều có thể đổi lại trong bảng keybind. Điều khiển cảm ứng (một cần di chuyển, kéo camera, và các nút hành động trên màn hình) tự động hiện lên trên thiết bị di động.

## Kiến trúc (một sim, ba host)

Ba ý tưởng giữ cho dự án gắn kết với nhau:

- **Một sim, ba host.** Cùng một mã `src/sim/` chạy thế giới ngoại tuyến trên trình duyệt, máy chủ trực tuyến, và env RL. Hành vi phải giống hệt nhau ở mọi nơi, và các bài kiểm thử tồn tại để giữ điều đó.
- **`IWorld` là mối nối duy nhất.** `IWorld` được định nghĩa dưới dạng các giao diện facet theo từng miền nằm trong `src/world_api/`, được tổng hợp bởi `src/world_api.ts`. `Sim` ngoại tuyến thỏa mãn nó về mặt cấu trúc và `ClientWorld` trực tuyến hiện thực nó bằng cách phản chiếu các snapshot của máy chủ. Bộ render và HUD chỉ nói chuyện với `IWorld`, không bao giờ với một world cụ thể, nên một tính năng mới mở rộng facet tương ứng trước rồi mới tới cả hai world.
- **Máy chủ giữ quyền quyết định.** Client gửi ý định; máy chủ quyết định kết quả. Client không bao giờ tự giải quyết combat, loot, hay kinh tế.

Sim là một tick 20 Hz cố định (`DT = 1/20`), mọi tính ngẫu nhiên chảy qua một `Rng` được seed duy nhất, và `src/sim/` không mang import DOM, trình duyệt, hay Three.js nào. Đó là điều cho phép cùng một mã đóng gói vào một máy chủ env Node, một vòng lặp game giữ quyền quyết định, và một tab trình duyệt mà không đổi một dòng nào.

### Bố cục dự án

| Đường dẫn | Đây là gì |
|---|---|
| `src/sim/` | Lõi game tất định, nguồn chân lý. Không phụ thuộc DOM hay Three. |
| `src/sim/content/` | Dữ liệu dạng mã: chín class, các kỹ năng, vùng đất, dungeon, delve, vật phẩm, công thức, enchant, talent, nghề nghiệp, deed. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, mối nối mà bộ render và HUD phụ thuộc vào: một giao diện facet cho mỗi miền. |
| `src/` (phần còn lại) | Bộ render Three.js, HUD và style, đầu vào/âm thanh, bản phản chiếu trực tuyến, cùng các SPA admin, guide, và editor. |
| `server/` | Máy chủ giữ quyền quyết định: HTTP và WS, vòng lặp thế giới, Postgres, xác thực, xã hội, kiểm duyệt. |
| `server/http/` | Đường ống yêu cầu REST: bộ định tuyến dạng bảng, middleware, và các định nghĩa route theo từng miền. |
| `headless/` + `python/` | Máy chủ env RL (`env_server.ts`) và các ràng buộc Python Gym. |
| `bot/` | Bot Discord (vai trò, chuyển tiếp, dòng hoạt động). |
| `electron/`, `android/`, `ios/` | Vỏ desktop (Steam) và vỏ di động gốc. |
| `tests/` | Bộ Vitest. |
| `scripts/` | Công cụ build, tài nguyên, i18n, SFX, ảnh chụp màn hình, và E2E trình duyệt. |
| `deploy/` · `mediawiki/` | Tài nguyên khởi động lần đầu cho production và container wiki người chơi. |
| `public/` · `docs/` | Tài nguyên tĩnh (được triển khai nguyên văn lên trang web) và tài liệu thiết kế. |

Không có gì trong số này chỉ dựa trên lòng tin: `tests/architecture.test.ts` quét mọi tệp sim để tìm
một import bị cấm, một biến toàn cục DOM, hay một lời gọi đồng hồ hoặc `Math.random` lạc chỗ, và
`tests/world_api_parity.test.ts` ghim mối nối lại để hai world không thể trôi lệch nhau.

Hầu hết các thư mục đều mang `CLAUDE.md` riêng với các quy ước cục bộ, và toàn bộ tập các bất
biến của dự án nằm trong [`CLAUDE.md`](../../CLAUDE.md) ở gốc. Những người đóng góp là agent hãy
bắt đầu từ đó, rồi lấy điểm vào của runtime tương ứng: [`AGENTS.md`](../../AGENTS.md) cộng thêm
[hướng dẫn vận hành Codex](../codex.md) cho Codex, [`GEMINI.md`](../../GEMINI.md) cho Gemini. Tất
cả đều dẫn về cùng một kiến trúc chuẩn.

## Dựng như các tựa kinh điển

Combat, lên cấp, và threat đều chạy theo luật đúng thời kinh điển: rage và energy, bảng hit và dodge, giảm trừ giáp, đường cong XP thật, bộ đếm đòn đánh, và global cooldown. Cảm giác đúng như bạn nhớ chứ không phải xấp xỉ nó. Những con số chính xác nằm trong `src/sim/` nếu bạn muốn đọc chúng.

Thế giới được viết bằng mã chứ không phải trong một trình biên tập 3D, và đó là điều giữ cho nó
nhỏ gọn, tất định, và dễ fork:

- Địa hình, nước, thời tiết, bầu trời, bố cục thị trấn, bóng đổ thời gian thực, và hiệu ứng combat đều được tạo ra lúc chạy từ chính dữ liệu của sim.
- Các mô hình có đi kèm cũng được dựng theo cách đó: các nhà máy procedural nằm dưới `scripts/assets/` xuất ra các GLB tất định qua pipeline image-to-GLB của dự án, bên cạnh một thư viện bộ mô hình CC0 được tuyển chọn. Các họ sinh vật và nhân vật đã rig mang đầy đủ animation đi, tấn công, niệm phép, ngồi, và chết.
- Biểu tượng là một bộ vẽ nhiều lớp tự dựng hình cho bất cứ thứ gì chưa có tệp đi kèm, nên không bao giờ thiếu biểu tượng, với phần art vẽ tay được tuyển chọn xếp chồng lên trên cho các kỹ năng, vật phẩm, và deed.
- Một HUD kinh điển hoàn chỉnh (khung đơn vị, thanh hành động, tooltip, nhật ký nhiệm vụ, bản đồ thế giới, minimap, văn bản combat nổi, the Book of Deeds), các hiệu ứng âm thanh không gian và giao diện được lấy mẫu, và một nhạc nền soạn theo lối procedural ngay trong repo rồi xuất xưởng dưới dạng các bản remaster phát luồng, hòa tan chuyển cảnh giữa các vùng, thị trấn, dungeon, và combat.

Mọi tài nguyên đi kèm và giấy phép của nó đều được ghi lại trong [CREDITS.md](../../CREDITS.md),
còn các phụ thuộc bên thứ ba được đóng gói kèm mang thông báo của chúng trong
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Phát triển

Ngoài client game, bản build còn tạo ra bảng điều khiển vận hành, trình biên tập thế giới tại
`/editor`, và Guide công khai tại `/wiki`, tất cả đều phục vụ từ cùng một máy chủ dev.

Mọi đường dẫn FFmpeg mà gate và các bài kiểm thử âm thanh sử dụng đều phân giải về các gói npm
`ffmpeg-static`/`ffprobe-static` đi kèm, nên một đóng góp bình thường không cần cài FFmpeg trên hệ
thống. Các đường dẫn đo tuân thủ (`npm run sfx:check`, các bài kiểm thử âm thanh, phần xác thực
xuất của Studio) gắn thẳng vào các binary tĩnh, không có dự phòng `PATH`: hãy chạy lại `npm ci`
nếu một lần cài bỏ qua script khiến chúng bị thiếu. Các tiến trình phát và mã hóa của Studio cùng
bước tiền kiểm của `npm run gate` phân giải qua `scripts/sfx/ffmpeg_paths.mjs`, nơi có dự phòng về
`PATH`. Một vài script sinh âm thanh độc lập (ví dụ `scripts/gen_ui_sfx.mjs`) vẫn mặc định dùng
`ffmpeg` từ `PATH`.

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

Các bài kiểm thử logic và unit dùng Vitest. Khi lặp đi lặp lại, hãy chạy một tệp đơn: `npx vitest run tests/sim.test.ts`. Các thay đổi về giao diện còn có một bộ kiểm thử trình duyệt thật dạng chọn tham gia, bao quát khả năng tiếp cận, điều hướng bằng bàn phím, và kích thước vùng chạm: `npm run test:browser`. Các script ảnh chụp màn hình và smoke điều khiển trình duyệt thật qua `puppeteer-core` và cần `npm run dev` đang chạy; các script ở mức giao thức (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) nói chuyện trực tiếp với máy chủ và cần `npm run server` thay vào đó. Các agent trình duyệt có thể điều khiển di chuyển qua `window.__game.controller` thay vì mô phỏng các phím được giữ, ví dụ `controller.move({ forward: true }, facingRadians)` hoặc các cờ gọn như `{ f: 1, sr: 1 }`.

Các bước kiểm tra chạy theo lớp, được mô tả trong [docs/qa-gate.md](../qa-gate.md): hãy trỏ bản
sao của bạn tới các hook dùng chung bằng `git config core.hooksPath .githooks` và một lớp nền
nhanh sẽ chạy trước khi bất cứ thứ gì rời khỏi máy bạn.

Để biết các lệnh máy chủ xem [Phát triển trực tuyến](#develop-online-with-hot-reload) ở trên,
[CONTRIBUTING.md](CONTRIBUTING.vi_VN.md) cho quy trình đóng góp,
[hướng dẫn SFX Studio](../sfx-studio-tutorial.md) cho việc sáng tác âm thanh và
xuất artifact, [DEPLOY.md](../../DEPLOY.md) cho production, và
[CREDITS.md](../../CREDITS.md) cho giấy phép tài nguyên.

## Bản địa hóa

Mọi chuỗi hiển thị với người chơi đều phân giải qua `t()`, và trò chơi xuất xưởng với **22 ngôn ngữ** (English, hai bản Spanish, hai bản French, English Canada, Italian, German, Chinese Giản thể và Phồn thể, Korean, Japanese, Brazilian Portuguese, Russian, Czech, Dutch, Polish, Indonesian, Turkish, Swedish, Vietnamese, và Danish). Sim và máy chủ giữ tính trung lập về ngôn ngữ: chúng phát ra các key ổn định hoặc English mà client bản địa hóa lại tại ranh giới, điều này giữ nguyên tính tất định. Người đóng góp chỉ thêm English; người bảo trì sẽ điền hàng loạt các ngôn ngữ khác trước mỗi lần phát hành. Quy trình được tài liệu hóa trong `docs/i18n-scaling/translation-workflow.md`.

## Đóng góp

Mọi kiểu đóng góp đều được hoan nghênh: mã, bản dịch, báo cáo lỗi, và tài liệu. Hãy bắt đầu với [CONTRIBUTING.md](CONTRIBUTING.vi_VN.md) để thiết lập, đọc [Quy tắc ứng xử](../../CODE_OF_CONDUCT.md), và xem [SECURITY.md](../../SECURITY.md) trước khi báo cáo một lỗ hổng. Mới ở đây? Hãy tìm các issue được gắn nhãn [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), mở một [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), hoặc chào một tiếng trên [Discord](https://discord.com/invite/worldofclaudecraft).

Việc phát triển đang diễn ra trên nhánh `release/vX.Y.Z` mới nhất. Hãy tra cứu nhánh đó thay vì phỏng đoán, rồi tạo nhánh từ nó và nhắm pull request của bạn vào đó. Đừng bao giờ tạo nhánh từ hay nhắm vào `main`, nhánh chỉ nhận một nhánh phát hành khi phiên bản đó xuất xưởng. [CONTRIBUTING.md](CONTRIBUTING.vi_VN.md) có câu lệnh một dòng giúp tìm ra nhánh hiện tại.

## Giấy phép

**Mã được [cấp phép MIT](../../LICENSE), nên cứ fork nó, remix nó, và tự dựng thế giới của bạn.** Đó là toàn bộ mục đích, và không có gì khác trên trang này hay trên trang web của chúng tôi lấy lại điều đó.

Có ba thứ được cấp phép riêng, nên bỏ ra ba mươi giây để biết thứ nào là thứ nào cũng đáng:

| Cái gì | Giấy phép | Bạn có được phân phối lại không? |
|---|---|---|
| **Mã nguồn**, nghĩa là tất cả trừ các tài nguyên media được tách ra bên dưới | [MIT](../../LICENSE) | Có. Kể cả mục đích thương mại. |
| **Tài nguyên media**: mô hình, texture, HDRI, biểu tượng, âm thanh, phông chữ (phần lớn nằm dưới `public/`) | Theo từng tài nguyên, ghi trong [CREDITS.md](../../CREDITS.md) | Phần lớn là có (đa số là CC0). Một số thì không, xem bên dưới. |
| **Tên và thương hiệu**: "World of ClaudeCraft", "Levy Street", các logo | Không được cấp phép | Không. |

**Cứ fork nó và tự dựng thế giới của bạn. Điều đó chạy được, và các tài nguyên không cản đường bạn.** Phần lớn những gì bạn thấy đều là CC0 thuộc phạm vi công cộng (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), còn các prop, sinh vật, phông nền và âm thanh giao diện do chúng tôi tự sinh ra thì đi kèm dự án nên một bản fork chạy được ngay. Chỉ là bạn không thể bóc chúng ra rồi bán như tác phẩm nghệ thuật độc lập.

Những gì bạn sẽ cần gỡ bỏ hoặc thay thế trước khi phân phối lại:

- các **biểu tượng kỹ năng class của CraftPix** nằm dưới `public/ui/skills/` do Levy Street mua và **không được phép phân phối lại**, nên hãy mua giấy phép riêng nếu bạn muốn đi kèm chúng;
- các **hiệu ứng âm thanh của @jamiecypher** theo giấy phép CC BY-NC 4.0, nên hãy chia sẻ chúng phi thương mại kèm ghi công, còn quyền thương mại chỉ áp dụng cho dự án này;
- **art của cửa hàng và prestige** (Season 1 Armory, bộ Claudium, bộ art nghề nghiệp, các biểu tượng Book of Deeds, huy hiệu rồng tinh nhuệ) là art thương mại đặt hàng riêng và **mọi quyền được bảo lưu**;
- các **nhãn hiệu thương hiệu bên thứ ba** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) là nhãn hiệu của chủ sở hữu chúng và không phải của chúng tôi để cấp phép tiếp;
- một số ít **biểu tượng và bản ghi âm dùng theo sự cho phép** cần được cho phép mới chuyển giao tiếp được.

[CREDITS.md](../../CREDITS.md) là danh sách có thẩm quyền, với một cột phân phối lại cho từng tài nguyên. Ở đâu một tài nguyên được liệt kê trong đó, giấy phép ấy sẽ thắng giấy phép MIT của dự án. Sổ đăng ký ấy vẫn đang được hoàn thiện, nên một tài nguyên media thiếu trong đó là chưa được ghi nhận chứ không phải tự do: hãy hỏi trước khi dựa vào nó. Mã nguồn thì ngược lại, và mọi thứ không bị tách ra đều là MIT.

[Điều khoản dịch vụ](https://worldofclaudecraft.com/terms) của chúng tôi bao trùm trò chơi được lưu trữ mà chúng tôi vận hành tại worldofclaudecraft.com: tài khoản, ứng xử, vật phẩm ảo. Chúng không hạn chế các quyền mà Giấy phép MIT trao cho bạn trong mã nguồn này.
