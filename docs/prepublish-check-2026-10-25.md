# SMALL PLANTS — pirms publicēšanas, 25.10.2026.

**Ieviešanas papildinājums 25.10.2026.:** produkcijas lietotnes kopija (9 tabulas, 307 ieraksti un visi 16 Storage faili) atjaunota lokāli ar pārbaudītām kontrolsummām, piekļuves tiesībām un RLS. Pirms ieviešanas produkcijas dati salīdzināti ar kopiju un sakrīt. Pēc lietotāja ieviešanas atļaujas produkcijā secīgi piemērotas `atomic_sowing_plan_save`, `atomic_archive_state`, `atomic_plan_import`; pēc tām visi esošie dati un Storage metadati precīzi nemainīti. Gala pārbaudēs iziet 682 lietotnes, 23 SQL un 11 reāli lokālie DB/Storage testi, lint, typecheck un production build. Atgriešanās Vercel izvietojums: `dpl_6SH8hEeJAJh9YVmLWbFdfRwbPka6`. Zemākie NO-GO vērtējumi ir vēsturiskā inventarizācija; to kopijas un lokālās vides šķēršļi ir novērsti. Publicēšanas un pēcpārbaudes gala protokols tiek glabāts ārpus Git repozitorija kopā ar ieviešanas pierādījumiem.

**Papildinājums pēc Docker/WSL sagatavošanas:** sākotnējais lokālās integrācijas/atjaunošanas šķērslis ir novērsts. Iziet 11 īstās lokālās Supabase DB/Storage pārbaudes; trīs migrācijas saglabā esošos datus, un svaigā kopija atjaunota otrā lokālā vidē ar identisku 10 tabulu saturu un 15 failu hash. Pārbaudīta arī atjaunotās lietotnes lapa un saglabāšanās pēc pārlādes. Lokālajai verifikācijai **GO**; faktiska produkcijas kopija, Vercel atgriešanās izvietojuma fiksēšana un atsevišķa ieviešanas atļauja vēl nepieciešama. Aktuālais īsais protokols: `../../supabase-local-test/RESULTS.md`. Zemāk saglabāts sākotnējais izvērtējums.

**Lēmums: NO-GO produkcijai pagaidām.** Jauns kritisks koda defekts nav pierādīts, bet nav īstas DB/Storage rakstīšanas un rezerves kopijas atjaunošanas pārbaudes. Lietotnes kods un migrācijas šajā posmā nav mainīti; nav commit, push, izvietošanas, produkcijas rakstīšanas vai maksas resursu.

## Pārbaudīts

- Atkārtoti iziet **682/682 lietotnes testi** un **23/23 SQL testi**. Tie aptver HUS izveidi/laukus, Moving/zudumus, foto atkārtojumus, piezīmju dublēšanos, arhīvu/atjaunošanu, atomisku importu/dublikātus, viena/divu HUS simulāciju, atkopšanu un novecojušu atbilžu publicēšanu. Tie ir automatizēti testi ar atmiņas DB/vadāmām atbildēm, nevis pilna īsta Supabase gala–gala pārbaude. Iepriekšējā posmā lint, typecheck un build izieti ar šo pašu lietotnes kodu.
- Jauna **jaunināšanas** pārbaude: uz pirmslabojumu shēmas izveidota sintētiska vēsture, Moving ar zudumu, foto/piezīmes, arhīvs, grafiki, izvietojums un plāna dokuments. Pēc katras no trim migrācijām precīzi sakrīt visas vērtības un laika atzīmes deviņās esošajās tabulās. Tas pārbaudīts tikai PGlite. Protokols: `../.p1-tools/prepublish-upgrade.log`; pārbaudes fails: `prepublish-upgrade-check.mjs` tajā pašā mapē.
- Īstā projekta `small plants` DB lasīšanas pārbaude: 22 HUS, 4 arhivēti, 16 notikumi, 13 korekcijas, 196 vēstures ieraksti, 6 piezīmes un 12 foto metadatu rindas. Nav atrasti dublēti normalizētie aktīvie cikli vai foto saites uz citas HUS notikumu/piezīmi. Visiem foto un plāna dokumentu metadatiem ir Storage objektu ieraksti. Tas nav bināro failu lejupielādes/satura tests.
- Foto bucket satur 14 objektus, dokumentu bucket — 2. Foto bucket ir 2 papildu objekti ārpus 12 foto metadatu saitēm; neko netīrīju. Rezerves kopijā jāiekļauj visi objekti.
- Jaunās trīs RPC funkcijas produkcijā vēl nav, migrāciju vēsture ir tukša. Vajadzīgie tabulu lauki ir pieejami. Lokālais HEAD paliek `eb7a8d7`; `git diff --check` tīrs. Daudzi jaunie faili ir vēl Git neizsekoti un vēlāk jāiekļauj pārskatītajā commit.

## Kāpēc nav īstas testa vides

Savienojumā redzama viena Free organizācija ar diviem aktīviem projektiem; publicētais Free limits ir divi. Jauna projekta cenas pieprasījums atgriež $0/mēnesī, bet tas neatceļ projektu kvotu. Izveides mēģinājums nav veikts. Branch cenas rīks norāda $0.01344/stundā; maksas branch nav veidots. Cits projekts nav apturēts. Šajā datorā Docker nav atrasts, tāpēc lokāla pilna Supabase vide nav palaista. Mākoņa izveides rīka pieprasītā organizācijas izvēle tika uzdota; tā pati par sevi neatbrīvotu kvotu.

**Vienkāršākā alternatīva:** palaist lokālu Supabase datorā ar Docker un sintētiskiem datiem. Alternatīvi atsevišķi vienoties par brīvu mākoņa projekta vietu; citu darba projektu nedrīkst apturēt automātiski. Pirms GO vajag īstus RPC un Storage upload/download/delete, pārtrauktu atkārtojumu, lapas pārlādi, paralēlas atbildes un divu savienojumu bloķēšanas pārbaudi. Vercel produkcijas projekta saite, atgriešanās izvietošanas ID un Preview konfigurācija šajā posmā nav pārbaudīta.

## Pārbaudāma rezerves kopija — pirms jebkādas produkcijas rakstīšanas

1. Sarunāt īsu bezrakstīšanas logu visiem lietotājiem, aizvērt vecās cilnes un pierakstīt pašreizējās Vercel izvietošanas ID. Visu eksportu veikt vienā šādā logā, lai DB un Storage kopija atbilst vienam stāvoklim.
2. Ar esošiem, droši padotiem DB rekvizītiem eksportēt lomas, shēmu un datus (`supabase db dump --role-only`, parasts `db dump`, `db dump --data-only --use-copy`; katram savs fails). Neatiestatīt produkcijas paroli. Supabase CLI ceļš prasa Docker; alternatīva ir saderīgs `pg_dump`/`psql` citā datorā.
3. Atsevišķi caur Storage API lejupielādēt **visus** objektus no `small-plants-hus-photos` un `small-plants-plan-documents`, saglabājot pilnos bucket/ceļus. Izveidot manifestu ar ceļu, izmēru un SHA-256; saglabāt arī bucket privātuma/MIME/izmēru konfigurāciju. DB kopija viena pati foto failus neietver.
4. Izolētā vidē atjaunot DB, bucket konfigurāciju un failus. Salīdzināt tabulu skaitu/ID un saturu, failu manifestu/hash, foto saites, arhīva vēsturi un atvērt visus 12 piesaistītos foto. Tikai eksportētu failu esamība nav atjaunošanas pierādījums. Pašlaik īsta kopija nav izveidota vai atjaunota.

## Ieviešanas un atgriešanās secība pēc atsevišķas atļaujas

1. Pabeigt īsto izolēto testu un kopijas atjaunošanu. Testa lietotnei/Preview dot tikai testa Supabase URL/atslēgas; nekad produkcijas atslēgas. Saglabāt visas lietotnes izmaiņas pārskatītā commit tikai pēc atļaujas; atsevišķi saskaņot push, jo tas var palaist automātisku Vercel izvietošanu.
2. Pirms produkcijas loga fiksēt veco Vercel izvietojumu un pārbaudīt pieejamo rollback. No jaunā koda izveidot pārbaudāmu artefaktu, to vēl nepārslēdzot produkcijā.
3. Bezrakstīšanas logā izveidot un pārbaudīt aktuālo kopiju. Ar skaidri atlasītu migrāciju izpildītāju piemērot **tikai**:
   1. `20261024160132_atomic_sowing_plan_save.sql`
   2. `20261024172817_atomic_archive_state.sql`
   3. `20261024180627_atomic_plan_import.sql`
   Pēc katras pārbaudīt sekmi un datu saglabāšanos. Nelaist `schema.sql` uz esošās DB un neizpildīt aklu `db push`: vecās migrācijas nav reģistrētas produkcijas vēsturē. Jāsaskaņo vēstures sākumpunkts/izpildītājs, nevis jāatkārto vecie DDL.
4. Pēc visu trīs funkciju un piekļuves pārbaudes izvietot/switchot jauno Vercel lietotni. Produkcijas URL/atslēgas atstāt servera pusē. Veikt nelielu iepriekš saskaņotu pēcievišanas pārbaudi, salīdzināt saglabātos datus un tikai tad atļaut ikdienas rakstīšanu.
5. Kļūmes gadījumā apturēt rakstīšanu un atgriezt Vercel uz iepriekš fiksēto izvietojumu. Jaunās funkcijas/receipt tabulu parasti atstāt: migrācijas ir pievienojošas, vecajai lietotnei tās nav jālieto. **Nedzēst receipt datus un neveikt automātisku DB rewind.** Vecā lietotne atgriež arī agrākos uzticamības trūkumus, tāpēc rollback sākotnēji lietojams ar rakstīšanu apturētu. Ja tiešām bojāti dati, saglabāt pēckļūmes kopiju, atjaunot DB un Storage izolēti un saskaņot jaunās izmaiņas, lai nezaudētu pēc sākotnējās kopijas ievadīto.

Atlikušās zināmās robežas: nepabeigtu foto/importa mēģinājumu identitāte nav noturīga pēc cilnes aizvēršanas; nav aizturētas nepiesaistītu failu tīrīšanas; lielam arhīvam vajadzīga servera atbilžu limitu pārbaude. Šajā pārbaudē jauns kritisks datu zuduma defekts nav pierādīts, bet bez īstās integrācijas un atjaunošanas pārbaudes GO nav pamatots.

Avoti: [Supabase Free limits](https://supabase.com/docs/guides/platform/billing-on-supabase), [DB kopija neietver Storage failus](https://supabase.com/docs/guides/platform/backups), [CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [Vercel rollback](https://vercel.com/docs/deployments/rollback-production-deployment). Rīku pārbaudēs iegūtie projekta/organizācijas metadati un tikai lasīšanas SQL; lokālie `prepublish-*.log` protokoli.
