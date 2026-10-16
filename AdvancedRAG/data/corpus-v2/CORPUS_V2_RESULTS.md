# Corpus v2 — état du 30 septembre 2026 (225 paires)

**Corpus figé le 30 septembre 2026 à 225 paires** (décision de fin de collecte, prise avant toute génération). Empreinte `5cabf7d044a083ebddfb2477ea8f13a607464cfa32adc9e64d751935a1f85d4b` ; enregistrement du gel dans `CORPUS_FROZEN.json` (empreintes du manifeste, des groupes de domaines et de l'environnement Hardhat figé). Les 30 paires `authorship_doubt` sont conservées ; aucune transformation supplémentaire n'a été admise.

Corpus reconstruit à partir de paires contrat/tests **écrites par des humains**, issues de dépôts GitHub publics sous licence libre, figées au commit, puis validées par exécution. Aucune génération n'a encore été faite à partir de ce corpus.

- **225 paires** (198 dépôts distincts, 186 auteurs, au plus 3 paires par dépôt) ; empreinte `5cabf7d044a083eb…` (`corpus_manifest.json`). États précédents conservés : 166 paires (`fc885c87…`, `corpus_manifest_v166.json`) 183 paires au seuil de 80 % (`2ac0a02d…`, `corpus_manifest_v183.json`) et 200 paires (`2d5f2525…`, `corpus_manifest_v200.json`).
- **Seuil de couverture abaissé de 80 % à 70 % le 30 septembre**, après la collecte et avant toute génération, pour atteindre la taille visée : les 17 paires rejetées pour la seule couverture entre 70 % et 80 % (71,05 % à 79,31 %) ont été revalidées (validateur v4, 17/17 acceptées). La couverture de chaque paire reste dans son `validation.json` ; le sous-corpus des 183 paires à ≥ 80 % peut servir d'analyse de robustesse.
- Niveaux : 44 simples, 110 modérées, 71 complexes.
- Tests d'origine : 145 JavaScript, 80 TypeScript. 102 paires ont des **tests** transformés mécaniquement (types retirés, `import` → `require`, chemin `hardhat-toolbox/network-helpers`) ; en comptant aussi les retouches des sources Solidity (chemins d'`import` aplatis, BOM UTF-8 retiré sur 1 paire), 118 paires ont au moins une transformation. Chaque transformation est enregistrée dans le manifeste de la paire.
- 30 paires marquées `authorship_doubt`ramènerait le corpus à 195 paires (décision du 28 septembre).

## Collecte et validation

| Lot | Candidats | Importés | Acceptés |
|---|---:|---:|---:|
| Pilote | 41 | 41 | 22 |
| DeFi | 107 | 106 | 69 |
| Applicatif | 97 | 96 | 76 |
| Ciblé v3 (domaines minces) | 20 | 20 | 13 |
| Ciblé v4 (enchères, crowdfunding, assurance, airdrop) | 27 | 26 | 4 |
| Seuil de couverture 70 % (paires déjà importées) | — | — | 17 |
| Lot v5 (4 agents, 30 septembre) | 28 | 28 | 25 |
| **Total** | **320** | **317** | **226** |

Dédoublonnage : 1 paire exclue (`forge-token`, signatures ERC20 identiques à `base-token`). Échecs d'import : 3 dépôts.

Causes de rejet (91, au seuil de 70 %) : tests d'origine en échec dans l'environnement figé 33 ; couverture de la cible principale < 70 % 11 (28 au seuil de 80 %) ; compilation ou chargement 26 (dont OpenZeppelin 4 : 6, « stack too deep » sans optimiseur : 11, pragma solc 0.8.28/0.8.29 absent de l'environnement figé : 4) ; absence de fichier LICENSE dans le dépôt (en-tête SPDX seul) 14 ; convention, licence ou assertions 6 (dont 2 imports non déclarés du lot v5 : `hardhat-chai-matchers` chargé explicitement, `typechain-types`) ; fuite vers le benchmark 1.

Le lot ciblé v3 visait les domaines du benchmark sous l'objectif (enchères, vote, crowdfunding, airdrop, bridge, rate limiting) : 13 acceptées sur 20. Les 7 rejets sont 6 suites d'origine en échec et 1 couverture insuffisante (`cross-chain-governor`, 71,7 %).

Le lot ciblé v4 (29 septembre) n'a retenu que 4 paires sur 26 : un premier sous-lot de 14 dépôts sans fichier LICENSE a été entièrement rejeté, la règle ayant été maintenue (l'en-tête SPDX ne couvre pas les fichiers de tests). Les tests d'airdrop Merkle reposent presque tous sur `merkletreejs` ou `@openzeppelin/merkle-tree`, absents de l'environnement figé ; environ 5 candidats supplémentaires seraient recevables si cette dépendance était admise (décision en attente).

Règles appliquées (toutes fixées avant génération, le seuil de couverture ayant été relâché après la collecte) : provenance et licence OSI ; Hardhat 2 + ethers 6, CommonJS, sans helper partagé ; imports OpenZeppelin 5.0.2 ou locaux ; 100 % des tests passants, sans test en attente ; couverture des instructions ≥ 70 % sur la cible principale (80 % jusqu'au 30 septembre) ; similarité structurelle < 0,6 avec les 30 contrats du benchmark ; dédoublonnage interne sur la cible principale.

## Couverture des domaines

Groupes définis dans `domain_groups.json` (domaines de `CORPUS_V2_SPEC.md` § 5, plus billetterie, jeux/loteries, traçabilité). Les paires de bridge sont rattachées au groupe relayer / méta-transactions, comme dans la spécification.

| Groupe | Simple | Modéré | Complexe | Total |
|---|---:|---:|---:|---:|
| escrow / paiements conditionnels | 4 | 10 | 8 | 22 |
| staking / rendement | 2 | 10 | 9 | 21 |
| jetons fongibles | 12 | 3 | 5 | 20 |
| registres / identité | 5 | 7 | 6 | 18 |
| NFT / marketplace | 3 | 12 | 2 | 17 |
| crowdfunding | 1 | 7 | 3 | 11 |
| jeux / loteries / marchés prédictifs | 1 | 7 | 2 | 10 |
| vote / gouvernance | 3 | 6 | 1 | 10 |
| AMM / DEX | 1 | 3 | 5 | 9 |
| billetterie | 0 | 5 | 4 | 9 |
| bridge / relayer / méta-transactions | 0 | 4 | 5 | 9 |
| multisig / trésorerie | 0 | 8 | 1 | 9 |
| abonnements / flux | 1 | 3 | 4 | 8 |
| enchères | 2 | 4 | 2 | 8 |
| oracles de prix | 1 | 2 | 5 | 8 |
| prêt / collatéral | 1 | 2 | 4 | 7 |
| vesting / timelock | 1 | 3 | 3 | 7 |
| rate limiting | 1 | 5 | 0 | 6 |
| contrôle d'accès | 2 | 2 | 1 | 5 |
| assurance | 0 | 3 | 1 | 4 |
| traçabilité | 1 | 3 | 0 | 4 |
| airdrop / Merkle | 2 | 1 | 0 | 3 |

Domaines du benchmark encore sous l'objectif de 8 paires : airdrop (MerkleAirdrop) 3, assurance (InsurancePool) 4, rate limiting (RateLimiter) 6. Le bridge (CrossChainBridge) compte 3 paires spécifiques dans son groupe.

## Audit indépendant (29 septembre, soir)

Recontrôle complet des 183 paires par un script distinct du pipeline : empreintes (corpus, `.md`, paires) recalculées et identiques ; 598/598 fichiers conformes à l'empreinte amont au commit figé ; 183/183 suites passantes sans test en attente ; couverture de la cible principale (vérifiée par nom) min 80,0 %, médiane 100 % ; fuite vers le benchmark recalculée, aucune au-dessus de 0,6 ; conventions statiques respectées ; même environnement figé pour toutes les paires.

Correction appliquée : `pong-tournament--mc-putchar` n'avait pas de fichier de licence copié, le dépôt nommant son fichier `UNLICENSE` (licence Unlicense confirmée). L'importeur reconnaît désormais `UNLICENSE`, la paire a été réimportée (seul le fichier LICENSE s'ajoute) et revalidée. Le validateur passe en v3 : il rejette toute paire sans fichier de licence, règle jusque-là appliquée à la sélection seulement. Les 182 autres paires restent validées en v2 ; elles satisfont toutes la règle v3. L'empreinte du corpus est inchangée (elle porte sur les `.md` indexés, qui n'incluent pas la licence) ; le manifeste précédent est conservé dans `corpus_manifest_v183_pre_licence_fix.json`.

Essai solc 0.8.28/0.8.29 (29 septembre) : les compilateurs ont été ajoutés temporairement, uniquement pour les runs dont le pragma l'exige (Hardhat prenant le compilateur le plus récent compatible, un ajout global aurait fait passer tous les fichiers `^0.8.x`, benchmark compris, de 0.8.24 à 0.8.29). Les 4 paires bloquées compilent alors, mais aucune n'est recevable : `dutch-auction--jcb82` et `vickrey-auction--jcb82` sont un gabarit de cours dont les tests attendent l'implémentation des étudiants (8/8 et 10/11 en échec), `campaign-factory--anjanaed` dépasse 24 Ko sans optimiseur (96/97 en échec), `auction--sammmmx` a 1 test d'origine en échec. La configuration figée a été restaurée à l'identique (`hardhat.config.js` `41e6b438…`) ; leurs `validation.json` gardent ces rejets, plus informatifs que l'échec de compilation.

Audit rejoué sur les 200 paires (30 septembre) : mêmes contrôles, tous conformes ; couverture de la cible principale min 71,05 %, médiane 100 % ; aucun nouveau quasi-doublon interne.

Lot v5 (30 septembre) : 4 agents de recherche, règles de présélection resserrées d'après les causes de rejet antérieures (fichier de licence, imports de tests, pragma ≤ 0.8.24, taille sans optimiseur) ; deux agents ont en outre exécuté les suites dans une copie du projet figé avant de proposer. 28 candidats, 25 acceptés (le lot ciblé assurance/airdrop/rate limiting/bridge n'a produit qu'un candidat, rejeté ; recherche GitHub bridée par un HTTP 429 d'une heure). Audit rejoué sur les 225 paires : tous contrôles conformes, couverture min 71,05 %, médiane 98,67 %.

## Limites à déclarer

- Paires transformées (102/225 pour les tests) : tests humains modifiés mécaniquement, sans changement de comportement, validés après transformation.
- Couverture calculée sur la seule cible principale ; mutation non mesurée à ce stade. Seuil relâché à 70 % après collecte (17 paires entre 70 % et 80 %) : décision prise avant génération, à déclarer comme telle.
- Paires d'un même dépôt corrélées ; la limite de 3 paires par dépôt ne borne pas les auteurs : 186 auteurs distincts, `sergio11` en fournit 6 (5 dépôts), `donguillotine` 5 (plusieurs dépôts), et `bharat3645` deux versions successives d'un même contrat `Job` (similarité 0,45). 30 paires d'authorship douteuse, conservées par décision explicite.
- `agent-subscriptions-v2--andrerserrano` : la suite passe (73/73), mais lors du run de couverture 2 tests de consommation de gas échouent, l'instrumentation augmentant le gas (230 316 contre un plafond de 230 000). La couverture est mesurée sur ce run.
- Fuite la plus proche : `baltpayment-vault--jxlabsok`, 0,597 contre `Token.sol` (seuil 0,6), due à sa dépendance `MockERC20.sol` et non à la cible principale.
- Recherche automatisée par agents ; recall inconnu, biais vers les dépôts récents (2023–2026) avec licence déclarée. Les lots ciblés ajoutent un biais de sélection vers les domaines du benchmark, voulu, à déclarer.
