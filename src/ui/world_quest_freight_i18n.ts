import type { EntityKind } from '../sim/types';
import { worldQuestCaravanForMob } from '../sim/world_quest_caravans';
import type { SupportedLanguage } from './i18n';
import { localizeFrostveilFreightYell } from './world_quest_frostveil_freight_i18n';
import { localizeWillowfenFreightYell } from './world_quest_willowfen_freight_i18n';

/** The driver shares the wagon's entity id but owns his authored chat name. */
export function worldQuestFreightSpeakerName(
  name: string,
  speakerKind?: EntityKind,
  templateId?: string,
): string | null {
  if (speakerKind !== 'mob' || !templateId) return null;
  const speaker = worldQuestCaravanForMob(templateId)?.story?.speaker;
  return name === speaker ? name : null;
}

type FreightYellKey = 'start' | 'success' | 'fail';

const ENGLISH: Record<FreightYellKey, string> = {
  start: "Keep close! Eastbrook's provisions must reach the market.",
  success: 'The freight is safe. Eastbrook owes you a debt.',
  fail: 'The caravan is lost!',
};

const YELLS: Record<SupportedLanguage, Record<FreightYellKey, string>> = {
  en: ENGLISH,
  en_CA: ENGLISH,
  es: {
    start: '¡Mantente cerca! Las provisiones de Eastbrook deben llegar al mercado.',
    success: 'La mercancía está a salvo. Eastbrook está en deuda contigo.',
    fail: '¡La caravana se ha perdido!',
  },
  es_ES: {
    start: '¡Mantente cerca! Las provisiones de Eastbrook deben llegar al mercado.',
    success: 'La mercancía está a salvo. Eastbrook está en deuda contigo.',
    fail: '¡La caravana se ha perdido!',
  },
  fr_FR: {
    start: "Restez près ! Les provisions d'Eastbrook doivent atteindre le marché.",
    success: 'La cargaison est sauvée. Eastbrook vous doit une fière chandelle.',
    fail: 'La caravane est perdue !',
  },
  fr_CA: {
    start: "Restez près ! Les provisions d'Eastbrook doivent atteindre le marché.",
    success: 'La cargaison est sauvée. Eastbrook vous doit une fière chandelle.',
    fail: 'La caravane est perdue !',
  },
  it_IT: {
    start: 'Restate vicini! Le provviste di Eastbrook devono raggiungere il mercato.',
    success: 'Il carico è al sicuro. Eastbrook vi è debitrice.',
    fail: 'La carovana è perduta!',
  },
  de_DE: {
    start: 'Bleibt in der Nähe! Eastbrooks Vorräte müssen den Markt erreichen.',
    success: 'Die Fracht ist sicher. Eastbrook steht in eurer Schuld.',
    fail: 'Die Karawane ist verloren!',
  },
  zh_CN: {
    start: '跟紧点！东溪的补给必须送到市场。',
    success: '货物安全了。东溪欠你一份人情。',
    fail: '商队全完了！',
  },
  zh_TW: {
    start: '跟緊點！東溪的補給必須送到市場。',
    success: '貨物安全了。東溪欠你一份人情。',
    fail: '商隊全完了！',
  },
  ko_KR: {
    start: '바짝 붙으세요! 이스트브룩의 보급품을 시장까지 보내야 합니다.',
    success: '화물은 무사합니다. 이스트브룩이 당신에게 빚을 졌군요.',
    fail: '대상단을 잃었습니다!',
  },
  ja_JP: {
    start: '離れないで！ イーストブルックの物資を市場まで届けるんだ。',
    success: '積み荷は無事だ。イーストブルックはあなたに借りができた。',
    fail: '隊商が失われた！',
  },
  pt_BR: {
    start: 'Fique perto! As provisões de Eastbrook precisam chegar ao mercado.',
    success: 'A carga está segura. Eastbrook tem uma dívida com você.',
    fail: 'A caravana foi perdida!',
  },
  ru_RU: {
    start: 'Не отставайте! Припасы Истврука должны попасть на рынок.',
    success: 'Груз спасён. Истврук у вас в долгу.',
    fail: 'Караван потерян!',
  },
  cs_CZ: {
    start: 'Držte se blízko! Zásoby Eastbrooku se musí dostat na trh.',
    success: 'Náklad je v bezpečí. Eastbrook je vaším dlužníkem.',
    fail: 'Karavana je ztracena!',
  },
  da_DK: {
    start: 'Hold jer tæt på! Eastbrooks forsyninger skal nå frem til markedet.',
    success: 'Fragten er i sikkerhed. Eastbrook står i gæld til jer.',
    fail: 'Karavanen er tabt!',
  },
  id_ID: {
    start: 'Tetap dekat! Perbekalan Eastbrook harus sampai ke pasar.',
    success: 'Muatan sudah aman. Eastbrook berutang budi kepadamu.',
    fail: 'Kafilahnya hilang!',
  },
  nl_NL: {
    start: 'Blijf dichtbij! De voorraden van Eastbrook moeten de markt bereiken.',
    success: 'De vracht is veilig. Eastbrook staat bij je in het krijt.',
    fail: 'De karavaan is verloren!',
  },
  pl_PL: {
    start: 'Trzymajcie się blisko! Zapasy Eastbrook muszą dotrzeć na targ.',
    success: 'Ładunek jest bezpieczny. Eastbrook ma u was dług.',
    fail: 'Karawana przepadła!',
  },
  sv_SE: {
    start: 'Håll er nära! Eastbrooks förnödenheter måste nå marknaden.',
    success: 'Lasten är säker. Eastbrook står i skuld till er.',
    fail: 'Karavanen är förlorad!',
  },
  tr_TR: {
    start: 'Yakın durun! Eastbrook erzakları pazara ulaşmalı.',
    success: 'Yük güvende. Eastbrook size borçlandı.',
    fail: 'Kervan kaybedildi!',
  },
  vi_VN: {
    start: 'Hãy theo sát! Nhu yếu phẩm của Eastbrook phải đến được khu chợ.',
    success: 'Hàng hóa đã an toàn. Eastbrook nợ bạn một ân tình.',
    fail: 'Đoàn xe đã mất!',
  },
};

const KEY_BY_ENGLISH = new Map(
  (Object.entries(ENGLISH) as [FreightYellKey, string][]).map(([key, text]) => [text, key]),
);

type StoryLines = readonly [string, string, string, string, string, string];
const STORY_ENGLISH: StoryLines = [
  "I'm Tobin. This is my old friend Bram's last delivery. Stay close.",
  'Bram vanished on the north road. His last letter asked me to bring this chest to the market.',
  "The bandits heard 'precious cargo'. Bram never owned anything worth stealing.",
  "Inside? Wooden horses and patched dolls. He repaired them for Eastbrook's children.",
  'We made it, Bram. Your toys are home. Thank you for helping me keep my promise.',
  'Hands off that chest! Cover the horses!',
];
const STORY_SPANISH: StoryLines = [
  'Soy Tobin. Esta es la última entrega de mi viejo amigo Bram. Quédate cerca.',
  'Bram desapareció en el camino del norte. En su última carta me pidió llevar este cofre al mercado.',
  'Los bandidos oyeron «carga valiosa». Bram nunca tuvo nada que mereciera la pena robar.',
  '¿Qué hay dentro? Caballitos de madera y muñecas remendadas. Los reparaba para los niños de Eastbrook.',
  'Lo logramos, Bram. Tus juguetes están en casa. Gracias por ayudarme a cumplir mi promesa.',
  '¡Apartaos del cofre! ¡Proteged a los caballos!',
];
const STORY_FRENCH: StoryLines = [
  'Je suis Tobin. Voici la dernière livraison de mon vieil ami Bram. Restez près de moi.',
  "Bram a disparu sur la route du nord. Sa dernière lettre me demandait d'apporter ce coffre au marché.",
  "Les bandits ont entendu « cargaison précieuse ». Bram n'a jamais rien possédé qui valait la peine d'être volé.",
  "À l'intérieur ? Des chevaux de bois et des poupées rapiécées. Il les réparait pour les enfants d'Eastbrook.",
  "Nous y sommes, Bram. Tes jouets sont chez eux. Merci de m'avoir aidé à tenir ma promesse.",
  'Ne touchez pas à ce coffre ! Protégez les chevaux !',
];
const STORY: Record<SupportedLanguage, StoryLines> = {
  en: STORY_ENGLISH,
  en_CA: STORY_ENGLISH,
  es: STORY_SPANISH,
  es_ES: STORY_SPANISH,
  fr_FR: STORY_FRENCH,
  fr_CA: STORY_FRENCH,
  it_IT: [
    'Sono Tobin. Questa è l’ultima consegna del mio vecchio amico Bram. Restate vicini.',
    'Bram è scomparso sulla strada a nord. Nella sua ultima lettera mi chiedeva di portare questa cassa al mercato.',
    'I banditi hanno sentito «carico prezioso». Bram non ha mai posseduto nulla che valesse la pena rubare.',
    'Dentro? Cavallini di legno e bambole rattoppate. Li riparava per i bambini di Eastbrook.',
    'Ce l’abbiamo fatta, Bram. I tuoi giocattoli sono a casa. Grazie per avermi aiutato a mantenere la promessa.',
    'Giù le mani dalla cassa! Proteggete i cavalli!',
  ],
  de_DE: [
    'Ich bin Tobin. Das ist die letzte Lieferung meines alten Freundes Bram. Bleibt in meiner Nähe.',
    'Bram verschwand auf der Nordstraße. In seinem letzten Brief bat er mich, diese Truhe zum Markt zu bringen.',
    'Die Banditen hörten «wertvolle Fracht». Bram besaß nie etwas, das einen Diebstahl wert gewesen wäre.',
    'Was drin ist? Holzpferde und geflickte Puppen. Er reparierte sie für Eastbrooks Kinder.',
    'Wir haben es geschafft, Bram. Dein Spielzeug ist daheim. Danke, dass ich mein Versprechen halten konnte.',
    'Hände weg von der Truhe! Beschützt die Pferde!',
  ],
  zh_CN: [
    '我叫托宾。这是老友布拉姆最后一批货。请跟紧我。',
    '布拉姆在北边的路上失踪了。他最后的信让我把这口箱子送到市场。',
    '强盗听说了“贵重货物”。可布拉姆从来没有值得偷的财物。',
    '里面是什么？木马和缝补过的娃娃。他为东溪的孩子们修好了这些玩具。',
    '我们做到了，布拉姆。你的玩具到家了。谢谢你帮我履行承诺。',
    '别碰箱子！保护马匹！',
  ],
  zh_TW: [
    '我叫托賓。這是老友布拉姆最後一批貨。請跟緊我。',
    '布拉姆在北邊的路上失蹤了。他最後的信讓我把這口箱子送到市場。',
    '強盜聽說了「貴重貨物」。可布拉姆從來沒有值得偷的財物。',
    '裡面是什麼？木馬和縫補過的娃娃。他為東溪的孩子們修好了這些玩具。',
    '我們做到了，布拉姆。你的玩具到家了。謝謝你幫我履行承諾。',
    '別碰箱子！保護馬匹！',
  ],
  ja_JP: [
    '俺はトビン。これは古い友人ブラムの最後の配達だ。そばにいてくれ。',
    'ブラムは北の道で姿を消した。最後の手紙で、この箱を市場へ届けてくれと頼まれたんだ。',
    '山賊は「貴重な荷物」と聞いたらしい。ブラムには盗むほどの財産なんてなかったよ。',
    '中身？ 木馬と繕った人形さ。イーストブルックの子供たちのために直していたんだ。',
    '着いたぞ、ブラム。お前のおもちゃは帰ってきた。約束を果たすのを手伝ってくれてありがとう。',
    'その箱に触るな！ 馬を守ってくれ！',
  ],
  ko_KR: [
    '나는 토빈이오. 오랜 친구 브람의 마지막 배달이지. 가까이 있어 주시오.',
    '브람은 북쪽 길에서 사라졌소. 마지막 편지에서 이 상자를 시장에 전해 달라고 했지.',
    '도적들이 귀중한 화물이라는 말을 들었나 보군. 브람에겐 훔칠 만한 재산도 없었는데.',
    '안에 뭐가 있냐고? 나무 말과 기운 인형들이오. 이스트브룩 아이들을 위해 고쳤다오.',
    '해냈어, 브람. 네 장난감들이 집에 왔어. 약속을 지키게 도와줘서 고맙소.',
    '상자에서 손 떼라! 말들을 지켜 주시오!',
  ],
  ru_RU: [
    'Я Тобин. Это последняя доставка моего старого друга Брама. Держитесь рядом.',
    'Брам пропал на северной дороге. В последнем письме он просил доставить этот сундук на рынок.',
    'Бандиты услышали про «ценный груз». А у Брама никогда не было ничего, что стоило бы красть.',
    'Что внутри? Деревянные лошадки и заштопанные куклы. Он чинил их для детей Истврука.',
    'Мы добрались, Брам. Твои игрушки дома. Спасибо, что помогли мне сдержать обещание.',
    'Руки прочь от сундука! Защитите лошадей!',
  ],
  pt_BR: [
    'Sou Tobin. Esta é a última entrega do meu velho amigo Bram. Fique por perto.',
    'Bram desapareceu na estrada do norte. Na última carta, pediu que eu levasse este baú ao mercado.',
    'Os bandidos ouviram falar em «carga preciosa». Bram nunca teve nada que valesse a pena roubar.',
    'O que tem dentro? Cavalinhos de madeira e bonecas remendadas. Ele os consertava para as crianças de Eastbrook.',
    'Conseguimos, Bram. Seus brinquedos chegaram em casa. Obrigado por me ajudar a cumprir minha promessa.',
    'Tirem as mãos do baú! Protejam os cavalos!',
  ],
  cs_CZ: [
    'Jsem Tobin. Tohle je poslední dodávka mého starého přítele Brama. Držte se blízko.',
    'Bram zmizel na severní cestě. V posledním dopise mě požádal, abych tuhle truhlu dovezl na trh.',
    'Bandité zaslechli «vzácný náklad». Bram nikdy neměl nic, co by stálo za krádež.',
    'Co je uvnitř? Dřevění koníci a záplatované panenky. Opravoval je pro děti z Eastbrooku.',
    'Dokázali jsme to, Brame. Tvé hračky jsou doma. Díky, že jste mi pomohli dodržet slib.',
    'Ruce pryč od truhly! Chraňte koně!',
  ],
  da_DK: [
    'Jeg er Tobin. Dette er min gamle ven Brams sidste levering. Hold jer tæt på.',
    'Bram forsvandt på vejen mod nord. Hans sidste brev bad mig bringe denne kiste til markedet.',
    'Banditterne hørte «dyrebar last». Bram ejede aldrig noget, der var værd at stjæle.',
    'Indeni? Træheste og lappede dukker. Han reparerede dem til Eastbrooks børn.',
    'Vi klarede det, Bram. Dit legetøj er hjemme. Tak, fordi I hjalp mig med at holde mit løfte.',
    'Fingrene væk fra kisten! Beskyt hestene!',
  ],
  id_ID: [
    'Aku Tobin. Ini kiriman terakhir sahabat lamaku, Bram. Tetaplah dekat.',
    'Bram menghilang di jalan utara. Surat terakhirnya memintaku membawa peti ini ke pasar.',
    'Para bandit mendengar «muatan berharga». Bram tak pernah punya barang yang layak dicuri.',
    'Isinya? Kuda kayu dan boneka yang ditambal. Dia memperbaikinya untuk anak-anak Eastbrook.',
    'Kita berhasil, Bram. Mainanmu sudah pulang. Terima kasih telah membantuku menepati janji.',
    'Jangan sentuh peti itu! Lindungi kuda-kudanya!',
  ],
  nl_NL: [
    'Ik ben Tobin. Dit is de laatste levering van mijn oude vriend Bram. Blijf dichtbij.',
    'Bram verdween op de noordelijke weg. In zijn laatste brief vroeg hij deze kist naar de markt te brengen.',
    'De bandieten hoorden «kostbare lading». Bram bezat nooit iets dat het stelen waard was.',
    'Wat erin zit? Houten paardjes en opgelapte poppen. Hij repareerde ze voor de kinderen van Eastbrook.',
    'Het is gelukt, Bram. Je speelgoed is thuis. Bedankt dat je me hielp mijn belofte te houden.',
    'Handen af van die kist! Bescherm de paarden!',
  ],
  pl_PL: [
    'Jestem Tobin. To ostatnia dostawa mojego starego przyjaciela Brama. Trzymajcie się blisko.',
    'Bram zaginął na północnym trakcie. W ostatnim liście prosił, bym zawiózł tę skrzynię na targ.',
    'Bandyci usłyszeli o «cennym ładunku». Bram nigdy nie miał nic wartego kradzieży.',
    'Co jest w środku? Drewniane koniki i połatane lalki. Naprawiał je dla dzieci z Eastbrook.',
    'Udało się, Bram. Twoje zabawki są w domu. Dziękuję za pomoc w dotrzymaniu obietnicy.',
    'Ręce precz od skrzyni! Chrońcie konie!',
  ],
  sv_SE: [
    'Jag heter Tobin. Det här är min gamle vän Brams sista leverans. Håll er nära.',
    'Bram försvann på vägen norrut. I sitt sista brev bad han mig köra den här kistan till marknaden.',
    'Banditerna hörde «dyrbar last». Bram ägde aldrig något värt att stjäla.',
    'Inuti? Trähästar och lagade dockor. Han lagade dem åt Eastbrooks barn.',
    'Vi klarade det, Bram. Dina leksaker är hemma. Tack för att ni hjälpte mig hålla mitt löfte.',
    'Bort med händerna från kistan! Skydda hästarna!',
  ],
  tr_TR: [
    'Ben Tobin. Bu, eski dostum Bram’in son teslimatı. Yakınımda kalın.',
    'Bram kuzey yolunda kayboldu. Son mektubunda bu sandığı pazara götürmemi istedi.',
    'Haydutlar «değerli yük» sözünü duymuş. Bram’in çalmaya değer hiçbir şeyi olmadı ki.',
    'İçinde ne mi var? Tahta atlar ve yamalı bebekler. Eastbrook çocukları için onları onarırdı.',
    'Başardık Bram. Oyuncakların eve geldi. Sözümü tutmama yardım ettiğiniz için teşekkürler.',
    'Ellerinizi sandıktan çekin! Atları koruyun!',
  ],
  vi_VN: [
    'Tôi là Tobin. Đây là chuyến giao hàng cuối của bạn cũ Bram. Hãy theo sát tôi.',
    'Bram mất tích trên đường phía bắc. Lá thư cuối nhờ tôi đưa chiếc rương này đến chợ.',
    'Bọn cướp nghe nói có «hàng quý». Bram chưa từng có thứ gì đáng để trộm cả.',
    'Bên trong ư? Ngựa gỗ và búp bê vá lại. Anh ấy sửa chúng cho trẻ em Eastbrook.',
    'Chúng ta làm được rồi, Bram. Đồ chơi của anh đã về nhà. Cảm ơn đã giúp tôi giữ lời hứa.',
    'Bỏ tay khỏi rương! Bảo vệ đàn ngựa!',
  ],
};
const STORY_INDEX_BY_ENGLISH = new Map(STORY_ENGLISH.map((text, index) => [text, index]));

export function localizeWorldQuestFreightYell(
  text: string,
  language: SupportedLanguage,
): string | null {
  const regional =
    localizeWillowfenFreightYell(text, language) ?? localizeFrostveilFreightYell(text, language);
  if (regional !== null) return regional;
  const storyIndex = STORY_INDEX_BY_ENGLISH.get(text);
  if (storyIndex !== undefined) return STORY[language][storyIndex];
  const key = KEY_BY_ENGLISH.get(text);
  return key ? YELLS[language][key] : null;
}
