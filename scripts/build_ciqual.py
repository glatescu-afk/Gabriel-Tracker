"""Convertit la table CALNUT 2020 (ANSES, basée sur CIQUAL) en JSON compact pour l'app.

Source : https://ciqual.anses.fr (miroir : openfoodfacts-server/external-data/ciqual/calnut/CALNUT.csv.0)
Usage  : python3 scripts/build_ciqual.py CALNUT.csv.0 data/ciqual.json
On garde l'hypothèse « MB » (valeur moyenne) recommandée par l'ANSES.
"""
import csv
import json
import sys

FIELDS = {
    "kcal": "nrj_kcal",
    "p": "proteines_g",
    "c": "glucides_g",
    "s": "sucres_g",
    "f": "lipides_g",
    "sf": "ags_g",
    "fi": "fibres_g",
    "na": "sel_g",
}


def num(v):
    v = (v or "").strip().replace(",", ".")
    if v in ("", "-"):
        return None
    try:
        x = float(v)
    except ValueError:
        return None
    x = round(x, 2)
    return int(x) if x == int(x) else x


def main(src, dst):
    foods = []
    with open(src, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row["HYPOTH"] != "MB":
                continue
            food = {"id": int(row["alim_code"]), "n": row["FOOD_LABEL"].strip(), "g": row["alim_ssgrp_nom_fr"].strip()}
            for key, col in FIELDS.items():
                food[key] = num(row[col])
            foods.append(food)
    foods.sort(key=lambda f: f["n"].lower())
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump({"source": "ANSES CALNUT 2020 (CIQUAL)", "unit": "100 g", "foods": foods}, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(foods)} aliments -> {dst}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
