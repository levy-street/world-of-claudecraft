// Reliquary page name and description locale table for id_ID
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
    name: 'Kripta Berongga',
    desc: 'Rampasan khas yang direbut dari Morthen dan Kripta Berongga.',
  },
  conquerors_hollow_crypt_heroic: {
    name: 'Heroik: Kripta Berongga',
    desc: 'Barang epik khusus mode heroik dari Morthen sang Pemanggil Kubur.',
  },
  conquerors_sunken_bastion: {
    name: 'Benteng Karam',
    desc: 'Rampasan langka dan epik dari Olen dan Vael sang Fogbinder.',
  },
  conquerors_sunken_bastion_heroic: {
    name: 'Heroik: Benteng Karam',
    desc: 'Barang epik khusus mode heroik dari Vael sang Fogbinder.',
  },
  conquerors_drowned_temple: {
    name: 'Kuil Tenggelam',
    desc: 'Rampasan langka dari Ibu Paduan Suara Selthe dan Ysolei, Awatara Bulan Tenggelam.',
  },
  conquerors_drowned_temple_heroic: {
    name: 'Heroik: Kuil Tenggelam',
    desc: 'Barang epik khusus mode heroik dari Ysolei.',
  },
  conquerors_gravewyrm_sanctum: {
    name: 'Sanktum Gravewyrm',
    desc: 'Rampasan langka dan epik dari para bos Sanktum dan Korzul sang Gravewyrm.',
  },
  conquerors_gravewyrm_sanctum_heroic: {
    name: 'Heroik: Sanktum Gravewyrm',
    desc: 'Barang epik khusus mode heroik dari Korzul sang Gravewyrm.',
  },
  conquerors_wildheart_basin: {
    name: 'Cekungan Hati Liar',
    desc: 'Senjata khas dari Zulgar dan Fanglord, Penakluk Binatang.',
  },
  conquerors_wildheart_basin_heroic: {
    name: 'Heroik: Cekungan Hati Liar',
    desc: 'Barang epik khusus mode heroik dari Zulgar, Suara Cekungan.',
  },
  conquerors_nythraxis: {
    name: 'Raid Nythraxis',
    desc: 'Rampasan epik dan legendaris dari Nythraxis, Bencana Thornpeak.',
  },
  conquerors_nythraxis_heroic: {
    name: 'Heroik: Raid Nythraxis',
    desc: 'Senjata raid khusus mode heroik dari Nythraxis.',
  },
  conquerors_thunzharr: {
    name: 'Thunzharr, Puncak yang Terjaga',
    desc: 'Rampasan epik pribadi dari bos dunia Puncak yang Terjaga.',
  },
  conquerors_collapsed_reliquary: {
    name: 'Reliquary yang Runtuh',
    desc: 'Barang langka khas dari peti berkunci di Reliquary yang Runtuh.',
  },
  conquerors_drowned_litany: {
    name: 'Litani Tenggelam',
    desc: 'Rampasan langka dan epik dari Litani Tenggelam.',
  },
  conquerors_set_deathlord: {
    name: 'Perlengkapan Tempur Barrowlord',
    desc: 'Keluarga pelat Deathlord yang lengkap.',
  },
  conquerors_set_wyrmshadow: {
    name: 'Jubah Nightfang',
    desc: 'Keluarga kulit Wyrmshadow yang lengkap.',
  },
  conquerors_set_necromancers: {
    name: 'Jubah Mournweave',
    desc: 'Keluarga kain Necromancers yang lengkap.',
  },
  conquerors_set_crownforged: {
    name: 'Regalia Bonewrought',
    desc: 'Keluarga pelat Crownforged yang lengkap.',
  },
  conquerors_set_nighttalon: {
    name: 'Perlengkapan Kulit Direfang',
    desc: 'Keluarga kulit Nighttalon yang lengkap.',
  },
  conquerors_set_soulflame: {
    name: 'Regalia Wraithfire',
    desc: 'Keluarga kain Soulflame yang lengkap.',
  },
  conquerors_set_stormcallers: {
    name: 'Jubah Galecall',
    desc: 'Keluarga kain Stormcallers yang lengkap.',
  },
  professions_masterwork: {
    name: 'Galeri Karya Besar',
    desc: 'Trofi seumur hidup untuk karya besar pertama. Tetap kosong sampai yang berikutnya jika seorang veteran lebih tua daripada galerinya (tidak ada riwayat kerajinan yang dikarang).',
  },
  professions_field_notes: {
    name: 'Catatan Lapangan Langka',
    desc: 'Temuan langka nan khas dari alam liar: urat bijih, teras kayu, kuntum cahaya bulan, dan spesimen sempurna.',
  },
  professions_specimens: {
    name: 'Spesimen Kunci',
    desc: 'Spesimen murni dari bangkai, bahan lapangan halus bermutu puncak, dan buruan idaman sang pemancing: museum perajin dalam bentuk mini.',
  },
  horizons_mounts: {
    name: 'Tunggangan',
    desc: 'Tunggangan dari istal, tali kekang heroik, barang epik Rift, dan pelana yang lebih langka. Kepemilikan mengikuti tali kekang yang sebenarnya (tas dan bank).',
  },
  horizons_weapon_skins: {
    name: 'Tampilan Senjata',
    desc: 'Tampilan senjata Gudang Senjata yang berlaku seakun. Kosong saat luring atau tanpa kosmetik akun; tidak pernah jarahan karakter.',
  },
  horizons_titles: {
    name: 'Gelar',
    desc: 'Gelar yang diraih dari Kitab Jasa. Hanya kosmetik: tidak pernah kekuatan, peluang jarahan, atau kompensasi kesialan.',
  },
  conquerors_the_rift: {
    name: 'Rift',
    desc: 'Rampasan khas dari Rift yang selalu berubah, dari makhluk mengerikan yang berkeliaran sampai dua pusaka buruan peringkat S.',
  },
  conquerors_rares_of_the_realm: {
    name: 'Makhluk Langka Negeri Ini',
    desc: 'Bukti setiap makhluk langka bernama yang ditumbangkan di seluruh negeri.',
  },
  conquerors_spoils_of_the_realm: {
    name: 'Rampasan Negeri Ini',
    desc: 'Pusaka khas yang dibawa oleh para makhluk langka bernama di negeri ini.',
  },
  conquerors_warfare_gallery: {
    name: 'Galeri Peperangan',
    desc: 'Kelima set tempur Peperangan, diraih sepotong demi sepotong dengan kehormatan.',
  },
  conquerors_warfare_armory: {
    name: 'Gudang Senjata Peperangan',
    desc: 'Perhiasan dan senjata Peperangan yang dibeli dengan kehormatan hasil jerih payah.',
  },
  horizons_vault_of_ages: {
    name: 'Ruang Simpan Zaman',
    desc: 'Pusaka yang ditarik dari zaman yang telah lewat. Relik ini tidak bisa lagi diraih; ruang simpan ini menghormati para veteran yang menyimpannya.',
  },
  horizons_riftbound: {
    name: 'Cincin Rift',
    desc: 'Cincin Rift pribadi, ditempa untuk setiap jawara dalam kelompok yang meraih penyelesaian pertama sebuah Rift berperingkat. Setiap karakter hanya bisa memiliki miliknya sendiri.',
  },
};
