<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · **Türkçe** · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

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

[Node.js 26](https://nodejs.org/) ve npm gerekecek; bunlar CI'nin ve üretim
imajının kullandığı sürümlerdir. Daha eski ana sürümler test edilmiyor. Çok
oyunculu sunucu için Postgres çalıştırmak üzere ayrıca
[Docker](https://www.docker.com/) isteyeceksiniz.

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

Çevrimdışı dünyayı oynamak ve çoğu şey üzerinde çalışmak için bu kadarı yeterli.
Tam çevrimiçi yığını çalıştırmak için önce ortamınızda bir veritabanı parolası
olması gerekir:

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

Aşağıdaki tam denetimi çalıştırmayı planlıyorsanız, sürdüğü tarayıcıyı bir kez
kurun: `npx playwright install chromium`.

[README](README.tr_TR.md), tam barındırma, geliştirme ve oynama rehberini içerir
ve depo genelindeki `CLAUDE.md` dosyaları her alan için kuralları belgeler.

### TypeScript araç zinciri

Tip denetimi, yerel derleyici olan TypeScript 7 üzerinde çalışıyor:
`npx tsc --noEmit` tam olarak eskisi gibi çalışır ve deponun tamamının denetimi
artık onlarca saniye yerine birkaç saniye sürer. Kurulum, resmi ikili takma ad
düzenini kullanır: `svelte-check` hâlâ o API'yi tükettiği için `typescript`
paketi TypeScript 6 JS API'sini (`@typescript/typescript6` sarmalayıcısı
üzerinden) çözer, `@typescript/native` ise `tsc` ikili dosyasını sağlar.
Bilinmesi gerekenler:

- **Editörler.** VS Code, yerleşik destek gelene kadar yerel dil hizmeti desteği
  için "TypeScript 7" mağaza eklentisine (`TypeScriptTeam.native-preview`)
  ihtiyaç duyar; eklenti `js/ts.experimental.useTsgo` ayarıyla açılıp kapanır ve
  "Disable TypeScript 7 Language Server" komutu, TypeScript 6 tsserver'a dönmek
  için onaylanmış geri dönüş yoludur. JetBrains IDE'leri yerel sunucuyu yalnızca
  `@typescript/native-preview` paket adı altında otomatik algılar, dolayısıyla bu
  deponun `@typescript/native` takma adından onu almazlar; kendi paketledikleri
  TypeScript 6 desteği sorunsuz çalışır.
- **Kullanışlı tsc bayrakları.** `--checkers N`, paralel tip denetleyici işçi
  sayısını belirler (varsayılan 4; sonuçlar her sayıda aynıdır): kısıtlı bir
  koşucuda belleği sınırlamak için düşürün, çok çekirdekli bir makinede
  yükseltin ve her iki durumda da ölçün, çünkü daha fazlası her zaman daha hızlı
  değildir. `--singleThreaded` tüm paralelliği kapatır. Tek bir dosyayı ayrıca
  denetlemek (`npx tsc somefile.ts`), dizinde bir `tsconfig.json` varsa hata
  verir; eski davranış için `--ignoreConfig` geçin.
- **Kilit dosyası.** `package-lock.json` dosyasını yalnızca
  `npx npm@10 install --package-lock-only` ile yeniden üretin: dosya npm 10
  semantiğini kullanır ve daha yeni npm ana sürümleri (CI'nin Node 26'sının
  paketlediği npm 11 dahil) `svelte-check` için iç içe isteğe bağlı eş bağımlılık
  girdilerini sessizce düşürerek CI'de `npm ci` senkronizasyonunu bozar. Düz
  `npm ci` her npm ana sürümünde güvenlidir. Yeniden ürettikten sonra,
  `npm ci --dry-run` çıktısının hem npm 10 hem de iş istasyonunuzun npm'i altında
  senkron olduğunu doğrulayın.
- **Ne zaman yeniden ele alınmalı.** İkili takma adı tek bir `typescript`
  bağımlılığına geri indirmek için HER İKİ koşul da sağlanmalı: TypeScript 7.1
  kararlı JS API'sinin yayımlanmış olması (TypeScript 7.0 hiç JS API'si
  içermiyor; yerine geçecek olan microsoft/typescript-go 2824 numaralı sorunda
  takip ediliyor) ve sveltejs/language-tools 3063 numaralı sorunun, bunu
  benimseyen yayımlanmış bir `svelte-check` ile kapanmış olması. svelte-check'in
  deneysel `--tsgo` modları TypeScript 6 API gereksinimini ortadan kaldırmaz ve
  devam eden TypeScript 7 yükleme çalışması (language-tools PR 3073) bu deponun
  zaten kullandığı `@typescript/native` takma adını okur, yani yeniden
  adlandırmaya gerek yoktur.

## Değişikliğinizi yapma

1. **En son sürüm dalından başlayın, asla `main` üzerinden değil.** Aktif çalışma
   bir `release/vX.Y.Z` dalında birleştirilir; `main` onun gerisinde kalır ve
   katkılar için temel değildir. En yenisini bulun ve ondan dallanın:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Bir sürüm numarasını bu rehberden kopyalamak yerine bu aramayı her zaman
   çalıştırın: sürüm dalları sık sık değişir ve en yenisi her sürümle birlikte
   ilerler. Dallar `feature/<short-slug>` veya `fix/<short-slug>` biçimindedir.
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
- **Yeni mantık, büyük koordinatör dosyalarından birine eklenmek yerine, mevcut
  bir dikiş yerinin arkasında kendi küçük ve testli modülü olarak gelir.**
  Oluşturucunun veya HUD'un okuduğu veriler `IWorld` arayüzünden
  (`src/world_api/`) geçer ve hem çevrimdışı hem çevrimiçi dünyada uygulanır;
  yeni bir simülasyon sistemi `SimContext` arkasına gider; yeni bir REST uç
  noktası ise `npm run new:endpoint` ile iskeletini kurabileceğiniz bir rota
  modülüdür.
- `*.generated.ts` gibi **üretilen dosyaları elle düzenlemeyin.** Bunları derleme
  yoluyla yeniden üretin.
- **Yazım stili kuralımız: hiçbir yerde uzun tire, orta tire veya emoji yok**;
  ne kodda, ne yorumlarda, ne belgelerde, ne commit mesajlarında, ne PR
  metninde, ne de oyuncuya yönelik metinlerde. Aralıklar için virgül, iki nokta,
  parantez veya "to" kullanın. Push öncesi bir kontrol diff'inizi tarar ve bir
  eşleşme bulursa push'u engeller.
- **Asla sırları** veya bir `.env` dosyasını commit etmeyin ve üretim yolunda
  asla `ALLOW_DEV_COMMANDS` etkinleştirmeyin; bu hileleri açar.

### Kod stili

Biçimlendirme [Biome](https://biomejs.dev/) ile yapılır ve `biome.json` içinde
yapılandırılmıştır: 2 boşluk girinti, 100 sütunluk satırlar, tek tırnak, sondaki
virgüller. Yalnızca dokunduğunuz dosyaları biçimlendirin
(`npx @biomejs/biome check --write <your-file.ts>`) ve onları `npm run ci:changed`
ile kontrol edin. CI yalnızca değişen dosyaları denetler, bu yüzden lütfen ağacın
geri kalanını yeniden biçimlendirmeyin: depo genelinde bir çalıştırma, sizin
düzeltmeniz gerekmeyen eski borçları ortaya çıkarır.

## Bir pull request açmadan önce

Depo denetimini yerelde çalıştırın. Bu, CI'nin dayattığı sözleşmenin aynısıdır:

```bash
npm run gate
```

Üzerinde çalışırken tek bir takım çalıştırın (`npx vitest run tests/sim.test.ts`)
ve biçimlendirme için `npm run ci:changed` kullanın; `npm test` her şeyi
çalıştırır ve takım haritası `tests/CLAUDE.md` içindedir. Tam `npm run gate`
şunları kapsar: üretilen yapıtların tazeliği, kötü amaçlı yazılım taraması,
değişen dosyalarda biçimlendirme, ses efekti uyumluluk kontrolü, tüm test takımı,
gerçek tarayıcıda bir regresyon geçişi, katı tip denetimi ve istemci, sunucu ve
başsız derlemeleri. Push öncesi tabandan yukarıya doğru katmanlı kontroller
[`docs/qa-gate.md`](../qa-gate.md) içinde anlatılıyor.

Ardından, oyuncuların gördüğü herhangi bir şeye dokunuyorsa, değişikliğinizi hem
masaüstünde hem de mobilde test edin; dikey ve yatay konumda telefon boyutunda
bir görüntü alanı da dahil olmak üzere. Dokunma hedefleri en az 40x40px ve form
girişleri en az 16px yazı tipi boyutunda kalmalıdır. Arayüz standartları
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) içinde belgelenmiştir.

## Pull request açma

Dalınızı gönderin ve **başladığınız en son `release/vX.Y.Z` dalını hedefleyen**
bir PR açın. **Asla `main` dalını hedeflemeyin**; `main`, katkı temeli değil,
sürüm zamanı bir birleştirme dalıdır. GitHub sizin için sıklıkla `main` dalını
önceden seçer, bu yüzden göndermeden önce temel dalı değiştirin.
[Pull request şablonu](../../.github/PULL_REQUEST_TEMPLATE.md) sizi kısa bir
kontrol listesinde yönlendirecek. Lütfen onu doldurun:

- **Neyin** değiştiğini ve **neden** değiştiğini açıklayın.
- İlgili herhangi bir sorunu bağlayın (örneğin, "Closes #123").
- Arayüz değişiklikleri için masaüstü ve mobilde **ekran görüntüsü veya bir klip
  ekleyin**.
- `npm run gate` denetiminin geçtiğini ve oyuncuya yönelik yeni dizgelerin
  aşağıdaki İngilizce öncelikli katkı politikasına uyduğunu onaylayın.

PR'ınızda CI, değiştirdiğiniz dosyalarda biçimlendirme ve linting, dört paralel
parçaya dağıtılmış tam test takımı, bir tarayıcı regresyon geçişi ve tip denetimi
ile istemci, sunucu ve başsız derlemelerini çalıştırır. Bu, yerelde
`npm run gate` çalıştırdıklarıyla örtüşür, dolayısıyla yeşil bir denetim yeşil
bir PR'ın iyi bir habercisidir.

Birleştirmeden önce aradığımız şey, yeşil bir CI çalışması ve tamamlanmış bir
kontrol listesidir. Bir bakım yöneticisi değişiklikler önerebilir. Bu, sürecin
normal ve işbirlikçi bir parçasıdır, bir reddetme değil. İncelemede nazik ve
yapıcı olmayı amaçlıyoruz ve aynısını sizden de rica ediyoruz.

> Commit mesajları ve PR başlıkları, bir kapsam ile birlikte
> [Conventional Commits](https://www.conventionalcommits.org/) biçimini izler
> (`feat(talents): ...`, `fix(net): ...`). Her commit ayrıca bir gövde taşır: boş
> bir satırdan sonra, neyin neden değiştiğini söyleyen bir ila dört yalın cümle,
> 72 sütuna yakın sarmalanmış olarak. Tek başına bir başlık yeterli değildir.

<a id="localization"></a>

## Yerelleştirme

World of ClaudeCraft birçok dilde sunuluyor. Oyuncuya görünen her dizge bir çeviri
anahtarı olmalıdır; özellik geliştiren katkıcılar ise normalde yalnızca İngilizce
kaynağı ekler.

- Kullanıcıya yönelik tüm metinler bir `t()` anahtarıdır. Yeni İngilizce metni
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) altındaki uygun alan bazlı
  modüle ekleyin (yeni HUD çerçevesi `hud_chrome.ts` içine gider), ardından
  `t('dotted.key', values)` ile işleyin. Bir özellik PR'ında yalnızca İngilizce
  olması tam olarak doğrudur: diğer yerel ayarları sürüm zamanında bakım
  yöneticisi doldurur, yani `src/ui/i18n.locales/` bindirmelerini düzenlemezsiniz
  ve orada asla İngilizce bir yer tutucu ya da `// TODO` bırakmazsınız. M16
  istisnası, çok metinli yeni bir İngilizce değerdir; bu değer ayrıca
  [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) içinde anlatılan beş Latin dışı
  dolguya da ihtiyaç duyar.
- Sayılar, para, tarihler, birimler ve yüzdeler, manuel dizge oluşturma yerine
  biçimlendiricilerden (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`)
  geçer.
- Dilden bağımsız kalan `src/sim/` veya `server/` içinden yayılan oyuncuya yönelik
  metinler, aynı değişiklikte istemci sınırında yeniden yerelleştirilmelidir.
  Koruma testi `npx vitest run tests/localization_fixes.test.ts` bunu uygular.
- Herhangi bir dizgeyi ekledikten veya değiştirdikten sonra `npm run i18n:gen`
  çalıştırın ve yeniden üretilen paketleri aynı değişiklikte commit edin. Hem
  denetim hem de CI, commit edilen yapıtları taze bir yeniden üretimle
  karşılaştırır, dolayısıyla bayat bir paket derlemeyi başarısız kılar.

Yani dizgelerinizi İngilizce ekleyin ve PR'ı açın; onları kendiniz çevirmeniz
gerekmiyor. Çevirilere yardım etmek isterseniz, bir sonraki bölüme bakın.

<a id="translating-the-game"></a>

## Oyunu çevirme

Bir dili iyileştirmek ya da oyunu yeni bir dile taşımaya yardım etmek mi
istiyorsunuz? Bunu yapmak için herhangi bir oyun kodu yazmanıza gerek yok:

1. Oyuncuya yönelik çevirilerin çoğu,
   [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) altındaki dil bazlı
   bindirme dosyalarında (her yerel ayar için bir tane) yaşar ve
   [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) içindeki İngilizce
   anahtarları yansıtır. Simülasyonun ve sunucunun yaydığı metin
   `src/ui/sim_i18n.ts` ve `src/ui/server_i18n.ts` içinde, yetenek metinleri
   `talent_i18n` modüllerinde çevrilir; yönetim panelinin ise
   `src/admin/i18n.locales/` altında kendi seti vardır.
2. Mevcut çevirileri iyileştirin veya kulağa garip gelen çevirileri doldurun.
3. `npm run i18n:gen` çalıştırın, yeniden üretilen paketleri bindirme
   düzenlemenizle birlikte commit edin, ardından yerelleştirme takımlarını
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   çalıştırın ve bir PR açın. Bindirmeler kasıtlı olarak seyrek olduğundan, tek
   başına bir tip denetimi bir anahtarın eksik olup olmadığını size söylemez.

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
- **Güvenlik açıkları.** Lütfen herkese açık bir sorun açmayın. Bunları
  [SECURITY.md](../../SECURITY.md) belgesini izleyerek özel olarak bildirin, biz
  de düzeltme ve açıklama konusunda sizinle birlikte çalışalım.

## Yardım alma

Takıldınız mı, yoksa sadece merhaba mı demek istiyorsunuz? [Topluluk Discord'una](https://discord.com/invite/worldofclaudecraft)
katılın. Hiçbir soru çok küçük değildir ve yeni katkıda bulunanlar her zaman hoş
karşılanır.

## Lisans

Kod katkısında bulunarak, kod katkılarınızın, projeyi kapsayan lisansın aynısı
olan projenin [MIT Lisansı](../../LICENSE) altında lisanslanacağını kabul
edersiniz.

MIT Lisansı ne diyorsa odur: herkes kodu ticari olsun olmasın kullanabilir,
değiştirebilir ve yeniden dağıtabilir.
[Hizmet Şartlarımız](https://worldofclaudecraft.com/terms),
worldofclaudecraft.com adresinde işlettiğimiz barındırılan oyunu (hesaplar,
davranış, sanal eşyalar) düzenler ve MIT Lisansı'nın bu kod üzerinde size veya
başkasına verdiği hakları kısıtlamaz. "World of ClaudeCraft" ve "Levy Street"
adları ile markaları MIT Lisansı kapsamında değildir.

Özgün yaratıcı varlıklar (ses kayıtları, müzik, sanat ve benzeri eser
nitelikli çalışmalar) istisnadır. Kendi oluşturduğunuz özgün bir varlığı katkı
olarak sunarsanız, bunun yerine telif hakkını saklı tutabilir ve onu seçtiğiniz
bir lisansla (örneğin CC BY-NC 4.0) katkı olarak verebilirsiniz; şu koşullarla:

- lisans, kapsadığı varlık yolları ve atfınız, aynı pull request'in parçası
  olarak [CREDITS.md](../../CREDITS.md) içindeki lisans tablosuna kaydedilir ve
- en azından, resmi sürümler ve oyun içi mağaza dahil olmak üzere varlıkları
  World of ClaudeCraft içinde ticari olarak kullanması için Levy Street'e
  süresiz ve telifsiz bir hak tanır.

CREDITS.md tablosunda listelenen varlıklar için, kaydedilen o lisans projenin
varsayılan MIT lisansına göre önceliklidir.

**CREDITS.md girdisi olmayan medya varlıkları MIT altında lisanslanmamıştır.**
Kayıt hâlâ tamamlanıyor, dolayısıyla eksik bir girdi, koşulların kaydedilmemiş
olduğu anlamına gelir; varlığın serbestçe alınabileceği anlamına gelmez. Bu
kasıtlıdır: kayıt dışı bir katkının varsayılan olarak devredilmesini engeller.
Kodda durum tam tersidir ve CREDITS.md içinde ayrı tutulmayan her şey MIT'dir.

Kayıt girdisinin isteğe bağlı bir evrak işi olmamasının nedeni tam olarak budur.
CREDITS.md'de bir satır olmadan bir varlık katkısı yaparsanız, aşağı akıştaki
hiç kimse onu kullanamaz ve bize ne verdiğinize dair elimizde bir kayıt olmaz.
**Redistribution** sütununu da dürüstçe doldurun. Bu projeyi çatallayan birine
varlığınızı devredip devredemeyeceğini söyleyen şey odur ve bazı satırlar tam da
devredilemeyecekleri için "No, permission required" olarak işaretlenmiştir.

---

World of ClaudeCraft'a katkıda bulunduğunuz için teşekkür ederiz. Bizimle birlikte
ne inşa edeceğinizi görmek için sabırsızlanıyoruz.
