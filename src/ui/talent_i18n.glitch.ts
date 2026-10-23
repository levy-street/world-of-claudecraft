// Glitch talent titles (spec, mastery, and choice-row names in
// src/sim/content/glitch_talents.ts) for every translated locale. Merged into the
// talent title overrides by talent_i18n.ts. es_ES and fr_CA share the es / fr_FR rows.
import type { SupportedLanguage } from './i18n';

const ROWS: Record<string, string> = {
  es: 'Sobrerreloj|Entropía|Caja de arena|Sobrevoltaje|Decadencia lenta|Aislamiento|Cambio en caliente|Banda ancha|Precarga|Byte rápido|Ruido intenso|Fuga profunda|Búfer|Pico|Bucle cerrado|Redundancia|Endurecido|Instantánea|Reacción en cadena|Copia cero|Fallo persistente|Sobremarcha|Inversión de bit|Paridad',
  fr_FR:
    'Surcadençage|Entropie|Bac à sable|Survoltage|Lente déchéance|Isolement|Échange à chaud|Large bande|Prélecture|Octet rapide|Bruit assourdissant|Fuite profonde|Tampon|Pic|Boucle serrée|Redondance|Durci|Instantané|Réaction en chaîne|Copie zéro|Faute persistante|Surrégime|Inversion de bit|Parité',
  it_IT:
    'Sovrafrequenza|Entropia|Ambiente isolato|Sovratensione|Decadimento lento|Isolamento|Scambio a caldo|Banda larga|Precaricamento|Byte rapido|Rumore assordante|Perdita profonda|Memoria tampone|Picco|Ciclo stretto|Ridondanza|Temprato|Istantanea|Reazione a catena|Copia zero|Guasto persistente|Sovramarcia|Inversione di bit|Parità',
  de_DE:
    'Übertaktung|Entropie|Sandkasten|Überspannung|Langsamer Verfall|Isolation|Heißtausch|Breitband|Vorabruf|Schnelles Byte|Lauter Lärm|Tiefes Leck|Puffer|Spitze|Enge Schleife|Redundanz|Gehärtet|Momentaufnahme|Kettenreaktion|Nullkopie|Beständiger Fehler|Volllast|Bitkipper|Parität',
  zh_CN:
    '超频|熵增|沙盒|过压|缓慢衰变|隔离|热插拔|宽频|预取|快速字节|喧嚣噪声|深度泄漏|缓冲|尖峰|紧密循环|冗余|加固|快照|连锁反应|零拷贝|持续故障|超载驱动|位翻转|奇偶校验',
  zh_TW:
    '超頻|熵增|沙盒|過壓|緩慢衰變|隔離|熱插拔|寬頻|預取|快速位元組|喧囂噪聲|深度洩漏|緩衝|尖峰|緊密迴圈|冗餘|加固|快照|連鎖反應|零複製|持續故障|超載驅動|位元翻轉|同位檢查',
  ko_KR:
    '오버클럭|엔트로피|샌드박스|과전압|느린 붕괴|격리|핫 스왑|광대역|프리페치|빠른 바이트|요란한 잡음|깊은 누수|버퍼|스파이크|촘촘한 루프|중복성|강화|스냅샷|연쇄 반응|제로 카피|지속 결함|오버드라이브|비트 반전|패리티',
  ja_JP:
    'オーバークロック|エントロピー|サンドボックス|過電圧|緩やかな崩壊|隔離|ホットスワップ|広帯域|プリフェッチ|高速バイト|轟音ノイズ|深いリーク|バッファ|スパイク|タイトループ|冗長化|硬化|スナップショット|連鎖反応|ゼロコピー|持続する障害|オーバードライブ|ビット反転|パリティ',
  pt_BR:
    'Sobrefrequência|Entropia|Caixa de areia|Sobretensão|Decadência lenta|Isolamento|Troca a quente|Banda larga|Pré-busca|Byte rápido|Ruído alto|Vazamento profundo|Memória intermediária|Pico|Laço apertado|Redundância|Endurecido|Instantâneo|Reação em cadeia|Cópia zero|Falha persistente|Sobremarcha|Inversão de bit|Paridade',
  ru_RU:
    'Разгон|Энтропия|Песочница|Перенапряжение|Медленный распад|Изоляция|Горячая замена|Широкая полоса|Предвыборка|Быстрый байт|Громкий шум|Глубокая утечка|Буфер|Всплеск|Тесный цикл|Избыточность|Закалка|Снимок|Цепная реакция|Нулевое копирование|Устойчивый сбой|Форсаж|Переворот бита|Чётность',
  cs_CZ:
    'Přetaktování|Entropie|Pískoviště|Přepětí|Pomalý rozpad|Izolace|Výměna za chodu|Široké pásmo|Předčítání|Rychlý bajt|Hlasitý šum|Hluboký únik|Vyrovnávací paměť|Špička|Těsná smyčka|Redundance|Zocelený|Snímek|Řetězová reakce|Nulová kopie|Trvalá chyba|Přetížení|Převrácení bitu|Parita',
  nl_NL:
    'Overklokken|Entropie|Zandbak|Overspanning|Traag verval|Isolatie|Heet wisselen|Breedband|Vooraf ophalen|Snelle byte|Luid geruis|Diep lek|Tussengeheugen|Piek|Strakke lus|Redundantie|Gehard|Momentopname|Kettingreactie|Nulkopie|Hardnekkige fout|Overbelasting|Bitomslag|Pariteit',
  pl_PL:
    'Podkręcenie|Entropia|Piaskownica|Przepięcie|Powolny rozpad|Izolacja|Wymiana na gorąco|Szerokie pasmo|Wstępne pobieranie|Szybki bajt|Głośny szum|Głęboki wyciek|Bufor|Skok|Ciasna pętla|Redundancja|Utwardzenie|Migawka|Reakcja łańcuchowa|Zerowa kopia|Trwała usterka|Przeciążenie|Odwrócenie bitu|Parzystość',
  id_ID:
    'Pacu Jam|Entropi|Kotak Pasir|Tegangan Lebih|Peluruhan Lambat|Isolasi|Tukar Panas|Pita Lebar|Praambil|Bita Cepat|Derau Keras|Kebocoran Dalam|Penyangga|Lonjakan|Putaran Rapat|Redundansi|Diperkeras|Cuplikan|Reaksi Berantai|Salinan Nol|Kesalahan Menetap|Kecepatan Lebih|Balik Bit|Paritas',
  tr_TR:
    'Hız Aşırtma|Entropi|Kum Havuzu|Aşırı Gerilim|Yavaş Çürüme|Yalıtım|Sıcak Takas|Geniş Bant|Ön Getirme|Hızlı Bayt|Yüksek Gürültü|Derin Sızıntı|Tampon|Sıçrama|Sıkı Döngü|Yedeklilik|Sertleşmiş|Anlık Görüntü|Zincirleme Tepki|Sıfır Kopya|Kalıcı Arıza|Aşırı Sürüş|Bit Çevirme|Eşlik',
  sv_SE:
    'Överklockning|Entropi|Sandlåda|Överspänning|Långsamt förfall|Isolering|Hetbyte|Bredband|Förhämtning|Snabb byte|Högt brus|Djup läcka|Buffert|Topp|Tät slinga|Redundans|Härdad|Ögonblicksbild|Kedjereaktion|Nollkopia|Ihållande fel|Överväxel|Bitvändning|Paritet',
  vi_VN:
    'Ép xung|Hỗn loạn|Hộp cát|Quá áp|Phân rã chậm|Cô lập|Tráo nóng|Băng rộng|Tìm nạp trước|Byte nhanh|Nhiễu lớn|Rò rỉ sâu|Bộ đệm|Đột biến|Vòng lặp chặt|Dự phòng|Tôi luyện|Ảnh chụp nhanh|Phản ứng dây chuyền|Sao chép không|Lỗi dai dẳng|Quá tải|Lật bit|Chẵn lẻ',
  da_DK:
    'Overtaktning|Entropi|Sandkasse|Overspænding|Langsomt forfald|Isolation|Varmbytte|Bredbånd|Forhåndshentning|Hurtig byte|Høj støj|Dyb lækage|Mellemlager|Spids|Stram løkke|Redundans|Hærdet|Øjebliksbillede|Kædereaktion|Nulkopi|Vedvarende fejl|Overgear|Bitvending|Paritet',
};

const NAMES = [
  'Overclock',
  'Entropy',
  'Sandbox',
  'Overvolt',
  'Slow Decay',
  'Isolation',
  'Hot Swap',
  'Wide Band',
  'Prefetch',
  'Quick Byte',
  'Loud Noise',
  'Deep Leak',
  'Buffer',
  'Spike',
  'Tight Loop',
  'Redundancy',
  'Hardened',
  'Snapshot',
  'Chain Reaction',
  'Zero Copy',
  'Persistent Fault',
  'Overdrive',
  'Bit Flip',
  'Parity',
];

function table(row: string): Record<string, string> {
  const values = row.split('|');
  return Object.fromEntries(NAMES.map((name, i) => [name, values[i]]));
}

export const GLITCH_TITLE_OVERRIDES: Partial<Record<SupportedLanguage, Record<string, string>>> = {
  ...Object.fromEntries(Object.entries(ROWS).map(([lang, row]) => [lang, table(row)])),
  es_ES: table(ROWS.es),
  fr_CA: table(ROWS.fr_FR),
};
