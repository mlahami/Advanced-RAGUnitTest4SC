# Index du corpus v2 — version 1 (30 septembre 2026)

Construit par `build_corpus_v2_index.py` à partir du corpus figé (225 paires, `5cabf7d0…`, vérifié contre `CORPUS_FROZEN.json` et contre les fichiers validés de chaque paire). Aucune génération, aucun appel d'API.

## Unités

| Type | Nombre | Indexé | Texte fourni au prompt |
|---|---:|:-:|---|
| fonction / modificateur Solidity | 3 513 | oui | la fonction, précédée de la paire, du fichier et du rôle (cible ou dépendance) |
| cas de test `it()` | 4 260 | oui | le test **avec son setup** : `require`, déclarations référencées (fixtures, variables, constantes, fermeture transitive), hooks `before`/`beforeEach` des suites englobantes |
| fichier source entier | 758 | non | conservé pour la traçabilité |

- 758/758 fichiers analysés par les parseurs stricts (Solidity 0.20.2, Babel), aucun recours au scanner lexical.
- Texte embarqué d'un test : chemin des `describe`, titre et bloc `it()` seulement ; le setup n'est pas embarqué. 815/7 773 textes dépassent 256 tokens et sont tronqués par l'encodeur. Le texte fourni au prompt n'est jamais tronqué (test : médiane 1 611 caractères, p90 2 817, max 9 867).
- Liens test → fonction (statiques, heuristiques) : 3 826/4 260 tests appellent au moins une fonction de leur paire, dont 3 716 la cible principale. 1 501/2 298 fonctions de cible principale sont appelées par au moins un test.
- Étiquettes heuristiques (`heuristic_not_validated`) : types de test (positif, revert, événement, limite, temps, accès, solde) et rôles de fonction (paiement, contrôle d'accès, temporel, événements, revert, lecture/écriture).

## Rejeu du retrieval sur les 14 contrats de développement (contrôle de cohérence)

Top 10, budget de 15 000 caractères, requête construite comme dans le serveur figé. « Domaine » : part des extraits dont le groupe de domaines correspond au contrat (Counter et SimpleStorage exclus, faute de domaine applicatif). Ce n'est pas une mesure de pertinence : un mock ERC20 d'une paire de staking peut être utile pour Token sans être du bon domaine. L'annotation de pertinence (spécification § 8, étape 5) reste à faire.

| Configuration | Domaine | Part de tests | Paires distinctes (moy.) |
|---|---:|---:|---:|
| dense, requête complète (baseline) | 80/116 | 58/136 | 5,4 |
| dense, code cible seul | 63/120 | 1/140 | 6,6 |
| hybride (BM25 + dense, RRF) | 80/119 | 41/137 | 5,4 |
| hybride, code cible seul (branche dense) | 74/120 | 8/140 | 6,1 |
| hybride + cross-encoder | 62/105 | 116/125 | 5,1 |

Constats :
1. Sans reranker, le retrieval renvoie surtout des **fonctions** de contrats du corpus, et presque exclusivement avec la requête « code cible seul » (le code appelle du code). Or ce sont les tests qui portent l'information utile au générateur.
2. Le cross-encoder renverse la proportion (93 % de tests), mais perd en domaine (TimelockVault 0/9).
3. Token et MetaCoin retrouvent rarement le groupe « jetons fongibles » : les fonctions ERC20 sont réparties dans les mocks de nombreux groupes.

## Règle retenue : pivot fonction → tests (option b, décision du 30 septembre)

Fonctions et tests restent indexés ; le prompt ne reçoit que des tests. Un test retrouvé est fourni tel quel ; une fonction retrouvée est remplacée par au plus 2 tests qui l'appellent (les plus ciblés d'abord : moins de fonctions de la paire appelées, puis ordre du fichier) ; une fonction sans test lié est ignorée ; pas de doublon. La règle (`TestPivotRetriever`) enveloppe n'importe quel retriever et s'applique à l'identique à RAG v2 et Advanced v2.

| Configuration + pivot | Domaine | Part de tests | Tests obtenus via une fonction | Contexte moyen |
|---|---:|---:|---:|---:|
| dense, requête complète | 80/103 | 100 % | 63/122 | 14 203 car. |
| dense, code cible seul | 64/112 | 100 % | 132/132 | 14 260 car. |
| hybride, requête complète | 81/108 | 100 % | 88/127 | 14 673 car. |
| hybride, code cible seul | 85/111 | 100 % | 123/127 | 14 190 car. |
| hybride + cross-encoder | 46/99 | 100 % | 0/118 | 14 776 car. |
| hybride code cible + cross-encoder | 53/106 | 100 % | 1/125 | 14 618 car. |

Constats :
1. Le pivot atteint son but : 100 % de tests fournis, sans perte de domaine pour le dense et l'hybride (75 à 78 % des extraits du bon groupe, contre 69 % avant).
2. Le cross-encoder (`ms-marco-MiniLM-L-6-v2`, entraîné sur des questions web) classe en tête des tests quel que soit le domaine : le pivot n'intervient plus (0 test via une fonction) et le domaine tombe à 46 %. Sur ce corpus, le reranker tel que configuré dégrade la pertinence apparente ; à confirmer par l'annotation avant d'en tirer une conclusion sur H2.
3. Avec ~1 600 caractères par test et setup, le budget de 15 000 caractères admet 7 à 10 tests par contrat (moyenne ~8,7).
4. La requête « code cible seul » ne change que la branche dense ; elle reste une variante d'ablation. Les conditions principales gardent la requête du serveur figé, pour rester comparables à RAG v1.

Fichiers : `chunks.jsonl` (catalogue), `index-report.json`, `config.json`, `embeddings.npy` (+ `.json`, empreinte des textes embarqués), `retrieval-replay-development14.json`, `retrieval-replay-summary.json`, `build.log`.
