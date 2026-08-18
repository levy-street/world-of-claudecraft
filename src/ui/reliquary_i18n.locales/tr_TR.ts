// Reliquary page name and description locale table for tr_TR
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
    name: 'Oyuk Mezar',
    desc: "Mezarçağıran Morthen'den ve Oyuk Mezar'dan sökülüp alınan simge ganimetler.",
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Kahramanca: Oyuk Mezar',
    desc: "Mezarçağıran Morthen'den yalnızca kahramanca modda düşen epikler.",
  },
  conquerors_sunken_bastion: {
    name: 'Batık Kale',
    desc: "Olen'den ve Fogbinder Vael'den çıkan nadir ve epik ganimetler.",
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Kahramanca: Batık Kale',
    desc: "Fogbinder Vael'den yalnızca kahramanca modda düşen epikler.",
  },
  conquerors_drowned_temple: {
    name: 'Boğulmuş Tapınak',
    desc: "Koroana Selthe'den ve Ysolei, Boğulmuş Ay'ın Avatarı'ndan çıkan nadir ganimetler.",
  },
  conquerors_drowned_temple_heroic: {
    name: 'Kahramanca: Boğulmuş Tapınak',
    desc: "Ysolei'den yalnızca kahramanca modda düşen epikler.",
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Mezarejderi Mabedi',
    desc: "Mabet'in patronlarından ve Mezarejderi Korzul'dan çıkan nadir ve epik ganimetler.",
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Kahramanca: Mezarejderi Mabedi',
    desc: "Mezarejderi Korzul'dan yalnızca kahramanca modda düşen epikler.",
  },
  conquerors_wildheart_basin: {
    name: 'Yaban Yürek Çukuru',
    desc: "Zulgar'dan ve Diş Lordu Canavar Efendisi'nden çıkan simge silahlar.",
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Kahramanca: Yaban Yürek Çukuru',
    desc: "Zulgar, Çukurun Sesi'nden yalnızca kahramanca modda düşen epikler.",
  },
  conquerors_nythraxis: {
    name: 'Nythraxis Baskını',
    desc: "Nythraxis, Dikenzirve Belası'ndan çıkan epik ve efsanevi ganimetler.",
  },
  conquerors_nythraxis_heroic: {
    name: 'Kahramanca: Nythraxis Baskını',
    desc: "Nythraxis'ten yalnızca kahramanca modda düşen baskın silahları.",
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, Uyanan Zirve',
    desc: "Uyanan Zirve'nin dünya patronundan çıkan kişisel epik ganimetler.",
  },
  conquerors_collapsed_reliquary: {
    name: 'Çökmüş Emanetlik',
    desc: "Çökmüş Emanetlik'teki kilitli sandıktan çıkan simge nadir parçalar.",
  },
  conquerors_drowned_litany: {
    name: 'Boğulmuş Litanya',
    desc: "Boğulmuş Litanya'dan çıkan nadir ve epik ganimetler.",
  },
  conquerors_set_deathlord: {
    name: 'Barrowlord Savaş Takımı',
    desc: 'Eksiksiz Deathlord plaka ailesi.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Nightfang Cübbeleri',
    desc: 'Eksiksiz Wyrmshadow deri ailesi.',
  },
  conquerors_set_necromancers: {
    name: 'Mournweave Giysileri',
    desc: 'Eksiksiz Necromancers kumaş ailesi.',
  },
  conquerors_set_crownforged: {
    name: 'Bonewrought Kıyafetleri',
    desc: 'Eksiksiz Crownforged plaka ailesi.',
  },
  conquerors_set_nighttalon: {
    name: 'Direfang Postu',
    desc: 'Eksiksiz Nighttalon deri ailesi.',
  },
  conquerors_set_soulflame: {
    name: 'Wraithfire Kıyafetleri',
    desc: 'Eksiksiz Soulflame kumaş ailesi.',
  },
  conquerors_set_stormcallers: {
    name: 'Galecall Cübbeleri',
    desc: 'Eksiksiz Stormcallers kumaş ailesi.',
  },
  professions_masterwork: {
    name: 'Şaheser Galerisi',
    desc: 'İlk şaheserler için ömür boyu ödüller. Kıdemli bir oyuncu galeriden eskiyse bir sonraki şaheser çıkana kadar boş kalır (uydurma bir üretim geçmişi yazılmaz).',
  },
  professions_field_notes: {
    name: 'Nadir Saha Notları',
    desc: 'Yabanın simge nadir buluşları: damarlar, öz odun, ay ışığında açan çiçekler ve kusursuz örnekler.',
  },
  professions_specimens: {
    name: 'Kilit Örnekler',
    desc: 'Leşlerden çıkan el değmemiş örnekler, en üst kalitede ince saha malzemeleri ve balıkçının peşine düştüğü av: küçük bir zanaatkâr müzesi.',
  },
  horizons_mounts: {
    name: 'Binekler',
    desc: 'Ahırdaki binekler, kahramanca dizginler, Yarık epikleri ve daha nadir eyerler. Sahiplik gerçek dizginleri izler (çantalar ve banka).',
  },
  horizons_weapon_skins: {
    name: 'Silah Görünümleri',
    desc: "Cephanelik'in hesap genelindeki silah görünümleri. Çevrimdışıyken ya da hesap kozmetiği yokken boştur; asla karakter ganimeti değildir.",
  },
  horizons_titles: {
    name: 'Unvanlar',
    desc: "Yiğitlikler Kitabı'ndan kazanılan unvanlar. Yalnızca kozmetik: asla güç, ganimet şansı ya da şanssızlık telafisi değil.",
  },
  conquerors_the_rift: {
    name: 'Yarık',
    desc: "Sürekli değişen Yarık'ın simge ganimetleri: gezinen dehşetlerinden S derecesi avının ikiz hazinelerine kadar.",
  },
  conquerors_rares_of_the_realm: {
    name: 'Diyarın Nadirleri',
    desc: 'Diyar boyunca alaşağı edilen her adlı nadirin kanıtı.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Diyarın Ganimetleri',
    desc: 'Diyarın adlı nadirlerinin taşıdığı simge hazineler.',
  },
  conquerors_warfare_gallery: {
    name: 'Savaş Galerisi',
    desc: 'Beş Savaş muharebe takımı, şerefle parça parça kazanılır.',
  },
  conquerors_warfare_armory: {
    name: 'Savaş Cephaneliği',
    desc: 'Zorlukla kazanılmış şerefle satın alınan Savaş takıları ve silahları.',
  },
  horizons_vault_of_ages: {
    name: 'Çağlar Hazinesi',
    desc: 'Geçmiş bir çağdan kaldırılmış hazineler. Bu yadigârlar artık kazanılamaz; hazine, onları saklayan kıdemlileri onurlandırır.',
  },
  horizons_riftbound: {
    name: 'Yarık Halkaları',
    desc: "Kişisel Yarık halkaları: dereceli bir Yarık'ın ilk tamamlamasını kazanan gruptaki her şampiyon için basılır. Bir karakter yalnızca kendisininkini taşıyabilir.",
  },
};
