# P1 un P2 kopējā pārbaude — 24.10.2026.

**Jaunākā atkārtotā kopējā pārbaude:** skat. `p1-p2-final-review.md`. Pēc atlikušo P2 labojumu integrācijas reproducēts viens jauns P1 un divi P2 atradumi; zemāk saglabāts agrākais pārskats.


**Statusa papildinājums pēc labojuma:** 1. un 2. P1 atradums ir lokāli salaboti; to agrākie reprodukcijas testi tagad sagaida drošo uzvedību. Zemāk saglabāts sākotnējās pārbaudes apraksts. Aktuālā labojuma detaļas ir `p1-local-fixes.md` pēdējā sadaļā. Ar nākamo lokālo labojumu novērsti arī 3. un 4. P2 atradumi: viss apstiprinātais foto imports ir viena transakcija ar atkārtojuma apstiprinājumu, bet saglabāšanas un pārlādes rezultāti ir nošķirti. Jaunā migrācija ir tikai sagatavota. Aktuālās detaļas un pārbaudes ir `p1-local-fixes.md` pēdējā sadaļā.


Pārskatīta lokālā kopija `small-plants-p1`, sākumpunkts `eb7a8d7`. Šajā pārbaudē lietotnes un migrāciju kods nav labots; pievienoti divi problēmu reprodukcijas testi un šis pārskats. Nav commit, push, ārēju DB pieprasījumu vai produkcijas izmaiņu.

## Secinājums

P1/P2 risinājumu pamatvirziens ir pareizs: viena HUS saglabāšana un arhīva stāvokļa maiņa ir atomiska, saglabātā Moving ID un foto saites netiek pārradītas, pašreizējā cikla izvēle atbilst noteiktajiem datumu noteikumiem. Tomēr kopējā pārbaudē reproducētas divas neatrisinātas P1 kļūmes. Pirms izvietošanas tās jānovērš.

## Prioritizēti atradumi

### 1. P1 — pārklājošs foto atkārtojums var zaudēt jau saglabātu attēlu

**Apstiprināts ar reprodukcijas testu.** Pirmais pieprasījums ar stabilu `uploadId` izveido piezīmi un augšupielādē pirmo no diviem foto. Kamēr otrais foto vēl gaida, tā paša pieprasījuma atkārtojums izmanto jau augšupielādēto failu, pabeidz abus foto un saglabā metadatus. Pirmais pieprasījums pēc tam saņem kļūdu pirms sava metadatu ievietošanas mēģinājuma; tā `metadataWriteStarted` joprojām ir `false`, tādēļ tīrīšana izdzēš pirmo failu un piezīmi, kuru jau izmanto sekmīgais atkārtojums.

Tests parāda, ka pēc sekmīgas otrās atbildes viens no diviem foto ceļiem vairs neeksistē un piezīme ir dzēsta. Īstajā shēmā `hus_photos.hus_note_id` ir `ON DELETE CASCADE`, tādēļ piezīmes dzēšana noņem arī piesaistītos foto metadatus. Šī kaskāde šajā konkrētajā reprodukcijā nav simulēta; tās sekas izriet no shēmas. Foto var pazust arī notikuma foto gadījumā bez piezīmes, jo pats koplietotais fails tiek dzēsts.

**Kā rodas praksē:** savienojums pārtrūkst, kamēr pirmais servera pieprasījums vēl turpina darbu, un lietotājs atkārto saglabāšanu. Dialoga aizsardzība pret dubultklikšķi neaptur iepriekšējā servera pieprasījuma darbu.

**Saistība ar labojumiem:** P1 pievienotā stabilā ceļa atkārtota izmantošana ļauj otrajam mēģinājumam pabeigt darbu. Vecais kompensējošās dzēšanas ceļš nav pielāgots šai koplietošanai.

**Pierādījumi:** `src/lib/repositories/supabase-hus-media-repository.ts:172-186,219-235`, `supabase/schema.sql:109-110`, `src/lib/repositories/p1-p2-review.test.ts`.

**Praktisks labojums:** pieprasījumiem ar stabilu `uploadId` neveikt tūlītēju failu/piezīmju kompensējošo dzēšanu arī pirms metadatu rakstīšanas. Atkārtojumiem tos izmantot atkārtoti; nepiesaistītus objektus vēlāk pārskatīt un tīrīt ar aizturi un atsauču pārbaudi. Alternatīva ir servera operācijas bloķēšana uz `uploadId`, kas aptver arī Storage darbības. Viena pārbaude pirms dzēšanas pati par sevi neatrisina vienlaicības sacensību.

### 2. P1 — jauktas saglabāšanas rindas kļūme neatjauno apstiprināto stāvokli

**Apstiprināts ar reprodukcijas testu un izsaukumu pārbaudi kodā.** Lietotājs maina lauku un, kamēr tas saglabājas, pievieno HUS notikumu. Rindā vispirms ir lauka labojums, pēc tam notikums. Lauka pieprasījums neizdodas. `enqueueRowSave` izsauc kļūmes apstrādi tikai pēdējam rindas elementam. Lauka apstrādātājs būtu pārlādējis datus, bet tas netiek izsaukts; HUS notikuma apstrādātājs tikai uzstāda kļūdas tekstu.

Notikums netiek saglabāts — tā ir pareizā daļa. Taču ekrānā paliek lauka optimistiskā, nesaglabātā vērtība. Nākamais cita lauka labojums var nosūtīt arī šo neveiksmīgo vērtību. Ja pirmais pieprasījums DB neko nesaglabāja, versija joprojām ir derīga un nevēlamā vērtība var tikt saglabāta bez konflikta.

**Saistība ar labojumiem:** jaunās kopējās rindas kļūmes politika pieņem, ka pēdējā operācija veiks to pašu atkopšanu; abi faktiskie izsaucēji izmanto atšķirīgus apstrādātājus.

**Pierādījumi:** `src/lib/row-save-queue.ts:18-25`, `src/components/PlannerApp.tsx:371-399`, `src/lib/p1-p2-queue-review.test.ts`.

**Praktisks labojums:** vienota atkopšana visai HUS rindai neatkarīgi no pēdējās operācijas veida. Pēc kļūmes pārlādēt apstiprināto rindu vai saglabāt pēdējo apstiprināto bāzi; līdz atkopšanai neatļaut jaunas saglabāšanas no optimistiskā stāvokļa. Dialogam atsevišķi jāsaņem notikuma kļūda, saglabājot tā ievadi atkārtošanai.

### 3. P2 — vairāku rindu imports vēl var palikt daļēji saglabāts

**Konstatēts kodā; šī nav jaunā P1/P2 regresija.** `confirmProductionPlanImport` saglabā kandidātus pa vienam. Kļūme vēlākā rindā neatceļ agrāk saglabātās. Vispārīgas kļūmes apstrāde arī nepārlādē plānu; to dara tikai versiju konflikta gadījumā. Atkārtota importa izvēle var izmantot vecu dublikātu informāciju un apstāties uz jau saglabātām rindām.

**Pierādījums:** `src/components/PlannerApp.tsx:831-865`. Šajā pārbaudē nav palaista pārlūka importa plūsma ar īstu HTTP/DB pieslēgumu.

**Praktisks labojums:** vai nu viena transakcija visam apstiprinātajam importam, vai skaidri uzskaitīti sekmīgie/neveiksmīgie kandidāti ar stabiliem ID un drošu turpināšanu. Pēc jebkuras kļūmes pārlādēt aktīvo plānu un pārrēķināt dublikātus.

### 4. P2 — sekmīgs DB ieraksts un neveiksmīga atbildes pārlāde joprojām nav atšķirti

**Konstatēts kodā; esošs integrācijas ierobežojums.** Pēc RPC sekmēm repozitorijs atsevišķi ielādē rindu. Arhīva saskarne pēc tam vēl atsevišķi pārlādē aktīvo plānu. Ja šie lasījumi neizdodas, lietotājs redz kļūmi, lai gan DB transakcija ir pabeigta. Pēc atjaunošanas arhīva rinda var jau būt noņemta no ekrāna pirms aktīvā plāna pārlādes.

Tas nenozīmē daļēju DB transakciju. Risks ir neskaidrs lietotnes stāvoklis un lieks atkārtots mēģinājums. HUS notikuma saglabāšanai atkopšana jau ir, bet tā nav vienādi piemērota visām operācijām.

**Pierādījumi:** `src/lib/repositories/supabase-sowing-plan-repository.ts:142,206`, `src/components/PlannerApp.tsx:404-437`.

**Praktisks labojums:** atšķirt apstiprinātu rakstīšanu no neveiksmīgas pārlādes; pēc neskaidras atbildes saskaņot aktīvo plānu un arhīvu pēc ID. Līdz saskaņošanai piedāvāt datu pārlādi, nevis paziņot, ka pati saglabāšana noteikti nav notikusi.

## Pārbaudītie galvenie scenāriji

| Scenārijs | Rezultāts un pierādījumi |
|---|---|
| Jauns HUS un vairāki ātri lauku labojumi | Esošie repozitorija un rindas testi iziet; iepriekšējā atbilde nepārraksta jaunāku ievadi. Jauktās kļūmes izņēmums aprakstīts 2. atradumā. |
| Neizdevusies viena HUS saglabāšana | SQL testi pārbauda pilnu vecā stāvokļa saglabāšanu pie darba, izvietojuma, zudumu, notikumu un vēstures kļūmēm. |
| Divas saglabāšanas no vienas versijas | SQL testi noraida novecojušo versiju. Tas pārbauda versiju loģiku, nevis īstu vairāku HTTP klientu slodzi. |
| Moving ar saistītu zudumu un foto | SQL testi saglabā notikuma ID, korekcijas ID un foto atsauci; notikuma apzināta dzēšana noņem tikai izvēlēto vēsturi. |
| Foto atkārtošana pēc pazudušas atbildes | Secīgie atkārtojumi, pāreja pāri pusnaktij, trūkstoša faila atjaunošana un svešu baitu noraidīšana iziet. Pārklājošais mēģinājums atklāj 1. atradumu. |
| Arhivēt → atjaunot | SQL testi saglabā momentuzņēmumu, manuālos datumus, Moving, zudumus un foto saites. |
| Kļūme arhivēšanas/atjaunošanas vidū | SQL testi abos virzienos atceļ gan citu HUS fiksētos datumus, gan versiju maiņu. |
| Mainīts aktīvais plāns vai dublikāts atjaunošanā | SQL testi noraida novecojušu kontekstu, jaunu rindu, nepilnīgas versijas un normalizētu dublikātu. |
| Pašreizējais, nākotnes, pārklājošais un pabeigtais cikls | Izvēles un kartītes attēlošanas testi iziet; pārējie cikli paliek pieejami. |
| Viena un divu HUS simulācija, faktiskā Moving aizsardzība | Esošie simulācijas testi aptver ciklu saglabāšanu, noslodzi un sākotnējo datu nemainīšanu. Simulācijas panelis tikai aprēķina priekšskatījumu un neveic saglabāšanas pieprasījumu. |

## Pārbaudes un to robežas

Rezultātu protokoli: `../.p1-tools/review-*.log`. Divi jaunie testi ir **problēmu reprodukcijas**: tie sagaida un apstiprina pašreizējo kļūdaino rezultātu. To sekmes nav šo problēmu novēršanas apliecinājums.

Atmiņas PostgreSQL: 17/17 testi sekmīgi. Lint un typecheck sekmīgi. Pirmajā pilnajā Vitest palaišanā 605 testi iziet, bet viens kopīgās simulācijas tests pārsniedz noklusēto 5 sekunžu robežu, kamēr vienlaikus darbojas arī SQL, lint un typecheck. Atkārtotā pilnā palaišanā ar `--maxWorkers 2` iziet 606/606 testi 47 failos (62,86 sekundes); noklusētais 5 sekunžu laika limits nav mainīts. Tie ietver iepriekšējos 604 testus un 2 jaunās problēmu reprodukcijas. `git diff --check` ir tīrs.

Iepriekšējā P2 noslēgumā `next build --webpack` iziets uz šī paša lietotnes koda; šajā pārbaudē pievienoti tikai testi un dokuments. Jaunās pārbaudes typecheck ietver arī abus reprodukcijas testus.

Nav veikta pilna pārlūka pārbaude ar autentificētu testa Supabase, īstu Storage un vairākiem HTTP klientiem. Storage sacensība reproducēta ar kontrolētiem repozitorija aizvietotājiem, bet SQL transakciju pārbaudes izpilda īsto shēmu un funkcijas atmiņas PostgreSQL. Reāla bloķēšanas sacensība starp vairākiem DB savienojumiem nav pārbaudīta.

## Vēl palikušie ekspluatācijas darbi

- Abas jaunās migrācijas ir tikai sagatavotas. Pirms izvietošanas tās atsevišķi jāpārbauda testa vidē; pašreizējais kods bez tām droši atsakās rakstīt.
- Atkārtošanas fails un stabilā operācija glabājas atvērtā ievades loga atmiņā. Pēc lapas aizvēršanas vai pārlādes nav saglabātas atkopšanas rindas nepabeigtajām augšupielādēm.
- Nav ieviesta aizturēta nepiesaistītu Storage objektu/piezīmju uzskaite un tīrīšana. To nedrīkst pievienot kā tūlītēju kompensējošu dzēšanu.
- Simulācijas aprēķins pārlūkā ir sinhrons. Novērotais testa laika pārsniegums ir signāls atsevišķai veiktspējas pārbaudei, bet nav pierādījums jaunai algoritma regresijai vai pastāvīgai uzkāršanai.
- Nav pārbaudīta faktiskā rezerves kopijas atjaunošana, izvietošanas konfigurācija vai produkcijas migrāciju stāvoklis; šajā darbā produkcijas piekļuves nav izmantotas.
