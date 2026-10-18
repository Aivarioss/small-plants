"use client";

import Image from "next/image";
import type { AppLanguage } from "@/lib/localization";

export type HusEntryDraftPhoto = { id: string; target: string; file: File; url: string };

export function HusEntryPhotos({ photos, language, onAdd, onRemove }: {
  photos: HusEntryDraftPhoto[];
  language: AppLanguage;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  return <div className="hus-entry-photos">
    <label className="file-action file-action--small">
      {language === "lv" ? "Pievienot fotogrāfijas" : "Add photos"}
      <input accept="image/jpeg,image/png" multiple type="file" onChange={(event) => {
        onAdd(Array.from(event.target.files ?? []));
        event.target.value = "";
      }} />
    </label>
    {photos.length > 0 ? <ul className="hus-entry-photo-list">
      {photos.map((photo) => <li key={photo.id}>
        <Image src={photo.url} alt={photo.file.name} unoptimized width={90} height={70} />
        <span>{photo.file.name}</span>
        <button type="button" className="danger-action danger-action--small" onClick={() => onRemove(photo.id)}>
          {language === "lv" ? "Noņemt" : "Remove"}
        </button>
      </li>)}
    </ul> : null}
  </div>;
}
