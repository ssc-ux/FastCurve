# Journal des modifications

## 1.2.0

### Traitements
- Trois façons de les renseigner, comme la biologie : **Saisir** (manuel),
  **Coller** (carré bleu du compte-rendu, extraction dès le collage) et
  **Dicter** (Dragon écrit dans la zone ; analyse à chaque pause).
- Boutons « Ajouter » distincts (traitement, annotation, lecture validée).

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
