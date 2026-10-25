# P1/P2 kopējā pārbaude pēc pārlāžu secības labojuma

**Statuss pēc turpmākā labojuma:** šeit aprakstītais foto publicēšanas P2 ir lokāli novērsts. Lauku/notikumu apstiprinājumi saglabā jaunākas lokālās foto/piezīmju izmaiņas, vienlaikus pieņemot servera laukus un `updatedAt`. Abi reprodukcijas testi pārveidoti par drošās uzvedības regresijām; detaļas ir `p1-local-fixes.md` pēdējā sadaļā. Zemāk saglabāts sākotnējās pārbaudes protokols.

24.10.2026. `small-plants-p1`, HEAD `eb7a8d7e9bf1223f627c6cde27d8540f5c9f4442`, ar visiem iepriekšējiem lokālajiem labojumiem. Šajā posmā lietotnes kods un migrācijas nav mainīti; pievienots šis pārskats un divi kontrolēti problēmas reprodukcijas testi.

## Secinājums un prioritāte

**Jauns P1 nav konstatēts. Palicis viens reproducēts P2:** aizkavēta visas HUS rindas saglabāšanas atbilde var aizstāt jaunāku foto stāvokli saskarnē. Jaunais darba kopas pārlāžu koordinētājs aptver pilnās pārlādes, bet šīs saglabāšanas atbildes tiek publicētas pa citu ceļu. Nav pierādīts, ka šo defektu ieviesa pēdējais labojums; tas ir atlikušais kopējās integrācijas trūkums.

## P2 — veca lauka saglabāšanas atbilde aizstāj jaunāku foto rezultātu

**Avoti:** `src/components/PlannerApp.tsx:438–440` un `463–465` aizstāj visu rindu ar `savedRow`/`saved`. Foto augšupielāde `706–709` un dzēšana `755–758` tajā pašā laikā maina pašreizējās rindas foto lokāli. Šīs darbības nav vienā HUS saglabāšanas rindā. Repozitorijs pēc rakstīšanas atgriež pilno rindu (`src/lib/repositories/supabase-sowing-plan-repository.ts:157,317`), kuras foto saturs var būt nolasīts pirms vēlākās foto darbības.

**Reproducētā secība:**

1. Sāk lauka labojumu. Serveris saglabā laukus un nolasa pilno HUS ar tābrīža foto; HTTP atbilde aizkavējas.
2. Tajā pašā HUS pabeidz foto pievienošanu vai dzēšanu. Jaunāks foto stāvoklis publicēts saskarnē.
3. Pienāk agrākā lauka saglabāšanas atbilde. `enqueueRowSave.saved` pieņem to kā pēdējo lauka rakstīšanu un pilnībā aizstāj saskarnes rindu, tostarp foto.
4. Pievienošanas gadījumā jaunais foto pazūd no saskarnes; dzēšanas gadījumā izdzēstais foto atkal parādās. Jauna pilna pārlāde atjauno DB stāvokli.

Koordinētāja `invalidate()` šeit atceļ citus lasījumus, bet nepārbauda pašas `savedRow` atbildes atsevišķo foto daļu. Pēdējā lauka saglabāšanas atbilde nav obligāti jaunākā foto versija.

**Pierādījuma līmenis:** `src/lib/read-order-combined-review.test.ts` abi scenāriji izmanto īsto `enqueueRowSave` un `createWorkspaceReadOrder`; ārējo atbilžu secība un redzamā/DB stāvokļa modelis ir vadāmi. Callback veic to pašu pilnas rindas aizstāšanu kā norādītās PlannerApp rindas. Tā nav pilna React/pārlūka vai īsta Storage integrācijas pārbaude. Testi apzināti apstiprina pašreizējo kļūdaino iznākumu, tāpēc to sekmes **nenozīmē salabotu defektu**. Tie nepierāda DB datu zudumu vai fiziski izdzēsta faila atjaunošanu; lauku saglabāšanas RPC nenosūta foto tabulas aizstāšanai.

**Ieteiktais labojums:** saskaņot vienas HUS rindas lauku/notikumu un foto publicēšanu. Vienkāršs variants ir kopīga darbību rinda, kurā nākamā foto darbība sākas pēc iepriekšējās lauka darbības pilnas atbildes apstrādes. Ja paralēlisms jāsaglabā, vajadzīga atsevišķa foto revīzija/dzēšanas atzīmes un droša jaunākā foto stāvokļa saglabāšana pie lauku apstiprinājuma vai autoritatīva pārlāde pēc visu konfliktējošo darbību beigām. Nevajag atmest visu lauka apstiprinājumu, jo tajā ir arī jaunais `updatedAt`; tikai foto masīvu apvienošana var atjaunot dzēstos attēlus.

## Pārbaudīto scenāriju rezultāti

| Scenārijs | Rezultāts |
|---|---|
| Lēna B pārlāde → ātra B pārlāde → saglabāta C → vecā B atbilde | Iepriekš pievienotā regresija iziet: C paliek. |
| Vecas sekmes pēc jaunākas kļūmes; veca kļūme pēc jaunākām sekmēm | Koordinētāja testi iziet; veca atbilde nepublicē datus un nenoņem jaunākās kļūmes pauzi. |
| Sākotnējā ielāde, lasījums rakstīšanas laikā, pārklājošas rakstīšanas | Vecie lasījumi atmesti, skaitītājs atbrīvo katru darbību vienreiz; testi iziet. |
| `committed`/`unknown` un aizstāta pēcsaglabāšanas pārlāde | Rakstīšanas iznākums saglabājas atsevišķi no pārlādes; pašreizējie testi iziet. Bez derīga skata paliek manuālās pārlādes ceļš. |
| Jaukta lauku/notikumu rinda un atkopšana | Atkarīgie darbi pēc kļūmes netiek izpildīti, atkopšana pieder kļūdainajai rakstīšanai; Moving un korekcijas saglabājas. Testi iziet. |
| Jauns HUS/arhīva darbība pēc iepriekšējas kļūmes | `not_started` saglabā ievadi, nesūta jauno darbību un nepārņem iepriekšējo apstiprinājumu. Testi iziet. |
| Lauka saglabāšana kopā ar foto pievienošanu/dzēšanu | Abi jaunie reprodukcijas testi apstiprina iepriekš aprakstīto P2. |
| Foto atkārtojumi/pārklāšanās pašā augšupielādē | Iepriekšējās regresijas iziet: stabili ID un nepamatotas kompensējošas dzēšanas novēršana saglabājas. Tas neaptver rindas publicēšanas P2. |
| Arhivēt/atjaunot un pārējo HUS grafiki | SQL atomiskuma, konflikta, dublikātu, vēstures un fiksēto grafiku testi iziet. Aktīvās/arhivētās rindas joprojām nāk no viena SELECT. |
| Imports ar jauktām rindām un kļūmi pakas vidū | SQL testi iziet: visa paka un receipt atomiski; atkārtojums ar to pašu ID nepārraksta vēlākus labojumus. Taimauts saglabā neskaidru rezultātu un mēģinājumu. |
| Pašreizējais/nākotnes/pārklājošie cikli | Izvēles un attēlošanas testi iziet. |
| Viena/divu HUS simulācija, Moving un fiziskā noslodze | Automatizētie testi iziet, arī sākotnējo datu nemainīšana un faktisko darbu aizsardzība. |

## Atlikušais darbs un pārbaudes robežas

1. Vispirms novērst iepriekš aprakstīto P2 un pārvērst abus reprodukcijas testus par drošas uzvedības regresijām.
2. Saglabāt nepabeigtu foto/importa mēģinājumu identitāti arī pēc cilnes aizvēršanas; pašlaik tā glabājas atmiņā.
3. Ieviest aizturētu nepiesaistīto failu/piezīmju uzskaiti un tīrīšanu. Tūlītējas dzēšanas novēršana aizsargā datus, bet var atstāt atlikumus.
4. Lielam arhīvam risināt darba kopas apjomu. Vecāktabulas atbilžu limits pašlaik izraisa skaidru atteikumu, nevis publicē nepilnu plānu; tas nav pilns mērogošanas risinājums.
5. Atsevišķā autorizētā testa vidē pārbaudīt īsto Supabase HTTP/Storage, relāciju atbilžu ierobežojumus un divu DB savienojumu bloķēšanas sacensības. Šajā posmā nav palaista jauna pārlūka plūsma vai slodzes tests.

Lietotnes build paliek iepriekšējā posmā sekmīgi pārbaudītais ar to pašu lietotnes kodu; šoreiz mainīts tikai tests un pārskats. Pārbaudes protokoli: `../.p1-tools/combined-order-review-*.log`. Migrācijas paliek tikai sagatavotas; nav commit, push, produkcijas vai pastāvīgas DB izmaiņu.

## Gala pārbaudes

- **676/676 testi, 55 faili:** iepriekšējie 674 iziet; divi jaunie apzināti reproducē aprakstīto kļūdu. Šis skaitlis nav apgalvojums, ka jaunais P2 ir novērsts.
- **23/23 SQL testi** atmiņas PostgreSQL; produkcija nav izmantota.
- Pilns lint bez kļūdām/brīdinājumiem un atsevišķs typecheck sekmīgi.
- `git diff --check` tīrs. HEAD nemainīts, oriģinālā lokālā projekta darba koks tīrs.
