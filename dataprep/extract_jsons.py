#!/usr/bin/env python3
"""extract_jsons.py
--------------------------------------------------
Extrait la dernière colonne (JSON) d'un CSV.gz tabulé et
écrit un fichier .json par ligne, nommé d'après l'avant-dernière colonne.

Format prévu (export Dataiku) :
col1 <TAB> … <TAB> file_id <TAB> "{"000": … }"\n
- Le fichier est encodé UTF-8 et compressé gzip.
- La première ligne est un header à ignorer.
"""
import csv
import gzip
import json
import pathlib
import sys
from typing import TextIO, Any

SRC_PATH = pathlib.Path(__file__).parent.parent / "api/data/a220-non-conformities/managed_dataset/NC_types_random_500_final_structured.csv.gz"
DST_DIR = pathlib.Path(__file__).parent.parent / "api/data/a220-non-conformities/json"


def open_csv(path: pathlib.Path) -> TextIO:
    """Ouvre le fichier gzip en texte UTF-8 et retourne un itérateur de lignes."""
    try:
        return gzip.open(path, mode="rt", encoding="utf-8", newline="")
    except FileNotFoundError:
        print(f"❌ Fichier source introuvable : {path}", file=sys.stderr)
        sys.exit(1)


def parse_double_json(field: str) -> Any:
    """Décodage robuste d'un champ JSON doublement encodé.

    1) Le champ est d'abord une *chaîne JSON* encadrée de guillemets dans le CSV
       (tous les \" internes sont échappés).
    2) On applique json.loads une première fois : on obtient soit un dict
       directement, soit une *chaîne* JSON propre (cas Dataiku).
    3) Si c'est encore une chaîne, on applique json.loads une seconde fois.
    """

    obj = json.loads(field)
    return obj


def main() -> None:
    DST_DIR.mkdir(parents=True, exist_ok=True)
    print(f"📂 Dossier de sortie : {DST_DIR}")

    with open_csv(SRC_PATH) as fh:
        reader = csv.reader(
            fh,
            delimiter="\t",
            quotechar='"',
            escapechar='\\',   # Dataiku échappe les guillemets avec \"
            doublequote=False,  # donc pas de "" pour un guillemet interne
            quoting=csv.QUOTE_MINIMAL,
        )

        # Sauter l'en-tête si présent
        header = next(reader, None)
        if header is None:
            print("⚠️  Le fichier est vide.")
            return

        err_count = 0
        for line_no, row in enumerate(reader, start=2):  # +1 pour header, +1 pour 1-indexé
            if len(row) < 2:
                print(f"⏭️  Ligne {line_no}: moins de deux colonnes, ignorée.")
                continue

            file_id = row[-2].strip()
            json_raw = row[-1]

            if not file_id:
                print(f"⏭️  Ligne {line_no}: identifiant vide, ignorée.")
                continue

            try:
                data = json.loads(json_raw)
            except json.JSONDecodeError as e:
                err_count += 1
                print(f"⛔ Ligne {line_no} (ID={file_id}) : JSON invalide → {e.msg}")
                continue

            out_path = DST_DIR / f"{file_id}.json"
            with out_path.open("w", encoding="utf-8") as out_f:
                json.dump(data, out_f, ensure_ascii=False, indent=2)

        print("✅ Extraction terminée.")
        if err_count:
            print(f"⚠️  {err_count} ligne(s) ignorée(s) pour JSON invalide.")


if __name__ == "__main__":
    main() 