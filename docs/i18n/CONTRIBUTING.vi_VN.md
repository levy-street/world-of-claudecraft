<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · **Tiếng Việt** · [Dansk](CONTRIBUTING.da_DK.md)

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

Bạn sẽ cần [Node.js 22+](https://nodejs.org/) và npm. Đối với máy chủ nhiều người
chơi, bạn cũng sẽ cần [Docker](https://www.docker.com/) để chạy Postgres.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

Như vậy là đủ để chơi thế giới ngoại tuyến và làm việc trên hầu hết mọi thứ. Để
chạy toàn bộ ngăn xếp trực tuyến:

```bash
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

[README](../../README.md) có đầy đủ hướng dẫn về cách lưu trữ, phát triển và chơi,
và các tệp `CLAUDE.md` rải rác khắp kho mã ghi lại các quy ước cho từng khu vực.

## Thực hiện thay đổi của bạn

1. **Tạo một nhánh** từ `main`: `feature/<short-slug>` hoặc `fix/<short-slug>`.
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
- **Đừng chỉnh sửa thủ công các tệp được sinh tự động** như `*.generated.ts`. Hãy
  tạo lại chúng thông qua quá trình build.
- **Không bao giờ commit bí mật** hay tệp `.env`, và không bao giờ bật
  `ALLOW_DEV_COMMANDS` trên đường dẫn production, vì nó mở khóa các gian lận.

## Trước khi bạn mở một pull request

Xin hãy chạy những lệnh này trên máy của bạn. Chúng là những kiểm tra giống như CI
chạy:

```bash
npm test                    # Vitest suite
npx tsc --noEmit            # TypeScript typecheck (the project is strict)
npm run security:gate       # malicious-code release gate (high-severity signatures; also asserted by npm test)
npm run build               # production client build
```

Nếu bạn thay đổi mã máy chủ hoặc mã không giao diện, hãy chạy thêm
`npm run build:server` và `npm run build:env`.

Sau đó hãy kiểm thử thay đổi của bạn trên cả máy tính để bàn và di động, bao gồm
một khung nhìn kích thước điện thoại ở chế độ dọc và ngang, nếu nó chạm đến bất cứ
thứ gì người chơi nhìn thấy. Các vùng chạm nên giữ ở mức ít nhất 40x40px và các ô
nhập biểu mẫu có cỡ chữ ít nhất 16px. Các tiêu chuẩn giao diện được ghi lại trong
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Mở pull request

Hãy push nhánh của bạn và mở một PR nhắm vào `main`.
[Mẫu pull request](../../.github/PULL_REQUEST_TEMPLATE.md) sẽ dẫn dắt bạn qua một
danh sách kiểm tra ngắn. Xin hãy điền vào đó:

- Mô tả **những gì** đã thay đổi và **vì sao**.
- Liên kết đến bất kỳ vấn đề liên quan nào (ví dụ, "Closes #123").
- Thêm **ảnh chụp màn hình hoặc một đoạn clip cho các thay đổi giao diện**, trên
  máy tính để bàn và di động.
- Xác nhận rằng kiểm thử, kiểm tra kiểu, và quá trình build đều đạt, và rằng các
  chuỗi mới đã được dịch.

Một lần chạy CI thành công và một danh sách kiểm tra hoàn chỉnh là những gì chúng
tôi tìm kiếm trước khi merge. Người bảo trì có thể đề xuất các thay đổi. Đó là một
phần bình thường, mang tính hợp tác của quá trình, không phải là sự từ chối. Chúng
tôi cố gắng tử tế và mang tính xây dựng trong khi review, và chúng tôi mong bạn
cũng làm như vậy.

> Thông điệp commit và tiêu đề PR tuân theo [Conventional Commits](https://www.conventionalcommits.org/)
> với một phạm vi khi phù hợp (`feat(talents): ...`, `fix(net): ...`). Đó là một
> quy ước mà chúng tôi ưa thích hơn là một yêu cầu nghiêm ngặt. Những thông điệp rõ
> ràng, mô tả tốt quan trọng hơn việc định dạng hoàn hảo.

<a id="localization"></a>

## Bản địa hóa

World of ClaudeCraft được phát hành bằng nhiều ngôn ngữ, và chúng tôi duy trì điều
đó khi trò chơi phát triển. Mọi chuỗi hiển thị với người chơi đều được dịch sang
mọi locale được hỗ trợ.

- Tất cả văn bản hướng đến người dùng đều là một khóa `t()` được định nghĩa trong
  [`src/ui/i18n.ts`](../../src/ui/i18n.ts). Hãy thêm một chuỗi mới vào locale `en`
  trước, rồi cung cấp một bản dịch thực sự ở mọi locale khác trong
  `supportedLanguages`. Không dùng văn bản tiếng Anh tạm thời, và không dùng
  `// TODO`.
- Số, tiền tệ, ngày tháng, đơn vị, và phần trăm đều đi qua các bộ định dạng
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) thay vì xây dựng chuỗi
  thủ công.
- Văn bản hướng đến người chơi được phát ra từ `src/sim/` hoặc `server/`, vốn luôn
  trung lập với ngôn ngữ, phải được bản địa hóa lại tại ranh giới máy khách trong
  cùng một thay đổi. Bài kiểm tra bảo vệ
  `npx vitest run tests/localization_fixes.test.ts` thực thi điều này.

Nếu thay đổi của bạn thêm một chuỗi và bạn chỉ có thể viết nó bằng một số ngôn ngữ,
điều đó không sao cả. Hãy mở PR và xin trợ giúp cho phần còn lại trong phần mô tả.
Chúng tôi thà giúp bạn hoàn thành còn hơn để bạn phải kìm lại.

<a id="translating-the-game"></a>

## Dịch trò chơi

Bạn muốn cải thiện một ngôn ngữ, hay giúp đưa trò chơi đến với một ngôn ngữ mới?
Bạn không cần viết bất kỳ mã trò chơi nào để làm điều đó:

1. Hãy mở [`src/ui/i18n.ts`](../../src/ui/i18n.ts) và tìm locale bạn muốn làm việc.
   Mỗi đối tượng locale liệt kê cùng các khóa như `en`.
2. Cải thiện các bản dịch hiện có, hoặc điền vào bất kỳ bản dịch nào đọc còn gượng.
3. Chạy `npx tsc --noEmit` để xác nhận không thiếu gì, rồi mở một PR.

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

## Nhận trợ giúp

Bị mắc kẹt, hay chỉ muốn chào hỏi? Hãy tham gia
[Discord cộng đồng](https://discord.com/invite/worldofclaudecraft). Không có câu hỏi nào là quá nhỏ,
và những người đóng góp mới luôn được chào đón.

## Giấy phép

Khi đóng góp, bạn đồng ý rằng các đóng góp của bạn sẽ được cấp phép theo
[Giấy phép MIT](../../LICENSE) của dự án, cùng giấy phép bao trùm toàn bộ dự án.

---

Cảm ơn bạn đã đóng góp cho World of ClaudeCraft. Chúng tôi rất nóng lòng muốn thấy
những gì bạn sẽ xây dựng cùng chúng tôi.
