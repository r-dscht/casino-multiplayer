# Spelersdata, Bank, Offline Loterij & Testkaart

## Opslag & Spelerbeheer (`server/game/` en `server/data/`)
- `server/game/playerManager.js` (`PlayerManager`):
  - Beheert live sessies (`players` Map) en opgeslagen accounts (`accounts` Map op lowercase `usernameKey`).
  - Persist als `players.json` in `server/data/` (in testomgeving met `NODE_ENV=test` of `storagePath: false` uitgeschakeld).
  - Belangrijkste methodes: `authSession`, `registerPlayer`, `addChips`, `deductChips`, `updatePlayerStats`, `getGlobalLeaderboard`, `restoreLeaderboardBackup`, `scheduleSave`, `flushToDiskSync`, `saveAccounts`.
- `server/game/bankManager.js` (`BankManager`):
  - Persist P2P-leningen, notificaties en rad-cooldowns als `bank.json` in `server/data/`.
  - `processWinRepayment(borrowerPlayerId, netWin)` ondersteunt zowel online spelers als offline opgeslagen `accounts` en keert automatisch afgeloste bedragen uit aan de uitlener.
- `server/game/lotteryEngine.js` (`LotteryEngine`):
  - Persist gezamenlijke Krasloten-pot (`pot`), verkochte loten (`totalTickets`), `totalLossContributions` (`1%` uit casinoverlies via `onHouseNetLoss`), winnaarsgeschiedenis en per-speler loten in `lottery.json`.
  - Directe 3x3 Match-3 afhandeling via `buyTickets(playerId, count)` (zonder wachttijd/countdown), automatische banklening-aflossing op nettowinst en `RESET_FLOOR_POT` herstart na een `100%` Jackpot.
- `server/data/`: runtime JSON-bestanden (`players.json`, `bank.json`, `lottery.json`) en genegeerde testmappen (`.gitignore`: `server/data/test_*`, `.dockerignore`: `.agents`, `tests`).

## Testsuite-kaart (`tests/`)
Gebruik gerichte paden voor snelle feedback en sluit altijd af met `npm test`:
- **Projectnavigatie & Docs**: `tests/unit/projectNavDocs.test.js`
- **Roulette & Defense**: `tests/unit/rouletteMath.test.js`, `tests/unit/rouletteEngine.test.js`, `tests/unit/socketDefense.test.js`, `tests/integration/socketEvents.test.js`, `tests/e2e/e2e_tier1_features.test.js`, `tests/e2e/e2e_tier2_boundaries.test.js`, `tests/e2e/e2e_tier3_combinations.test.js`, `tests/e2e/e2e_tier4_scenarios.test.js`
- **Blackjack**: `tests/unit/blackjackDeck.test.js`, `tests/unit/blackjackRules.test.js`, `tests/unit/blackjackEngine.test.js`, `tests/integration/blackjackEngineLoop.test.js`, `tests/integration/blackjackSockets.test.js`, `tests/e2e/e2eCasinoBlackjackSuite.test.js`
- **Poker**: `tests/unit/pokerDeck.test.js`, `tests/unit/pokerRules.test.js`, `tests/unit/pokerPotManager.test.js`, `tests/unit/pokerEngine.test.js`, `tests/integration/pokerBetLock.test.js`, `tests/integration/pokerBuyInCashout.test.js`, `tests/integration/pokerSockets.test.js`, `tests/stress/adversarialPokerMath.test.js`, `tests/stress/adversarialPokerSockets.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js`
- **Nieuwe spellen (Crash, Plinko, Slots, Racing, Hi-Lo, Mines, Boulevard Cross, AviaMasters)**: `tests/crashEngine.test.js`, `tests/unit/plinkoEngine.test.js`, `tests/unit/slotsEngine.test.js`, `tests/unit/racingEngine.test.js`, `tests/unit/hiloEngine.test.js`, `tests/integration/hiloSocket.test.js`, `tests/unit/minesEngine.test.js`, `tests/integration/minesSocket.test.js`, `tests/unit/crossEngine.test.js`, `tests/integration/crossSocket.test.js`, `tests/unit/aviaEngine.test.js`, `tests/integration/aviaSocket.test.js`, `tests/e2e/e2eNewCasinoGamesSuite.test.js`
- **Staatsloterij, Bank, Sessie & UI/Locks**: `tests/unit/lotteryEngine.test.js`, `tests/integration/lotterySocket.test.js`, `tests/unit/versionSync.test.js`, `tests/unit/bankManager.test.js`, `tests/integration/bankSockets.test.js`, `tests/unit/playerManager.test.js`, `tests/unit/accountPersistence.test.js`, `tests/unit/sessionPersistence.test.js`, `tests/integration/playerProfileSockets.test.js`, `tests/integration/sessionAndStatusRegression.test.js`, `tests/integration/betLockPresence.test.js`, `tests/integration/chatRouting.test.js`, `tests/unit/backlogNavigation.test.js`, `tests/unit/clientUiUx.test.js`, `tests/unit/globalLeaderboard.test.js`, `tests/unit/bugFixesRegression.test.js`, `tests/unit/tunnel.test.js`, `tests/integration/serverRoute.test.js`, `tests/stress/adversarialChallenge.test.js`
- **Standalone M1-script** (valt buiten `npm test` glob `tests/**/*.test.js`): `tests/challenge/challenge_m1_2.js`
