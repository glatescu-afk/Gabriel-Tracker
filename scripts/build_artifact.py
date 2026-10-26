"""Assemble l'app en un seul fichier HTML autonome (base CIQUAL intégrée).

Usage : python3 scripts/build_artifact.py dist/gabriel-tracker.html
Le fichier produit est le contenu d'une page claude.ai : pas de <html>/<head>/<body>,
la plateforme ajoute le squelette à la publication.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main(dst):
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    js = (ROOT / "app.js").read_text(encoding="utf-8")
    data = (ROOT / "data" / "ciqual.json").read_text(encoding="utf-8").replace("</", "<\\/")

    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    body = body.replace('<script src="app.js"></script>', "").strip()

    out = "\n".join([
        "<title>Gabriel Tracker</title>",
        '<meta name="theme-color" content="#16a34a">',
        "<style>", css, "</style>",
        body,
        f'<script type="application/json" id="ciqual-data">{data}</script>',
        "<script>", js, "</script>",
        "",
    ])
    pathlib.Path(dst).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(dst).write_text(out, encoding="utf-8")
    print(f"{dst} : {len(out.encode()) // 1024} Kio")


if __name__ == "__main__":
    main(sys.argv[1])
