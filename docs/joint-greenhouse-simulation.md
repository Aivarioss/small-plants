# Kopīga vairāku HUS simulācija

`src/lib/joint-greenhouse-simulation.ts` eksportē `simulateJointSowingPlan`.
Tas ir tīrs aprēķins bez UI pieslēguma, datu saglabāšanas un DB izmaiņām.
Esošais viena HUS simulators un Stādu mājas kapacitātes skats turpina strādāt tāpat.

## Ievade

```ts
const result = simulateJointSowingPlan({
  rows,
  config: plannerConfig,
  asOfDate: "2026-10-16",
  sowingChanges: [
    { planRowId: hus8a.id, sowingDate: "2026-10-17" },
    { planRowId: hus8b.id, sowingDate: "2026-10-19" },
    { planRowId: hus3.id, sowingDate: "2026-10-20" },
  ],
  completedWork: [],
  lockedPlanRowIds: [],
});
```

`asOfDate` ir obligāts; aprēķins nav atkarīgs no datora pašreizējā datuma.
Pagājuši retināšanas datumi tiek konservatīvi fiksēti. Moving un retināšanas
faktiskie notikumi netiek pārplānoti, arī ja ieraksts datēts nākotnē.
`completedWork` ļauj nodot citur reģistrētus faktiskos darbus kā
`{ planRowId, type, date }`. Darba `locked` vai manuāls plānotais datums pats
par sevi nenozīmē, ka darbs ir izpildīts. `lockedPlanRowIds` papildus pilnībā
fiksē izvēlētos HUS.

Planting vienmēr paliek ievades `harvestDate`. Mainot sēšanu, netiek izmantota
vecā viena HUS simulatora darbība, kas pārbīda arī Planting.

## Meklēšana

Meklēšana izmanto esošo `generateWorkItemsForRows`, `scheduleProductionWork`,
`evaluateThinningWorkload`, `evaluateGreenhouseDensity` un koplietotās
`greenhouseSimulationModel` resursu pārbaudes. Nav jaunu darba slodzes svaru,
galdu ietilpības koeficientu vai otra neatkarīga scheduler.

1. Vienlaikus izvēlas 8.–10. dienas datumus un esošajam normālajam galdu skaitam
   atbilstošus izvietojumus visiem iesaistītajiem vēl neizpildītajiem HUS.
   Drīkst izmantot citu rindu un A14–A26, ja viss periods ir brīvs.
2. Ja risinājuma nav, pievieno esošo blīvuma klašu sablīvējumu līdz 35 stādiem
   renē un fiziski iespējamu B/C/D rindas dalīšanu. Kompromisi ir nosacīti.
3. Ja regulārie varianti neder, pievieno ārkārtas 11. dienu.
4. Tikai pēc tam izmēģina viena cita vēl nesākta HUS sēšanas pārbīdi par
   ±1, ±2 vai ±3 dienām. Šāds priekšlikums vienmēr prasa lietotāja apstiprinājumu.
   Lietotāja tieši pieprasītie sēšanas datumi netiek aizstāti ar citiem.

Katrs starpstāvoklis satur vienu kopīgu rezervāciju kopu. Vēl neizvēlētajiem
HUS sēšanas galdiem izmanto agrāko iespējamo retināšanu kā optimistisku
apakšējo aizņemtības robežu, lai nepamatoti neatmestu kopīgi atrisināmu variantu.
Gala plānu atkārtoti pārbauda ar visiem izvēlētajiem datumiem kopā.

Sēšanas galdi ir aizņemti no sēšanas līdz retināšanai ieskaitot; atbrīvojas
nākamajā dienā. Piešķirtie A numuri ir fiksēti, un aizņemto galdu skaits ir
vismaz esošajā sēšanas formulā vajadzīgais skaits un vismaz piešķirto numuru
skaits. Trūkstoši A numuri netiek uzskatīti par trūkstošu kapacitātes informāciju.
Fiksētām rezervācijām pārbauda arī nepārtrauktu fizisku izvietojumu, neparedzot
starpdienu stādu pārvietošanu. Šīs pārbaudes meklēšanas soļi ietilpst kopējā budžetā.

Augšanas vietu pārbauda katru dienu līdz katra pārplānotā HUS Planting.
Tiek iekļautas arī vēlākas fiksētās rezervācijas, ja tās pārklājas ar cita
iesaistītā HUS garāko uzturēšanos. Planting dienā augšanas vieta ir brīva;
tās pašas dienas retināšanai ir norāde “vispirms Planting”. Dalītās zonas
rezervācija tiek skaitīta vienu reizi, bet katra HUS fiziskie galdi paliek uzskaitē.

Plānus sakārto pēc sēšanas kompromisiem, blīvuma/laistīšanas kompromisiem,
blīvuma pakāpes un sablīvējuma apjoma, mainīto retināšanas datumu skaita un
pārbīdes, darba pārslodzes, ārkārtas dienām un rindu maiņām. Darba pārslodze
ir esošā scheduler noteiktais pārsniegums unikālajās retināšanas dienās.
Blakus datumi ar vienādu praktisko efektu un savstarpēji aizvietojamu rindu
permutācijas netiek atkārtoti piedāvātas.

Nemaina citus jau ieplānotus darbus. Ja jauns sēšanas datums padara automātiskās
pazarēšanas/kociņu dienas bioloģiski nederīgas, esošais scheduler aprēķina jaunas
vēl neizpildīto automātisko darbu dienas; tās atsevišķi redzamas `workDates`
priekšlikumos ar saskaņošanas nosacījumu. Manuāli fiksētu darbu konfliktu
neatrisina, klusējot pārrakstot tā datumu.

## Rezultāts un robežas

- `plans`: līdz trim kopīgi pārbaudītiem, būtiski atšķirīgiem plāniem.
- `proposals`: katra HUS sēšana, retināšana, Planting, rinda, galdi, blīvums,
  laistīšanas partneri, darbu secība un slodze.
- `changes`: pirms/pēc vērtības, pamatojums LV/EN un `requiresApproval`.
- `workItems` un `occupancy`: plānotie darbi un kopīgā dienu kapacitāte.
- `conflicts`: konkrēti novērotie šķēršļi ar datumu un iesaistītajiem HUS.
- `search`: izlietotie soļi, posmi, robežas un pēc robežas fiksētie HUS.

`can` nozīmē pārbaudītu plānu; `conditional` ir plāns ar redzamiem riskiem vai
neapstiprinātiem nosacījumiem. `insufficientData` norāda lēmumam būtisku datu
trūkumu. `cannot` norāda neveiksmi pārbaudītajā kandidātu telpā.
Ja meklēšana tika apgriezta un risinājuma nav, atgriež `searchLimited`,
neapgalvojot, ka cits plāns nevarētu pastāvēt. Ar atrastu plānu
`search.truncated` joprojām var būt `true`: plāns ir pārbaudīts, bet tā globāls
optimālums nav pierādīts.

Noklusējumi: 12 000 soļu, 48 saglabāti starpstāvokļi, 8 maināmi HUS,
12 sēšanas kompromisa scenāriji. Absolūtie maksimumi ir 50 000 / 128 / 12 / 24.
Kontekstā ir ne vairāk par 80 HUS; periods un atsevišķs cikls ir ierobežots
ar 90 dienu intervālu. Robežas ir eksplicītas un atspoguļotas rezultātā.
Meklēšana nepierāda matemātiski optimālu risinājumu un nepiedāvā divu
nepieprasītu sēšanu vienlaicīgu pārbīdi vai fizisku Moving pārrakstīšanu.

Izpildītas retināšanas un atšķirīga Moving datuma savietošana prasa papildu
informāciju par galdu atbrīvošanu; pretrunīgus ievades pabeigšanas datumus
modulis neatmin. Nezināmam faktiskam augšanas galamērķim nevar piešķirt
pilnībā pārbaudīta izvietojuma statusu.

## Sintētiskais oktobra scenārijs

Šis nav Supabase eksports. Īstie ražošanas dati lokāli nav pieejami.
Testā HUS 6 izmanto C24 līdz 21.10., HUS 7 izmanto B26+A13 līdz 28.10.
HUS 9 ir fiksēta plānota D26 rezervācija no 21.10. līdz **pieņemtam 04.11.**,
sēšana 13.10. un A3/A4/A8. HUS 8A/8B/3 sējamo stādu skaits ir
**pieņemts 3656/3656/900**, sākotnējās sēšanas ir 20./22./23.10.,
fiksētie Planting ir **pieņemti 11./13./14.11.** Pārējie testu dati ir sintētiski.

Aprēķinātais labākais plāns šīm konkrētajām ievadēm:

| HUS | Sēšana | Retināšana | Augšanas vieta | Planting |
| --- | --- | --- | --- | --- |
| 8A | 17.10. | 26.10. | C, 24 galdi | 11.11. |
| 8B | 19.10. | 28.10. | B, 24 galdi pēc HUS 7 | 13.11. |
| 3 | 20.10. | 29.10. | A14–A26, 6 galdi | 14.11. |

Atrasti divi atšķirīgi nosacīti plāni; otrajā HUS 3 retināšana notiek 28.10.
pēc HUS 7 Planting. Nosacījumi ietver A papildu bloku, Planting/retināšanas
secību un darba pārslodzi. Datumi nav ieprogrammētas atbildes — tests
pieņem derīgus kopīgus plānus un pārbauda kapacitāti, Planting un vēsturi.

Lokāls mērījums pēc iesildīšanas, 5 atkārtojumi, 2026-10-16:

| Scenārijs | Vidējais | Diapazons | Soļi | Rezultāts |
| --- | --- | --- | --- | --- |
| Oktobra sintētiskais, 3 pārplānoti HUS | 126 ms | 109–155 ms | 297 | 2 nosacīti plāni |
| 16 HUS, 400 soļu / 4 maināmu HUS robeža | 161 ms | 151–176 ms | 400 | `searchLimited` |

Tas ir konkrētā datora aprēķina mērījums bez tīkla pieprasījumiem un TS
transpilēšanas laika, nevis veiktspējas garantija citai ierīcei.
