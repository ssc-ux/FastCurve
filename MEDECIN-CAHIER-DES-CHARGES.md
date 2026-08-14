# Cahier des charges du médecin — FastCurve

**Rédigé par :** l'utilisateur final (médecin interniste hospitalier).
**Date :** 14 août 2026.
**Statut :** contrat. Ce document sert de référence pour juger chaque livraison. Les critères d'acceptation numérotés en fin de document sont la partie qui compte.

---

## 0. Qui je suis et comment je travaille

Je suis en consultation. J'ai le compte-rendu à finir, le patient suivant dans le couloir, et **cinq minutes**. Je veux une courbe de créatinine sur quatre ans à coller dans mon CR.

Mes critères, dans l'ordre : **simple, fiable, professionnel, facile, rapide.**

Ce que je ne ferai jamais :
- lire une notice ;
- ouvrir un écran « Options » pour comprendre pourquoi ça n'a pas marché ;
- toucher un curseur de contraste ;
- vérifier une par une quinze cellules que la machine a lues.

Ce que je veux : **ça marche du premier coup, ou ça me dit clairement que ça n'a pas marché.**

J'ai passé une demi-heure dans l'application. Voici ce que j'ai trouvé, grief par grief.

---

## 1. Grief n°1 — « Je peux pas modifier les dates, ça enregistre trop vite »

### Ce que j'ai fait, et ce qui s'est passé

J'ai ajouté un paramètre (Créatinine), cliqué trois fois sur « + Date », rempli 70 / 75 / 80. Puis j'ai voulu remettre la troisième colonne au **1er février 2020** — un suivi rétrospectif, c'est mon cas courant.

Je clique sur la date, je tape `0` `1` `0` `2` `2` `0` `2` `0`.

Voici, frappe par frappe, ce qui s'est réellement produit :

| Je tape | Ce que l'application fait |
|---|---|
| `0` | la date se vide |
| `1` | **la date devient 16/01/2026, la colonne saute en 1re position, et le focus part du champ** |
| `0` `2` `2` `0` `2` `0` | **rien. Mes six frappes tombent dans le vide.** |

Résultat : je voulais **01/02/2020**, j'ai obtenu **16/01/2026**. Sans un mot à l'écran. Et mes valeurs ont changé de colonne sous mes doigts.

J'ai refait l'essai en tapant l'année d'abord : je tape `1` pour commencer « 15/03/2024 », et j'obtiens **14/08/0001**. La courbe part de l'an 1. L'axe des abscisses affiche « 14/08/0001 → 16/08/2026 » et le graphique est bon pour la poubelle.

C'est exactement ça, « ça enregistre trop vite » : **l'application enregistre après chaque chiffre, alors que ma date n'est pas finie de taper.** Et comme les colonnes sont retriées à chaque enregistrement, la colonne que j'étais en train d'éditer se déplace et me vole le curseur.

### Ce qui doit se passer

Je clique sur une date. Je tape ma date **en entier** — jour, mois, année. Pendant que je tape :
- **la colonne ne bouge pas d'un pixel** ;
- **le curseur reste dans le champ** ;
- **rien n'est enregistré, rien n'est retrié, la courbe ne bouge pas.**

Quand j'ai fini — j'appuie sur `Entrée`, ou `Tab`, ou je clique ailleurs — **alors** la date est enregistrée, la colonne va se ranger à sa place chronologique, et la courbe se met à jour.

Si la date que j'ai tapée est incomplète ou aberrante (an 1, an 0203, une année à un chiffre), l'application **ne l'enregistre pas** : elle laisse le champ en attente et me le signale discrètement. Elle ne fabrique jamais toute seule une date de l'an 1.

Si le déplacement de la colonne écrase des valeurs existantes, on me le dit avec un « Annuler » à portée de clic (ça, c'est déjà le cas, gardez-le).

### Bonus indispensable : taper une date à ma manière

Le champ actuel est un champ date de navigateur : il m'impose ses trois cases et son petit calendrier, et son format change selon la langue du navigateur (j'ai vu `08/14/0001` dans le tableau et `14/08/0001` sur le graphique **sur le même écran** — inacceptable dans un outil médical).

Je veux pouvoir taper, **au clavier, dans un champ texte normal** :
- `12/03/2024` ou `12/03/24` → 12 mars 2024
- `12032024` → 12 mars 2024
- `03/2024` ou `mars 2024` → mars 2024 (fréquent : je n'ai souvent que le mois)
- `2024` → 2024

Et **toujours** en `jj/mm/aaaa`, partout, quelle que soit la langue du navigateur. Le petit calendrier peut rester en secours à côté, mais il ne doit pas être le seul chemin.

---

## 2. Grief n°2 — « Remplir le tableau comme un tableau Excel, librement sur les dates, avec la courbe en live »

### Ce que j'ai constaté

Le bon point d'abord, à conserver : **la courbe se met bien à jour pendant que je tape une valeur.** Je tape `8` puis `5`, la courbe suit. C'est exactement ce que je veux. Ne cassez pas ça.

Le reste ne ressemble pas à Excel :

1. **J'ajoute un paramètre, et le tableau n'a aucune colonne.** Une ligne « Créatinine µmol/L », et rien à droite. Nulle part où taper. Il faut d'abord deviner qu'il faut cliquer « + Date », un petit bouton en pointillés perdu à droite du tableau.
2. **« + Date » ajoute toujours aujourd'hui** (14/08/2026), puis 15/08, puis 16/08. Pour un suivi rétrospectif 2019→2024, chaque colonne doit ensuite être ré-éditée à la main — et cette édition est cassée (grief n°1). Les deux griefs se cumulent : **il est aujourd'hui pratiquement impossible de saisir un suivi rétrospectif à la main.**
3. **On ne peut pas ajouter une ligne en tapant.** Il faut ouvrir un panneau « Ajouter un paramètre », chercher dans un catalogue, cliquer un résultat, puis cliquer « Fermer ». Quatre gestes et un panneau qui pousse le tableau vers le bas.
4. **`Tab` sort du tableau.** En bout de ligne, `Tab` m'envoie sur le bouton du nom de paramètre de la ligne suivante, pas sur la première cellule de cette ligne.
5. Le collage d'un bloc Excel (Ctrl+V) fonctionne — c'est le seul chemin vraiment rapide aujourd'hui — mais il passe par un écran « Vérifier le tableau collé » supplémentaire, même quand toutes les dates ont été reconnues correctement.

### Ce qui doit se passer

**Le tableau est toujours prêt à recevoir.** J'ouvre l'application, il y a déjà une grille avec des lignes vides et des colonnes vides, comme une feuille de calcul. Je clique dans une case, je tape.

**Une colonne vide en permanence à droite.** Je tape une date dedans → une nouvelle colonne vide apparaît encore à droite. Je n'ai jamais à chercher un bouton « + Date ». (Gardez « + Série » : ajouter 12 dates trimestrielles d'un coup, c'est bien vu.)

**Une ligne vide en permanence en bas.** Je tape « Créatinine » dedans → la ligne se crée, une suggestion me propose le paramètre du catalogue avec son unité, et une nouvelle ligne vide apparaît en dessous. Si mon libellé n'est pas au catalogue, il est accepté tel quel, sans discussion.

**Je navigue au clavier comme dans Excel :**
- `Tab` / `Maj+Tab` : cellule suivante / précédente, en repassant à la ligne suivante en bout de ligne ;
- `Entrée` : cellule du dessous ;
- flèches : déplacement dans la grille ;
- `Suppr` : vide la cellule ;
- Ctrl+V d'un bloc de cellules : remplit à partir de la cellule courante.

**Les dates sont libres :** j'en tape une en 2019 dans la dernière colonne, elle va se ranger en tête quand j'ai fini de taper — pas avant.

**La courbe suit en direct**, comme aujourd'hui.

**Et un tableau collé depuis Excel avec des dates lisibles va directement dans la grille**, sans écran de vérification intermédiaire — avec un « Annuler » dans le bandeau si je me suis trompé de bloc. L'écran de vérification ne s'affiche que si une date n'a **pas** été reconnue.

---

## 3. Grief n°3 — « L'OCR marche pas, les valeurs sont ubuesques, et tous ces réglages c'est trop compliqué »

### Ce que j'ai constaté — c'est le point le plus grave

J'ai collé une capture d'écran de biologie tout à fait ordinaire : cinq analytes, trois dates, une colonne « Unité », une colonne « Normes » (`59 - 104`, `< 5`, `13 - 17`…), les valeurs pathologiques en orange avec une flèche ↑, une ligne sur deux en gris clair. Exactement ce que crache n'importe quel logiciel de labo hospitalier.

Voilà ce que l'application a lu :

| Vraies valeurs de la capture | Ce que l'application a écrit |
|---|---|
| Créatinine : 85, 92, 110 | **« Créatinine umolL » : une seule valeur, 104** — c'est la borne haute de la colonne « Normes », pas une valeur du patient |
| CRP : 3, 12, 45 | **45 seulement** (les deux premières perdues) |
| Hémoglobine : 13,2 / 12,8 / 11,9 | **11,9 seulement** |
| Leucocytes : 7,4 / 9,1 / 12,2 | **« 122 »** — la virgule perdue, valeur fausse d'un facteur 10 |
| Plaquettes : 245, 198, 312 | **400** — encore une borne de norme |
| Trois dates : 12/03, 15/06, 20/09/24 | **une seule colonne, sans aucune date** |

**Deux valeurs sur cinq sont des bornes de normes prises pour des résultats de patient.** Une autre est fausse d'un facteur 10. Aucune date n'est lue. Sur douze valeurs à récupérer, l'application en propose cinq, dont quatre fausses. « Ubuesque » est le mot juste.

Et le code couleur signale **exactement l'inverse** de ce qu'il faut :
- `104` et `400` (les deux bornes de normes, donc les deux vraies erreurs) : **blanches, aucune alerte** ;
- `45` (CRP réelle, correctement lue) : **rouge « hors-norme »** ;
- `12,2` lu `122` : violet « incohérent » — pour une fois utile, mais noyé.

Sur mon second essai, avec une capture parfaitement nette où l'OCR a tout lu juste, **cinq cellules sur douze étaient quand même colorées en alerte**, et une CRP à 3 mg/L — parfaitement normale — était surlignée en violet « incohérent ».

Le problème de fond est là : **l'application colore ce qui est anormal chez le patient, pas ce qui est douteux à la lecture.** Or je fais des courbes pour des patients malades. Toutes mes valeurs sont hors norme. Ce code couleur ne me sert à rien et masque le seul signal dont j'ai besoin.

### Ce qui doit se passer

**Le geste, en entier :** je fais une capture d'écran de mon logiciel de labo. Je bascule sur FastCurve. Je fais `Ctrl+V`. J'attends deux secondes. **Le tableau est rempli, les cases douteuses sont en jaune.** Je corrige les jaunes, j'appuie sur Entrée. Fini.

Pas de bouton à cliquer avant. Pas de bouton « Lire les valeurs ». Pas de choix à faire.

**Une seule couleur : le jaune = « je ne suis pas sûr, vérifie ».** Rien d'autre. Pas de rouge, pas de violet, pas de légende à trois entrées.

Est en jaune :
- une valeur que la reconnaissance a lue avec peu de certitude ;
- une valeur qui n'a pas de virgule là où on l'attendait, ou qui est décalée d'un facteur 10 par rapport aux autres valeurs **de la même ligne** ;
- une date non reconnue ;
- un nom d'analyte non reconnu.

N'est **jamais** en jaune : une valeur simplement pathologique. Une CRP à 45, une créatinine à 300, une hémoglobine à 7 sont des résultats parfaitement normaux **à lire** — c'est mon patient qui est malade, pas l'OCR.

**Les colonnes parasites doivent être écartées d'office.** Une colonne intitulée « Normes », « Valeurs de référence », « Réf. », « Unité », ou dont le contenu ressemble à `59 - 104`, `< 5`, `4 - 10`, n'est pas une colonne de dates : elle ne doit **jamais** produire de valeurs. Aujourd'hui c'est la première source d'erreur.

**Les décimales doivent être respectées.** `12,2` ne doit jamais devenir `122`. Si le doute existe, c'est jaune.

**Chaque colonne de dates de l'image doit devenir une colonne de dates dans le tableau.** Lire une capture à trois dates et n'en ressortir qu'une seule colonne sans date, c'est un échec, pas un résultat partiel.

**Si la lecture est mauvaise, dites-le-moi franchement.** Un message clair : « Je n'ai pas su lire cette capture. Essayez une capture plus large / plus nette, ou collez le tableau depuis Excel. » Je préfère cent fois un échec net à cinq valeurs fausses que je dois débusquer une par une.

### Réglages à SUPPRIMER de l'écran d'import

Je les nomme tels qu'ils apparaissent à l'écran aujourd'hui :

| À supprimer | Pourquoi |
|---|---|
| **« ▾ Options »** (le dépliant entier) | Un dépliant de réglages sur un écran qui doit faire une seule chose. |
| **« Noir & blanc (photos difficiles) »** | Je ne saurai jamais si ma photo est « difficile ». C'est à la machine d'essayer. |
| **« Aperçu du traitement »** | Réglage de développeur. Ne veut rien dire pour moi. |
| **« Contraste »** (le curseur) | Idem. Je ne suis pas photographe. |
| **« ⟲ » et « ⟳ »** (pivoter à gauche / à droite) | Je colle des captures d'écran, pas des polaroids de travers. |
| **« Redresser auto »** | Si c'est automatique, ça n'a pas besoin d'un bouton. |
| **« 🔍 Lire les valeurs » / « ↻ Relire »** | Coller **est** la commande. Un bouton de plus pour dire « oui, vas-y ». |
| **« ✓ Image » / « Comparer à l'image »** (le bouton bascule) | Une bascule de plus. La vignette d'image reste, mais toujours affichée, sans bouton. |
| **La légende à trois pastilles : « faible confiance », « hors-norme », « incohérent »** | Une seule couleur, donc plus de légende à décoder. Une phrase suffit : « Les cases en jaune sont à vérifier. » |
| **La colonne « Unité »** dans le tableau de vérification | Vide dans mes essais. L'unité vient du catalogue ; je la corrigerai dans la grille si besoin. |
| **Les deux onglets « 📷 Photo / capture » et « 📄 Compte-rendu (texte) »** | Je colle ; l'application voit bien elle-même si c'est une image ou du texte. |
| **Les deux boutons « ⌨️ Saisir » / « 📥 Importer »** | Même raison : coller doit marcher depuis n'importe où. Il n'y a qu'un écran, la grille. |
| **Le pavé de texte « 🔒 Astuce confidentialité : recadrez pour exclure l'en-tête patient… »** | Quatre lignes de conseil sur l'écran d'accueil. Un lien « Confidentialité » suffit. |

### Ce qui doit RESTER sur l'écran d'import

- **La zone « Collez une capture d'écran (Ctrl+V) »**, et le glisser-déposer d'une image ou d'un PDF.
- **« choisir un fichier »**, en petit — pour le jour où le collage ne marche pas.
- **La mention « 100% local — rien n'est envoyé »**. Ça, c'est ce qui me permet de l'utiliser à l'hôpital. Gardez-la bien visible.
- **Le tableau de vérification** avec les noms d'analytes, les dates, les valeurs, **modifiables au clavier**.
- **La vignette de l'image d'origine en regard de chaque ligne** — c'est le seul réglage intelligent de tout l'écran : elle me permet de corriger sans rouvrir ma capture. Affichez-la toujours, sans bouton pour l'activer.
- **La case à cocher par ligne** pour exclure une ligne dont je ne veux pas.
- **« Ajouter au graphique »** et **« Annuler »**.
- **Le recadrage** — mais uniquement s'il reste utile après que tout le reste fonctionne, et alors seulement dans un menu discret. Sa justification (masquer l'en-tête patient) est bonne ; ce n'est pas un réglage d'image, c'est de la confidentialité.
- **La lecture de plusieurs captures collées à la suite** (« 3 captures en attente »). C'est utile : mes bilans sont sur trois écrans.

---

## 4. Autres irritants rencontrés en me promenant

**A. Le panneau de saisie fait un tiers de l'écran, le graphique vide prend les deux tiers.**
Sur un écran de 1440×900, la grille est écrasée dans une bande de 380 px pendant que le graphique — qui affiche « Ajoutez des valeurs pour générer la courbe » — occupe 500 px. Sur l'écran d'accueil, la troisième option (« Coller un compte-rendu ») est **coupée** et il faut faire défiler un panneau pour la voir. Il existe une poignée de redimensionnement, mais elle est invisible : deux traits gris de 20 px. **Tant qu'il n'y a pas de données, la saisie doit occuper l'écran.**

**B. Le tableau de vérification déborde et il faut le faire défiler horizontalement dans un panneau déjà trop court.** Avec trois dates, la troisième est déjà hors champ.

**C. Le format de date n'est pas cohérent dans l'application.** Sur le même écran, j'ai lu `08/14/0001` dans le tableau et `14/08/0001` sur le graphique. Le champ suit la langue du navigateur, pas l'application. Dans un outil médical, une date au format américain est un risque : `03/04` c'est le 3 avril ou le 4 mars ? Tout doit être en `jj/mm/aaaa`, partout.

**D. Après avoir ajouté un paramètre, le panneau « Ajouter un paramètre » reste ouvert** et pousse le tableau vers le bas ; il faut cliquer « Fermer ». Le lien « Fermer », en gris clair, est le seul moyen d'en sortir.

**E. La croix de suppression d'une colonne (✕) n'apparaît qu'au survol**, en gris très clair, collée à la date. Deux fois j'ai failli supprimer une colonne en visant le champ de date.

**F. Le bouton « + Date » est perdu à droite du tableau**, en pointillés gris, à un endroit où l'œil ne va pas. C'est pourtant l'action la plus fréquente après avoir créé une ligne.

**G. Le menu « Affichage » contient « Marquer les valeurs hors-norme ».** C'est un réglage de graphique, il est à sa place là. Mais il ne doit surtout pas être confondu avec le surlignage de l'import, qui doit signaler des erreurs de **lecture** et non des anomalies **cliniques**. Deux choses différentes, deux endroits différents — c'est aujourd'hui la même idée appliquée aux deux, et c'est la racine du problème n°3.

**H. La modale d'accueil est correcte** (trois étapes, mention du 100% local, bouton unique « Commencer »). Rien à changer, sauf qu'elle ne doit pas revenir à chaque ouverture.

---

## 5. CRITÈRES D'ACCEPTATION

Chaque ligne se valide ou s'invalide en manipulant l'application, sans lire une ligne de code. Une livraison est acceptée quand tous les critères sont vérifiés.

### Dates

1. Je clique sur la date d'une colonne, je tape les huit chiffres d'une date complète (`01022020`) : les huit chiffres arrivent dans le champ, aucun n'est perdu.
2. Pendant que je tape cette date, la colonne ne change pas de position dans le tableau.
3. Pendant que je tape cette date, le curseur reste dans le champ de date que j'ai cliqué.
4. Pendant que je tape cette date, la courbe ne bouge pas et l'axe des dates ne change pas.
5. Quand j'appuie sur `Entrée` après avoir tapé la date, la date est enregistrée, la colonne se range à sa place chronologique, et la courbe se met à jour.
6. Quand je clique en dehors du champ après avoir tapé la date, il se passe la même chose qu'avec `Entrée`.
7. Après avoir tapé une date complète, la date affichée est exactement celle que j'ai tapée — jamais une date de l'an 1, 20, 202 ou 2 026.
8. Si j'appuie sur `Échap` en cours de frappe, la date revient à sa valeur d'avant et rien n'a été enregistré.
9. Je peux saisir une date en tapant `12/03/2024`, `12032024` ou `12/03/24` — les trois donnent le 12 mars 2024.
10. Je peux saisir `03/2024` (mois seul) et `2024` (année seule) sans que ce soit refusé.
11. Toutes les dates de l'application — grille, écran d'import, graphique, exports — s'affichent en `jj/mm/aaaa`, quelle que soit la langue du navigateur.
12. Quand une date que je déplace écrase des valeurs existantes, un message me le dit et propose « Annuler » ; un clic sur « Annuler » restaure l'état d'avant.

### Grille de saisie

13. À l'ouverture d'un suivi vide, une grille est déjà affichée avec au moins une ligne vide et une colonne vide : je peux cliquer dans une case et taper sans avoir cliqué sur aucun bouton au préalable.
14. Il y a toujours une colonne vide à l'extrême droite ; dès que j'y saisis une date, une nouvelle colonne vide apparaît à sa droite.
15. Il y a toujours une ligne vide en bas ; dès que j'y saisis un nom d'analyte, une nouvelle ligne vide apparaît en dessous.
16. Je tape « créat » dans une ligne vide : une suggestion me propose « Créatinine (µmol/L) » ; je valide par `Entrée` et l'unité est renseignée toute seule.
17. Je tape un libellé absent du catalogue (« IgG4 sérique ») : il est accepté tel quel, sans message d'erreur ni écran supplémentaire.
18. `Tab` déplace le curseur à la cellule de droite ; en fin de ligne, il passe à la première cellule de la ligne suivante, sans jamais sortir du tableau.
19. `Maj+Tab` fait l'inverse.
20. `Entrée` dans une cellule de valeur déplace le curseur à la cellule du dessous.
21. Les flèches ↑ ↓ ← → déplacent le curseur de cellule en cellule.
22. Je tape une valeur : la courbe se met à jour pendant que je tape, sans que j'aie à quitter la cellule.
23. Je clique une cellule qui contient « 110 » et je tape « 85 » : la cellule contient « 85 », jamais « 11085 » ni « 1850 ».
24. Je copie un bloc de 3 lignes × 4 colonnes depuis Excel et je le colle dans une cellule : les douze valeurs se placent à partir de cette cellule.
25. Je copie depuis Excel un tableau complet (ligne d'en-tête de dates + lignes d'analytes) et je fais `Ctrl+V` : si toutes les dates sont reconnues, les valeurs entrent directement dans la grille sans écran intermédiaire, et un « Annuler » reste disponible.
26. Le même collage avec une date illisible affiche l'écran de vérification, avec la seule colonne problématique surlignée.
27. Tant qu'aucune valeur n'a été saisie, la zone de saisie occupe la plus grande partie de l'écran et aucune option de l'écran d'accueil n'est coupée par le bas.

### Import d'une capture (OCR)

28. Je fais `Ctrl+V` d'une capture d'écran depuis n'importe quel écran de l'application : la lecture démarre toute seule, sans que je clique sur un bouton.
29. Sur une capture de biologie ordinaire à trois colonnes de dates, le tableau proposé comporte trois colonnes de dates, chacune avec sa date renseignée.
30. Sur cette même capture, aucune valeur issue d'une colonne « Normes », « Valeurs de référence », « Réf. » ou « Unité » n'apparaît comme valeur de patient.
31. Une valeur écrite `12,2` sur l'image ne devient jamais `122`.
32. Le nom d'analyte proposé ne contient pas l'unité collée au nom (pas de « Créatinine umolL »).
33. Le tableau de vérification n'utilise qu'**une seule** couleur de signalement : le jaune.
34. Une valeur simplement pathologique mais correctement lue (CRP à 45 mg/L, créatinine à 300 µmol/L, hémoglobine à 7 g/dL) n'est **pas** surlignée.
35. Une valeur mal lue, une date non reconnue ou un nom non reconnu **est** surligné en jaune.
36. Sur une capture parfaitement nette dont toutes les valeurs sont correctement lues, aucune case n'est surlignée.
37. La légende à trois pastilles (« faible confiance », « hors-norme », « incohérent ») n'existe plus ; une seule phrase indique que le jaune est à vérifier.
38. L'écran d'import ne comporte plus aucun des éléments suivants : « ▾ Options », « Noir & blanc (photos difficiles) », « Aperçu du traitement », le curseur « Contraste », « ⟲ », « ⟳ », « Redresser auto », « 🔍 Lire les valeurs », « ↻ Relire », « ✓ Image / Comparer à l'image », la colonne « Unité ».
39. La vignette de la portion d'image d'origine est affichée en regard de chaque ligne, en permanence, sans bouton pour l'activer.
40. La mention « 100% local — rien n'est envoyé » reste visible sur l'écran d'import.
41. Quand la lecture échoue, un message en français clair me le dit et me propose une autre voie (capture plus nette, ou collage depuis Excel) — l'application ne propose jamais un tableau partiellement faux comme si tout allait bien.
42. Toutes les cases du tableau de vérification (noms, dates, valeurs) sont modifiables au clavier, et `Tab` circule de l'une à l'autre.
43. Je peux coller plusieurs captures à la suite et obtenir un seul tableau de vérification consolidé.
44. Entre le `Ctrl+V` et le tableau de vérification affiché, il s'écoule **moins de dix secondes** pour une capture d'écran standard.

### Général

45. La suppression d'une colonne de dates demande une action délibérée et non un survol : je ne dois pas pouvoir supprimer une colonne en visant son champ de date.
46. Depuis un suivi vide, je peux obtenir une courbe exploitable de 3 analytes × 4 dates rétrospectives (2019→2024) — saisie au clavier, sans collage — **en moins de deux minutes et sans jamais perdre une frappe**.
47. Depuis un suivi vide, je peux obtenir la même courbe par `Ctrl+V` d'une capture d'écran, correction des cases jaunes comprise, **en moins d'une minute**.
48. À aucun moment de ces deux parcours je n'ai eu à ouvrir un écran de réglages ni à cliquer sur une option dont le libellé ne parle pas de médecine.

---

*Je serai rappelé pour vérifier chacun de ces points, dans l'application, en la manipulant.*
