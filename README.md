# Gabriel Tracker : suivi des calories

Application web (sans serveur, sans compte) pour noter ce que tu manges et suivre tes calories et tes macros. Elle s'installe sur le téléphone comme une app (PWA) et le journal reste **sur ton appareil**.

## Bases de données utilisées

| Source | Contenu | Accès |
|---|---|---|
| **CIQUAL / CALNUT 2020, ANSES** | Table officielle française : 2 119 aliments génériques avec énergie, protéines, glucides, sucres, lipides, AG saturés, fibres et sel. Les féculents y sont en **version cuite** (pâtes sèches cuites, pâtes complètes, riz blanc, basmati, complet, quinoa, couscous, boulgour, lentilles, haricots…). | Incluse dans l'app (`data/ciqual.json`), marche hors ligne |
| **Open Food Facts** | Plus de 3 millions de produits du commerce (marques, codes-barres) | API publique, en ligne |
| **USDA FoodData Central** | Base américaine (Foundation, SR Legacy, FNDDS) avec beaucoup d'aliments crus et cuits. Recherche en anglais. | API publique. `DEMO_KEY` par défaut, clé gratuite conseillée |

Pour CALNUT, l'app prend l'hypothèse « MB » (valeur moyenne), que recommande l'ANSES.

## Féculents : cru ou cuit

Les féculents marqués **cru ↔ cuit** donnent deux façons de saisir la quantité :

- **Pesé cuit** : tu pèses l'assiette, l'app applique directement les valeurs CIQUAL de l'aliment cuit.
- **Pesé cru / sec** : tu pèses les pâtes (ou le riz…) avant cuisson. La cuisson à l'eau n'ajoute pas de calories, donc l'app calcule le poids cuit équivalent avec le facteur `kcal du produit sec / kcal du produit cuit` (par exemple 100 g de pâtes sèches ≈ 286 g de pâtes cuites ≈ 357 kcal).

Les valeurs « sèches » de référence sont dans `RAW_EQUIV`, au début de `app.js`.

## Fonctionnalités

- Journal par repas (petit-déjeuner, déjeuner, collation, dîner) et navigation entre les jours
- Recherche sans tenir compte des accents, avec synonymes (spaghetti, penne, coquillettes → pâtes…)
- Scan de code-barres avec la caméra (Chrome sur Android), ou saisie manuelle du code
- Aliments personnels, favoris, récents
- Objectif calculé avec Mifflin-St Jeor (sexe, âge, taille, poids, activité, objectif) et répartition des macros
- Historique sur 7, 30 ou 90 jours et courbe de poids
- Export et import JSON des données
- Thème clair ou sombre automatique, fonctionne hors ligne

## Lancer l'app

Il faut la servir en HTTP : en `file://`, le navigateur bloque le chargement de la base CIQUAL.

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

### Version hébergée sur claude.ai

`python3 scripts/build_artifact.py dist/gabriel-tracker.html` produit une page autonome (base CIQUAL intégrée) publiée sur claude.ai. Dans cette version, le journal se synchronise avec le compte claude.ai (capacité `db`). En revanche, Open Food Facts, l'USDA et le scan de code-barres n'y marchent pas : la page ne peut pas appeler d'autres sites.

### La mettre en ligne gratuitement (GitHub Pages)

GitHub Pages n'est disponible que pour un dépôt **public** sur un compte gratuit (*Settings → General → Danger Zone → Change visibility*).

Dans le dépôt GitHub, va dans *Settings → Pages → Build and deployment*, choisis *Deploy from a branch*, puis la branche et le dossier `/ (root)`. L'app sera disponible sur `https://<utilisateur>.github.io/<dépôt>/`. Sur le téléphone, fais « Ajouter à l'écran d'accueil ».

## Mettre à jour la base CIQUAL

```bash
curl -LO https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/external-data/ciqual/calnut/CALNUT.csv.0
python3 scripts/build_ciqual.py CALNUT.csv.0 data/ciqual.json
```

Source officielle : [ciqual.anses.fr](https://ciqual.anses.fr). Données publiées par l'ANSES sous Licence Ouverte Etalab.
