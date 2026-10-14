"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { filterPhotoArchive, husPhotoFileUrl, type PhotoArchiveEntry, type PhotoArchiveFilter } from "@/lib/hus-photo-archive";
import type { AppLanguage } from "@/lib/localization";
import type { HusPhotoEntry } from "@/lib/types";

export function PhotoArchiveMetadata({ entry, language }: { entry: PhotoArchiveEntry; language: AppLanguage }) {
  return (
    <div className="photo-archive-metadata">
      <strong>{entry.hus}{entry.date ? ` — ${formatPhotoDate(entry.date, language)}` : ""}</strong>
      {entry.description ? <p>{entry.description}</p> : null}
      {entry.location ? <p>{language === "lv" ? "Galds / atrašanās vieta" : "Table / location"}: {entry.location}</p> : null}
      {!entry.date && entry.uploadedAt ? (
        <p>{language === "lv" ? "Augšupielādēts" : "Uploaded"}: {formatPhotoDate(entry.uploadedAt.slice(0, 10), language)}</p>
      ) : null}
      <span className="photo-archive-status">
        {entry.archived ? language === "lv" ? "Arhivēts HUS" : "Archived HUS" : language === "lv" ? "Aktīvs HUS" : "Active HUS"}
      </span>
    </div>
  );
}

export function HusPhotoArchive({ entries, language, onView }: {
  entries: PhotoArchiveEntry[];
  language: AppLanguage;
  onView: (photo: HusPhotoEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PhotoArchiveFilter>("all");
  const visible = useMemo(() => filterPhotoArchive(entries, query, filter), [entries, query, filter]);
  return (
    <section className="panel photo-archive">
      <h2>{language === "lv" ? "Fotoarhīvs" : "Photo archive"}</h2>
      <div className="photo-archive-controls">
        <label>
          {language === "lv" ? "Meklēt fotogrāfijas" : "Search photos"}
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder={language === "lv" ? "HUS, apraksts, C7 vai datums" : "HUS, description, C7 or date"} />
        </label>
        <label>
          {language === "lv" ? "HUS statuss" : "HUS status"}
          <select value={filter} onChange={(event) => setFilter(event.target.value as PhotoArchiveFilter)}>
            <option value="all">{language === "lv" ? "Visas bildes" : "All photos"}</option>
            <option value="active">{language === "lv" ? "Aktīvie HUS" : "Active HUS"}</option>
            <option value="archived">{language === "lv" ? "Arhivētie HUS" : "Archived HUS"}</option>
          </select>
        </label>
      </div>
      <p aria-live="polite">{language === "lv" ? "Fotogrāfijas" : "Photos"}: {visible.length}</p>
      {visible.length === 0 ? <p className="empty-state">
        {entries.length === 0
          ? language === "lv" ? "Fotogrāfiju vēl nav." : "No photos yet."
          : language === "lv" ? "Nav meklēšanai atbilstošu fotogrāfiju." : "No matching photos."}
      </p> : null}
      <div className="photo-archive-grid">
        {visible.map((entry) => (
          <article className="photo-archive-card" key={entry.photo.id}>
            <button className="photo-archive-image" type="button" onClick={() => onView(entry.photo)}
              aria-label={`${language === "lv" ? "Atvērt fotogrāfiju" : "Open photo"}: ${entry.hus}, ${entry.description ?? entry.photo.originalFileName}`}>
              <Image alt={entry.description ?? entry.photo.originalFileName} height={300} width={400}
                src={husPhotoFileUrl(entry.photo)} unoptimized />
            </button>
            <PhotoArchiveMetadata entry={entry} language={language} />
          </article>
        ))}
      </div>
    </section>
  );
}

function formatPhotoDate(date: string, language: AppLanguage): string {
  return new Intl.DateTimeFormat(language === "lv" ? "lv-LV" : "en-GB", { timeZone: "UTC" }).format(new Date(date));
}
