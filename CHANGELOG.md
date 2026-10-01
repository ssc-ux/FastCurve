# Journal des modifications

## 1.5.1

### Captures
- Tableau d'UN SEUL examen sur plusieurs dates (ex. CRP seule) : il n'était
  pas lu (refus volontaire du moteur des captures, qui risquait de décaler
  les colonnes). Quand ce moteur échoue, le moteur photo prend le relais : il
  rattache chaque valeur à la date au-dessus d'elle. Banc : 2 captures
  réelles d'une ligne ajoutées, 17 captures à 100 %.

## 1.5.0

### Photo d'écran
- Guide de prise de vue refait sur le détecteur de texte (≈ 200 ms par
  analyse) : il reconnaît le tableau là où l'ancien échouait, et demande de
  décaler quand la colonne des noms est coupée ou absente.
- Lecture environ 3 fois plus rapide : calcul sur plusieurs cœurs (page
  isolée par le service worker, dès la deuxième visite).
- Double lecture (à l'essai) : les deux images les plus nettes de la rafale
  sont lues ; toute case où elles diffèrent passe en jaune, une case lue sur
  une seule image est reprise en jaune. `?double=0` la désactive.
- Fin de nombre rognée sur fond peu contrasté relue avec marge ; nombre
  incomplet signalé, jamais deviné ; débris collés aux noms écartés ; nom
  coupé au bord gauche mis en doute.
- Photo choisie dans la galerie : reconnue automatiquement et lue par le
  moteur photo (une capture d'écran reste lue par le moteur des captures).
- Moteur et modèles (~26 Mo) gardés en cache d'une version à l'autre.
- Banc : 95,9 % des cases justes, 0 erreur silencieuse ; captures : 100 %.

### Déploiement
- Plus d'installation de Chromium (Chrome des machines GitHub), actions
  GitHub à jour, cache npm.

## 1.4.0

### Photo d'écran (encore derrière `?photo=1`)
- Nouveau moteur de lecture pour les photos : PaddleOCR (PP-OCRv4) exécuté
  dans le navigateur (ONNX Runtime, WebAssembly). Rien ne sort de l'appareil ;
  modèles (~12 Mo) et moteur (~14 Mo) servis par le site, puis en cache.
- Tableau reconstruit à partir des zones de texte : lignes suivies malgré la
  perspective, ligne des dates, colonnes par bord droit, point décimal
  cherché sur l'image, valeur coupée au bord jamais inventée.
- Banc (6 photos réelles, 932 cases) : 93 % justes, 0 erreur silencieuse
  (contre 0–10 % avec le moteur des captures). Chaque case a son extrait.
- Les captures d'écran gardent leur moteur (Tesseract, 100 % sur le banc).

## 1.3.0

### Carrés bleus (traitements)
- Lecture refondue sur de vrais comptes-rendus : plages « de 2003 à 2010 »,
  années seules, « en octobre 2019 », date de tête de ligne.
- Chaque ligne dit ce qu'elle fait : début, arrêt, nouvelle dose, cure,
  traitement actuel ; « relai du X par Y » arrête X et démarre Y ; faute de
  frappe rattrapée (« MYORTIC » → MYFORTIC).
- Sections sans rapport ignorées (suivi, vaccinations, projet, bilan) : leurs
  dates ne deviennent plus des dates de traitement.
- Un changement de dose devient un palier de la même barre (dose en mg/j
  quand elle se calcule) ; une ligne sans date n'est plus ajoutée « à
  aujourd'hui » : elle est décochée.

### Captures
- Barre de titre au-dessus du tableau, pictogrammes au liseré flou, numéros
  de demande pris pour des valeurs, virgule perdue rétablie d'après la ligne
  (case laissée en jaune) — banc : 15 captures dont 3 réelles, 100 %.

## 1.2.0

### Traitements
- Trois façons de les renseigner, comme la biologie : **Saisir** (manuel),
  **Coller** (carré bleu du compte-rendu, retouchable avant « Analyser ») et
  **Dicter** (Dragon écrit dans la zone ; analyse à chaque pause).
- Boutons « Ajouter » distincts (traitement, annotation, lecture validée).

### Vérification et courbe (audit, priorité 1)
- Vérification d'une lecture en pleine largeur ; au-dessus de chaque valeur,
  nom et date, l'extrait correspondant de la capture d'origine.
- Axe du temps coupé (« // ») sur les trous de plusieurs années : chaque
  période reste lisible ; la courbe traverse la coupure en pointillé.

### Photo guidée (en réglage, activée par `?photo=1`)
- Caméra avec cadre qui suit le tableau repéré en direct (rouge / orange /
  vert) et consignes : redresser, se placer en face, se rapprocher, zoomer.
- Déclenchement automatique quand l'image est bonne et stable ; rafale de
  4 images, la plus nette est retenue ; mise au point visée sur le tableau.
- Photo redressée, recadrée, lissée contre le moiré, puis lue comme une
  capture. « Reprendre la photo » et « Ajouter la suite du tableau »
  (les parties sont fusionnées par date et par variable).

## 1.1.0 — mise en production

### Reconnaissance des captures d'écran
- Chaque valeur est lue à trois agrandissements, puis retenue à la majorité ;
  seules les lectures formant un nombre votent. Désaccord → case en jaune.
- Contrôle de cohérence des glyphes : les chiffres lus sans hésitation servent
  de modèles, tirés de la capture elle-même ; un chiffre qui ne leur ressemble
  pas est signalé.
- Filets du tableau et fonds surlignés (colonne du jour en jaune) neutralisés
  avant lecture.
- Pictogrammes accolés aux valeurs (ⓘ, flèches ↑↓) écartés de la découpe.
- Colonne « Normales » sans titre dans la ligne des dates : plus jamais prise
  pour une colonne de résultats.
- Titres de section (« HÉMATO … (24 analyses) ») et lignes de texte
  (« non communiquée », « Automate ») écartés.
- Nom d'analyte mal lu rapproché du catalogue (« 19G » → IgG).
- Banc d'épreuve : 14 captures dont 2 réelles d'extranet hospitalier —
  100 % des cases, dates et lignes, aucune erreur. Vérifié à chaque
  déploiement.

### Fiabilité des données
- Deux colonnes du même jour (deux prélèvements, ou deux captures) ne
  s'écrasent plus : une case vide n'efface jamais une valeur, deux valeurs
  différentes sont signalées.
- Le navigateur est prié de conserver le suivi (stockage persistant).
- Pastille sur « Enregistrer » quand le suivi a changé depuis le dernier
  fichier enregistré.

### Catalogue
- Plus aucune valeur de référence pré-remplie : les normales sont celles du
  laboratoire, saisies par le médecin.

### Présentation
- Emojis remplacés par le jeu d'icônes de l'application (rendu identique sous
  Windows, macOS, iOS, Android).
- Téléphone : barre d'outils de la courbe sur une seule ligne ; icônes de la
  barre du haut libellées.

### Production
- Cache hors-ligne versionné à chaque build ; « Nouvelle version disponible »
  proposée pendant l'utilisation.
- Politique de sécurité resserrée (plus de `unsafe-inline` ni `unsafe-eval`
  pour les scripts).
- Informations légales (usage, confidentialité, hébergement) dans
  Réglages › À propos ; avertissement d'usage à l'accueil.
- Tests de bout en bout (Chromium, bureau et téléphone) dans la CI.

## 1.0.0
- Première version.
