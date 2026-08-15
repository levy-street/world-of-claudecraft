// Reliquary page name and description locale table for vi_VN
// (data-as-code, size-exempt). One per-base-locale chunk behind
// RELIQUARY_LOCALE_LOADERS in reliquary_i18n.ts, so a visitor downloads only
// their own locale's page strings. Every page name reuses an already-shipped
// string wherever one exists (dungeon, delve, world-boss and item-set entity
// names verbatim; the deed table's heroic-prefix form for the heroic pages), so
// a page never disagrees with the content it collects. Values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored source
// before this table is consulted.
import type { ReliquaryLocaleTable } from '../reliquary_i18n';

export const table: ReliquaryLocaleTable = {
  conquerors_hollow_crypt: {
    name: 'Hầm Mộ Rỗng',
    desc: 'Chiến lợi phẩm tiêu biểu giành từ Morthen và Hầm Mộ Rỗng.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Anh Hùng: Hầm Mộ Rỗng',
    desc: 'Đồ sử thi chỉ rơi ở chế độ anh hùng từ Morthen Kẻ Gọi Mộ.',
  },
  conquerors_sunken_bastion: {
    name: 'Pháo Đài Chìm',
    desc: 'Chiến lợi phẩm hiếm và sử thi từ Olen và Vael Fogbinder.',
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Anh Hùng: Pháo Đài Chìm',
    desc: 'Đồ sử thi chỉ rơi ở chế độ anh hùng từ Vael Fogbinder.',
  },
  conquerors_drowned_temple: {
    name: 'Ngôi Đền Chết Chìm',
    desc: 'Chiến lợi phẩm hiếm từ Mẫu Ca Selthe và Ysolei, Hóa Thân Nguyệt Chết Chìm.',
  },
  conquerors_drowned_temple_heroic: {
    name: 'Anh Hùng: Ngôi Đền Chết Chìm',
    desc: 'Đồ sử thi chỉ rơi ở chế độ anh hùng từ Ysolei.',
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Thánh Đường Mộ Long',
    desc: 'Chiến lợi phẩm hiếm và sử thi từ các trùm Thánh Đường và Korzul Mộ Long.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Anh Hùng: Thánh Đường Mộ Long',
    desc: 'Đồ sử thi chỉ rơi ở chế độ anh hùng từ Korzul Mộ Long.',
  },
  conquerors_wildheart_basin: {
    name: 'Lòng Chảo Trái Tim Hoang Dã',
    desc: 'Vũ khí tiêu biểu từ Zulgar và Thuần Thú Sư Lãnh Chúa Nanh.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Anh Hùng: Lòng Chảo Trái Tim Hoang Dã',
    desc: 'Đồ sử thi chỉ rơi ở chế độ anh hùng từ Zulgar, Tiếng Nói Của Vùng Trũng.',
  },
  conquerors_nythraxis: {
    name: 'Raid Nythraxis',
    desc: 'Chiến lợi phẩm sử thi và huyền thoại từ Nythraxis, Tai Họa Đỉnh Gai.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Anh Hùng: Raid Nythraxis',
    desc: 'Vũ khí raid chỉ rơi ở chế độ anh hùng từ Nythraxis.',
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, Đỉnh Núi Thức Giấc',
    desc: 'Chiến lợi phẩm sử thi riêng từ trùm thế giới của Đỉnh Núi Thức Giấc.',
  },
  conquerors_collapsed_reliquary: {
    name: 'Thánh Tích Sụp Đổ',
    desc: 'Vật phẩm hiếm tiêu biểu từ rương khóa trong Thánh Tích Sụp Đổ.',
  },
  conquerors_drowned_litany: {
    name: 'Kinh Cầu Chết Chìm',
    desc: 'Chiến lợi phẩm hiếm và sử thi từ Kinh Cầu Chết Chìm.',
  },
  conquerors_set_deathlord: {
    name: 'Bộ Chiến Barrowlord',
    desc: 'Trọn bộ giáp tấm Deathlord.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Áo Lễ Nightfang',
    desc: 'Trọn bộ giáp da Wyrmshadow.',
  },
  conquerors_set_necromancers: {
    name: 'Y Phục Mournweave',
    desc: 'Trọn bộ áo vải Necromancers.',
  },
  conquerors_set_crownforged: {
    name: 'Bộ Lễ Phục Bonewrought',
    desc: 'Trọn bộ giáp tấm Crownforged.',
  },
  conquerors_set_nighttalon: {
    name: 'Bộ Da Direfang',
    desc: 'Trọn bộ giáp da Nighttalon.',
  },
  conquerors_set_soulflame: {
    name: 'Lễ Phục Wraithfire',
    desc: 'Trọn bộ áo vải Soulflame.',
  },
  conquerors_set_stormcallers: {
    name: 'Áo Lễ Galecall',
    desc: 'Trọn bộ áo vải Stormcallers.',
  },
  professions_masterwork: {
    name: 'Phòng Trưng Bày Kiệt Tác',
    desc: 'Cúp lưu niệm trọn đời cho những kiệt tác đầu tiên. Sẽ để trống cho tới kiệt tác kế tiếp nếu người chơi kỳ cựu có trước phòng trưng bày (không bịa ra lịch sử chế tác).',
  },
  professions_field_notes: {
    name: 'Ghi Chép Thực Địa Hiếm',
    desc: 'Những phát hiện hiếm tiêu biểu nơi hoang dã: mạch quặng, lõi gỗ, đóa hoa dưới trăng và mẫu vật hoàn hảo.',
  },
  professions_specimens: {
    name: 'Mẫu Vật Trọng Yếu',
    desc: 'Mẫu vật nguyên vẹn lấy từ xác, nguyên liệu thực địa hảo hạng bậc nhất và con cá mà người câu hằng mong: một bảo tàng thợ thủ công thu nhỏ.',
  },
  horizons_mounts: {
    name: 'Thú Cưỡi',
    desc: 'Thú cưỡi từ chuồng, dây cương anh hùng, đồ sử thi Rạn Nứt và những bộ yên hiếm hơn. Quyền sở hữu bám theo dây cương thật (túi đồ và ngân hàng).',
  },
  horizons_weapon_skins: {
    name: 'Ngoại Hình Vũ Khí',
    desc: 'Ngoại hình vũ khí của Kho Vũ Khí, dùng chung cả tài khoản. Trống khi ngoại tuyến hoặc khi không có đồ trang trí tài khoản; không bao giờ là chiến lợi phẩm của nhân vật.',
  },
  horizons_titles: {
    name: 'Danh Hiệu',
    desc: 'Danh hiệu nhận được từ Sách Kỳ Công. Chỉ mang tính trang trí: không bao giờ là sức mạnh, tỉ lệ rơi đồ hay bù trừ vận rủi.',
  },
  conquerors_the_rift: {
    name: 'Rạn Nứt',
    desc: 'Chiến lợi phẩm tiêu biểu của Rạn Nứt luôn đổi thay, từ những nỗi kinh hoàng lang thang tới hai báu vật của cuộc săn hạng S.',
  },
  conquerors_rares_of_the_realm: {
    name: 'Quái Hiếm Của Vương Quốc',
    desc: 'Bằng chứng về mọi quái hiếm có tên đã bị hạ khắp vương quốc.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Chiến Lợi Phẩm Vương Quốc',
    desc: 'Những báu vật tiêu biểu mà các quái hiếm có tên của vương quốc mang theo.',
  },
  conquerors_warfare_gallery: {
    name: 'Phòng Trưng Bày Chiến Tranh',
    desc: 'Năm bộ chiến trang Chiến Tranh, kiếm được từng món một bằng danh dự.',
  },
  conquerors_warfare_armory: {
    name: 'Kho Vũ Khí Chiến Tranh',
    desc: 'Trang sức và vũ khí Chiến Tranh mua bằng danh dự khó nhọc mới có.',
  },
  horizons_vault_of_ages: {
    name: 'Kho Báu Ngàn Năm',
    desc: 'Những báu vật đã ngừng lưu hành của một thời đã qua. Các kỳ trân này không còn giành được nữa; kho báu tôn vinh các kỳ cựu còn giữ chúng.',
  },
  horizons_riftbound: {
    name: 'Nhẫn Rạn Nứt',
    desc: 'Những chiếc nhẫn Rạn Nứt riêng, đúc cho mọi nhà vô địch trong tổ đội giành lượt hoàn thành đầu tiên của một Rạn Nứt xếp hạng. Mỗi nhân vật chỉ có thể giữ của riêng mình.',
  },
};
