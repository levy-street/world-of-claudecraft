<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · **Türkçe** · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# World of ClaudeCraft'a Katkıda Bulunma

Öncelikle, burada olduğunuz için teşekkür ederiz. World of ClaudeCraft, klasik
MMO'ları seven insanlardan oluşan bir topluluk tarafından geliştiriliyor ve
büyük olsun küçük olsun her katkı onu daha iyi hale getiriyor. Bir yazım
hatasını düzeltmek, oyunu çevirmek, bir hata bildirmek, baştan sona yepyeni bir
zindan inşa etmek: hepsinin değeri var ve burada hoş geldiniz.

Bu rehber, kurulumu yapmanıza ve ilk katkınızı sorunsuz bir şekilde
gerçekleştirmenize yardımcı olacak. Uzman olmanıza gerek yok. Bir şey belirsizse
[Discord](https://discord.com/invite/worldofclaudecraft) üzerinden sorun, biri size memnuniyetle
yardımcı olacaktır.

Katılarak, [Davranış Kuralları](../../CODE_OF_CONDUCT.md) belgemize uymayı kabul
etmiş olursunuz.

## Katkıda bulunma yolları

Burada herkes için bir yer var:

- **Kod.** Bir hatayı düzeltin, bir özellik ekleyin veya performansı iyileştirin.
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  ve [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  etiketli sorunlar başlamak için iyi yerlerdir.
- **Çeviriler.** Bir dili iyileştirerek veya tamamlayarak dünyanın dört bir
  yanındaki oyunculara yardım edin. Aşağıdaki [Oyunu çevirme](#translating-the-game)
  bölümüne bakın. Bu, başlamanın en kolay ve en etkili yollarından biridir.
- **Hata bildirimleri ve özellik fikirleri.** Bir [sorun](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)
  açın. Net bir hata bildirimi gerçek bir katkıdır.
- **Belgeler.** Bunun gibi rehberler, README ve `docs/` içindeki tasarım belgeleri
  her zaman iyileştirilebilir.
- **Oyun testi ve geri bildirim.** Oyunu oynayın, neyin yanlış hissettirdiğini
  bize söyleyin ve Discord'da fikirlerinizi paylaşın.

## Başlarken

[Node.js 22+](https://nodejs.org/) ve npm gerekecek. Çok oyunculu sunucu için
Postgres çalıştırmak üzere ayrıca [Docker](https://www.docker.com/) isteyeceksiniz.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

Çevrimdışı dünyayı oynamak ve çoğu şey üzerinde çalışmak için bu kadarı yeterli.
Tam çevrimiçi yığını çalıştırmak için:

```bash
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

[README](../../README.md), tam barındırma, geliştirme ve oynama rehberini içerir
ve depo genelindeki `CLAUDE.md` dosyaları her alan için kuralları belgeler.

## Değişikliğinizi yapma

1. `main` üzerinden bir **dal oluşturun**: `feature/<short-slug>` veya
   `fix/<short-slug>`.
2. **Odaklı commit'ler yapın.** Daha küçük, kendi içinde bütünlüklü
   değişiklikleri incelemek ve birleştirmek büyük olanlardan daha kolaydır.
3. `src/sim/` veya `server/` içinde değiştirdiğiniz her davranış için **test
   ekleyin veya güncelleyin**.
4. **Oyuncuya görünen metni çevrilebilir tutun.** [Yerelleştirme](#localization)
   ve [Oyunu çevirme](#translating-the-game) bölümlerine bakın.

### Akılda tutulması gerekenler

Bunlar kod tabanının yük taşıyan kurallarıdır. Tüm ayrıntılar kök
[`CLAUDE.md`](../../CLAUDE.md) içinde yer alıyor, ama kısa hali:

- **Simülasyon çekirdeği (`src/sim/`) doğruluğun kaynağıdır** ve saf kalır;
  DOM, tarayıcı veya Three.js içe aktarımı yoktur; böylece tam olarak aynı kod
  çevrimdışı, sunucuda ve başsız RL ortamında çalışır.
- **Simülasyon deterministiktir.** Sabit bir 20 Hz tick ile çalışır ve tüm
  rastgelelik `Rng` üzerinden geçer; sim mantığında asla `Math.random`,
  `Date.now` veya `performance.now` kullanılmaz. Aynı tohum (seed) her zaman aynı
  dünyayı üretir.
- **Oynanış matematiği klasik dönem MMO formüllerini izler** (öfke, isabet
  tabloları, zırh, XP eğrileri). Lütfen denge sayıları uydurmayın. Bunun yerine
  formülü gösterin.
- `*.generated.ts` gibi **üretilen dosyaları elle düzenlemeyin.** Bunları derleme
  yoluyla yeniden üretin.
- **Asla sırları** veya bir `.env` dosyasını commit etmeyin ve üretim yolunda
  asla `ALLOW_DEV_COMMANDS` etkinleştirmeyin; bu hileleri açar.

## Bir pull request açmadan önce

Lütfen bunları yerelde çalıştırın. Bunlar CI'nin çalıştırdığı kontrollerin
aynısıdır:

```bash
npm test                    # Vitest suite
npx tsc --noEmit            # TypeScript typecheck (the project is strict)
npm run security:gate       # malicious-code release gate (high-severity signatures; also asserted by npm test)
npm run build               # production client build
```

Sunucu veya başsız kodu değiştirdiyseniz, ayrıca `npm run build:server` ve
`npm run build:env` çalıştırın.

Ardından, oyuncuların gördüğü herhangi bir şeye dokunuyorsa, değişikliğinizi hem
masaüstünde hem de mobilde test edin; dikey ve yatay konumda telefon boyutunda
bir görüntü alanı da dahil olmak üzere. Dokunma hedefleri en az 40x40px ve form
girişleri en az 16px yazı tipi boyutunda kalmalıdır. Arayüz standartları
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) içinde belgelenmiştir.

## Pull request açma

Dalınızı gönderin ve `main` üzerine bir PR açın. [Pull request şablonu](../../.github/PULL_REQUEST_TEMPLATE.md)
sizi kısa bir kontrol listesinde yönlendirecek. Lütfen onu doldurun:

- **Neyin** değiştiğini ve **neden** değiştiğini açıklayın.
- İlgili herhangi bir sorunu bağlayın (örneğin, "Closes #123").
- Arayüz değişiklikleri için masaüstü ve mobilde **ekran görüntüsü veya bir klip
  ekleyin**.
- Testlerin, tip kontrolünün ve derlemenin geçtiğini ve yeni dizgelerin
  çevrildiğini onaylayın.

Birleştirmeden önce aradığımız şey, yeşil bir CI çalışması ve tamamlanmış bir
kontrol listesidir. Bir bakım yöneticisi değişiklikler önerebilir. Bu, sürecin
normal ve işbirlikçi bir parçasıdır, bir reddetme değil. İncelemede nazik ve
yapıcı olmayı amaçlıyoruz ve aynısını sizden de rica ediyoruz.

> Commit mesajları ve PR başlıkları, uyduğu yerde bir kapsam ile birlikte
> [Conventional Commits](https://www.conventionalcommits.org/) biçimini izler
> (`feat(talents): ...`, `fix(net): ...`). Bu, katı bir gereklilikten çok
> sevdiğimiz bir konvansiyondur. Net, açıklayıcı mesajlar mükemmel biçimlendirmeden
> daha önemlidir.

<a id="localization"></a>

## Yerelleştirme

World of ClaudeCraft birçok dilde sunuluyor ve oyun büyüdükçe bunu böyle
sürdürüyoruz. Oyuncuya görünen her dizge, desteklenen her yerel ayara çevrilir.

- Kullanıcıya yönelik tüm metinler [`src/ui/i18n.ts`](../../src/ui/i18n.ts)
  içinde tanımlanmış bir `t()` anahtarıdır. Önce `en` yerel ayarına yeni bir dizge
  ekleyin, ardından `supportedLanguages` içindeki diğer her yerel ayarda gerçek bir
  çeviri sağlayın. İngilizce yer tutucu yok ve `// TODO` yok.
- Sayılar, para, tarihler, birimler ve yüzdeler, manuel dizge oluşturma yerine
  biçimlendiricilerden (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`)
  geçer.
- Dilden bağımsız kalan `src/sim/` veya `server/` içinden yayılan oyuncuya yönelik
  metinler, aynı değişiklikte istemci sınırında yeniden yerelleştirilmelidir.
  Koruma testi `npx vitest run tests/localization_fixes.test.ts` bunu uygular.

Değişikliğiniz bir dizge ekliyorsa ve onu yalnızca bazı dillerde
yazabiliyorsanız, sorun değil. PR'ı açın ve açıklamada geri kalanı için yardım
isteyin. Sizi geri tutmaktansa bitirmenize yardım etmeyi çok daha fazla tercih
ederiz.

<a id="translating-the-game"></a>

## Oyunu çevirme

Bir dili iyileştirmek ya da oyunu yeni bir dile taşımaya yardım etmek mi
istiyorsunuz? Bunu yapmak için herhangi bir oyun kodu yazmanıza gerek yok:

1. [`src/ui/i18n.ts`](../../src/ui/i18n.ts) dosyasını açın ve üzerinde çalışmak
   istediğiniz yerel ayarı bulun. Her yerel ayar nesnesi `en` ile aynı anahtarları
   listeler.
2. Mevcut çevirileri iyileştirin veya kulağa garip gelen çevirileri doldurun.
3. Hiçbir şeyin eksik olmadığını doğrulamak için `npx tsc --noEmit` çalıştırın,
   ardından bir PR açın.

Yepyeni bir yerel ayar önermek veya üslup ve terminolojiyi tartışmak için
[Discord](https://discord.com/invite/worldofclaudecraft) üzerinde bir konu başlatın, onu bağlamanıza
yardımcı olacağız. Anadili olan ve akıcı konuşanlar özellikle hoş karşılanır. İyi
çeviriler, oyunu her yerdeki oyuncular için ev gibi hissettirir.

## Hata bildirme ve özellik isteme

Lütfen [sorun şablonlarını](https://github.com/levy-street/world-of-claudecraft/issues/new/choose)
kullanın:

- **Hata bildirimi.** Yinelenmeleri önlemek için önce [mevcut sorunları](https://github.com/levy-street/world-of-claudecraft/issues)
  arayın, ardından yeniden oluşturma adımlarını, ne beklediğinizi, ne olduğunu ve
  ortamınızı (çevrimdışı veya çevrimiçi, tarayıcı, masaüstü veya mobil) ekleyin.
- **Özellik isteği.** Yalnızca çözümü değil, çözmeye çalıştığınız sorunu açıklayın.
  Bağlam, doğru şeyi tasarlamamıza yardımcı olur.

## Yardım alma

Takıldınız mı, yoksa sadece merhaba mı demek istiyorsunuz? [Topluluk Discord'una](https://discord.com/invite/worldofclaudecraft)
katılın. Hiçbir soru çok küçük değildir ve yeni katkıda bulunanlar her zaman hoş
karşılanır.

## Lisans

Katkıda bulunarak, katkılarınızın, projeyi kapsayan lisansın aynısı olan projenin
[MIT Lisansı](../../LICENSE) altında lisanslanacağını kabul edersiniz.

---

World of ClaudeCraft'a katkıda bulunduğunuz için teşekkür ederiz. Bizimle birlikte
ne inşa edeceğinizi görmek için sabırsızlanıyoruz.
