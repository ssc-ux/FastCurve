<script lang="ts">
  // Mentions d'usage, de confidentialité et d'hébergement. Aucun éditeur n'est
  // nommé (choix du projet) ; tout le reste est factuel et vérifiable dans le
  // code source.
  const version = `${__APP_VERSION__} (build ${__BUILD_ID__.slice(0, 8)})`;
</script>

<div class="legal">
  <details>
    <summary>Usage et responsabilité</summary>
    <p>
      FastCurve met en forme des résultats biologiques et d'EFR sous forme de
      courbes, pour illustrer un compte-rendu. Il <strong>ne pose aucun diagnostic</strong>,
      n'interprète pas les résultats et ne propose aucune décision thérapeutique :
      ce n'est pas un dispositif médical.
    </p>
    <p>
      Les valeurs reconnues automatiquement (capture d'écran, PDF, dictée,
      collage) sont proposées à la vérification avant tout ajout. Elles
      doivent être <strong>contrôlées par rapport au document source</strong>, qui seul
      fait foi. Les bornes de normale affichées sont celles saisies par
      l'utilisateur, propres à son laboratoire.
    </p>
  </details>

  <details>
    <summary>Données personnelles et confidentialité</summary>
    <p>
      Aucune donnée saisie n'est transmise : il n'y a ni serveur applicatif, ni
      compte, ni cookie, ni mesure d'audience, ni service d'intelligence
      artificielle en ligne. La reconnaissance de caractères s'exécute dans le
      navigateur.
    </p>
    <p>
      Le suivi en cours est conservé dans le stockage local de ce navigateur,
      sur ce poste ; les fichiers <code>.fastcurve.json</code> sont enregistrés
      là où l'utilisateur les place. L'utilisateur (ou son établissement)
      reste responsable des données de santé qu'il y saisit : privilégiez un
      libellé anonymisé et vérifiez qu'aucun identifiant patient n'apparaît
      sur une figure partagée.
    </p>
  </details>

  <details>
    <summary>Hébergement et licence</summary>
    <p>
      Application statique hébergée par GitHub Pages (GitHub, Inc., 88 Colin
      P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis). Comme tout
      hébergeur web, GitHub peut journaliser l'adresse IP des visiteurs lors du
      téléchargement de l'application ; aucune donnée saisie ne lui parvient.
    </p>
    <p>Logiciel libre sous licence MIT. Version {version}.</p>
  </details>
</div>

<style>
  .legal { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
  details { border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; background: var(--panel); }
  summary { cursor: pointer; font-size: 13px; font-weight: 600; }
  p { font-size: 12.5px; line-height: 1.55; color: var(--muted); margin: 8px 0 4px; }
</style>
