# Reconnaissance des captures — ce qui a changé, et ce qui ne marche toujours pas

Branche `w-ocr`. Tout est mesuré sur le même banc, avec les mêmes images, pour
l'ancienne comme pour la nouvelle chaîne. Les chiffres qui suivent se
reproduisent en trois commandes :

```
npx vite --port 5212 &
node bench/run.mjs ancien      # l'ancienne chaîne
node bench/run.mjs nouveau     # la nouvelle
node verif-criteres.mjs        # les critères 28 à 44 dans un vrai Chromium
```

---

## 1. Le chiffre

Banc de 12 captures d'écran de « serveurs de résultats » : tableaux encadrés,
zébrés, en serif pâle, à bandeau sombre, en corps 9 comme en corps 13, plus
**la capture du cahier des charges reconstituée à l'identique** (cinq analytes,
trois dates dont deux sans année, colonne « Unité », colonne « Normes »,
valeurs pathologiques en orange fléché).

| | 10 captures d'origine | 12 captures (avec celles du médecin) |
|---|---|---|
| **Ancienne chaîne** | **69,5 %** de cellules justes · 23/30 dates · 64/84 lignes | **63,0 %** · 24/36 dates · 74/94 lignes |
| **Nouvelle chaîne** | **96,7 %** · 30/30 dates · 83/84 lignes | **97,1 %** · 36/36 dates · 93/94 lignes |

> **Sur la mesure elle-même.** La base annoncée jusqu'ici était 68,7 %. En
> dépouillant les erreurs restantes j'ai découvert que le banc lui-même se
> trompait : il rapprochait chaque ligne attendue de « la première ligne lue qui
> lui ressemble », et « ALAT », à une lettre de « ASAT », était noté contre la
> ligne ASAT. Six cellules parfaitement lues comptaient pour fausses. L'instrument
> est corrigé (appariement un pour un) et les **deux** chaînes ont été remesurées
> avec : l'ancienne passe de 68,7 % à 69,5 %, la nouvelle est à 96,7 %. C'est
> cette paire-là qui est comparable.

Le détail, capture par capture, nouvelle chaîne :

| capture | cellules justes | faux silencieux | dates |
|---|---|---|---|
| encadre-normal | 100 % | 0 | 3/3 |
| encadre-petit | 100 % | 0 | 3/3 |
| zebre-normal | 100 % | 0 | 4/4 |
| zebre-petit | 100 % | 0 | 4/4 |
| serif-palecontraste | 90 % | 1 | 2/2 |
| serif-petit | 90 % | 1 | 2/2 |
| fleches-anormales | 88,9 % | 0 | 3/3 |
| encadre-gris | 100 % | 0 | 2/2 |
| zebre-hd | 100 % | 0 | 3/3 |
| encadre-minuscule | 96,9 % | 0 | 4/4 |
| **medecin** | **100 %** | 0 | 3/3 |
| **medecin-petit** | **100 %** | 0 | 3/3 |

Le chiffre qui compte le plus n'est pas 97,1 % mais **2** : le nombre de valeurs
fausses proposées **sans être signalées**, sur 276. L'ancienne chaîne en laissait
passer 8.

---

## 2. Les cinq erreurs, une par une

Chacune est devenue un cas de test du banc (`bench/medecin.ts`), passé sur les
12 captures à chaque exécution, **plus** un bloc de tests unitaires
(`src/lib/ocr/pipeline.test.ts`) qui verrouille la logique qui les empêche.

| | Erreur | Ancienne chaîne | Nouvelle chaîne |
|---|---|---|---|
| 1 | « Créatinine » lue **104**, borne de la colonne « Normes » | 0 faute *(voir ci-dessous)* | **0 faute** |
| 2 | Plaquettes lues **400**, même cause | **2 fautes** | **0 faute** |
| 3 | Leucocytes `12,2` lus **`122`** | **2 fautes** | **0 faute** |
| 4 | Nom lu « Créatinine umolL » | 0 faute *(voir ci-dessous)* | **0 faute** |
| 5 | 3 colonnes de dates fondues en **1 seule, sans date** | **3 fautes** | **0 faute** |

**Erreur 1 — la colonne des normes prise pour la colonne des résultats.**
Corrigée à la racine : la chaîne décide d'abord **à quoi sert chaque colonne**,
avant de lire une seule valeur. Une colonne est écartée si son en-tête le dit
(« Normes », « Valeurs usuelles », « Réf. », « VN », « Intervalle »…) ou si son
contenu la trahit — un intervalle `nombre - nombre`, `< 5`, `> 75`, `13 à 17`
est un motif reconnaissable, et il suffit qu'il domine la colonne. Sur la
capture du médecin, la colonne `59 - 104` est classée « normes » et ne produit
plus aucune valeur.
*Honnêteté sur le « 0 faute » de l'ancienne chaîne :* sur mes captures, elle ne
commet pas cette faute-là sur la créatinine — non parce qu'elle sait l'éviter,
mais parce qu'elle perd la ligne entière ailleurs. La faute est en revanche bien
reproduite sur les **plaquettes** (erreur 2), même mécanisme, même colonne.

**Erreur 2 — Plaquettes 400.** Reproduite : sur les deux captures du médecin,
l'ancienne chaîne propose bien `400`, la borne haute de `150 - 400`. La nouvelle
propose `245`, `198`, `312`.

**Erreur 3 — la virgule décimale.** Deux verrous. D'abord, chaque case de
résultat est lue **seule**, agrandie, avec la liste des caractères qu'elle a le
droit de contenir (`0123456789.,<>`) : Tesseract ne peut plus y voir de lettres.
Ensuite, la virgule est cherchée **dans l'encre** : une petite tache basse entre
deux chiffres. Si la reconnaissance l'a perdue, on la remet à sa place.
`12,2` reste `12,2` sur les 12 captures.

**Erreur 4 — l'unité collée au nom.** `nettoyerNom` détache une unité en fin de
nom, entre parenthèses ou agglutinée (« Créatinine umolL » → « Créatinine »),
sans mutiler « Bilirubine totale », « Anticorps anti-DNA » ni « Vitamine D ».
Ici encore l'ancienne chaîne ne reproduit pas la faute sur mes captures ; le
verrou existe et est testé.

**Erreur 5 — les colonnes de dates.** C'était la faute la plus lourde : sans
dates, **aucune** valeur n'est utilisable. Trois corrections ont été nécessaires,
chacune découverte en mesurant :

- les colonnes sont établies **sur les lignes de données seules** — la ligne
  d'en-tête, plus large et souvent posée sur un fond plein, bouchait toutes les
  gouttières ;
- la ligne d'en-tête est analysée **sur les niveaux de gris**, pas sur la carte
  d'encre : un bandeau de couleur soude sinon tous les en-têtes en un seul pavé ;
- un en-tête **déborde** la largeur de ses valeurs (`15/01/2024` au-dessus de
  `138`) ; découpé à la largeur des valeurs, il ne restait que `024`.

S'y ajoute la lecture des dates dont les séparateurs ont sauté : la barre oblique
d'un `12/03` écrit petit est très régulièrement rendue `1`, et l'en-tête devient
`12103`. On la recolle — mais seulement quand jour et mois sont valides, jamais
sur `12345` ni sur `2024`. Résultat : **36 dates sur 36**, dont les deux dates
sans année de la capture du médecin, reconstituées à partir de l'année de la
troisième colonne et **signalées en jaune** parce qu'elles ont été déduites.

---

## 3. Ce que veut dire le jaune

**Une seule couleur, un seul sens : « je ne suis pas sûr d'avoir bien LU cette
case ».** Rien de clinique n'entre dans cette décision. Le calcul est dans
`src/lib/ocr/confiance.ts`, et il est entièrement testé.

Une case est jaune si, et seulement si :

1. **la case porte de l'encre mais rien n'a été lu** — une valeur perdue ;
2. **la reconnaissance elle-même n'est pas sûre** (confiance Tesseract < 72) ;
3. **l'encre porte plus de signes que le texte rendu** — c'est ce qui attrape un
   `> 300` rendu `300`, une valeur fausse et parfaitement crédible ;
4. **la virgule décimale a dû être rétablie** d'après l'image **et** le résultat
   ne colle pas au reste de la ligne. `7,4 · 9,1 · 12,2` se corrobore tout seul et
   reste blanc ; `9,8 · 10,9 · 1,17` ne se corrobore pas, et là il faut regarder ;
5. **la valeur est décalée d'un facteur 10** par rapport aux autres valeurs *de
   la même ligne*, alors que celles-ci portent une virgule ;
6. **la valeur est hors de tout ordre de grandeur connu** pour cet analyte — au
   facteur 25, choisi pour laisser passer toute la pathologie courante ;
7. **la date n'a pas été reconnue**, ou son **année était absente de l'image** ;
8. **le nom d'analyte n'est pas reconnu** par le catalogue.

N'est **jamais** jaune : une valeur simplement pathologique. Vérifié dans le
navigateur sur une capture dont les six analytes sont tous hors norme —
Hémoglobine 9,8 / 10,9 / 11,7 · Leucocytes 14,2 · Plaquettes 480 · Créatinine
168 / 132 / 115 · CRP 96 / 28 / 7 · Albumine 28 / 33 : **aucune case surlignée**.
La CRP à 3 mg/L qui passait en violet « incohérent » ne l'est plus non plus.

Chaque case jaune porte sa raison en infobulle, en français
(« virgule décimale rétablie d'après l'image », « année absente de l'image — à
confirmer », « un signe de l'image n'a pas été lu (peut-être « < » ou « > ») »…).

---

## 4. Les réglages supprimés

Tous ceux de la section « Réglages à SUPPRIMER » du cahier des charges qui
vivaient dans l'écran d'import :

| Supprimé | |
|---|---|
| « ▾ Options » (le dépliant entier) | ✓ |
| « Noir & blanc (photos difficiles) » | ✓ |
| « Aperçu du traitement » | ✓ |
| Le curseur « Contraste » | ✓ |
| « ⟲ » et « ⟳ » (pivoter) | ✓ |
| « Redresser auto » | ✓ |
| « 🔍 Lire les valeurs » / « ↻ Relire » | ✓ — coller **est** la commande |
| La bascule « ✓ Image » / « Comparer à l'image » | ✓ — la vignette est toujours là |
| La légende à trois pastilles | ✓ — remplacée par une phrase |
| La colonne « Unité » du tableau de vérification | ✓ — l'unité vient du catalogue |
| Les onglets « 📷 Photo / capture » et « 📄 Compte-rendu (texte) » | ✓ |
| Le pavé « 🔒 Astuce confidentialité… » (4 lignes) | ✓ — une phrase, et le recadrage au clic sur une vignette |

Conservés : la zone de collage, « choisir un fichier », **la mention « 100 % local
— rien n'est envoyé »** (désormais visible aussi pendant la lecture *et* pendant
la vérification), le tableau modifiable au clavier, **la vignette de l'image
d'origine en regard de chaque ligne, affichée en permanence**, la case à cocher
par ligne, le recadrage de confidentialité, « Ajouter au graphique » et
« Annuler », et la lecture de plusieurs captures collées à la suite.

**Hors de mon périmètre :** les deux boutons « ⌨️ Saisir » / « 📥 Importer » que
le cahier des charges demande aussi de supprimer vivent dans `DataTab.svelte`,
réécrit en parallèle par un autre agent. Je n'y ai pas touché. Ils restent à
enlever.

---

## 5. Les critères 28 à 44

Vérifiés dans un vrai Chromium par `node verif-criteres.mjs` — **17 sur 17** —
et par `node verif-collage.mjs <capture>`, qui rejoue le geste complet.

| N° | Critère | Verdict | Preuve |
|---|---|---|---|
| 28 | `Ctrl+V` depuis n'importe quel écran, la lecture démarre seule | **✓** | collage depuis l'écran « Repères » : le tableau arrive sans aucun clic |
| 29 | 3 colonnes de dates, chacune renseignée | **✓** | capture du médecin → `12/03/2024`, `15/06/2024`, `20/09/2024` |
| 30 | aucune valeur issue de « Normes » ou « Unité » | **✓** | aucune borne (`59`, `104`, `150`, `400`, `13`, `17`, `4`, `10`, `5`) dans les valeurs |
| 31 | `12,2` ne devient jamais `122` | **✓** | Leucocytes rendu `12.2`; 0 faute sur les 12 captures |
| 32 | pas d'unité collée au nom | **✓** | noms proposés : Creatinine, CRP, Hemoglobine, Leucocytes, Plaquettes |
| 33 | une seule couleur de signalement | **✓** | un seul fond de signalement dans tout le tableau (`#fff4d6`) |
| 34 | une valeur pathologique bien lue n'est pas surlignée | **✓** | 13 valeurs hors norme lues juste, aucune surlignée |
| 35 | valeur mal lue / date non reconnue / nom non reconnu → jaune | **✓** | nom `1gG` non reconnu, surligné ; années déduites, surlignées |
| 36 | capture parfaitement nette → aucune case surlignée | **✓ / partiel** | vrai sur `encadre-normal` (18/18 justes, 0 jaune). **3 jaunes inutiles subsistent sur 276 cellules** (1,1 %) — détail au §6 |
| 37 | plus de légende à trois pastilles | **✓** | une phrase : « Les cases en jaune sont à vérifier » |
| 38 | plus aucun des réglages listés, ni la colonne « Unité » | **✓** | recherche des 12 libellés dans la page : aucun |
| 39 | vignette d'origine en regard de chaque ligne, en permanence | **✓** | 9 vignettes pour 9 lignes, aucun bouton pour les activer |
| 40 | « 100 % local — rien n'est envoyé » reste visible | **✓** | présent à l'écran pendant la vérification |
| 41 | échec net et message clair | **✓** | image de bruit → « Je n'ai pas su lire cette capture. […] Essayez une capture plus large ou plus nette, ou collez le tableau depuis Excel. » et **aucun tableau proposé** |
| 42 | toutes les cases modifiables au clavier, `Tab` circule | **✓** | 33 champs sur 33 modifiables |
| 43 | plusieurs captures collées à la suite → un seul tableau | **✓** | 2 captures → 1 tableau, 6 colonnes de dates, 6 lignes (les cinq analytes communs fusionnés) |
| 44 | moins de dix secondes entre `Ctrl+V` et le tableau | **✓** | **1,3 s** |

Aucune requête réseau hors `localhost` n'est émise, ni pendant le banc ni pendant
les vérifications navigateur — c'est contrôlé automatiquement à chaque
exécution. Tesseract et ses données de langue sont servis depuis
`public/tesseract/`.

---

## 6. Ce qui ne marche toujours pas

**8 cellules fausses ou manquantes sur 276 (2,9 %)** — 4 fausses, 4 manquantes. Les voici toutes.

| Capture | Ligne | Attendu | Lu | Signalé ? |
|---|---|---|---|---|
| serif-palecontraste | TP | `84` | `54` | **jaune** |
| serif-palecontraste | Fibrinogène | `5,2` | `9,2` | non |
| serif-petit | TP | `84` | `54` | **jaune** |
| serif-petit | Fibrinogène | `5,2` | `9,2` | non |
| fleches-anormales | IgG (3 valeurs) | `4,8 / 6,2 / 8,1` | ligne présente, **nom lu `19G`** | **jaune** (nom non reconnu) |
| encadre-minuscule | CRP | `<5` | *(vide)* | **jaune** |

- **2 faux silencieux** : `5,2` lu `9,2` sur les deux captures en serif pâle
  (encre grise sur fond crème, corps 11-13). Une confusion de chiffre pure, à
  confiance élevée : ni la géométrie ni la cohérence de ligne ne peuvent la
  rattraper. C'est le seul cas où le médecin peut encore recopier une valeur
  fausse sans être averti. **2 sur 276, contre 8 pour l'ancienne chaîne.**
- **1 nom sur 94 mal lu** : `IgG` rendu `19G`. Trois lettres, dont deux
  ambiguës. La ligne est proposée avec ses trois valeurs justes, et le nom est
  surligné parce que le catalogue ne le reconnaît pas — une frappe suffit.
- **1 valeur censurée perdue** : `<5` en corps 9 rend une case vide, signalée en
  jaune (« une valeur semble présente sur l'image mais n'a pas pu être lue »).
- **3 jaunes inutiles sur 276** (1,1 %) : des cases justes mais signalées —
  `12,2` sur les deux captures du médecin, `5,1` sur `zebre-hd`. Toutes trois
  pour la même raison : Tesseract les a lues avec une confiance inférieure à
  72 %, à cause de la flèche orange collée au chiffre. Le critère 36 est donc
  tenu sur une capture nette et sobre, mais pas sur une capture nette et fléchée.
  J'assume ce choix : abaisser le seuil de confiance ferait remonter les faux
  silencieux, et c'est exactement ce qu'il ne faut pas.
  *(Trois autres jaunes inutiles ont été supprimés en cours de route : « 4,0 »
  était réduit à « 4 », ce qui faisait disparaître une virgule que l'encre montre
  et déclenchait l'alerte. Les décimales sont maintenant gardées telles
  qu'écrites.)*

**Deux limites de méthode, à dire franchement :**

1. **Le banc est synthétique.** Les 12 captures sont produites par Chromium à
   partir de gabarits que j'ai écrits en imitant des serveurs de résultats
   hospitaliers. La capture du médecin y est reconstituée d'après sa description,
   pas scannée. Un vrai export de Sillage, une photo d'écran prise de travers ou
   une capture compressée en JPEG n'ont pas été essayés. **97,1 % est un chiffre
   de laboratoire ; il faut le confronter à de vraies captures.**
2. **Un paramètre a été ajusté sur ce banc** : la marge blanche laissée autour de
   chaque case (0,45 hauteur de ligne). Les valeurs 0,30 / 0,40 / 0,45 / 0,50
   donnaient 93,5 / 93,9 / 95,1 / 91,9 %. Le choix est défendable en soi
   (Tesseract veut du blanc autour d'une ligne isolée), mais il est calé sur douze
   images et pourrait ne pas être optimal ailleurs.

**Ce qui n'a pas été fait :**

- l'ancienne chaîne (`image.ts`, `tableParser.ts`, `ocr.ts` version globale)
  est toujours dans le dépôt. Elle ne sert plus qu'au banc, pour la comparaison ;
- la lecture d'un PDF ajoute désormais **toutes** ses pages à la file, au lieu
  d'un sélecteur de page. Sur un PDF de dix pages dont une seule porte le tableau,
  on lira dix pages pour n'en retenir qu'une — correct, mais lent ;
- les deux boutons « ⌨️ Saisir » / « 📥 Importer » de `DataTab.svelte` (hors
  périmètre) restent à supprimer.

---

## 7. Comment c'est fait

`src/lib/ocr/pipeline.ts` assemble sept modules, tous purs et testables sauf
celui qui touche au canvas :

```
preparation.ts   image de travail, gris par canal minimum, seuil local (Sauvola),
                 correction de polarité, découpe et agrandissement d'une case
structure.ts     bandes de texte, gouttières, colonnes, composantes connexes,
                 détection de la virgule dans l'encre
pipeline.ts      isole le tableau dans la page, choisit la bande d'en-tête,
                 orchestre les lots de reconnaissance
roles.ts         à quoi sert chaque colonne : nom, unité, normes, date
ocr.ts           Tesseract, case par case, avec liste blanche de caractères
correction.ts    réparation d'un nombre, virgule rétablie, ordre de grandeur
confiance.ts     le doute de lecture, et rien d'autre
```

Le principe qui gouverne tout : **on ne demande jamais à Tesseract de comprendre
un tableau.** On lui donne une case à la fois, agrandie, avec la liste des
caractères qu'elle a le droit de contenir. La géométrie est établie avant, par
analyse d'encre. C'est ce qui rend impossible, par construction, de lire une
borne de normes comme un résultat : cette colonne n'est jamais soumise à la
reconnaissance des valeurs.

Une capture standard coûte une cinquantaine de reconnaissances de cases —
1,3 à 1,9 seconde, en tout, dans le navigateur.

**165 tests** au vert (`npx vitest run`), **0 erreur et 0 avertissement**
(`npx svelte-check --tsconfig ./tsconfig.json --threshold warning`).
