# Spellen, Engines & RTP-Wiskunde

Alle game-logica draait server-authoritative onder `server/game/` met een bijbehorende controller in `client/js/`.

## Overzicht per Spel

| Spel | Server bestanden | Belangrijke klassen / exports | Client controller | Huisvoordeel / Model |
| :--- | :--- | :--- | :--- | :--- |
| **Roulette** | `server/game/rouletteConstants.js`, `server/game/rouletteMath.js`, `server/game/rouletteEngine.js` | `BET_TYPES`, `PHASES`, `evaluateBet`, `validateBet`, `RouletteEngine` (`transitionToBetting`, `transitionToSpinning`, `transitionToPayout`) | `client/js/three/Roulette3D.js` + `client/js/ui.js` | `2.000%` (`98.000%` RTP) via `26%` Zero Shield/Bonus op pocket `0` |
| **Blackjack** | `server/game/blackjackConstants.js`, `server/game/blackjackDeck.js`, `server/game/blackjackRules.js`, `server/game/blackjackEngine.js` | `BlackjackDeck`, `BlackjackEngine` (`takeSeat`, `placeBet`, `handleAction`, `advanceTurn`), `scoreHand` | `client/js/ui.js` (`CasinoUI`) | S17, `6` stoelen, 3-op-2 Blackjack |
| **Poker** | `server/game/pokerConstants.js`, `server/game/pokerDeck.js`, `server/game/pokerRules.js`, `server/game/pokerPotManager.js`, `server/game/pokerEngine.js` | `PokerDeck`, `PokerPotManager`, `PokerEngine` (`takeSeat`, `leaveSeat`, `rebuy`, `cashoutAllPlayersSync`), `determineWinners` | `client/js/poker.js` (`CasinoPoker`) | P2P zonder huisvoordeel (side pots, rebuy, peek-toggle) |
| **Crash** | `server/game/crashEngine.js` | `CrashEngine` (`generateCrashPoint`, `startBettingPhase`, `startRunningPhase`, `cashOut`) | `client/js/crash.js` (`CasinoCrash`) | `2%` (`98%` RTP): `2%` instant crash, curve `0.98 / (1 - u)` |
| **Plinko** | `server/game/plinkoEngine.js` | `PlinkoEngine` (`dropBalls`, `generatePath`, `normalizeRisk`, `getState`) | `client/js/plinko.js` (`CasinoPlinko`) | `~2%` (`97.5%–98.5%` RTP) voor `8–16` rijen x `low`/`medium`/`high` |
| **Slots** | `server/game/slotsConstants.js`, `server/game/slotsEngine.js` | `PAYLINES`, `PAYTABLE`, `SCATTER_REWARDS`, `evaluatePayline`, `SlotsEngine` (`selectMachine`, `spin`) | `client/js/slots.js` (`CasinoSlots`) | `~2%` (`~98%` RTP) op Normal Spin & `30x` Bonus Buy; Golden Fever zonder Juich |
| **Paardracen** | `server/game/racingConstants.js`, `server/game/racingEngine.js` | `BASE_WIN_ODDS`, `WINNER_POT_LOSER_SHARE`, `WINNER_POT_ROLLOVER_CAP_MULT`, `RacingEngine` (`placeBet`, `cancelBet`, `cheerHorse`) | `client/js/racing.js` (`CasinoRacing`) | `2%` (`98%` RTP): `3.38x` basis + `50%` Verliezers Winnaarspot (`5.0x` cap); enige spel met Juich |
| **Hi-Lo Privé** | `server/game/hiloConstants.js`, `server/game/hiloDeck.js`, `server/game/hiloEngine.js` | `TARGET_RTP`, `MAX_EV_CAP`, `calculateHiloOdds`, `evaluateGuess`, `HiloEngine` (`startLadder`, `makeGuess`, `skipCard`, `halfCashout`, `cashout`) | `client/js/hilo.js` (`CasinoHilo`) | `2%` (`TARGET_RTP = 0.98`); uitsluitend Solo Ladder + Live Zaal (geen Blitz, geen Juich) |
| **Royal Mines** | `server/game/minesConstants.js`, `server/game/minesEngine.js` | `VALID_GRID_SIDES`, `TARGET_RTP`, `MAX_EV_CAP`, `MinesEngine` (`startSolo`, `clickSoloTile`, `cashoutSolo`, `voteSharedSettings`, `joinShared`) | `client/js/mines.js` (`CasinoMines`) | `2%` (`TARGET_RTP = 0.98`); Solo + Shared Vault; `_queuedCashout` voorkomt gemiste Cash Out |
| **Staatsloterij** | `server/game/lotteryConstants.js`, `server/game/lotteryEngine.js` | `TICKET_PRICE`, `HOUSE_FEE_RATE`, `ROUND_DURATION_MS`, `DRAW_REVEAL_MS`, `buildRaffleReelEntries`, `LotteryEngine` (`buyTickets`, `tick`) | `client/js/lottery.js` (`CasinoLottery`) | `0%` (`HOUSE_FEE_RATE = 0`), `2.500 F`/lot, `10-min` cyclus, `64` reel-kaarten (`winnerSlot = 52`) |

## Navigatie-locks (Cross-Game Contract)
Elke actieve engine implementeert `hasActiveBets(playerId)` en `getActiveBetTotal(playerId)`. Zodra een speler actieve inzetten of een lopende ronde heeft (bv. Solo Ladder, open Mines-kluis, Derby-ticket, niet-gefolde Poker-hand, Blackjack-inzet of Crash-inzet), blokkeert `canPlayerNavigate` in `server/socket.js` de spelwissel tot settlement of cashout.
