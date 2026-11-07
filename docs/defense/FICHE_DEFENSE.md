# Praxis : fiche de défense (entretien)

**1. Pourquoi, pour qui.** Une note d'analyse (entrée sur un marché, rachat d'actions, position publique) écrite par un LLM a l'air sourcée même quand elle ne l'est pas. Praxis vise un lecteur qui doit savoir ce qui, dans la note, repose sur une source vérifiable et ce qui n'y repose pas. À ma connaissance, personne ne s'en sert en production.

**2. En une phrase.** Un pipeline LLM en 7 étapes qui transforme une question business en note d'analyse au format déclaré en YAML, et dont le code, pas le modèle, vérifie que chaque élément cité a une source renvoyée par la recherche, datée et sur un domaine de confiance. Il ne vérifie pas que la source dise ce que dit l'affirmation (`docs/SYSTEM_CARD.md:88-90`).

**3. Trois décisions clés**

| Décision | Gain | Coût |
|---|---|---|
| Un sourcing insuffisant dégrade la note au lieu de l'arrêter ([ADR 0002](../adr/0002-degrade-on-insufficient-sourcing.md)). C'est le défaut de la CLI et du benchmark ; la bibliothèque arrête par défaut. | La note est livrée, mais dit elle-même ce qu'elle n'a pas pu sourcer : section « Insufficiently sourced » écrite par le code, non par le modèle (`src/sourcing/insufficient.ts:25-45`), et drapeau `insufficiently_sourced`. | Le drapeau est binaire et se lève sur un seul élément : les 6 notes réelles sont toutes signalées (voir 4). Il dit que la barre n'est pas atteinte, pas de combien. Sans aucune constatation sourcée, la note s'arrête quand même. |
| La confiance dans une source vient d'une liste écrite par le code, pas d'une note du modèle ([ADR 0003](../adr/0003-source-trust-criteria.md)) | Chaque format liste les hôtes qu'il accepte. Un site d'organisation ne compte comme source « first-party » que si l'organisation est dans une liste relue, que l'hôte est l'un de ses domaines et que l'élément la nomme (`src/sourcing/first-party.ts:34-48`). Jamais pour une probabilité ou un impact de risque, ni pour la contre-preuve d'une critique : ce sont des jugements, pas des faits de l'organisation. Le modèle propose, le code vérifie. | Une liste statique : une grande part des éléments cités tombent en dehors (16 à 32 éléments non fiables sur 41 à 49 par note, `docs/SYSTEM_CARD.md:16-19`). Et le code ne peut pas juger si la phrase énonce bien un fait propre à l'organisation : il faut un humain. |
| Chaque requête réserve son pire cas avant de partir (`UsageLedger.reserve`, `src/orchestrator/ledger.ts:221`) | Un plafond par note, tenu dans le code : une requête n'est envoyée que si le dépensé, les réservations en cours et son pire cas tiennent sous le plafond. | Le plafond peut être dépassé quand des recherches web ajoutent plus de 15 000 tokens chacune (`docs/SLO.md:70-73`). Une note peut s'arrêter alors que la dépense réelle aurait tenu ; aucune exécution enregistrée ne s'est arrêtée sur le plafond. |

**4. Chiffres** (notes terminées le 4 nov. 2026, claude-opus-5-5 et claude-sonnet-5-5, enregistrements dans `benchmarks/outputs/live/` ; tentatives comptées depuis la 1.2.1)

| Chiffre | Source | Comment il a été mesuré |
|---|---|---|
| Briefings réels terminés, par commit : `fe09710` 0 sur 1, `7c75a06` 1 sur 1, `3a7ca6a` 1 sur 1, `8df678f` 4 sur 5 | `docs/SYSTEM_CARD.md`, « Measured performance » | Lu dans `error-*.json` et `metadata.json`, groupés par `provenance.git_sha`. Aucun taux poolé ni intervalle : quatre versions du code, au plus 5 tentatives chacune. Les 5 échecs de la 1.2.1 n'ont pas d'enregistrement et sont listés à part. |
| Notes signalées « insufficiently sourced » : **6 sur 6** | `docs/SYSTEM_CARD.md:15-19` | Lu dans `metadata.json`. Par note : 6 à 15 éléments sans source, 16 à 32 sur des domaines non fiables, sur 41 à 49 éléments. |
| Coût par note : **3,29 $ à 4,75 $** (n = 6) | `docs/SLO.md:18` | `usage.total.cost_usd` : tokens et recherches web renvoyés par l'API, multipliés par la table de prix. Ce n'est pas une facture. Palier 1 du protocole : 17,96 $ dépensés pour une estimation centrale de 30,23 $ (`benchmarks/outputs/live/README.md:106`). |
| Durée : **7,7 à 11,9 min** (n = 6) | `docs/SLO.md:16` | Somme des durées des étapes du pipeline. La question 12 dépasse la cible de 10 minutes. n trop petit pour un p95. |
| Qualité des notes : **non évaluée** | `docs/SYSTEM_CARD.md:19` | Aucun juge n'a tourné sur les notes réelles (`score:live` est payant, non approuvé). Les sorties mock sont du texte de fixture : `score-all.ts` refuse de les noter. |

**Pourquoi 6 notes sur 6 sont signalées.**
- Les trois formats de ces six notes, comme les quatre formats livrés, sont en `sourcing_policy: strict` (par exemple `formats/mckinsey-style-note.yaml:97`). Un seul élément sans source, sur un domaine non fiable ou plus vieux que la limite du format fait échouer le contrôle (`src/sourcing/errors.ts:109-117`). La note est alors dégradée.
- Chaque note en a des dizaines. Les listes d'hôtes de confiance sont courtes, la recherche web renvoie souvent d'autres hôtes, et certaines affirmations ne trouvent aucune source.
- Le signal utile est donc dans les compteurs, pas dans le drapeau. Après les corrections de sourcing, la seconde exécution de la question 05 passe de 9 à 15 éléments `ok`, sur 44 puis 47 (`benchmarks/outputs/live/README.md:46-47`). Ce sont deux tirages d'une même question, sous des règles différentes : une indication, pas une preuve.
- La question 05 a servi au développement après le palier 0 : elle n'est plus une question réservée au test.

**5. Une erreur réelle attrapée par le process.** La question 02 du palier 1 a échoué. Une section de synthèse a été refusée, puis sa relance aussi. L'enregistrement ne garde que la dernière raison : le contrôle de la prose (OWASP LLM05) a refusé une adresse `www.`.
- Cette raison ne citait que `'www.'` : la cause n'était pas diagnosticable. La PR [#42](https://github.com/matteogallo-ai/praxis/pull/42), fusionnée, fait citer l'adresse entière, coupée à 200 caractères.
- Diagnostic probable, que l'enregistrement ne peut pas confirmer : ce n'est pas un bug du validateur. La consigne du format demandait la source « en parenthèses à la fin du paragraphe », ce qui invite un nom d'hôte. Accepter un `www.` nu a été refusé.
- La PR [#44](https://github.com/matteogallo-ai/praxis/pull/44), fusionnée, corrige la cause probable. Elle remplace la consigne par des marqueurs de citation `[n]`, vérifiés par le code, sans nom de site ni URL dans le texte ; un marqueur qui ne pointe sur aucune source est refusé.
- Aucune relance payante n'a été faite pour « vérifier ».

**6. Ce que je ferais autrement**
- Construire les listes d'hôtes de confiance à partir des questions du benchmark **avant** la première exécution réelle : 6 sur 6 signalées était prévisible.
- Afficher dès le premier jour l'affirmation à côté de chaque source first-party. Ma relecture des 8 sources first-party de la question 10 en a refusé 2 : deux probabilités de risque, qui sont des jugements et non des faits de l'organisation. La PR [#47](https://github.com/matteogallo-ai/praxis/pull/47), fusionnée, exclut du first-party les probabilités, les impacts et la contre-preuve des critiques ; la PR [#48](https://github.com/matteogallo-ai/praxis/pull/48), fusionnée, affiche l'affirmation à côté de chaque source first-party.
- Garder dans l'enregistrement d'erreur la réponse refusée, pas seulement la dernière raison.

**7. Questions pièges**
1. *« 6 notes sur 6 signalées : l'outil ne marche pas. »* → Le drapeau dit que la politique stricte n'est pas tenue. C'est le comportement voulu (ADR 0002), et la note liste chaque élément en cause. Ce que je ne peux pas dire, c'est que les notes sont bonnes : leur qualité n'a pas été évaluée.
2. *« 6 sur 13, c'est un taux de réussite de 46 %. »* → Ce taux mélange quatre versions du code et cinq tentatives sans enregistrement : il ne décrit aucune version. Par commit : `fe09710` 0 sur 1, `7c75a06` 1 sur 1, `3a7ca6a` 1 sur 1, `8df678f` 4 sur 5 ; l'échec de `8df678f` est la question 02 (section 5). Les 5 tentatives de la 1.2.1 ont échoué sans enregistrement. Aucun intervalle : au plus 5 tentatives par version. Sa cause probable est corrigée sur `main` (#44), sans relance payante pour le vérifier.
3. *« Pourquoi ne pas laisser le modèle juger la fiabilité d'une source ? »* → Il noterait ses propres sources. Le modèle peut proposer qu'une source est first-party ; le code vérifie l'organisation, le domaine et le sujet, et un humain juge la phrase.
4. *« Tu as écrit le code ? »* → Développement assisté par agents de code : je spécifie, je relis les PR et leurs tests, et je réponds de ce qui est fusionné. Ce que cela recouvre ici :
   - les critères de « done » et les contrôles CI (claims ↔ tests, récit périmé, commits, versions des prompts) ;
   - les décisions de fond, par exemple refuser un `www.` nu plutôt que l'accepter, ou exclure les estimations et les critiques du first-party (PR #47) ;
   - la relecture humaine des sources first-party, et un relecteur à contexte neuf avant chaque remise.
5. *« Combien coûte une note ? »* → De 3,29 $ à 4,75 $ sur 6 notes. Les notes terminées du palier 1 ont coûté 0,56 à 0,80 de leur estimation centrale. Chacune des 8 exécutions enregistrées (depuis le 3 nov. 2026) a été précédée d'une estimation (bas, central, haut) et d'un accord explicite, avec un plafond par note tenu par le code, sauf le dépassement documenté des grosses recherches web.
