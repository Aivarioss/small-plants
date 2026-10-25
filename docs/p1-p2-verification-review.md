# SMALL PLANTS — P1/P2 labojumu kopējā verifikācija

**Statuss pēc turpmākā labojuma:** zemāk aprakstītais pārlāžu secības P2 ir lokāli novērsts. Visas darba kopas ielādes izmanto kopīgu secības aizsardzību; vecus lasījumus invalidē arī rakstīšanas sākums un beigas. Deviņi jaunie regresijas testi aprakstīti `p1-local-fixes.md` pēdējā sadaļā. Zemāk saglabāts sākotnējās pārbaudes protokols.

24.10.2026. Lokālā kopija `small-plants-p1`, HEAD `eb7a8d7e9bf1223f627c6cde27d8540f5c9f4442` ar iepriekšējiem necommitētajiem labojumiem. Šajā pārbaudē lietotnes kods, testi un migrācijas nav mainīti. Pievienots šis pārskats; sintētiskās pārlūka pārbaudes palīgfails un protokoli atrodas ārpus repozitorija, `../.p1-tools/`.

## Rezultāts

**Jauns P1 nav atklāts. Atrasts viens reproducēts P2:** vecāka pārlādes atbilde var pēc veiksmīgas saglabāšanas publicēt novecojušu HUS versiju. Datubāzes versiju pārbaude saglabājas un nepieļauj šīs vecās versijas klusu pārrakstīšanu. Tomēr ekrānā īslaicīgi pazūd tikko saglabātais labojums un vēsture, un lietotājs var atkārtot nevajadzīgu darbu.

Iepriekšējie trīs atradumi (svešas saglabāšanas rezultāta attiecināšana uz nesāktu darbību, plāna/arhīva atsevišķi momentuzņēmumi un importa bloķēšanas taimauta rezultāts) regresijas testos ir novērsti. Tas neizslēdz zemāk aprakstīto pārlāžu savstarpējās secības problēmu.

## P2 — aizkavēta pārlāde publicē vecāku versiju pēc jaunākas saglabāšanas

**Vieta:** `src/components/PlannerApp.tsx:285–291` un `retryWorkspaceRefresh` (321–328). Arī sākotnējās ielādes efekts publicē savu rezultātu neatkarīgi no citiem lasījumiem. Nav pieprasījuma paaudzes vai cita nosacījuma, kas novecojušai atbildei aizliegtu mainīt rindas un izvēli. Pārlādes poga gaidīšanas laikā netiek bloķēta.

**Reprodukcija īstā lokālajā Next lietotnē un pārlūkā:**

1. Sintētiskajā DB izveidoti divi TEST HUS cikli. Lauks `variety` mainīts no `Review current` uz `Review saved A`, pēc tam uz `Review saved B`.
2. Otrā labojuma DB transakcija izpildās, bet pēclasījumi un atkopšanas lasījums kontrolēti saņem 503. Lietotne pareizi parāda apstiprinātu saglabāšanu, prasa pārlādēt un aptur rakstīšanu. Pēdējā apstiprinātā A versija paliek ekrānā.
3. Lasījumi atkal atļauti. Pirmajam manuālajam pārlādes pieprasījumam DB momentuzņēmums B nolasīts uzreiz, bet atbilde aizturēta 45 sekundes. Lietotājs nospiež pārlādi vēlreiz; otrā atbilde B pienāk uzreiz un atļauj darbu.
4. Lietotājs maina šķirni uz `Review saved C`. Saglabāšana sekmīga; pārlūks rāda C un trīs vēstures ierakstus.
5. Pienāk pirmā, aizturētā B atbilde. Ekrāns atgriežas uz B un diviem vēstures ierakstiem, vienlaikus ziņojot, ka dati pārlādēti. DB joprojām glabā C.
6. Mēģinājums no šī vecā skata ievadīt `Review attempted D` saņem versiju konfliktu; atkopšana atjauno C. DB netiek pārrakstīta ar D.

**Pierādījumi:** pārlūka pieejamības koka novērojumi šajā sarunā; `../.p1-tools/verification-browser-state.json` satur DB vērtību C un HTTP pieprasījumu laika secību brīdī, kad pārlūks rāda B. `verification-browser-final-state.json` apstiprina C pēc konflikta atkopšanas un vēlāk saglabāto Moving. Šie faili satur tikai sintētiskus datus. Sākotnējās kļūmes pārbaudē ņemti vērā klienta automātiskie 503 atkārtojumi — kļūmes skaits bija pietiekams, lai izsmeltu tos.

**Praktisks labojums:** centralizēt visu darba kopas lasījumu publicēšanu. Piesaistīt pieprasījumus monotonai paaudzei un invalidēt agrāk sāktus lasījumus, kad sākas vai apstiprinās rakstīšana. Pārlādes pogai gaidīšanas laikā nepieļaut otru pieprasījumu; tikai pogas bloķēšana neaptver mediju atkopšanas un citu lasījumu pārklāšanos. Novecojuša pieprasījuma pabeigšana nedrīkst ne pārrakstīt rindas/izvēli, ne noņemt jaunākas kļūmes rakstīšanas aizliegumu. Regresijās aptvert: lēns A lasījums → ātrs B lasījums → saglabāšana C → A atbilde; kā arī veca veiksmīga atbilde pēc jaunākas atkopšanas kļūmes.

## Galvenie scenāriji

| Scenārijs | Pārbaude un rezultāts |
|---|---|
| Pašreizējais HUS pret nākotnes ciklu | Pārlūkā izvēlēts augošais 15.10.–06.11. cikls, nākotnes 10.01. cikls parādīts atsevišķi. Izvēles un pārklājošos ciklu regresijas iziet. |
| Lauka labojums un vēsture | Pārlūks → Next API → īstā SQL funkcija atmiņas DB: A, B un C labojumi saglabāti. Pēclasījuma kļūme pareizi nošķirta no DB saglabāšanas. |
| Novecojusi versija | Pārlūka D mēģinājums no vecās B versijas noraidīts; atkopšana atjauno C. Jaunais P2 ir skata secība, nevis pierādīta DB datu pazušana. |
| Moving ar zudumu | Pārlūkā saglabāts A7 → C1-C24 un −10. DB viens notikums un viena saistīta korekcija; saskarnē 3590 stādi un C rinda. |
| Ātri un jaukti lauku/notikumu labojumi | Rindas un kopējās regresijas iziet: atkopšana pirms atkarīgo darbu noraidīšanas, pēdējā apstiprinātā versija, Moving/korekcijas saglabāšana. |
| Jauns HUS/arhīva darbība pēc iepriekšējās kļūmes | Testi apstiprina `not_started`, nesūta jauno rakstīšanu un saglabā ievadi, ja neizdodas priekšnosacījums ar `committed` vai `unknown`. |
| Arhivēt/atjaunot | SQL regresijas iziet: atomiska citu grafiku fiksēšana, konflikta/vidus kļūmes pilna atcelšana, dublikātu aizsardzība un vēstures/saišu saglabāšana. Vienots darba kopas SELECT novērš starpsarakstu momentuzņēmumu defektu. Pilna pārlūka apstiprināšanas plūsma šoreiz nav pabeigta. |
| Daļējs imports un atkārtojumi | SQL un API testi iziet: visas pakas atomiskums, nemainīgs mēģinājuma ID, receipt atkārtojums, jaunāku labojumu nepārrakstīšana; bloķēšanas taimauts saglabā `unknown`. |
| Foto pārklājoši atkārtojumi | Regresijas iziet abiem mērķiem; stabila mēģinājuma kļūme neizdzēš failus/piezīmes, ko var izmantot otrs pieprasījums. Reāla Storage pārlūka augšupielāde nav veikta. |
| Simulācija un noslodze | Automatizētie viena/divu HUS, sākotnējo datu nemainīšanas, faktiskā Moving un fiziskās noslodzes testi iziet. Pārlūkā noslodze rāda faktisko C1-C24 izvietojumu; aprēķina klikšķis netika droši pabeigts pārlūka vadības savienojuma taimauta dēļ, tāpēc to neuzskatu par sekmīgu pilnu pārlūka testu vai pierādītu lietotnes defektu. |

## Palaistās pārbaudes

- Vitest: **665/665**, **53/53 faili**, divi darbinieki, bez testa laika limita palielināšanas.
- Īstā SQL shēma un sagatavotās migrācijas PGlite atmiņas PostgreSQL: **23/23**.
- Lint: **0 kļūdu un brīdinājumu**. Atsevišķs typecheck: **sekmīgs**.
- `git diff --check`: tīrs. HEAD nemainīgs; oriģinālās lokālās projekta kopijas darba koks tīrs.
- Izmantots iepriekšējā posmā sekmīgi uzbūvētais produkcijas režīma build ar šo pašu lietotnes kodu. Šoreiz no jauna nav būvēts; tas faktiski darbināts lokālajās pārlūka pārbaudēs.

Protokoli: `../.p1-tools/verification-vitest.log`, `verification-db.log`, `verification-lint.log`, `verification-types.log`; lokālā servera protokoli `browser-app*.log` un `browser-backend*.log`.

## Atlikušais darbs un robežas

1. Vispirms novērst jauno P2 pārlāžu secības defektu. Šis pārskats to nelabo.
2. Nepabeigto foto/importa mēģinājumu noturīga atkopšana pēc cilnes aizvēršanas joprojām nav ieviesta. Pašlaik mēģinājumu identitātes dzīvo atmiņā.
3. Saglabātu, bet nepiesaistītu failu/piezīmju aizturēta uzskaite un droša tīrīšana nav ieviesta. Tūlītējas dzēšanas novēršana aizsargā no datu zuduma, bet var atstāt atlikumus.
4. Darba kopas parent rindu servera ierobežojums tagad izraisa skaidru atteikumu, nevis nepilna plāna publicēšanu. Mērogošana/pilna rezultāta servera ielāde lielākam arhīvam vēl jāplāno.
5. Nepieciešama atsevišķi autorizēta testa vide ar īsto Supabase HTTP/Storage, servera atbilžu ierobežojumiem un diviem DB savienojumiem bloķēšanas sacensību pārbaudei. Šoreiz izmantota īstā lietotne, Supabase klients un SQL, bet šaurs lokāls HTTP aizvietotājs un viena atmiņas DB. Tas nav pilns Supabase servisa ekvivalents vai slodzes tests.

Trīs migrācijas joprojām tikai sagatavotas. Nav commit, push, produkcijas pieprasījumu, produkcijas konfigurācijas vai pastāvīgu DB izmaiņu.
