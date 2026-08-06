# FastCurve

Générateur de courbes de suivi biologique et EFR, pensé pour illustrer un
compte-rendu : on saisit ou on colle des valeurs, on pose les traitements, on
récupère une figure lisible à coller dans un document.

**Tout se passe dans le navigateur.** Aucune donnée n'est envoyée nulle part,
il n'y a pas de serveur, pas de compte, pas de dépendance à un service en
ligne — reconnaissance de captures d'écran comprise.

## Ce que ça fait

- **Saisie** — une grille paramètres × dates, navigable au clavier. Ajout de
  dates une par une ou par série régulière (7 jours, mois, trimestre, an).
- **Collage** — `Ctrl+V` sur une capture d'écran de résultats de laboratoire
  (reconnaissance de caractères locale) ou sur un tableau copié depuis un
  tableur, avec un écran de vérification avant intégration.
- **Import de compte-rendu** — coller le paragraphe des traitements en extrait
  les molécules, les doses et les décroissances.
- **Traitements** — barres pour les traitements continus, avec décroissance par
  paliers ; flèches pour les événements ponctuels (bolus, chirurgie).
- **Figure** — un panneau par paramètre ou tous sur un axe commun, bandes de
  normale, valeurs hors-norme signalées, annotations datées, fenêtre temporelle.
- **Sortie** — copie dans le presse-papiers, PNG haute résolution, SVG
  vectoriel, ou impression A4 paysage (figure page 1, tableau des valeurs
  page 2).

## Conservation du travail

Le suivi en cours est conservé dans le navigateur : fermer l'onglet et revenir
plus tard le retrouve tel quel. **Enregistrer** produit un fichier
`.fastcurve.json` qu'on rouvre plus tard, ou sur un autre poste, avec
**Ouvrir**.

## Développement

```sh
npm install
npm run dev      # serveur de développement
npm test         # 137 vérifications
npm run check    # typage Svelte + TypeScript
npm run build    # production → dist/
```

Svelte 5 (runes) + TypeScript + Vite. Le graphique est produit sous forme de
SVG par `src/lib/chart/render.ts`, sans bibliothèque de tracé.

Les tests couvrent trois niveaux : le comportement du modèle de données
(`src/**/*.test.ts`), la non-régression du rendu par comparaison de signatures
SVG sur vingt états figés (`tests/rendu.test.ts`), et des invariants de
robustesse — aller-retour JSON sans perte, déterminisme du rendu, valeurs
aberrantes, échappement du texte utilisateur (`tests/fiabilite.test.ts`).

## Licence

MIT.
