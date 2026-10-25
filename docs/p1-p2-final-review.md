# SMALL PLANTS: atkārtota P1/P2 kopējā pārbaude

**Statuss pēc labojuma:** visi trīs šī pārskata atradumi ir lokāli salaboti norādītajā secībā. Defektu reprodukcijas testi tagad pārbauda drošo uzvedību; aktuālās detaļas ir `p1-local-fixes.md` pēdējā sadaļā. Zemāk saglabāts sākotnējais pārskats. Jaunas migrācijas nebija nepieciešamas, un produkcija nav mainīta.


24.10.2026. Lokālā kopija `small-plants-p1`, HEAD `eb7a8d7` ar visiem līdzšinējiem necommitētajiem labojumiem. Šajā pārbaudē pievienots tikai problēmu reprodukcijas tests un pārskats. Lietotnes kods un SQL nav mainīti. Nav commit, push vai produkcijas pieprasījumu.

## Secinājums

Viena HUS un importa transakciju, foto saglabāšanas un pašreizējā cikla izvēles iepriekšējie testi iziet. Tomēr kopējā darbību secībā atklāts **viens jauns P1 un divi P2 atradumi**. P1 var izdzēst vēl nenosūtīta jaunā HUS ievadi. Pirms izvietošanas jānovērš vismaz šis P1; zemāk norādīta ieteiktā labojumu secība.

## 1. P1 — iepriekšējās saglabāšanas apstiprinājums tiek attiecināts uz vēl nesāktu darbību

**Reproducēts ar īsto saglabāšanas rindas un rezultātu apstrādes kodu.**

1. Lauka labojums tiek saglabāts DB, bet pēcsaglabāšanas lasījums neizdodas. Rinda atgriež `WriteOutcomeError("committed", [iepriekšējā HUS ID])`.
2. Kamēr šis lauka labojums vēl gaida atbildi/atkopšanu, lietotājs iesniedz jaunu HUS vai sāk arhivēšanu.
3. `completePlanWrite` jaunās darbības `writeAndRefresh` blokā vispirms gaida `Promise.all(rowSaveChainsRef.current.values())`.
4. Iepriekšējais lauka labojums noraida solījumu ar savu `committed` kļūdu. Jaunās darbības pieprasījums netiek izsaukts.
5. `writeAndRefresh` šo svešo apstiprinājumu interpretē kā jaunās darbības sekmi. Mērķa stāvokļa pārbaude netiek izsaukta, jo tā paredzēta tikai `unknown` gadījumam.
6. Jauna HUS gadījumā `addPlanRow` iztīra ievadi un pārslēdzas uz darba lapu, lai gan jaunā rinda nav izveidota. Arhivēšanas/atjaunošanas gadījumā var parādīties sekmes un pārvietošanās uz citu skatu bez izpildītas darbības.

Testā jaunā HUS `create` izsaukumu skaits ir **0**, rezultāts ir `committed`, bet ievade tiek iztīrīta. Tas ir jaunās rezultātu nošķiršanas un agrākās saglabāšanas rindas integrācijas defekts; pati DB transakcija šajā scenārijā nezaudē datus, bet pazūd lietotāja nesaglabātā ievade.

**Pierādījumi:** `src/components/PlannerApp.tsx:321-338,385-392,469-486`; `src/lib/write-outcome.ts:20-28`; `src/lib/p1-p2-final-review.test.ts` pirmais tests.

**Labojums:** iepriekšējo rindu gaidīšanu veikt pirms jaunās darbības rezultātu apstrādes. Ja priekšnosacījums neizdodas, jauno darbību atzīmēt kā **nesāktu**, saglabāt tās ievadi un nepārslēgt skatu kā pēc sekmes. Apstiprinājumu piesaistīt konkrētās darbības identitātei/veidam; tikai ID salīdzināšana nepietiek, jo lauka labojums un arhivēšana var attiekties uz to pašu HUS. Regresijās aptvert jauna HUS izveidi un arhivēšanu pēc iepriekšēja `committed` un `unknown` rezultāta.

## 2. P2 — aktīvā plāna un arhīva paralēlie lasījumi nav viens DB momentuzņēmums

**Abas iespējamās neatbilstības reproducētas ar kontrolētiem lasījumu rezultātiem.**

`loadPlanWorkspace` sagaida abus HTTP lasījumus pirms publicēšanas, taču katrs lasījums redz savu DB stāvokli. Cits lietotājs starp šiem lasījumiem var arhivēt vai atjaunot HUS:

- aktīvais vaicājums redz rindu pirms arhivēšanas, bet arhīva vaicājums pēc tās — viens ID ir abos sarakstos;
- arhīva vaicājums redz stāvokli pirms arhivēšanas, bet aktīvais vaicājums pēc tās — ID nav nevienā sarakstā.

Abos testos šāds skats tiek publicēts ar `refreshed: true`. Rinda DB nav izdzēsta, taču saskarnē tā var šķietami pazust vai saglabāties aktīvajā plānā pēc arhivēšanas. Aktīvā ieraksta prioritāte var arī atvērt novecojušu rediģējamu darba lapu; DB arhīva aizsardzība saglabāšanas pieprasījumu noraidīs.

Kalendāram un sakņu statistikai jau ir ID dublikātu aizsardzība (`calendar-history.ts:27-32`, `greenhouse-statistics.ts:121-122`), tāpēc šajā pārbaudē **nav pierādīta statistikas dubultskaitīšana**. Šīs aizsardzības tomēr neatjauno iztrūkstošo rindu vai novecojušo aktīvo versiju.

**Pierādījumi:** `src/lib/write-outcome.ts:33-36`; `src/components/PlannerApp.tsx:304-309`; abi `both/neither` testi `src/lib/p1-p2-final-review.test.ts`. Reāla vairāku HTTP klientu secība šajā pārbaudē nav palaista. Tas, ka atsevišķi SELECT var redzēt atšķirīgus apstiprinātus stāvokļus, atbilst [PostgreSQL momentuzņēmumu noteikumiem](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED).

**Labojums:** ielādēt pilnās rindas ar vienu servera SELECT un pēc šī vienotā rezultāta sadalīt aktīvās/arhivētās rindas. Alternatīva ir servera lasījums vienā konsekventā momentuzņēmumā. Saskarnē papildus pārbaudīt sarakstu savstarpējo konsekvenci un aktuālās darbības sagaidāmo ID/stāvokli. Tikai `Promise.all` nav datu konsekvences garantija.

## 3. P2 — importa atkārtojuma bloķēšanas taimauts izmet sākotnējā mēģinājuma ID

**Reproducēta kļūdas klasifikācija; pilna DB sacensība ar diviem savienojumiem nav reproducēta.**

Importa funkcija pirms apstiprinājuma nolasīšanas iegūst transakcijas bloķēšanu uz mēģinājuma ID. Ja pirmais pieprasījums vēl strādā, atkārtojums gaida šo bloķēšanu. Pēc piecām sekundēm tas var saņemt `55P03`. Repozitorijs to pārveido par parastu versiju konfliktu; API atbild ar 409, bet `writeAndRefresh` to uzskata par `failed`. Importa saskarne tad iztīra `pendingImportRef` un ziņo, ka imports nav saglabāts.

Bloķēšanas gaidīšanas kļūme pierāda tikai atkārtojuma neveiksmi. Pirmais pieprasījums joprojām var pabeigt darbu. Tiek zaudēta piesaiste sākotnējam mēģinājumam, un nākamā apstiprināšana ģenerē jaunu ID. DB dublikātu un versiju pārbaudes saglabājas; šajā pārbaudē nav pierādīta dublētu rindu izveide. Defekts ir nepamatoti galīgs rezultāts un nedroša atkopšanas plūsma.

**Pierādījumi:** `supabase/migrations/20261024180627_atomic_plan_import.sql:14,29-30`; `src/lib/repositories/supabase-sowing-plan-repository.ts:325`; `src/components/PlannerApp.tsx:863-867`; pēdējais tests `src/lib/p1-p2-final-review.test.ts`. [PostgreSQL lock_timeout](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-LOCK-TIMEOUT) pārtrauc bloķēšanu gaidošo komandu; tas nepierāda citas sesijas transakcijas atcelšanu.

**Labojums:** neiegūtu importa apstiprinājumu bloķēšanas taimauta gadījumā atstāt kā nepabeigtu/neskaidru, saglabājot sākotnējo ID un precīzo pieprasījumu. Piedāvāt atkārtotu šī paša mēģinājuma pārbaudi vai servera statusa vaicājumu. Definēt atsevišķu “vēl darbojas”/“rezultāts nav zināms” rezultātu; neģenerēt jaunu importa ID, kamēr vecā iznākums nav atrisināts.

## Galvenie scenāriji

| Scenārijs | Šīs pārbaudes rezultāts |
|---|---|
| Jauns HUS un ātri secīgi lauku labojumi | Pamatplūsmas testi iziet. Jauna darbība pēc iepriekšēja saglabāta lauka lasīšanas kļūmes atklāj 1. atradumu. |
| Jaukta lauku/notikumu saglabāšanas rinda | Atkopšana, atkarīgo rakstīšanu apturēšana, svaiga versija un Moving/korekcijas saglabāšana iziet. |
| Moving, zudumi, foto un apzināta notikuma dzēšana | SQL testi saglabā ID/saites; apzināta dzēšana noņem izvēlēto vēsturi un metadatus. |
| Foto atkārtojums, pārklājoši mēģinājumi, kļūme pirms/pēc metadatiem | Iepriekš salabotie abu mērķu — notikuma un piezīmes — regresijas testi iziet. Tūlītējā kompensējošā dzēšana stabila ID mēģinājumos neatkārtojas. |
| Arhivēt → atjaunot; kļūme fiksēšanas vidū | SQL testi abos virzienos atceļ visu operāciju pie kļūmes, saglabā manuālos datumus, vēsturi un saites. Kopējā skata lasījumu problēma ir 2. atradums. |
| Imports: jaunas un aizvietojamas rindas | SQL testi nodrošina visas pakas un apstiprinājuma atcelšanu pie vēlākas kļūmes. Saglabātā ID atkārtojums nepārraksta vēlākus labojumus. Taimauta izņēmums ir 3. atradums. |
| Apstiprināta saglabāšana + neveiksmīgs nākamais lasījums | Atsevišķas darbības servera un klienta testi iziet. Apstiprinājuma izplatīšana uz citu darbību ir 1. atradums. |
| Pašreizējais, tuvākais nākotnes, pārklājošais, pabeigtais HUS cikls | Izvēles un kartītes attēlošanas testi iziet. |
| Viena/divu HUS simulācija un faktiskā Moving aizsardzība | Pilnajā testu kopā iziet arī sākotnējo datu nemainīšana, fiziskā noslodze un jau paveiktu darbu aizsardzība. Simulācijas panelis nepersistē priekšskatījumu. |

## Pārbaudes un robežas

Pilnā Vitest palaišana: **648/648 testi 52 failos** ar diviem darbiniekiem, bez laika limita maiņas. Tajos ir iepriekšējie 644 regresijas testi un **4 jauni defektu reprodukcijas testi**. Jaunie testi apzināti apstiprina kļūdaino iznākumu — to sekmes nenozīmē, ka šie atradumi ir salaboti.

Pārējie protokoli: `../.p1-tools/final-review-*.log`. **Gala rezultāts: 23/23 atmiņas PostgreSQL testi, lint bez kļūdām vai brīdinājumiem un atsevišķs typecheck sekmīgi; `git diff --check` tīrs.** Iepriekšējā posmā build iziets uz šī paša lietotnes koda; šajā pārbaudē lietotnes kods un migrācijas nav mainīti.

Nav veikta autentificēta pārlūka plūsma ar īstu Supabase HTTP/Storage, divu reālu DB savienojumu bloķēšanas pārbaude vai produkcijas slodzes pārbaude. Kontrolētie reprodukcijas testi izmanto īstos rindas/rezultātu apstrādes moduļus un vadāmus ārējo atbilžu aizvietotājus. SQL regresijas testi izpilda īsto shēmu un funkcijas atmiņas PostgreSQL ar sintētiskiem datiem.

Vēl paliek noturīga nepabeigto foto/importa mēģinājumu atkopšana pēc lapas aizvēršanas un aizturēta nepiesaistītu failu/piezīmju uzskaite un tīrīšana. Trīs jaunās migrācijas joprojām ir tikai sagatavotas; tās nav piemērotas pastāvīgai DB. Pirms izvietošanas nepieciešama atsevišķa testa vides pārbaude.

Oriģinālās lokālās projekta kopijas Git darba koks paliek tīrs. Lokālās labojumu kopijas HEAD nemainīts: `eb7a8d7`. Commit, push, jaunas migrācijas un produkcijas izmaiņas šajā pārbaudē nav veiktas.

Pēc visu trīs atradumu labošanas: 665/665 lietotnes testi, 23/23 atmiņas PostgreSQL testi, lint, typecheck un build sekmīgi. Sākotnējā pārskata reprodukcijas testi ir pārveidoti un vairs nesagaida kļūdainus rezultātus.
