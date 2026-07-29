<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · **Tiếng Việt** · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Đóng góp cho World of ClaudeCraft

Trước hết, cảm ơn bạn đã có mặt ở đây. World of ClaudeCraft được xây dựng bởi một
cộng đồng những người yêu thích các tựa MMO cổ điển, và mọi đóng góp, dù lớn hay
nhỏ, đều giúp trò chơi tốt hơn. Sửa một lỗi chính tả, dịch trò chơi, báo cáo một
lỗi, dựng nên cả một hầm ngục mới: tất cả đều có giá trị, và bạn được chào đón ở
đây.

Hướng dẫn này sẽ giúp bạn cài đặt và thực hiện đóng góp đầu tiên một cách suôn sẻ.
Bạn không cần phải là chuyên gia. Nếu có điều gì chưa rõ, hãy hỏi trên
[Discord](https://discord.com/invite/worldofclaudecraft) và sẽ có người sẵn lòng giúp đỡ.

Khi tham gia, bạn đồng ý tuân theo [Quy tắc Ứng xử](../../CODE_OF_CONDUCT.md) của
chúng tôi.

## Các cách đóng góp

Ở đây có chỗ cho tất cả mọi người:

- **Mã nguồn.** Sửa một lỗi, thêm một tính năng, hoặc cải thiện hiệu năng. Các vấn
  đề được gắn nhãn
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  và [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  là những điểm khởi đầu tốt.
- **Bản dịch.** Hãy giúp người chơi trên khắp thế giới bằng cách cải thiện hoặc
  hoàn thiện một ngôn ngữ. Xem [Dịch trò chơi](#translating-the-game) bên dưới. Đây
  là một trong những cách khởi đầu dễ nhất và có tác động lớn nhất.
- **Báo cáo lỗi và ý tưởng tính năng.** Hãy mở một [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  Một báo cáo lỗi rõ ràng là một đóng góp thực sự.
- **Tài liệu.** Các hướng dẫn như hướng dẫn này, README, và các tài liệu thiết kế
  trong `docs/` luôn có thể được cải thiện.
- **Chơi thử và phản hồi.** Hãy chơi trò chơi, cho chúng tôi biết điều gì cảm thấy
  chưa ổn, và chia sẻ ý tưởng trên Discord.

## Bắt đầu

Bạn sẽ cần [Node.js 26](https://nodejs.org/) và npm, đúng các phiên bản mà CI và
ảnh production đang dùng. Các bản major cũ hơn chưa được kiểm thử. Đối với máy chủ
nhiều người chơi, bạn cũng sẽ cần [Docker](https://www.docker.com/) để chạy
Postgres.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Point git at the repository hooks (once per clone)
git config core.hooksPath .githooks

# 4. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

Như vậy là đủ để chơi thế giới ngoại tuyến và làm việc trên hầu hết mọi thứ. Để
chạy toàn bộ ngăn xếp trực tuyến, trước tiên bạn cần có một mật khẩu cơ sở dữ liệu
trong môi trường của mình:

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

Nếu bạn định chạy toàn bộ cổng kiểm tra được mô tả bên dưới, hãy cài đặt một lần
trình duyệt mà nó điều khiển: `npx playwright install chromium`.

[README](README.vi_VN.md) có đầy đủ hướng dẫn về cách lưu trữ, phát triển và chơi,
và các tệp `CLAUDE.md` rải rác khắp kho mã ghi lại các quy ước cho từng khu vực.

### Chuỗi công cụ TypeScript

Việc kiểm tra kiểu chạy trên TypeScript 7, trình biên dịch gốc: `npx tsc --noEmit`
hoạt động y hệt như trước và một lượt kiểm tra toàn bộ kho mã giờ chỉ mất vài giây
thay vì hàng chục giây. Bản cài đặt dùng bí danh kép chính thức: gói `typescript`
phân giải sang JS API của TypeScript 6 (thông qua lớp bọc
`@typescript/typescript6`) vì `svelte-check` vẫn còn dùng API đó, trong khi
`@typescript/native` cung cấp tệp nhị phân `tsc`. Những điều cần biết:

- **Trình soạn thảo.** VS Code cần tiện ích mở rộng "TypeScript 7" trên marketplace
  (`TypeScriptTeam.native-preview`) để có hỗ trợ dịch vụ ngôn ngữ gốc cho tới khi
  hỗ trợ tích hợp sẵn được phát hành; nó được bật tắt qua thiết lập
  `js/ts.experimental.useTsgo`, và lệnh "Disable TypeScript 7 Language Server" của
  nó là phương án dự phòng chính thức để quay lại tsserver của TypeScript 6. Các
  IDE của JetBrains chỉ tự động nhận diện máy chủ gốc dưới tên gói
  `@typescript/native-preview`, nên chúng sẽ không nhận ra nó từ bí danh
  `@typescript/native` của kho mã này; hỗ trợ TypeScript 6 đi kèm của chúng vẫn
  hoạt động tốt.
- **Các cờ tsc hữu ích.** `--checkers N` đặt số tiến trình kiểm tra kiểu song song
  (mặc định là 4; kết quả giống hệt nhau ở mọi số lượng): hãy giảm nó để giới hạn
  bộ nhớ trên một runner eo hẹp, tăng nó trên máy nhiều nhân, và hãy đo đạc trong
  cả hai trường hợp, vì nhiều hơn không phải lúc nào cũng nhanh hơn.
  `--singleThreaded` tắt toàn bộ tính song song. Kiểm tra một tệp đơn lẻ theo kiểu
  tùy hứng (`npx tsc somefile.ts`) sẽ báo lỗi khi thư mục có một `tsconfig.json`;
  hãy truyền `--ignoreConfig` để có lại hành vi cũ.
- **Tệp khóa.** Chỉ tạo lại `package-lock.json` bằng
  `npx npm@10 install --package-lock-only`: tệp này dùng ngữ nghĩa của npm 10, và
  các bản npm major mới hơn (bao gồm npm 11 đi kèm Node 26 của CI) âm thầm loại bỏ
  các mục peer tùy chọn lồng nhau của `svelte-check`, khiến `npm ci` mất đồng bộ
  trên CI. Bản thân `npm ci` thì an toàn với mọi bản npm major. Sau khi tạo lại,
  hãy xác nhận `npm ci --dry-run` đồng bộ với cả npm 10 lẫn npm trên máy bạn.
- **Khi nào cần xem lại.** Hãy gộp bí danh kép trở lại thành một phụ thuộc
  `typescript` duy nhất khi CẢ HAI điều kiện đều thỏa: JS API ổn định của
  TypeScript 7.1 đã phát hành (TypeScript 7.0 hoàn toàn không có JS API; phương án
  thay thế được theo dõi ở issue 2824 của microsoft/typescript-go), và issue 3063
  của sveltejs/language-tools đã đóng kèm một bản `svelte-check` phát hành có áp
  dụng nó. Các chế độ `--tsgo` thử nghiệm của svelte-check không gỡ bỏ yêu cầu về
  API TypeScript 6 của nó, và phần nạp TypeScript 7 đang được thực hiện (PR 3073
  của language-tools) đọc chính bí danh `@typescript/native` mà kho mã này đã dùng,
  nên không cần đổi tên gì cả.

## Thực hiện thay đổi của bạn

1. **Hãy bắt đầu từ nhánh release mới nhất, và không bao giờ từ `main`.** Công việc
   đang hoạt động được tích hợp trên một nhánh `release/vX.Y.Z`; `main` đi sau nó
   và không phải là nền tảng cho các đóng góp. Hãy tìm nhánh mới nhất và tạo nhánh
   từ đó:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Hãy luôn chạy lượt tra cứu đó thay vì sao chép một số hiệu phiên bản từ hướng
   dẫn này: các nhánh release luân chuyển thường xuyên, và nhánh mới nhất thay đổi
   theo mỗi lần phát hành. Các nhánh được đặt tên `feature/<short-slug>` hoặc
   `fix/<short-slug>`.
2. **Thực hiện các commit tập trung.** Những thay đổi nhỏ, độc lập sẽ dễ review và
   merge hơn những thay đổi lớn.
3. **Thêm hoặc cập nhật kiểm thử** cho bất kỳ hành vi nào bạn thay đổi trong
   `src/sim/` hoặc `server/`.
4. **Giữ cho văn bản hiển thị với người chơi có thể dịch được.** Xem
   [Bản địa hóa](#localization) và [Dịch trò chơi](#translating-the-game).

### Những điều cần lưu ý

Đây là những quy tắc cốt lõi của kho mã. Chi tiết đầy đủ nằm trong tệp
[`CLAUDE.md`](../../CLAUDE.md) ở thư mục gốc, nhưng đây là phiên bản ngắn gọn:

- **Lõi mô phỏng (`src/sim/`) là nguồn chân lý**, và nó luôn thuần khiết, không có
  bất kỳ import nào của DOM, trình duyệt hay Three.js, để cùng một đoạn mã chạy
  ngoại tuyến, trên máy chủ, và trong môi trường RL không giao diện.
- **Mô phỏng có tính tất định.** Nó chạy ở nhịp cố định 20 Hz, và mọi yếu tố ngẫu
  nhiên đều đi qua `Rng`, không bao giờ dùng `Math.random`, `Date.now` hay
  `performance.now` trong logic mô phỏng. Cùng một seed luôn tạo ra cùng một thế
  giới.
- **Phép toán lối chơi tuân theo các công thức MMO thời cổ điển** (rage, bảng đánh
  trúng, giáp, đường cong XP). Xin đừng tự bịa ra các con số cân bằng. Thay vào đó
  hãy trích dẫn công thức.
- **Logic mới được đưa vào dưới dạng một mô-đun nhỏ, có kiểm thử riêng, nằm sau một
  đường nối sẵn có**, thay vì được nối thêm vào một trong những tệp điều phối lớn.
  Dữ liệu mà bộ dựng hình hay HUD đọc sẽ đi qua giao diện `IWorld`
  (`src/world_api/`) và được hiện thực ở cả thế giới ngoại tuyến lẫn trực tuyến;
  một hệ thống mô phỏng mới nằm sau `SimContext`; một endpoint REST mới là một
  mô-đun route mà bạn có thể tạo khung bằng `npm run new:endpoint`.
- **Đừng chỉnh sửa thủ công các tệp được sinh tự động** như `*.generated.ts`. Hãy
  tạo lại chúng thông qua quá trình build.
- **Quy ước văn phong của dự án: không dùng gạch ngang dài, gạch ngang ngắn hay
  emoji** ở bất cứ đâu, dù là trong mã, chú thích, tài liệu, thông điệp commit, văn
  bản PR, hay văn bản hiển thị với người chơi. Hãy dùng dấu phẩy, dấu hai chấm, dấu
  ngoặc đơn, hoặc chữ "đến" cho các khoảng giá trị. Một bước kiểm tra trước khi
  push sẽ quét diff của bạn và chặn lượt push nếu phát hiện.
- **Không bao giờ commit bí mật** hay tệp `.env`, và không bao giờ bật
  `ALLOW_DEV_COMMANDS` trên đường dẫn production, vì nó mở khóa các gian lận.

### Phong cách mã nguồn

Việc định dạng do [Biome](https://biomejs.dev/) đảm nhiệm, được cấu hình trong
`biome.json`: thụt lề 2 khoảng trắng, dòng dài 100 cột, nháy đơn, và dấu phẩy cuối.
Chỉ định dạng những tệp bạn đã chạm vào
(`npx @biomejs/biome check --write <your-file.ts>`) và kiểm tra chúng bằng
`npm run ci:changed`. CI chỉ kiểm soát các tệp đã thay đổi, nên xin đừng định dạng
lại phần còn lại của cây mã: một lượt chạy trên toàn kho mã sẽ làm lộ ra khoản nợ
kỹ thuật tồn đọng từ lâu, vốn không phải việc bạn phải sửa.

## Trước khi bạn mở một pull request

Hãy chạy cổng kiểm tra của kho mã trên máy của bạn. Đó chính là hợp đồng mà CI thực
thi:

```bash
npm run gate
```

Trong lúc lặp đi lặp lại, hãy chạy một bộ kiểm thử đơn lẻ
(`npx vitest run tests/sim.test.ts`) và `npm run ci:changed` để kiểm tra định dạng;
`npm test` chạy tất cả, và bản đồ các bộ kiểm thử nằm trong `tests/CLAUDE.md`. Toàn
bộ `npm run gate` bao gồm độ tươi mới của các tạo phẩm được sinh tự động, lượt quét
mã độc, định dạng trên các tệp đã thay đổi, kiểm tra tính tuân thủ của hiệu ứng âm
thanh, toàn bộ bộ kiểm thử, một lượt kiểm thử hồi quy trên trình duyệt thật, lượt
kiểm tra kiểu nghiêm ngặt, và các bản build máy khách, máy chủ cùng không giao
diện. Các lớp kiểm tra, tính từ mức sàn trước khi push trở lên, được mô tả trong
[`docs/qa-gate.md`](../qa-gate.md).

Sau đó hãy kiểm thử thay đổi của bạn trên cả máy tính để bàn và di động, bao gồm
một khung nhìn kích thước điện thoại ở chế độ dọc và ngang, nếu nó chạm đến bất cứ
thứ gì người chơi nhìn thấy. Các vùng chạm nên giữ ở mức ít nhất 40x40px và các ô
nhập biểu mẫu có cỡ chữ ít nhất 16px. Các tiêu chuẩn giao diện được ghi lại trong
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Mở pull request

Hãy push nhánh của bạn và mở một PR **nhắm vào đúng nhánh `release/vX.Y.Z` mới nhất
mà bạn đã bắt đầu từ đó. Không bao giờ nhắm vào `main`**, vốn là một nhánh tích hợp
tại thời điểm phát hành chứ không phải nền tảng cho các đóng góp. GitHub thường sẽ
chọn sẵn `main` cho bạn, nên hãy đổi nhánh nền trước khi gửi.
[Mẫu pull request](../../.github/PULL_REQUEST_TEMPLATE.md) sẽ dẫn dắt bạn qua một
danh sách kiểm tra ngắn. Xin hãy điền vào đó:

- Mô tả **những gì** đã thay đổi và **vì sao**.
- Liên kết đến bất kỳ vấn đề liên quan nào (ví dụ, "Closes #123").
- Thêm **ảnh chụp màn hình hoặc một đoạn clip cho các thay đổi giao diện**, trên
  máy tính để bàn và di động.
- Xác nhận rằng `npm run gate` đạt và các chuỗi mới hiển thị với người chơi tuân
  theo chính sách "tiếng Anh trước" dành cho người đóng góp được nêu bên dưới.

Trên PR của bạn, CI sẽ chạy định dạng và linting trên các tệp bạn đã thay đổi, toàn
bộ bộ kiểm thử chia thành bốn phân mảnh song song, một lượt kiểm thử hồi quy trên
trình duyệt, cùng lượt kiểm tra kiểu và các bản build máy khách, máy chủ và không
giao diện. Điều đó khớp với những gì `npm run gate` chạy trên máy bạn, nên một cổng
kiểm tra xanh là dấu hiệu tốt cho một PR xanh.

Một lần chạy CI thành công và một danh sách kiểm tra hoàn chỉnh là những gì chúng
tôi tìm kiếm trước khi merge. Người bảo trì có thể đề xuất các thay đổi. Đó là một
phần bình thường, mang tính hợp tác của quá trình, không phải là sự từ chối. Chúng
tôi cố gắng tử tế và mang tính xây dựng trong khi review, và chúng tôi mong bạn
cũng làm như vậy.

> Thông điệp commit và tiêu đề PR tuân theo [Conventional Commits](https://www.conventionalcommits.org/)
> với một phạm vi (`feat(talents): ...`, `fix(net): ...`). Mỗi commit cũng đều mang
> một phần thân: sau một dòng trống, từ một đến bốn câu đơn giản nói rõ điều gì đã
> thay đổi và vì sao, ngắt dòng ở khoảng 72 cột. Chỉ một tiêu đề thôi là chưa đủ.

<a id="localization"></a>

## Bản địa hóa

World of ClaudeCraft được phát hành bằng nhiều ngôn ngữ. Mọi chuỗi hiển thị với
người chơi đều phải là một khóa dịch, còn người đóng góp tính năng thì thường chỉ
cần thêm bản gốc tiếng Anh.

- Tất cả văn bản hướng đến người dùng đều là một khóa `t()`. Hãy thêm văn bản tiếng
  Anh mới vào đúng mô-đun theo miền nằm trong
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (phần khung HUD mới thì vào
  `hud_chrome.ts`), rồi kết xuất nó bằng `t('dotted.key', values)`. Chỉ có tiếng
  Anh là hoàn toàn đúng đắn cho một PR tính năng: người bảo trì sẽ điền các locale
  còn lại vào thời điểm phát hành, nên bạn không chỉnh sửa các lớp phủ
  `src/ui/i18n.locales/` và không bao giờ để lại trong đó một chỗ giữ chỗ bằng
  tiếng Anh hay một `// TODO`. Ngoại lệ M16 là một giá trị tiếng Anh mới có nhiều
  chữ, vốn còn cần thêm năm bản điền phi Latinh được mô tả trong
  [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Số, tiền tệ, ngày tháng, đơn vị, và phần trăm đều đi qua các bộ định dạng
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) thay vì xây dựng chuỗi
  thủ công.
- Văn bản hướng đến người chơi được phát ra từ `src/sim/` hoặc `server/`, vốn luôn
  trung lập với ngôn ngữ, phải được bản địa hóa lại tại ranh giới máy khách trong
  cùng một thay đổi. Bài kiểm tra bảo vệ
  `npx vitest run tests/localization_fixes.test.ts` thực thi điều này.
- Sau khi thêm hoặc thay đổi bất kỳ chuỗi nào, hãy chạy `npm run i18n:gen` và commit
  các gói được sinh lại trong cùng một thay đổi. Cả cổng kiểm tra lẫn CI đều so sánh
  các tạo phẩm đã commit với một lượt sinh lại từ đầu, nên một gói lỗi thời sẽ làm
  hỏng bản build.

Vì vậy hãy thêm các chuỗi của bạn bằng tiếng Anh rồi mở PR; bạn không cần tự dịch
chúng. Nếu bạn muốn giúp một tay với các bản dịch, hãy xem phần tiếp theo.

<a id="translating-the-game"></a>

## Dịch trò chơi

Bạn muốn cải thiện một ngôn ngữ, hay giúp đưa trò chơi đến với một ngôn ngữ mới?
Bạn không cần viết bất kỳ mã trò chơi nào để làm điều đó:

1. Hầu hết các bản dịch hiển thị với người chơi nằm trong các tệp lớp phủ theo từng
   ngôn ngữ dưới [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (mỗi locale
   một tệp), phản chiếu các khóa tiếng Anh trong
   [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/). Văn bản do mô phỏng và máy
   chủ phát ra được dịch trong `src/ui/sim_i18n.ts` và `src/ui/server_i18n.ts`, văn
   bản talent trong các mô-đun `talent_i18n`, còn bảng điều khiển quản trị có bộ
   riêng của nó dưới `src/admin/i18n.locales/`.
2. Cải thiện các bản dịch hiện có, hoặc điền vào bất kỳ bản dịch nào đọc còn gượng.
3. Chạy `npm run i18n:gen`, commit các gói được sinh lại cùng với thay đổi lớp phủ
   của bạn, rồi chạy các bộ kiểm thử bản địa hóa
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   và mở một PR. Chỉ kiểm tra kiểu thôi sẽ không cho bạn biết liệu có thiếu khóa nào
   không, vì các lớp phủ được cố ý để thưa.

Để đề xuất một locale hoàn toàn mới, hoặc để thảo luận về giọng điệu và thuật ngữ,
hãy bắt đầu một chủ đề trên [Discord](https://discord.com/invite/worldofclaudecraft) và chúng tôi sẽ
giúp bạn kết nối nó. Người bản xứ và người nói lưu loát đặc biệt được chào đón. Những
bản dịch tốt khiến trò chơi cảm thấy như nhà đối với người chơi ở khắp mọi nơi.

## Báo cáo lỗi và yêu cầu tính năng

Xin hãy sử dụng [các mẫu issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Báo cáo lỗi.** Hãy tìm trong [các vấn đề hiện có](https://github.com/levy-street/world-of-claudecraft/issues)
  trước để tránh trùng lặp, rồi kèm theo các bước tái hiện, điều bạn mong đợi, điều
  đã xảy ra, và môi trường của bạn (ngoại tuyến hay trực tuyến, trình duyệt, máy
  tính để bàn hay di động).
- **Yêu cầu tính năng.** Hãy mô tả vấn đề bạn đang cố giải quyết, chứ không chỉ giải
  pháp. Bối cảnh giúp chúng tôi thiết kế đúng thứ cần thiết.
- **Lỗ hổng bảo mật.** Xin đừng mở một issue công khai. Hãy báo cáo riêng tư theo
  hướng dẫn trong [SECURITY.md](../../SECURITY.md), và chúng tôi sẽ cùng bạn xử lý
  bản vá và việc công bố.

## Nhận trợ giúp

Bị mắc kẹt, hay chỉ muốn chào hỏi? Hãy tham gia
[Discord cộng đồng](https://discord.com/invite/worldofclaudecraft). Không có câu hỏi nào là quá nhỏ,
và những người đóng góp mới luôn được chào đón.

## Giấy phép

Khi đóng góp mã nguồn, bạn đồng ý rằng các đóng góp mã nguồn của bạn sẽ được cấp
phép theo [Giấy phép MIT](../../LICENSE) của dự án, cùng giấy phép bao trùm toàn bộ
dự án.

Giấy phép MIT có ý nghĩa đúng như những gì nó nói: bất kỳ ai cũng có thể sử dụng,
sửa đổi, và phân phối lại mã nguồn, dù vì mục đích thương mại hay không.
[Điều khoản Dịch vụ](https://worldofclaudecraft.com/terms) của chúng tôi điều chỉnh
trò chơi được lưu trữ mà chúng tôi vận hành tại worldofclaudecraft.com (tài khoản,
ứng xử, vật phẩm ảo) và không hạn chế các quyền mà Giấy phép MIT trao cho bạn hay
bất kỳ ai khác đối với mã nguồn này. Tên và nhận diện thương hiệu "World of
ClaudeCraft" và "Levy Street" không nằm trong phạm vi Giấy phép MIT.

Các tài nguyên sáng tạo gốc (bản thu âm, âm nhạc, tranh vẽ, và các tác phẩm có tác
giả tương tự) là ngoại lệ. Nếu bạn đóng góp một tài nguyên gốc do chính bạn tạo ra,
bạn có thể giữ bản quyền và đóng góp nó theo một giấy phép do bạn chọn (ví dụ
CC BY-NC 4.0), với điều kiện là:

- giấy phép đó, các đường dẫn tài nguyên mà nó bao trùm, và phần ghi công của bạn
  được ghi lại trong bảng giấy phép ở [CREDITS.md](../../CREDITS.md) như một phần
  của cùng pull request, và
- nó bao gồm tối thiểu một sự cho phép vĩnh viễn, miễn phí bản quyền dành cho Levy
  Street để sử dụng các tài nguyên đó vào mục đích thương mại trong World of
  ClaudeCraft, bao gồm các bản phát hành chính thức và cửa hàng trong trò chơi.

Đối với các tài nguyên được liệt kê trong bảng CREDITS.md, giấy phép đã ghi lại đó
được ưu tiên hơn giấy phép MIT mặc định của dự án.

**Các tài nguyên đa phương tiện không có mục trong CREDITS.md thì không được cấp
phép theo MIT.** Sổ đăng ký vẫn đang được hoàn thiện, nên một mục còn thiếu có
nghĩa là các điều khoản chưa được ghi nhận, chứ không phải tài nguyên đó có thể tự
do lấy dùng. Điều này là có chủ đích: nó ngăn một đóng góp chưa đăng ký bị đem cho
đi theo mặc định. Với mã nguồn thì ngược lại, và bất cứ thứ gì không được tách ra
trong CREDITS.md đều là MIT.

Đó chính là lý do mục ghi trong sổ đăng ký không phải là thủ tục giấy tờ tùy chọn.
Nếu bạn đóng góp một tài nguyên mà không có dòng nào trong CREDITS.md, không ai ở
phía sau có thể dùng nó và chúng tôi cũng không có ghi nhận nào về những gì bạn đã
trao cho chúng tôi. Hãy điền cột **Redistribution** một cách trung thực nữa. Đó là
thứ cho người fork dự án này biết liệu họ có được truyền tiếp tài nguyên của bạn
hay không, và một số dòng được đánh dấu "No, permission required" chính là vì họ
không được phép.

---

Cảm ơn bạn đã đóng góp cho World of ClaudeCraft. Chúng tôi rất nóng lòng muốn thấy
những gì bạn sẽ xây dựng cùng chúng tôi.
