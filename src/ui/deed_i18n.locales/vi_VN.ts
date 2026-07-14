// Deed name / desc / title locale table for vi_VN (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  prog_first_steps: {
    name: 'Những Bước Đầu Tiên',
    desc: 'Đạt cấp 2 và đặt bước chân đầu tiên lên một con đường dài.',
  },
  prog_finding_your_feet: {
    name: 'Vững Đôi Chân',
    desc: 'Đạt cấp 5; chốn hoang dã trông đã nhỏ đi đôi chút.',
  },
  prog_double_digits: { name: 'Hai Chữ Số', desc: 'Đạt cấp 10 và mở khóa thiên phú của bạn.' },
  prog_the_long_middle: { name: 'Chặng Giữa Đằng Đẵng', desc: 'Đạt cấp 15.' },
  prog_level_cap: { name: 'Cảnh Sắc Từ Đỉnh Cao', desc: 'Đạt cấp 20, cấp tối đa.' },
  prog_well_rested: {
    name: 'Ngơi Nghỉ Trọn Vẹn',
    desc: 'Nghỉ chân tại quán trọ cho đến khi bạn tích được kinh nghiệm nghỉ ngơi.',
  },
  prog_talented: { name: 'Một Điểm Đáng Giá', desc: 'Tiêu điểm thiên phú đầu tiên của bạn.' },
  prog_specialized: {
    name: 'Tuyên Bố Chí Hướng',
    desc: 'Chọn một hệ phái và học kỹ năng đặc trưng của hệ phái ấy.',
  },
  prog_deep_roots: {
    name: 'Rễ Cắm Sâu',
    desc: 'Tiêu một điểm thiên phú vào một thiên phú thuộc hàng cuối.',
  },
  prog_full_build: {
    name: 'Trọn Bộ Mười Một',
    desc: 'Tiêu trọn cả mười một điểm thiên phú vào một lối xây dựng duy nhất.',
  },
  prog_veteran: {
    name: 'Kỳ Cựu',
    desc: 'Tích lũy 250,000 điểm kinh nghiệm trọn đời.',
    title: 'Kỳ Cựu',
  },
  prog_champion: {
    name: 'Nhà Vô Địch',
    desc: 'Tích lũy 500,000 điểm kinh nghiệm trọn đời.',
    title: 'Nhà Vô Địch',
  },
  prog_paragon: {
    name: 'Tinh Hoa',
    desc: 'Tích lũy 1,000,000 điểm kinh nghiệm trọn đời.',
    title: 'Tinh Hoa',
  },
  prog_mythic: {
    name: 'Huyền Thoại',
    desc: 'Tích lũy 2,500,000 điểm kinh nghiệm trọn đời.',
    title: 'Huyền Thoại',
  },
  prog_eternal: {
    name: 'Vĩnh Hằng',
    desc: 'Tích lũy 5,000,000 điểm kinh nghiệm trọn đời.',
    title: 'Vĩnh Hằng',
  },
  prog_prestige: {
    name: 'Khởi Đầu Lại',
    desc: 'Đạt cấp tối đa, lấp đầy thanh kinh nghiệm thêm một lần nữa, và nhận bậc Uy Danh 1.',
  },
  prog_prestige_5: { name: 'Thói Quen Cũ', desc: 'Đạt bậc Uy Danh 5.' },
  prog_prestige_10: { name: 'Chuyển Động Vĩnh Cửu', desc: 'Đạt bậc Uy Danh 10.' },
  prog_first_harvest: {
    name: 'Hoa Trái Đồng Nội',
    desc: 'Thu hoạch điểm thu thập đầu tiên của bạn.',
  },
  prog_mining_100: { name: 'Quặng Trong Huyết Quản', desc: 'Đạt 100 điểm thành thạo Khai Khoáng.' },
  prog_logging_100: { name: 'Kẻ Đốn Lõi Gỗ', desc: 'Đạt 100 điểm thành thạo Đốn Gỗ.' },
  prog_herbalism_100: { name: 'Bậc Thầy Đồng Cỏ', desc: 'Đạt 100 điểm thành thạo Thảo Dược Học.' },
  prog_master_gatherer: {
    name: 'Bậc Thầy Thu Thập',
    desc: 'Đạt 100 điểm thành thạo trong Khai Khoáng, Đốn Gỗ, và Thảo Dược Học.',
  },
  prog_first_craft: {
    name: 'Làm Bằng Đôi Tay',
    desc: 'Hoàn thành lượt chế tác thành công đầu tiên của bạn.',
  },
  prog_craft_specialist: {
    name: 'Bí Mật Nhà Nghề',
    desc: 'Đạt 75 điểm kỹ năng trong bất kỳ một nghề chế tác nào và mở khóa các đặc quyền chuyên môn của nghề ấy.',
  },
  prog_around_the_ring: {
    name: 'Một Vòng Quanh Xưởng',
    desc: 'Đạt 25 điểm kỹ năng trong năm nghề chế tác khác nhau.',
  },
  cmb_first_blood: { name: 'Vết Máu Đầu Tiên', desc: 'Đánh bại kẻ địch đầu tiên của bạn.' },
  cmb_slayer: { name: 'Kẻ Tàn Sát', desc: 'Đánh bại 1,000 kẻ địch.' },
  cmb_legion_of_one: { name: 'Một Người Một Quân Đoàn', desc: 'Đánh bại 10,000 kẻ địch.' },
  cmb_heavy_hitter: { name: 'Tay Đấm Hạng Nặng', desc: 'Gây tổng cộng 500,000 sát thương.' },
  cmb_critical_eye: { name: 'Con Mắt Chí Mạng', desc: 'Tung 500 đòn chí mạng.' },
  cmb_giantslayer: {
    name: 'Kẻ Diệt Khổng Lồ',
    desc: 'Tung đòn kết liễu một kẻ địch cao hơn bạn ít nhất năm cấp.',
  },
  cmb_first_fall: {
    name: 'Phủi Bụi Đứng Dậy',
    desc: 'Chết lần đầu tiên; đến những người giỏi nhất cũng từng như thế.',
  },
  dgn_hollow_crypt: {
    name: 'Kẻ Phá Hầm Mộ',
    desc: 'Đánh bại Morthen Kẻ Gọi Mộ trong Hầm Mộ Rỗng.',
  },
  dgn_sunken_bastion: {
    name: 'Màn Sương Cởi Trói',
    desc: 'Đánh bại Vael Fogbinder trong Pháo Đài Chìm.',
  },
  dgn_drowned_temple: {
    name: 'Dìm Trăng Đáy Nước',
    desc: 'Đánh bại Ysolei, Hóa Thân Nguyệt Chết Chìm, trong Ngôi Đền Chết Chìm.',
  },
  dgn_gravewyrm_sanctum: {
    name: 'Cự Long Bên Dưới',
    desc: 'Đánh bại Korzul Mộ Long trong Thánh Đường Mộ Long.',
  },
  dgn_hollow_crypt_heroic: {
    name: 'Anh Hùng: Hầm Mộ Rỗng',
    desc: 'Đánh bại Morthen Kẻ Gọi Mộ trong Hầm Mộ Rỗng ở độ khó Anh Hùng.',
  },
  dgn_sunken_bastion_heroic: {
    name: 'Anh Hùng: Pháo Đài Chìm',
    desc: 'Đánh bại Vael Fogbinder trong Pháo Đài Chìm ở độ khó Anh Hùng.',
  },
  dgn_drowned_temple_heroic: {
    name: 'Anh Hùng: Ngôi Đền Chết Chìm',
    desc: 'Đánh bại Ysolei, Hóa Thân Nguyệt Chết Chìm, trong Ngôi Đền Chết Chìm ở độ khó Anh Hùng.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Anh Hùng: Thánh Đường Mộ Long',
    desc: 'Đánh bại Korzul Mộ Long trong Thánh Đường Mộ Long ở độ khó Anh Hùng.',
  },
  dgn_nythraxis: {
    name: 'Tai Họa Chấm Dứt',
    desc: 'Đánh bại Nythraxis, Tai Họa Đỉnh Gai, phía sau cánh cửa hoàng gia niêm phong.',
  },
  dgn_nythraxis_heroic: {
    name: 'Anh Hùng: Tai Họa Chấm Dứt',
    desc: 'Đánh bại Nythraxis, Tai Họa Đỉnh Gai, ở độ khó Anh Hùng.',
  },
  dgn_thornpeak_rounds: {
    name: 'Đảo Đủ Một Vòng',
    desc: 'Dọn sạch Hầm Mộ Rỗng, Pháo Đài Chìm, Ngôi Đền Chết Chìm, và Thánh Đường Mộ Long.',
  },
  dgn_deepward: {
    name: 'Trấn Giữ Vực Sâu',
    desc: 'Chinh phục mọi hầm ngục, raid, và cả hai hang sâu ở độ khó Anh Hùng.',
  },
  dgn_mark_circuit: {
    name: 'Trọn Một Vòng Đua',
    desc: 'Kiếm Dấu Ấn Anh Hùng từ cả bốn hầm ngục Anh Hùng trong cùng một ngày.',
  },
  dgn_boss_clears_50: { name: 'Năm Mươi Cánh Cửa Sâu', desc: 'Đánh bại 50 trùm cuối hầm ngục.' },
  dgn_morthen_flawless: {
    name: 'Không Ai Bỏ Xương Lại',
    desc: 'Đánh bại Morthen Kẻ Gọi Mộ ở độ khó Anh Hùng mà không một thành viên tổ đội nào tử trận.',
  },
  dgn_morthen_trio: {
    name: 'Ba Người Chống Nấm Mồ',
    desc: 'Đánh bại Morthen Kẻ Gọi Mộ với ba người chơi trở xuống.',
  },
  dgn_olen_arc: {
    name: 'Né Bước Tử Thần',
    desc: 'Đánh bại Hiệp Sĩ Chỉ Huy Olen mà Vòng Chém Gặt của hắn không đánh trúng ai ngoài mục tiêu hiện tại của hắn.',
  },
  dgn_vael_thralls: {
    name: 'Đừng Hòng Bắt Nô Lệ',
    desc: 'Đánh bại Vael Fogbinder khi mọi Nô Lệ Chết Chìm hắn triệu gọi đều đã bị giết từ trước.',
  },
  dgn_ysolei_moonspawn: {
    name: 'Không Sót Một Nguyệt Sinh',
    desc: 'Đánh bại Ysolei khi mọi Nguyệt Sinh nàng triệu gọi đều đã bị giết từ trước.',
  },
  dgn_ysolei_flawless: {
    name: 'Mắt Ráo Hoảnh',
    desc: 'Đánh bại Ysolei, Hóa Thân Nguyệt Chết Chìm, ở độ khó Anh Hùng mà không một thành viên tổ đội nào tử trận.',
  },
  dgn_velkhar_bonewalkers: {
    name: 'Cứ Nằm Yên Dưới Mộ',
    desc: 'Đánh bại Đại Tử Linh Sư Velkhar khi mọi Xác Xương Hồi Sinh đều bị tiêu diệt trước lúc hắn gục ngã.',
  },
  dgn_korzul_flawless: {
    name: 'Kẻ Đốn Long',
    desc: 'Đánh bại Korzul Mộ Long ở độ khó Anh Hùng mà không một thành viên tổ đội nào tử trận.',
    title: 'Kẻ Đốn Long',
  },
  dgn_sanctum_speed: {
    name: 'Nước Rút Thánh Đường',
    desc: 'Đánh bại Korzul Mộ Long trong vòng 15 phút kể từ khi tổ đội của bạn tiến chiếm Thánh Đường Mộ Long.',
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Không Quỳ Trước Vua Nào',
    desc: 'Đánh bại Nythraxis mà Phá Mộ không hề đánh trúng ai ngoài mục tiêu hiện tại của hắn.',
  },
  dgn_nythraxis_wardens: {
    name: 'Người Giữ Đá Hộ Trận',
    desc: 'Đánh bại Nythraxis khi mọi đợt Cuồng Nộ Bất Tử đều bị phá trước khi kịp giáng xuống.',
  },
  dgn_nythraxis_deathless: {
    name: 'Không Ai Bất Tử Hơn',
    desc: 'Đánh bại Nythraxis, Tai Họa Đỉnh Gai, ở độ khó Anh Hùng mà không một thành viên raid nào tử trận.',
    title: 'Kẻ Bất Tử',
  },
  cmb_thunzharr: { name: 'Núi Đã Đổ', desc: 'Hạ gục Thunzharr, Đỉnh Núi Thức Giấc, tại Vách Bão.' },
  cmb_thunzharr_unbroken: {
    name: 'Kẻ Phá Đỉnh',
    desc: 'Hạ gục Thunzharr, Đỉnh Núi Thức Giấc, mà không chết lần nào từ đòn đầu tiên của bạn đến hơi thở cuối cùng của hắn.',
    title: 'Kẻ Phá Đỉnh',
  },
  cmb_thunzharr_ten: {
    name: 'Thói Quen Hạ Núi',
    desc: 'Hạ gục Thunzharr, Đỉnh Núi Thức Giấc, mười lần.',
  },
  dlv_reliquary: { name: 'Chân Chạy Thánh Tích', desc: 'Quét sạch Thánh Tích Sụp Đổ.' },
  dlv_reliquary_heroic: {
    name: 'Anh Hùng: Thánh Tích Sụp Đổ',
    desc: 'Quét sạch Thánh Tích Sụp Đổ ở bậc Anh Hùng.',
  },
  dlv_litany: { name: 'Bặt Tiếng Kinh Cầu', desc: 'Quét sạch Kinh Cầu Chết Chìm.' },
  dlv_litany_heroic: {
    name: 'Anh Hùng: Kinh Cầu Chết Chìm',
    desc: 'Quét sạch Kinh Cầu Chết Chìm ở bậc Anh Hùng.',
  },
  dlv_lore_journal: { name: 'Ghi Chú Bên Lề', desc: 'Mở khóa cả năm mục của nhật ký hang sâu.' },
  dlv_companion_max: {
    name: 'Bạn Nơi Vực Sâu',
    desc: 'Nâng một bạn đồng hành hang sâu lên bậc cao nhất của cô ấy.',
  },
  dlv_companions_both: {
    name: 'Hai Ngọn Đèn Cùng Sáng',
    desc: 'Nâng cả hai bạn đồng hành hang sâu, Tế Đồ Tessa và Edda Reedhand, lên bậc cao nhất.',
  },
  dlv_clears_50: { name: 'Năm Mươi Sải Sâu', desc: 'Hoàn thành 50 chuyến hang sâu.' },
  dlv_solo_heroic: {
    name: 'Hai Người Đã Đủ Chật',
    desc: 'Quét sạch một hang sâu bậc Anh Hùng không cùng người chơi nào khác, chỉ bạn và bạn đồng hành của mình.',
  },
  dlv_tumbler_premium: {
    name: 'Tinh Thông Đường Chốt Khóa',
    desc: 'Mở một rương thánh tích trấn phù ở mức cược cao nhất, hoàn hảo ngay trong lần thử duy nhất.',
  },
  dlv_rite_flawless: {
    name: 'Thuộc Làu Từng Chữ',
    desc: 'Hoàn thành Nghi Lễ Thánh Tích Chết Chìm mà không một lần sai sót.',
  },
  dlv_varric_ringers: {
    name: 'Chuông Ngừng Ngân',
    desc: 'Đánh bại Chấp Sự Varric khi mọi Kẻ Rung Chuông Tang Lễ hắn dựng dậy đều đã bị diệt từ trước.',
  },
  dlv_nhalia_bells: {
    name: 'Kẻ Lặng Chuông',
    desc: 'Đánh bại Sơ Nhalia, Bản Thánh Ca Chết Chìm, mà không một thành viên tổ đội nào bị Chuông Ngân Vang đánh trúng.',
    title: 'Kẻ Lặng Chuông',
  },
  chr_vale_chapter_i: {
    name: 'Biên Niên Sử Thung Lũng, Chương I',
    desc: 'Hoàn thành chương đầu trong biên niên sử của Saul: những việc vặt mở màn ở Đông Khê, nắm rõ địa thế Thung Lũng, và nếm chút hương vị đầu tiên của các nghề nơi đây.',
  },
  chr_vale_chapter_ii: {
    name: 'Biên Niên Sử Thung Lũng, Chương II',
    desc: 'Hoàn thành chương thứ hai trong biên niên sử của Saul: dẹp yên lũ cướp, đám murloc và loài sâu bọ trong mỏ, so tài trên Sân Heo Nái, và liều mình bước vào Thánh Tích Sụp Đổ.',
  },
  chr_vale_chapter_iii: {
    name: 'Trọn Bộ Biên Niên Sử Thung Lũng',
    desc: 'Theo trọn câu chuyện của Thung Lũng: Kẻ Gọi Mộ bị lột mặt nạ, Hầm Mộ Rỗng được thanh tẩy, và mọi nỗi kinh hoàng hữu danh của Thung Lũng đều bị hạ gục.',
    title: 'Xứ Thung Lũng',
  },
  chr_vale_gatherer: {
    name: 'Sống Nhờ Đất Mẹ',
    desc: 'Thu hoạch một mạch quặng, một cụm gỗ và một khóm thảo dược tại Thung Lũng Đông Khê.',
  },
  chr_vale_first_cast: {
    name: 'Có Gì Dưới Hồ Gương',
    desc: 'Câu một con cá từ vùng nước của Thung Lũng Đông Khê.',
  },
  chr_vale_packbreaker: { name: 'Kẻ Phá Bầy', desc: 'Hạ 3 Sói Rừng trong vòng 10 giây.' },
  chr_vale_cup_debut: {
    name: 'Kẻ Tranh Xô Đồng',
    desc: 'Ra sân và chạm bóng trong một trận Cúp Thung Lũng tại Sân Heo Nái.',
  },
  chr_vale_rares: {
    name: 'Nỗi Kinh Hoàng Thung Lũng',
    desc: 'Hạ năm nỗi kinh hoàng hữu danh của Thung Lũng Đông Khê: Lão Greyjaw, Mogger, Grix Vua Đường Hầm, Đội Trưởng Verlan và Kẻ Buộc Oan Hồn Maldrec.',
  },
  chr_marsh_chapter_i: {
    name: 'Biên Niên Sử Đầm Lầy, Chương I',
    desc: 'Hoàn thành chương đầu trong biên niên sử của Osric Fenn: đáp lời hiệu triệu Cầu Đầm, giữ vững đường đắp cao, và thuộc lòng hình hài đầm lầy.',
  },
  chr_marsh_chapter_ii: {
    name: 'Biên Niên Sử Đầm Lầy, Chương II',
    desc: 'Hoàn thành chương thứ hai trong biên niên sử của Osric Fenn: đốt sạch ổ nhện góa phụ, đưa những kẻ chết chìm về yên nghỉ, kéo được Cá Bố Già lên bờ, và liều mình bước vào Kinh Cầu Chết Chìm.',
  },
  chr_marsh_chapter_iii: {
    name: 'Trọn Bộ Biên Niên Sử Bùn Sâu',
    desc: 'Theo trọn câu chuyện của đầm lầy: doanh trại giáo phái bị đập tan, Fogbinder phải bặt tiếng trong Pháo Đài Chìm, và mọi nỗi kinh hoàng hữu danh của màn sương đều bị hạ gục.',
    title: 'Xứ Bùn Sâu',
  },
  chr_marsh_gatherer: {
    name: 'Lượm Lặt Cầu Đầm',
    desc: 'Thu hoạch một mạch quặng, một cụm gỗ và một khóm thảo dược tại Đầm Lầy Bùn Sâu.',
  },
  chr_marsh_unburst: {
    name: 'Chớ Đứng Trong Bào Tử',
    desc: 'Hạ 8 Quái Phình Đầm Lầy mà không dính đợt nổ Bào Tử Ăn Mòn của chúng.',
  },
  chr_marsh_hush_the_mending: {
    name: 'Chặn Tay Thầy Chữa',
    desc: 'Tại Doanh Trại Triệu Mộ, hạ một Thầy Chữa Gọi Mộ trước bất kỳ tín đồ nào hắn đang chăm sóc.',
  },
  chr_marsh_rares: {
    name: 'Danh Xưng Trong Sương',
    desc: 'Hạ ba nỗi kinh hoàng hữu danh của Đầm Lầy Bùn Sâu: Mirejaw Háu Đói, Sloomtooth Kẻ Chết Chìm và Sơ Nhalia.',
  },
  chr_peaks_chapter_i: {
    name: 'Biên Niên Sử Cao Nguyên, Chương I',
    desc: 'Hoàn thành chương đầu trong biên niên sử của Zenzie: dọn sạch đường sườn núi, quét rỗng những hang đào, và thuộc từng lối đi mà Vọng Đài Cao canh giữ.',
  },
  chr_peaks_chapter_ii: {
    name: 'Biên Niên Sử Cao Nguyên, Chương II',
    desc: 'Hoàn thành chương thứ hai trong biên niên sử của Zenzie: đập tan Trại Chiến của Drogmar, đọc hiểu cơn bão đang thức giấc, và đứng nơi Hồ Lung Linh tỏa sáng.',
  },
  chr_peaks_chapter_iii: {
    name: 'Trọn Bộ Biên Niên Sử Đỉnh Gai',
    desc: 'Theo trọn câu chuyện của ngọn núi: Long Giáo bị đập tan, Thánh Đường Mộ Long phải bặt tiếng, Đỉnh Núi Thức Giấc bị quật ngã, và mọi nỗi kinh hoàng hữu danh của vách đá đều bị hạ gục.',
    title: 'Xứ Đỉnh Gai',
  },
  chr_peaks_sparring: {
    name: 'Luyện Đòn Trên Tường',
    desc: 'Gây tổng cộng 1.000 sát thương lên Hình Nộm Tập Luyện phía trên Vọng Đài Cao.',
  },
  chr_peaks_glimmer_cast: {
    name: 'Nước Lạnh, Ánh Sáng Còn Lạnh Hơn',
    desc: 'Câu một con cá từ Hồ Lung Linh.',
  },
  chr_peaks_moongate: {
    name: 'Qua Cánh Cổng Giá Lạnh',
    desc: 'Bước qua nguyệt môn bên bờ Hồ Lung Linh.',
  },
  chr_peaks_waking_witness: {
    name: 'Ngọn Núi Biết Đi',
    desc: 'Tận mắt nhìn thấy Thunzharr, Đỉnh Núi Thức Giấc khi hắn sải bước trên núi.',
  },
  chr_peaks_rares: {
    name: 'Những Cái Tên Khắc Vào Vách Đá',
    desc: 'Hạ bốn nỗi kinh hoàng hữu danh của Cao Nguyên Đỉnh Gai: Quản Đốc Mạch Sắt, Brutok Nghiền Sọ, Voskar Cánh Tàn Lửa và Lãnh Chúa Tủy Varkas.',
  },
  col_discovery_25: {
    name: 'Chuột Gom Đồ',
    desc: 'Khám phá 25 món đồ khác nhau (mỗi món được tính vào lần đầu tiên nó về tay bạn).',
  },
  col_discovery_75: { name: 'Chim Ác Là', desc: 'Khám phá 75 món đồ khác nhau.' },
  col_discovery_150: {
    name: 'Tủ Kỳ Trân',
    desc: 'Khám phá 150 món đồ khác nhau.',
    title: 'Người Giữ Kỳ Trân',
  },
  col_discovery_250: { name: 'Đại Danh Mục', desc: 'Khám phá 250 món đồ khác nhau.' },
  col_first_rare: {
    name: 'Chút Gì Xanh Biếc',
    desc: 'Sở hữu món đồ phẩm chất hiếm đầu tiên của bạn.',
  },
  col_first_epic: {
    name: 'Sinh Ra Trong Sắc Tía',
    desc: 'Sở hữu món đồ phẩm chất sử thi đầu tiên của bạn.',
  },
  col_first_legendary: {
    name: 'Số Đỏ Màu Cam',
    desc: 'Sở hữu món đồ phẩm chất huyền thoại đầu tiên của bạn.',
  },
  col_set_vale_arcanist: {
    name: 'Vương Phục Bí Thuật Sư Thung Lũng',
    desc: 'Khám phá đủ mọi món của bộ Vương Phục Bí Thuật Sư Thung Lũng.',
  },
  col_set_boundstone_vanguard: {
    name: 'Tiên Phong Đá Trói',
    desc: 'Khám phá đủ mọi món của bộ Tiên Phong Đá Trói.',
  },
  col_set_greyjaw_stalker: {
    name: 'Bộ Đồ Kẻ Rình Greyjaw',
    desc: 'Khám phá đủ mọi món của Bộ Đồ Kẻ Rình Greyjaw.',
  },
  col_set_deathlord: {
    name: 'Chiến Giáp Barrowlord',
    desc: 'Khám phá đủ mọi món của bộ Chiến Giáp Barrowlord.',
  },
  col_set_wyrmshadow: {
    name: 'Lễ Phục Nightfang',
    desc: 'Khám phá đủ mọi món của bộ Lễ Phục Nightfang.',
  },
  col_set_necromancers: {
    name: 'Y Phục Mournweave',
    desc: 'Khám phá đủ mọi món của bộ Y Phục Mournweave.',
  },
  col_set_crownforged: {
    name: 'Vương Phục Bonewrought',
    desc: 'Khám phá đủ mọi món của bộ Vương Phục Bonewrought.',
  },
  col_set_nighttalon: { name: 'Bộ Da Direfang', desc: 'Khám phá đủ mọi món của Bộ Da Direfang.' },
  col_set_soulflame: {
    name: 'Vương Phục Wraithfire',
    desc: 'Khám phá đủ mọi món của bộ Vương Phục Wraithfire.',
  },
  col_set_stormcallers: {
    name: 'Lễ Phục Galecall',
    desc: 'Khám phá đủ mọi món của bộ Lễ Phục Galecall.',
  },
  col_seven_regalia: {
    name: 'Tủ Áo Bảy Bộ',
    desc: 'Khám phá đủ mọi món của cả bảy dòng giáp sử thi.',
    title: 'Lộng Lẫy',
  },
  col_true_colors: {
    name: 'Bản Sắc Riêng',
    desc: 'Ra trận với một diện mạo khác với diện mạo mặc định của lớp nhân vật bạn.',
  },
  col_all_slots: {
    name: 'Mười Một Phân Vẹn Mười Một',
    desc: 'Trang bị đồ ở cả mười một ô trang bị cùng một lúc.',
  },
  col_quartermaster_buyout: {
    name: 'Khách Quen Hạng Nhất',
    desc: 'Khám phá đủ cả mười món hàng của Quân Nhu Trưởng Vex.',
  },
  col_glimmerfin: { name: 'Tia Hy Vọng Lấp Lánh', desc: 'Câu được một con Cá Koi Vây Lấp Lánh.' },
  col_full_creel: {
    name: 'Giỏ Cá Đầy Ắp',
    desc: 'Khám phá đủ sáu loại cá thường từ vùng nước của Thung Lũng, Đầm Lầy và Cao Nguyên.',
  },
  col_junk_drawer: {
    name: 'Ngăn Kéo Đồ Đồng Nát',
    desc: 'Khám phá 10 món đồ phẩm chất kém khác nhau.',
  },
  pvp_arena_first_match: {
    name: 'Cát Trong Đôi Giày',
    desc: 'Đấu một trận xếp hạng tại Đấu Trường Tro Tàn, ở nhánh đấu bất kỳ.',
  },
  pvp_arena_first_win: {
    name: 'Khán Đài Gầm Vang',
    desc: 'Thắng một trận đấu trường xếp hạng ở nhánh đấu bất kỳ.',
  },
  pvp_arena_1v1_1600: {
    name: 'Ứng Viên Đấu Trường',
    desc: 'Đạt 1600 điểm xếp hạng ở nhánh đấu trường 1v1.',
  },
  pvp_arena_1v1_1750: {
    name: 'Kình Địch Đấu Trường',
    desc: 'Đạt 1750 điểm xếp hạng ở nhánh đấu trường 1v1.',
  },
  pvp_arena_1v1_1900: {
    name: 'Giác Đấu Sĩ',
    desc: 'Đạt 1900 điểm xếp hạng ở nhánh đấu trường 1v1.',
    title: 'Giác Đấu Sĩ',
  },
  pvp_arena_2v2_1600: {
    name: 'Song Kiếm Hợp Bích',
    desc: 'Đạt 1600 điểm xếp hạng ở nhánh đấu trường 2v2.',
  },
  pvp_arena_2v2_1750: {
    name: 'Cặp Đôi Đáng Gờm',
    desc: 'Đạt 1750 điểm xếp hạng ở nhánh đấu trường 2v2.',
  },
  pvp_arena_2v2_1900: {
    name: 'Ăn Ý Tuyệt Đối',
    desc: 'Đạt 1900 điểm xếp hạng ở nhánh đấu trường 2v2.',
  },
  pvp_duel_first_win: { name: 'Ra Ngoài Giải Quyết', desc: 'Thắng một trận đấu tay đôi.' },
  pvp_duel_grace: {
    name: 'Bài Học Khiêm Nhường',
    desc: 'Thua một trận đấu tay đôi mà thể diện vẫn gần như nguyên vẹn.',
  },
  pvp_vcup_first_match: {
    name: 'Đôi Giày Chạm Cỏ',
    desc: 'Chơi trọn vẹn một trận Cúp Thung Lũng tại Sân Heo Nái, dù thắng hay thua.',
  },
  pvp_vcup_first_win: {
    name: 'Chiếc Cúp Đầu Tay',
    desc: 'Thắng một trận Cúp Thung Lũng xếp hạng.',
  },
  pvp_vcup_wins_10: { name: 'Cầu Thủ Dạn Dày', desc: 'Thắng 10 trận Cúp Thung Lũng xếp hạng.' },
  pvp_vcup_wins_25: {
    name: 'Huyền Thoại Bóng Heo Rừng',
    desc: 'Thắng 25 trận Cúp Thung Lũng xếp hạng.',
    title: 'Huyền Thoại Bóng Heo Rừng',
  },
  pvp_vcup_first_goal: {
    name: 'Khai Nòng',
    desc: 'Ghi một bàn thắng trong một trận Cúp Thung Lũng xếp hạng.',
  },
  pvp_vcup_hat_trick: {
    name: 'Người Hùng Hat-trick',
    desc: 'Ghi ba bàn trong cùng một trận Cúp Thung Lũng xếp hạng, ở nhánh 3v3 trở lên.',
  },
  pvp_vcup_golden_goal: {
    name: 'Khoảnh Khắc Vàng',
    desc: 'Ghi bàn thắng vàng định đoạt một trận Cúp Thung Lũng xếp hạng.',
  },
  pvp_vcup_first_save: {
    name: 'Đôi Tay Vững Vàng',
    desc: 'Cản phá một pha bóng trong vai thủ môn ở một trận Cúp Thung Lũng xếp hạng.',
  },
  pvp_vcup_clean_sheet: {
    name: 'Đừng Hòng Qua Được Ta',
    desc: 'Thắng một trận Cúp Thung Lũng xếp hạng trong vai thủ môn mà không để thủng lưới bàn nào.',
  },
  pvp_vcup_guild_win: {
    name: 'Vì Màu Cờ Sắc Áo',
    desc: 'Thắng một trận Cúp Thung Lũng xếp hạng khi ra sân dưới kỳ hiệu bang hội của bạn.',
  },
  pvp_fiesta_first_bout: {
    name: 'Khách Không Mời',
    desc: 'Đấu trọn một trận Fiesta 2v2, dù thắng hay thua.',
  },
  pvp_fiesta_first_win: { name: 'Linh Hồn Của Bữa Tiệc', desc: 'Thắng một trận Fiesta 2v2.' },
  pvp_fiesta_double: {
    name: 'Họa Vô Đơn Chí',
    desc: 'Ghi hai pha hạ gục trong Fiesta chỉ trong bốn giây.',
  },
  pvp_fiesta_shutdown: {
    name: 'Kẻ Phá Đám',
    desc: 'Hạ gục một đối thủ Fiesta đang trên chuỗi ba mạng trở lên.',
  },
  pvp_fiesta_full_build: {
    name: 'Chỉnh Tề Dự Tiệc',
    desc: 'Thắng một trận Fiesta sau khi chốt món tăng cường ở cả ba đợt.',
  },
  pvp_fiesta_powerups: {
    name: 'Mỗi Thứ Một Chút',
    desc: 'Nhặt đủ cả bốn món tăng lực trên võ đài ít nhất một lần: Quỷ Tốc Độ, Người Khổng Lồ, Giày Mặt Trăng và Kẻ Cuồng Chiến.',
  },
  pvp_fiesta_five_kills: {
    name: 'Gánh Cả Bữa Tiệc',
    desc: 'Ghi năm pha hạ gục trong cùng một trận Fiesta.',
  },
  soc_first_party: { name: 'Có Nhau Vẫn Hơn', desc: 'Gia nhập một tổ đội cùng người chơi khác.' },
  soc_full_house: { name: 'Kín Đội Hình', desc: 'Dọn sạch một hầm ngục với tổ đội đủ năm người.' },
  soc_guild_joined: { name: 'Dưới Một Ngọn Cờ', desc: 'Trở thành thành viên của một bang hội.' },
  soc_guild_founded: {
    name: 'Ngòi Bút Khai Hội',
    desc: 'Tự tay sáng lập một bang hội của riêng bạn.',
  },
  soc_first_trade: {
    name: 'Thuận Mua Vừa Bán',
    desc: 'Hoàn tất một giao dịch với người chơi khác.',
  },
  soc_first_sale: {
    name: 'Mở Hàng',
    desc: 'Nhận tiền từ món hàng đầu tiên bạn bán được trên Chợ Thế Giới.',
  },
  soc_steady_custom: {
    name: 'Buôn May Bán Đắt',
    desc: 'Thu về tổng cộng trọn đời 10 vàng từ các món hàng bạn bán trên Chợ Thế Giới.',
  },
  soc_market_magnate: {
    name: 'Trùm Thương Trường',
    desc: 'Thu về tổng cộng trọn đời 100 vàng từ các món hàng bạn bán trên Chợ Thế Giới.',
    title: 'Đại Thương Gia',
  },
  soc_by_ravens_wing: {
    name: 'Theo Cánh Quạ Đen',
    desc: 'Gửi một lá thư qua đường Quạ Thư kèm theo tiền hoặc bưu kiện.',
  },
  soc_room_for_more: {
    name: 'Còn Chỗ Chứa Thêm',
    desc: 'Mua lần mở rộng ngân hàng đầu tiên của bạn.',
  },
  soc_gilded_strongbox: {
    name: 'Két Sắt Mạ Vàng',
    desc: 'Mua hết mọi lần mở rộng ngân hàng mà các thủ quỹ chịu bán cho bạn.',
  },
  soc_meet_bursar: {
    name: 'Niềm Tin Đặt Nơi Fernando',
    desc: 'Đến bái kiến Thủ Quỹ Fernando, người trông coi Két Sắt Mạ Vàng ở Đông Khê.',
  },
  soc_pocket_money: { name: 'Tiền Tiêu Vặt', desc: 'Nhặt được tổng cộng trọn đời 1 vàng tiền xu.' },
  soc_heavy_purse: {
    name: 'Hầu Bao Nặng Trĩu',
    desc: 'Nhặt được tổng cộng trọn đời 10 vàng tiền xu.',
  },
  soc_wyrms_hoard: {
    name: 'Kho Báu Của Rồng',
    desc: 'Nhặt được tổng cộng trọn đời 100 vàng tiền xu.',
  },
  soc_civic_duty: {
    name: 'Nghĩa Vụ Công Dân',
    desc: 'Phân bổ điểm trọng tâm thị trấn đầu tiên của bạn.',
  },
  exp_long_road_north: {
    name: 'Đường Dài Lên Phương Bắc',
    desc: 'Ghé thăm cả ba khu định cư trung tâm: Đông Khê, Cầu Đầm và Vọng Đài Cao.',
  },
  exp_vale_wayfarer: {
    name: 'Lữ Khách Thung Lũng',
    desc: 'Ghé thăm đủ mười một địa danh của Thung Lũng Đông Khê.',
  },
  exp_marsh_wayfarer: {
    name: 'Lữ Khách Đầm Lầy',
    desc: 'Ghé thăm đủ tám địa danh của Đầm Lầy Bùn Sâu.',
  },
  exp_peaks_wayfarer: {
    name: 'Lữ Khách Cao Nguyên',
    desc: 'Ghé thăm đủ mười địa danh của Cao Nguyên Đỉnh Gai.',
  },
  exp_world_traveler: {
    name: 'Kẻ Chu Du Thiên Hạ',
    desc: 'Lập kỳ công lữ khách của cả ba vùng đất.',
    title: 'Lữ Khách',
  },
  exp_something_shiny: {
    name: 'Thứ Gì Đó Lấp Lánh',
    desc: 'Nhặt một vật thể lấp lánh trên mặt đất.',
  },
  exp_first_ore: { name: 'Cuốc Vỡ Đất', desc: 'Thu hoạch mạch quặng đầu tiên của bạn.' },
  exp_first_timber: { name: 'Cây Đổ Đấy!', desc: 'Thu hoạch cụm gỗ đầu tiên của bạn.' },
  exp_first_herb: { name: 'Mát Tay', desc: 'Thu hoạch bụi thảo dược đầu tiên của bạn.' },
  feat_era_cap: {
    name: 'Đứa Con Của Kỷ Nguyên Thứ Nhất',
    desc: 'Đã đạt cấp 20 khi Kỷ Nguyên Thứ Nhất vẫn còn hiện hành.',
  },
  feat_book_complete: {
    name: 'Trọn Vẹn Cả Cuốn Sách',
    desc: 'Lập mọi kỳ công trong Sách Kỳ Công.',
  },
  feat_brightwood_relic: {
    name: 'Ký Ức Rừng Sáng',
    desc: 'Giữ một di vật của Rừng Sáng xưa: Áo Da Gai Góc hoặc Vương Miện Quân Vương.',
  },
  hid_saul_footnote: {
    name: 'Cước Chú Trong Sử Sách',
    desc: 'Đã quấy rầy Sử Quan Saul chín lần liền không ngơi nghỉ.',
    title: 'Cước Chú',
  },
  hid_gilded_tour: {
    name: 'Chuyến Tham Quan Mạ Vàng',
    desc: 'Đã giao dịch với cả ba chi nhánh của Két Sắt Mạ Vàng.',
  },
  hid_fall_death: {
    name: 'Trọng Lực Luôn Thắng',
    desc: 'Đã bỏ mạng vì một cuộc chuyện trò quá dài với mặt đất.',
  },
  hid_keepers_toll_twice: {
    name: 'Người Canh Giữ Thu Phí Hai Lần',
    desc: 'Đã bỏ mạng khi Cái Giá Của Người Canh Giữ vẫn còn đè nặng lên bạn.',
  },
  hid_roll_hundred: {
    name: 'Trăm Điểm Tròn Trĩnh',
    desc: 'Đã đổ ra đúng 100 hoàn hảo với một lệnh /roll thường.',
  },
  hid_yumi_cheer: {
    name: 'Người Hâm Mộ Cuồng Nhiệt Nhất Của Yumi',
    desc: 'Đã cổ vũ cho Yumi ở nơi cô nàng nghe thấy bạn, ngay giữa trận đấu.',
  },
  hid_bountiful_coffer: {
    name: 'Chiếc Rương Tím',
    desc: 'Đã cạy mở một Rương Hậu Hĩnh trước khi nó kịp kẹt khóa.',
  },
  hid_companion_save: {
    name: 'Có Cô Ấy Ở Đây',
    desc: 'Người bạn đồng hành hang sâu của bạn đã kéo một đồng đội gục ngã đứng dậy trở lại.',
  },
  hid_codfather: {
    name: 'Gia Nhập Gia Đình',
    desc: 'Đã lôi được Cá Bố Già lên khỏi Vũng Cạn Đầm Sâu.',
  },
  prog_crown_below: {
    name: 'Vương Miện Dưới Lòng Đất',
    desc: 'Lần theo vương miện từ bãi xương bất an đến lăng mộ của Vua Nythraxis và theo nhiệm vụ Hồi Kết Của Tai Họa đến tận cùng.',
  },
  prog_mere_at_rest: {
    name: 'Mặt Hồ Yên Nghỉ',
    desc: 'Theo cuộc canh giữ của Ondrel Vane đến hồi kết: dàn hợp ca câm lặng, Cuộn Nhợt bị hạ, và Nguyệt Chết Chìm được yên nghỉ.',
  },
  prog_callused_hands: {
    name: 'Đôi Tay Chai Sạn',
    desc: 'Hoàn thành nhiệm vụ Một Nghề Cho Mỗi Bàn Tay và kiếm vết chai đầu tiên trong các nghề của Đông Khê.',
  },
  prog_tools_of_the_trade: {
    name: 'Dụng Cụ Nhà Nghề',
    desc: 'Hoàn thành một lượt chế tác đòi hỏi trạm chế tác tại khu chế tác Vọng Đài Cao.',
  },
  dgn_nythraxis_crypt: {
    name: 'Điều Hầm Mộ Cất Giữ',
    desc: 'Dấn thân vào Hầm Mộ Hoang Phế và thu hồi cả hai nửa đá khóa cùng cuốn nhật ký cổ xưa từ những kẻ canh giữ nơi ấy.',
  },
  chr_marsh_first_cast: {
    name: 'Lươn Trong Lau Sậy',
    desc: 'Câu một con cá từ vùng nước của Đầm Lầy Bùn Sâu.',
  },
};
