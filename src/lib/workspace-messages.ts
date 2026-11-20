import type { AppLanguage } from "./localization";

const messages: Array<[string, string]> = [
  ["Neizdevās ielādēt plānu", "Could not load the plan"], ["Neizdevās saglabāt HUS", "Could not save HUS"],
  ["Neizdevās saglabāt datus.", "Could not save data."], ["Neizdevās saglabāt HUS ierakstu.", "Could not save HUS entry."],
  ["Pirms turpināšanas pārlādē datus vai pabeidz iepriekšējā importa pārbaudi.", "Refresh the data or finish checking the previous import before continuing."],
  ["Datu pārlāde neizdevās. Mēģini pārlādēt vēlreiz; saglabāšanu neatkārto.", "Refresh failed. Try refreshing again; do not repeat the save."],
  ["Šis Hus ir mainīts citur. Pārbaudi jaunāko versiju pirms atkārtotas izmaiņas.", "This HUS was changed elsewhere. Check the latest version before editing again."],
  ["Ielādē plānu…", "Loading plan…"], ["Dati ielādēti", "Data loaded"],
  ["Saglabā izmaiņas…", "Saving changes…"], ["Izmaiņas saglabātas", "Changes saved"],
  ["Saglabā HUS ierakstu", "Saving HUS entry"], ["Saglabā HUS fotogrāfijas", "Saving HUS photos"],
  ["HUS ieraksts saglabāts", "HUS entry saved"], ["Dzēš HUS foto", "Deleting HUS photo"], ["Foto dzēsts", "Photo deleted"],
  ["Saglabāts; dati pārlādēti.", "Saved; data refreshed."],
  ["Saglabāts. Datu pārlāde neizdevās; saglabāšanu neatkārto, pārlādē datus.", "Saved. Refresh failed; refresh the data instead of saving again."],
  ["Saglabāšanas rezultāts nav apstiprināts. Pārlādē datus un pārbaudi rezultātu.", "Saving has not been confirmed. Refresh the data and check the result."],
  ["Aktīvais plāns un arhīvs pārlādēti. Pārbaudi saglabāto rezultātu.", "Active plan and archive refreshed. Check the saved result."],
  ["Foto saglabājās, bet savienojums pārtrūka. Dati pārlādēti.", "Photo was saved, but the connection dropped. Data reloaded."],
  ["Foto noņemts no HUS. Faila dzēšanu vēl nav izdevies apstiprināt.", "Photo removed from HUS. File deletion has not yet been confirmed."],
];
export function workspaceMessage(message: string, language: AppLanguage): string {
  const pair = messages.find(pair => pair.includes(message));
  return pair ? pair[language === "lv" ? 0 : 1] : message;
}
