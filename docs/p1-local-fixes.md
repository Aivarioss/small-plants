# Lokālie P1 un P2 labojumi

Sākumpunkts: eb7a8d7. Izmaiņas nav commitētas vai publicētas.

- **Secīgie labojumi:** katra lauka izmaiņa tiek piemērota pēdējai apstiprinātajai HUS versijai. Vecāka atbilde neaizvieto jaunāku ievadi. Kļūme aptur atkarīgos labojumus, un saskarne pārlādē datus. Atkopšanu veic tieši neveiksmīgā rakstīšanas operācija pirms gaidošo lauku vai notikumu labojumu noraidīšanas; abu veidu izsaucēji izmanto vienu atkopšanas funkciju. Ja pārlāde neizdodas, ekrānā atjauno pēdējo apstiprināto rindu, nevis vēlākas optimistiskas ievades stāvokli. Pēc rindas pabeigšanas saglabāšanas ķēde tiek atbrīvota, lai turpmāka pārlāde netiktu aizvietota ar vecu versiju.
- **Nepilnīga ielāde:** noņemti rezerves vaicājumi, kas neielādētus Moving un zudumus pasniedza kā tukšus sarakstus. Ja pilnā vēsture nav pieejama, ielāde atgriež kļūdu.
- **Atomiska saglabāšana:** izveide un rediģēšana izmanto vienu `save_sowing_plan_row` RPC. Migrācijā vecais un jaunais stāvoklis ir viena transakcija; esošo notikumu ID un foto saites netiek pārradītas. Labojumam nepieciešama pilna `updated_at` versija.
- **Foto atkopšana:** neskaidras metadatu saglabāšanas kļūmes gadījumā augšupielādētie faili un piezīmes netiek dzēsti. Atkārtošana izmanto stabilus ID un no datuma neatkarīgu ceļu. Metadatiem piesaistīta faila esamība tiek pārbaudīta; trūkstošs fails tiek atjaunots no vēl atvērtā ievades mēģinājuma. Arī papildu foto pie notikuma izmanto šo pašu atkārtojuma mehānismu un rāda atkārtošanas pogu.

## Migrācijas priekšnosacījums

`supabase/migrations/20261024160132_atomic_sowing_plan_save.sql` ir tikai sagatavota. Tā nav piemērota nevienai pastāvīgai datubāzei. Tā pati funkcija pievienota svaigas instalācijas `supabase/schema.sql`.

Pirms šī koda izvietošanas nepieciešams atsevišķi apstiprināt un piemērot migrāciju testa vidē un vēlāk produkcijā. Ja funkcijas nav, jaunais kods skaidri atsakās saglabāt; tas neatgriežas pie vecajiem secīgajiem rakstīšanas pieprasījumiem. Esošā produkcijas versija šajā darbā nav mainīta.

Funkcija izmanto `security invoker`, esošās tabulas un servera service-role piekļuvi. Izpilde anon un authenticated lomām ir aizliegta. Klienta atslēgu vai lietotnes piekļuves modeļa izmaiņu nav.

## Pārbaudes

Noslēguma rezultāts 24.10.2026.: 610/610 Vitest testi, 17/17 atmiņas PostgreSQL testi, lint bez kļūdām vai brīdinājumiem, typecheck un `next build --webpack` sekmīgi. `git diff --check` ir tīrs. Sākotnējās lokālās projekta kopijas Git darba koks palicis tīrs.

Pēc parastas `npm ci` instalācijas:

```text
npm test
npm run test:db
npm run lint
npx next typegen
npm run typecheck
npm run build
```

`test:db` izmanto piesprausto PGlite 0.5.11 tikai operatīvajā atmiņā un neveido savienojumu ar Supabase. Tas pārbauda pilnu transakcijas atcelšanu pie darba, izvietojuma, zudumu, notikumu un vēstures kļūdām, cikla izveides atcelšanu, versiju konfliktus, arhīva aizsardzību, relāciju integritāti un foto saišu saglabāšanu. PGlite nav iekļauts lietotnes produkcijas atkarībās.

Šī čata izolētajā kopijā jau instalētās atkarības ir piesaistītas no sākotnējās lokālās kopijas. Tāpēc testiem izmantots Vitest `--configLoader runner`, SQL testa rīkam norādīta jau lejupielādētās pakotnes adrese ar `PGLITE_MODULE_URL`, bet produkcijas build — `next build --webpack`. Noklusētais Turbopack šajā konkrētajā izvietojumā noraida `node_modules` saiti ārpus projekta saknes. Produkta būvēšanas konfigurācija tādēļ nav mainīta. Pilnīga `npm ci` instalācija šajā sesijā nav atkārtota; jaunās pakotnes lockfaila integritāte ņemta no jau lejupielādētās fiksētās pakotnes.

## Robežas

Pēc neskaidras foto saglabāšanas kļūmes var īslaicīgi palikt nepiesaistīts fails vai piezīme. Ar stabilu `uploadId` failus un piezīmes saglabā arī kļūmēs pirms metadatu rakstīšanas, jo tos jau var izmantot pārklājošs atkārtojums. Tā ir apzināta izvēle nezaudēt iespējami saglabātu foto. Saglabāšanas atkārtojums atvērtajā ievadē tos izmanto atkārtoti; automātiska vecu nepiesaistītu objektu tīrīšana nav pievienota.

Regresijas testi neizmanto produkcijas datus. Pilna Supabase HTTP integrācija un pārbaude ar īsto produkcijas konfigurāciju nav veikta. Atmiņas DB testā izlaista tikai `create extension pgcrypto` rinda, jo UUID ģenerators ir PostgreSQL iebūvēts un attiecīgā papildu paplašinājuma nav WASM komplektā; pārējā shēma, trigeri un saglabāšanas funkcija tiek izpildīti nemainīti.

## P2: arhivēšanas blakusefekti

Arhivēšana un atjaunošana izmanto vienu `change_sowing_plan_archive` RPC: citu aktīvo HUS aprēķināto darba datumu fiksēšana un mērķa arhīva stāvokļa maiņa ir viena transakcija. Kļūme jebkurā solī atceļ visu operāciju, ieskaitot citu HUS versiju maiņu. Esošie manuālie darba datumi netiek pārrakstīti; arhīva momentuzņēmums, Moving, zudumi un foto saites saglabājas arī pēc atjaunošanas.

Pārbauda mērķa versiju un visu aktīvo HUS kopu ar precīziem `updated_at` laikiem. Vienlaikus pievienots, izņemts vai mainīts cikls aptur operāciju. Atjaunošanas dublikātu pārbaude atrodas tajā pašā transakcijā un normalizē HUS nosaukuma reģistru un atstarpes. Aktīvā plāna tabulas bloķēšana stabilizē kopu arī attiecībā pret jaunu ciklu izveidi. Bloķēšanas gaidīšanas robeža ir 5 sekundes; konflikta gadījumā jāatjauno dati un jāmēģina vēlreiz. Pēc sekmīgas atjaunošanas saskarne pārlādē visu aktīvo plānu, lai parādītu arī citu HUS fiksētos datumus.

Papildu migrācija: `supabase/migrations/20261024172817_atomic_archive_state.sql`. **Tikai sagatavota**, nav piemērota pastāvīgai datubāzei. Pirms izvietošanas nepieciešamas abas sagatavotās migrācijas. Svaigas instalācijas shēma ietver abas funkcijas. Ja jaunā funkcija vēl nav pieejama, kods neveic rezerves secīgos rakstīšanas pieprasījumus.

Regresijas testi pārbauda atcelšanu pēc vēlākas darba datumu kļūmes un pēc piespiedu mērķa atjauninājuma kļūmes abiem virzieniem; novecojušu kontekstu, jaunu aktīvu rindu, dublikātus, nepilnīgas versijas, neatļautu datumu fiksēšanu un atkārtotu pieprasījumu. PostgreSQL testi darbojas atmiņā ar sintētiskiem datiem. Reālu vairāku HTTP klientu bloķēšanās un tīkla pārtraukumu pārbaude nav veikta.

## P2: pašreizējā HUS cikla izvēle

HUS galvenajā kartītē priekšroka ir ciklam, kura sēšanas datums jau pienācis un izvešanas datums vēl nav pagājis. Abi robeždatumi ir ieskaitīti; izmanto lietotnes pašreizējo vietējo datumu. Statuss `done` ir pabeigts arī tad, ja plānotais izvešanas datums vēl ir nākotnē.

Ja pašreizēja cikla nav, izvēlas tuvāko nākotnes ciklu; ja visi ir pabeigti, visnesenāk izvesto ciklu. Ja pašreizējie cikli pārklājas, galvenais ir vēlāk iesāktais, bet visi pārējie paliek redzami ar datumiem un skaidru statusa norādi. Arhīva kārtošana joprojām izmanto arhivēšanas laiku. Izvēle neveic izmaiņas datos.

Seši izvēles loģikas testi un trīs kartītes attēlošanas testi pārbauda pašreizējo ciklu, nākotnes prioritāti, pārklāšanos, robeždatumus, pabeigtos ciklus un arhīva prioritāti.


## Kopējā pārskatā atrasto P1 kļūmju labojums

- Foto atkārtojumi ar stabilu `uploadId` vairs neveic tūlītēju kompensējošu failu/piezīmju dzēšanu nevienā kļūmes posmā. Pārklājošā mēģinājuma sekmīgi saglabātie failu ceļi, metadati un piezīmes paliek pieejami. Bez stabila ID agrīnā tīrīšana saglabāta; pēc neskaidras metadatu rakstīšanas tīrīšana joprojām netiek veikta.
- Atkopšana ir atdalīta no pēdējā rindas elementa kļūdas paziņošanas. Tā notiek vienu reizi operācijā, kuras rakstīšana neizdevās, un saņem tās pēdējo apstiprināto bāzi. Gaidošie labojumi, tostarp atkopšanas laikā pievienotie, netiek nosūtīti; tie saņem kļūdu pēc atkopšanas pabeigšanas. HUS dialoga ievade paliek atkārtošanai.
- Agrākie divi kļūdu reprodukcijas testi pārveidoti par regresijas testiem, kas sagaida pareizu rezultātu. Papildus pārbaudīti abi foto mērķi (notikums un piezīme), atkārtota sekmīga nolasīšana pēc sacensības, atkopšanas laikā pievienots labojums, pārlādes kļūme ar atkāpšanos uz apstiprināto versiju, pazudusi jau saglabātas izmaiņas atbilde un lauku/Moving/zudumu sekmīga saglabāšanas secība.

Šiem diviem labojumiem jauna DB migrācija nav nepieciešama. Atlikušās pārskata P2 problēmas — daļējs vairāku rindu imports un rakstīšanas/pārlādes rezultātu nošķiršana — šajā labojumā nav mainītas. Nepiesaistītu objektu aizturēta tīrīšana un noturīga atkopšana pēc lapas aizvēršanas paliek atsevišķi darbi.

Noslēguma pārbaudes pēc abu papildu P1 labojumu ieviešanas: 610/610 Vitest testi 47 failos (`--maxWorkers 2`, bez laika limita maiņas), 17/17 atmiņas PostgreSQL testi, lint bez kļūdām vai brīdinājumiem, atsevišķs typecheck un `next build --webpack` sekmīgi. `git diff --check` tīrs. Protokoli glabājas `../.p1-tools/p1-followup-*.log`. Pilna Supabase HTTP/Storage integrācija šajā lokālajā pārbaudē nav veikta; foto sacensības regresijas testi izmanto kontrolētu Storage/DB aizvietotāju ar piezīmes foto kaskādes modeli.

## Atlikušās P2 problēmas: imports un rezultātu nošķiršana

### Viss apstiprinātais imports vienā transakcijā

Foto importa apstiprināšana vairs nesaglabā rindas ar atsevišķiem izveides/atjaunošanas pieprasījumiem. Viens `/api/sowing-plan/batch` pieprasījums nodod visu apstiprināto komplektu funkcijai `import_sowing_plan_rows`, kas izmanto jau pārbaudīto `save_sowing_plan_row`. Jebkuras rindas, bērna ieraksta, versijas vai dublikāta kļūme atceļ visu komplektu un tā izpildes apstiprinājumu. Esošajiem HUS ielādē svaigu bāzi un saglabā pilno vēsturi, Moving, korekcijas un foto saites.

Katram importa mēģinājumam ir stabils UUID un nemainīgs sākotnējais pieprasījums. `sowing_plan_import_operations` saglabā sekmīgā importa rindas un sākotnējo pieprasījumu tajā pašā transakcijā. Atkārtojums pēc pazudušas atbildes atgriež šo apstiprinājumu, nepārrakstot rindas vai vēlākus lietotāju labojumus. Cits saturs ar to pašu ID tiek noraidīts. Vienlaicīgi viena ID mēģinājumi tiek serializēti ar transakcijas bloķēšanu; gaidīšana ierobežota ar 5 sekundēm. Dubultklikšķi apstiprināšanas laikā bloķē arī tūlītējs saskarnes aizsargs.

Neskaidra rezultāta gadījumā saskarne saglabā tieši to pašu importa komplektu atkārtošanai un neļauj to rediģēt vai sākt citu plāna rakstīšanu. Pēc zināmas kļūmes pārlādē datus un pārrēķina dublikātus. Pēc apstiprinātas saglabāšanas importa ievade tiek aizvērta arī tad, ja neizdodas tikai datu pārlāde, lai tas netiktu saglabāts atkārtoti.

Salabots arī importa vēstures ieraksta ID: agrākais `row-id-history` nebija PostgreSQL UUID; tagad tiek ģenerēts derīgs UUID. Šis ID paliek nemainīgs attiecīgā importa atkārtojumos.

**Jaunā migrācija:** `supabase/migrations/20261024180627_atomic_plan_import.sql`. Tikai sagatavota, iekļauta arī svaigas instalācijas shēmā. Tā jāpiemēro pēc abām agrāk sagatavotajām migrācijām un pirms jaunā lietotnes koda izvietošanas. Nav veikta migrācija pastāvīgā DB. Ja funkcijas nav, nav rezerves pārejas uz daļējiem rakstīšanas pieprasījumiem.

Apstiprinājumu tabulai ir RLS, un piekļuve/izpilde paredzēta tikai esošajai servera `service_role` lomai. Apstiprinājumiem nav automātiska derīguma termiņa vai tīrīšanas: to izdzēšana atceltu ilgtermiņa atkārtojumu aizsardzību. Neatkarīgu vecā importa priekšskatījuma/JSON pārcelšanas galapunktu, kas jau raksta vienā `upsert`, šis labojums nemaina. Foto importa esošā ieslēgšanas konfigurācija nav mainīta.

### Atsevišķi saglabāšana, neskaidra atbilde un datu pārlāde

Pēc sekmīgas vienas rindas vai arhīva RPC izpildes neveiksmīgs nākamais lasījums atgriež atsevišķu `committed` apstiprinājumu ar ID. Pazudis savienojums vai nederīga/infrastruktūras atbilde bez saglabāšanas apstiprinājuma tiek marķēta `unknown`; tā netiek pasniegta kā pierādīta transakcijas atcelšana. Zināma DB kļūme joprojām ir atsevišķs noraidījums.

Izveide, dzēšana, arhivēšana, atjaunošana un imports izmanto kopēju rezultāta/pārlādes apstrādi. Aktīvā plāna un arhīva lasījumi tiek pabeigti abi, pirms saskarne publicē jauno kopējo stāvokli. Tas novērš agrāko atjaunošanas brīdi, kad arhīva rinda tika noņemta pirms neveiksmīgas aktīvā plāna ielādes.

Ja DB saglabāšana apstiprināta, bet pārlāde neizdodas, parādās ziņa **Saglabāts** un poga **Pārlādēt datus**. Turpmāka plāna rakstīšana tiek apturēta līdz pārlādei. Neskaidrus izveides/arhīva/dzēšanas rezultātus, kur iespējams, saskaņo pēc ID un sagaidāmā aktīvā/arhīva stāvokļa. Lauku/notikumu saglabāšanas rinda arī atšķir apstiprinātu rakstīšanu un neskaidru atbildi; ja atkopšanas lasījums neizdodas, tā atjauno apstiprināto bāzi un prasa datu pārlādi.

Tīkla kļūmes gadījumā bez servera apstiprinājuma vai nolasāma rezultāta nav iespējams pierādīt, vai rakstīšana pabeigta. Šis stāvoklis tiek skaidri saglabāts kā neskaidrs, nevis pieņemts par sekmi vai neveiksmi. Importam šo stāvokli atrisina drošs tā paša ID atkārtojums.

### Regresijas pārbaudes

Pievienoti testi servera atbildēm, klienta atbilžu apstrādei, kopējās pārlādes publicēšanai, importa atomiskajam repozitorijam un importa vēstures UUID. SQL testi pārbauda jauktu izveides/atjaunošanas importu, pēdējās rindas un bērna kļūmes atcelšanu, versiju konfliktu pēc agrāka ieraksta, dublikātus esošajos un jaunajos ciklos, viena ID atkārtojumu un vēlāku izmaiņu saglabāšanu.

Pilna autentificēta pārlūka pārbaude ar īstu Supabase HTTP/Storage šeit nav veikta. SQL testi izpilda shēmu un migrācijas tikai atmiņas PostgreSQL ar sintētiskiem datiem. Saglabāšanas rindas un nepabeigta importa mēģinājuma ievade joprojām nav noturīga pēc lapas aizvēršanas; DB apstiprinājums saglabājas, taču saskarnes mēģinājuma ID netiek rakstīts pārlūka krātuvē.

Noslēguma rezultāts pēc atlikušo P2 labojumu ieviešanas: **644/644 Vitest testi 51 failā, 23/23 atmiņas PostgreSQL testi, lint bez kļūdām vai brīdinājumiem, atsevišķs typecheck un `next build --webpack` sekmīgi**. `git diff --check` tīrs. Protokoli: `../.p1-tools/p2-remaining-*.log`. Pirmo build apturēja Windows `EPERM` pie iepriekš ģenerēta `.next` faila dzēšanas; ģenerētā mape pārvietota uz `../.p1-tools/next-before-p2-remaining`, un svaigā mapē build un typecheck iziet. Lietotnes būvēšanas konfigurācija nav mainīta. Oriģinālā projekta kopija paliek tīra, un lokālais HEAD joprojām ir `eb7a8d7`; commit un push nav veikti.

## Atkārtotajā kopējā pārbaudē atrasto trīs problēmu labojumi

### P1: iepriekšēja apstiprinājuma pāriešana uz nesāktu darbību

`writeAndRefresh` tagad atsevišķi izpilda sagatavošanas/priekšnosacījuma soli un tikai tad sāk konkrēto rakstīšanu. `completePlanWrite` gaida esošās saglabāšanas rindas šajā atsevišķajā solī. Ja gaidīšana neizdodas, rezultāts ir `not_started`, un iepriekšējais `committed` vai `unknown` vairs nevar kļūt par jaunās izveides, arhivēšanas, atjaunošanas vai dzēšanas rezultātu. Jaunā pieprasījuma un tā rezultāta pārbaudes izsaukumu nav. Ievade netiek iztīrīta un skats netiek pārslēgts kā pēc sekmes.

Imports arī saglabā savu mēģinājuma ID un saturu, ja jaunā nosūtīšana nav sākta. Tas ir svarīgi, ja šis pats imports iepriekš jau saņēmis neskaidru atbildi. Pārlādes kļūme pēc neveiksmīga priekšnosacījuma nenomaina `not_started` uz citu rezultātu.

### P2: viens aktīvā plāna un arhīva lasījums

Jaunais autentificētais GET `/api/sowing-plan/workspace` izpilda vienu nefiltrētu `sowing_plan_rows` SELECT kopā ar esošajām relācijām. No šī paša rezultāta rindas sadala aktīvajās un arhivētajās. Vairs netiek kombinēti divu dažādos brīžos izpildītu aktīvā plāna/arhīva pieprasījumu rezultāti.

Vienoto lasījumu izmanto sākotnējā ielāde, manuāla pārlāde, pēc rakstīšanas veiktā pārlāde, saglabāšanas rindas atkopšana un foto neskaidras atbildes saskaņošana. Atbilde netiek kešota. Kamēr sākotnējais pilnais skats nav ielādēts, plāna rakstīšana ir apturēta; kļūmes gadījumā pieejama datu pārlādes poga.

Papildu aizsardzība: ja vienā atbildē atkārtojas HUS ID, skats netiek publicēts. SELECT pieprasa precīzu vecāktabulas rindu skaitu; ja servera rindu ierobežojums atgriež nepilnu plānu, ielāde atgriež skaidru kļūdu un neveido šķietami veiksmīgu skatu ar pazudušām rindām. Tas nav paginēts risinājums: ja dati pārsniedz konfigurēto API limitu, vajadzīga atsevišķa testa vides/servera lasīšanas ietilpības pārbaude. Servera konfigurācija šajā darbā nav mainīta.

### P2: importa mēģinājuma saglabāšana pēc bloķēšanas kļūmes

Importa RPC kļūdas `55P03` (bloķēšanas gaidīšanas taimauts) un `40P01` (deadlock) tagad dod `WriteOutcomeError("unknown", ids)`, nevis parastu versiju konfliktu. Neveiksmīgs atkārtojums nepierāda agrākā pieprasījuma atcelšanu. API saglabā `unknown` arī HTTP atbildē, un saskarne patur sākotnējo importa UUID un precīzo saturu atkārtošanai.

Regresijas testi abiem kodiem vispirms saņem neskaidru rezultātu, tad sekmīgu apstiprinājumu, un pārbauda, ka abos pieprasījumos ID un sākotnējais saturs sakrīt. Parastie novecojušas versijas un dublikāta konflikti saglabā atsevišķo kļūmes apstrādi. SQL apstiprinājuma funkcija un transakcijas atcelšanas loģika nav mainītas.

Šiem trīs labojumiem **jauna DB migrācija nav nepieciešama**. Iepriekš sagatavotās trīs migrācijas paliek nepiemērotas pastāvīgai datubāzei. Nav commit, push, produkcijas datu/koda vai konfigurācijas izmaiņu.

Iepriekšējā pārskata četri defektu reprodukcijas testi pārveidoti par drošās uzvedības regresijas testiem un papildināti. Pilna reālu paralēlu Supabase savienojumu/Storage pārbaude vēl nav veikta; tīkla un bloķēšanas iznākumi regresijas testos ir vadāmi, bet SQL testos tiek izpildītas īstās shēmas funkcijas tikai atmiņā ar sintētiskiem datiem.

Gala pārbaudes pēc šo trīs atradumu labojumiem: **665/665 lietotnes testi 53 failos**, **23/23 atmiņas PostgreSQL testi**, lint bez kļūdām vai brīdinājumiem, atsevišķs typecheck un `next build --webpack` sekmīgi. `git diff --check` tīrs. Protokoli: `../.p1-tools/final-three-*.log`. Būvēts ar svaigu ģenerēto `.next` mapi; iepriekšējā saglabāta `../.p1-tools/next-before-final-three`, lai izvairītos no iepriekš novērotās Windows/OneDrive dzēšanas kļūmes. Lietotnes būvēšanas konfigurācija nav mainīta.

## P2: novecojušu pārlāžu rezultātu atmešana

`workspace-read-order.ts` nodrošina kopīgu secību sākotnējai ielādei, manuālajai pārlādei, pēcsaglabāšanas lasījumiem un atkopšanai. Tikai jaunākais joprojām derīgais lasījums drīkst publicēt aktīvās/arhīva rindas un mainīt izvēlēto HUS. Jaunāks lasījums invalidē vecāku; rakstīšanas sākums un beigas invalidē agrākus un rakstīšanas laikā sāktus lasījumus. Kamēr darbojas kaut viena rakstīšana, lasījums nedrīkst publicēt momentuzņēmumu. Aizsardzība aptver lauku/notikumu saglabāšanas rindas, izveidi, dzēšanu, arhivēšanu/atjaunošanu, importu un foto pievienošanu/dzēšanu.

Novecojušas sekmes un kļūmes ir atsevišķs iekšējs rezultāts: tās nedrīkst atjaunot veco skatu, izraisīt atkopšanu uz veco apstiprināto rindu vai noņemt jaunākas kļūmes rakstīšanas aizliegumu. `writeAndRefresh` saglabā konkrētās rakstīšanas apstiprinājumu arī tad, kad tās pēclasījumu aizstāj jaunāks. Ja nav derīga svaiga skata, rakstīšana paliek apturēta un pieejama pārlāde. Manuālās pārlādes poga gaidīšanas laikā ir bloķēta, un atkārtots izsaukums tiek apturēts arī ar sinhronu ref aizsardzību.

Deviņi jaunie regresijas testi izmanto īsto secības koordinētāju un rezultātu apstrādi ar vadāmi aizturētām atbildēm: lēns B → ātrs B → saglabāts C → vecais B; vecas sekmes pēc jaunākas kļūmes; veca kļūme pēc jaunākām sekmēm; sākotnējā lasījuma invalidēšana; lasījums rakstīšanas laikā; pārklājošās rakstīšanas; jau atgriezta momentuzņēmuma derīguma atcelšana; `committed` un `unknown` apstiprinājuma saglabāšana pie aizstāta pēclasījuma.

DB shēma un migrācijas nav mainītas. Nav commit, push vai produkcijas izmaiņu. Pārbaudes protokoli: `../.p1-tools/read-order-*.log`.

Gala rezultāts: **674/674 lietotnes testi 54 failos**, **23/23 atmiņas PostgreSQL testi**, atsevišķs typecheck un `next build --webpack` sekmīgi. Pilnais lint sākotnēji atrada tikai vienu pēc pārveidošanas neizmantotu importu; tas noņemts, un atkārtots lint visiem šajā posmā mainītajiem TypeScript failiem ir bez kļūdām un brīdinājumiem. Pēc importa tīrīšanas arī build palaists atkārtoti un iziet (`read-order-build-final.log`). `git diff --check` tīrs; HEAD joprojām `eb7a8d7`, oriģinālā projekta kopija tīra. Šajā labojuma posmā nav atkārtota pārlūka pārbaude; agrāk pārlūkā reproducētās secības tagad pārbaudītas ar vadāmiem asinhroniem regresijas testiem.

## P2: lauka apstiprinājums saglabā jaunāko foto stāvokli

`hus-media-publication.ts` uzskaita veiksmīgu lokālu foto/piezīmju izmaiņu revīziju katram HUS atsevišķi. Lauka vai notikuma saglabāšana fiksē šo revīziju pirms ievietošanas rindā. Ja tā mainījusies līdz apstiprinājuma publicēšanai, no servera pārņem laukus, notikumus, vēsturi un `updatedAt`, bet saglabā pašreizējos foto un piezīmes. Foto masīvi netiek apvienoti, tāpēc dzēstie foto un foto-only piezīmes neatgriežas. Ja lokālas foto izmaiņas nav notikušas, autoritatīvo servera foto saturu publicē kā iepriekš.

Notikuma apzināta dzēšana joprojām noņem tā piesaistītos foto; vecāko foto saglabāšanas aizsardzība šo darbību neatceļ. Aizsardzību izmanto abi saglabāšanas apstiprinājumi — lauki un HUS notikumi —, kā arī atkopšanas rezerves atgriešanās pie pēdējās apstiprinātās rindas, ja pilnais lasījums neizdodas. DB rakstīšanas funkcijas un saglabāšanas rindas apstiprinātā versija netiek aizstātas ar lokāli izdomātu versiju.

Abi iepriekšējās pārbaudes defekta reprodukcijas testi tagad pārbauda drošo rezultātu ar īsto publicēšanas palīgu, rindu un pārlāžu koordinētāju. Vēl seši testi aptver jaunus foto ar piezīmēm, dzēšanu pāri vairākiem rindas apstiprinājumiem, servera lauku/versijas saglabāšanu, citas HUS neatkarību, parastu autoritatīvu lasījumu, apzinātu notikuma/foto dzēšanu un neveiksmīgas atkopšanas rezerves ceļu.

Jauna DB migrācija nav nepieciešama. Nav commit, push vai produkcijas izmaiņu. Protokoli: `../.p1-tools/media-publication-*.log`. Šajā posmā pārbaudes ir automatizētas ar vadāmu atbilžu secību; nav veikta jauna īsta Supabase Storage/pārlūka integrācijas pārbaude.

Gala pārbaudes: **682/682 lietotnes testi 56 failos**, **23/23 atmiņas PostgreSQL testi**, pilns lint bez kļūdām/brīdinājumiem, atsevišķs typecheck un `next build --webpack` sekmīgi. Abi sākotnējās pārbaudes testi vairs negaida kļūdaino foto iznākumu. `git diff --check` tīrs; HEAD nemainīgs (`eb7a8d7`), oriģinālā lokālā projekta kopija tīra. Iepriekšējā ģenerētā `.next` mape saglabāta `../.p1-tools/next-before-media-publication`, lai izvairītos no iepriekš novērotās Windows/OneDrive ģenerēto failu dzēšanas kļūmes.
