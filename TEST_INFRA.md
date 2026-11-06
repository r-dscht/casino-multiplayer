# Monte Carlo Royale Multiplayer Casino — Test Infrastructure Specification

## 1. Overview & Test Philosophy
This document outlines the testing architecture, harness design, execution protocol, and verification standards for the **Monte Carlo Royale Luxury Multiplayer Casino** web application (`casino-multiplayer`), encompassing **European Roulette**, **Multiplayer Blackjack**, **Persistent Session Management**, **Navigation Bet Lock**, **Tabbed Chat**, and **100% Silent Luxury Aesthetics**.

### Core Test Principles:
1. **Opaque-Box & Requirement-Driven**: Tests interact with the casino application strictly from the outside—via HTTP/REST endpoints, typed Socket.io WebSocket connections, public interface contracts, and filesystem audits.
2. **Zero Facade / No Cheating**: All tests execute genuine mathematical and state machine logic. No trivial assertions (`assert.ok(true)`), no hardcoded passes, and no bypassed business logic.
3. **Progressive Testability**: Tests are designed to be self-contained and independently verifiable across parallel development tracks. Tests can dynamically verify newly landing modules while validating interface contracts and mathematical invariants without stalling or failing.
4. **Strict Guardrails Enforcement**: Automated forensic scanners enforce 100% silent design (zero audio files, zero Web Audio API), zero unicode emojis, and complete brand sanitization (zero GTA references).
5. **Zero External Test Dependencies**: Built entirely on Node.js's native test runner (`node:test`) and assertion library (`node:assert/strict`), executing hundreds of tests in milliseconds without heavy third-party framework overhead.

---

## 2. Test Architecture

The testing architecture is organized into unit, integration, and opaque-box end-to-end layers:

```
casino-multiplayer/
├── tests/
│   ├── unit/
│   │   ├── rouletteMath.test.js          # Pure Roulette math, 37 pockets, 2.7027% house edge
│   │   ├── rouletteEngine.test.js        # Roulette state transitions (BETTING, SPINNING, PAYOUT)
│   │   ├── playerManager.test.js         # Player registry, 10,000 chip bankroll, atomic ledger
│   │   ├── bankManager.test.js           # P2P transfers, loan agreements, win deduction amortizations
│   │   ├── accountPersistence.test.js    # Disk storage, password authentication
│   │   ├── socketDefense.test.js         # Malformed payloads, rate-limiting, crash defense
│   │   └── tunnel.test.js                # Cloudflare Quick Tunnel extraction & bypass logic
│   ├── integration/
│   │   ├── serverRoute.test.js           # HTTP endpoints, static delivery, silent & brand audit
│   │   ├── socketEvents.test.js          # Socket connection, betting, payouts, chat broadcasts
│   │   ├── playerProfileSockets.test.js  # Profile fetching, avatar/color customization
│   │   └── bankSockets.test.js           # P2P loan socket events & notifications
│   └── e2e/
│       ├── harness.js                    # Ephemeral test server & instrumented Socket client
│       ├── e2e_tier1_features.test.js    # Roulette Tier 1: Feature Coverage (38 tests)
│       ├── e2e_tier2_boundaries.test.js  # Roulette Tier 2: Boundary & Corner Cases (30 tests)
│       ├── e2e_tier3_combinations.test.js# Roulette Tier 3: Cross-Feature Interactions (9 tests)
│       ├── e2e_tier4_scenarios.test.js   # Roulette Tier 4: Real-World Scenarios (5 tests)
│       └── e2eCasinoBlackjackSuite.test.js # Comprehensive 4-Tier Blackjack & Casino Suite (58 tests)
```

---

## 3. Feature Inventory Coverage Matrix

The matrix below maps all 44 features from `PROJECT.md` to their corresponding automated test suites:

| # | Feature Name | Primary Scope | Test Suite Location | Coverage Type |
|---|---|---|---|---|
| 1 | Dedicated Project Directory | Root layout | `tests/integration/serverRoute.test.js` | Integration |
| 2 | Brand Sanitization & Luxury Styling | Theme/Copy | `tests/integration/serverRoute.test.js`, `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Audit |
| 3 | 100% Silent Client ("geen audio") | Audio removal | `tests/integration/serverRoute.test.js`, `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Forensic |
| 4 | Low-Poly Procedural 3D Wheel | Three.js geometry | `tests/integration/serverRoute.test.js` | Integration |
| 5 | Single-Texture Pocket Atlas | Canvas atlas | `tests/integration/serverRoute.test.js` | Integration |
| 6 | Dual-Rate Thermal Throttling | 30/60 FPS clamp | `tests/integration/serverRoute.test.js` | Integration |
| 7 | Synchronized Animation Physics | Ball trajectory | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 8 | Responsive Viewport & Camera | CSS/DOM | `tests/integration/serverRoute.test.js` | Integration |
| 9 | European Betting Grid | 37 pockets | `tests/unit/rouletteMath.test.js` | Unit |
| 10 | Multi-Player Chip Placement | Live board | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 11 | Player Onboarding Modal | Registration | `tests/unit/playerManager.test.js`, `tests/e2e/e2e_tier1_features.test.js` | Unit/E2E |
| 12 | 10,000 Chip Starting Balance | Bankroll | `tests/unit/playerManager.test.js`, `tests/e2e/e2eCasinoBlackjackSuite.test.js` | Unit/E2E |
| 13 | Real-Time Chat & Event Feed | Multiplayer chat | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 14 | European Roulette Math Engine | Odds & payouts | `tests/unit/rouletteMath.test.js` | Unit |
| 15 | Authoritative State Machine | Roulette phases | `tests/unit/rouletteEngine.test.js` | Unit |
| 16 | Server Clock Synchronization | Timestamps | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 17 | Real-Time Socket Protocol | Sockets | `tests/integration/socketEvents.test.js` | Integration |
| 18 | Disconnection & Edge Handling | Active bets | `tests/e2e/e2e_tier1_features.test.js`, `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E |
| 19 | Windows Cloudflare Quick Tunnel | `cloudflared` | `tests/unit/tunnel.test.js` | Unit |
| 20 | 1-Click Cloud Deployment | Docker/Render | `tests/integration/serverRoute.test.js` | Integration |
| 21 | Automated Unit & Integration Tests| Core engine | `tests/unit/*.test.js`, `tests/integration/*.test.js` | Full Suite |
| 22 | Requirement-Driven E2E Suite | 4-Tier E2E | `tests/e2e/*.test.js` | E2E |
| 23 | Persistent Session Authentication | Bearer tokens | `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/unit/sessionPersistence.test.js` | Unit/E2E |
| 24 | Resilient Atomic Disk Storage | `players.json` | `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/unit/sessionPersistence.test.js` | Unit/E2E |
| 25 | Refresh Session Auto-Recovery | Browser reload | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 3 |
| 26 | Multi-Game Player Presence | Lobby/Roulette/BJ | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 27 | Server Navigation Bet Lock | Active bets | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 3 |
| 28 | 6-Deck Cryptographic Shoe | 312 cards | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 29 | Pure Blackjack Math & Scoring | Dynamic Ace/S17 | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 2 |
| 30 | Standard Blackjack Player Actions | Hit/Stand/Dbl/Splt | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 2 |
| 31 | Authoritative S17 Dealer AI | Dealer hits <=16 | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 2 |
| 32 | 5-Seat State Machine & Turn Timers| Clockwise turns | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 2 |
| 33 | Dealer Hole Card Masking | Anti-cheat | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 34 | Enhanced Avatar & Monogram System| Monograms | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 35 | Active Turn & Seated Status Badges| Turn pulses | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 36 | Semicircular 5-Seat Blackjack Arc | Table seats | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 4 |
| 37 | Tabbed Casino Chat System | Global/Table | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 3 |
| 38 | Zero Emoji & Pure SVG Card Suits | Vector suits | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 39 | 3D Card Dealing Micro-animations | Perspective flip | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 40 | Win Shimmers & Chip Balance Ticker| Ticker animation | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 4 |
| 41 | Regal Outcome Banners | Victory banners | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 42 | Client Navigation Lock Interceptor | Lock toasts | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 3 |
| 43 | Comprehensive E2E Testing Suite | Tiers 1-4 | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | Complete E2E |
| 44 | Forensic Integrity Audit | Security/Brand | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | Forensic E2E |

---

## 4. Systematic 4-Tier Opaque-Box Methodology

The E2E suite follows a rigorous 4-tier testing hierarchy in `tests/e2e/e2eCasinoBlackjackSuite.test.js`:

### Tier 1: Feature Coverage (>=5 tests per core feature)
1. **F1: Multiplayer Blackjack Table (9 tests)**:
   - Seat claiming on 5-seat table (`take_seat`), rejecting occupied seats (`SEAT_OCCUPIED`).
   - Placing bets with chip balance deductions, rejecting bets exceeding balance (`INSUFFICIENT_FUNDS`).
   - 2-card initial deal, dealer hole card masking (`{ hidden: true }`) in public payloads.
   - Hit action: card dealing from shoe, dynamic Ace calculation, bust detection (>21).
   - Stand action: hand status freezing, turn advancement.
   - Double down action: doubling bet, deducting stake, dealing exactly 1 card, automatic stand.
   - Split pairs: splitting identical ranks into two hands with matching wagers.
   - Dealer AI S17: dealer draws to 16, stands on Soft 17 [A, 6].
   - 15-second turn timeout: automatic stand anti-stall advancing clockwise.
2. **F2: Session & Persistence (5 tests)**:
   - Initial starting balance of exactly 10,000 chips.
   - Cryptographic bearer session token generation (`cst_...`).
   - Reconnecting with token restores exact account without resetting chips or re-granting 10k chips.
   - Preservation of stats (`roundsPlayed`, `totalWon`, `biggestWin`) and customizations.
   - Resilient atomic disk storage write-through and process restart survival.
3. **F3: Navigation Bet Lock (5 tests)**:
   - Detection of active unresolved bets on Roulette table (`hasActiveBets === true`).
   - Detection of active unresolved bets on Blackjack table.
   - Rejection of room navigation with typed error `CANNOT_LEAVE_ACTIVE_BETS`.
   - Bet lock immediate release upon `clear_bets` in betting phase.
   - Bet lock release upon round settlement and payout.
4. **F4: Tabbed Casino Chat (5 tests)**:
   - Global channel broadcasting to all connected sockets (`casino:global`).
   - Table channel scoping to active game room (`table:blackjack`, `table:roulette`).
   - Room isolation: Roulette players do not receive Blackjack table chat.
   - Circular buffer memory safety: 50-message cap with FIFO order.
   - Non-emoji system announcements (`[BLACKJACK]`, `[CASINO]`, `[GRAND WIN]`).
5. **F5: Guardrails (0 Audio, 0 Emojis, Luxury Theme) (5 tests)**:
   - Zero audio files anywhere in the repository (`.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`).
   - Zero Web Audio API usage in client JavaScript (`AudioContext`, `createOscillator`, `<audio>`).
   - Zero unicode emoji characters in client code (HTML, JS, CSS).
   - Card suits authored strictly as SVG vector symbols (`#suit-spade`, `#suit-heart`, etc.).
   - Brand sanitization: zero references to GTA / Grand Theft Auto across client and server.

### Tier 2: Boundary & Corner Cases (>=5 tests per area)
1. **B1: Natural Blackjack (Ace + 10) 3:2 Payouts (5 tests)**:
   - 3:2 payout evaluation (+1.5x profit, 2.5x gross return).
   - Multi-card 21 (e.g. 7-7-7) pays 1:1, strictly beaten by dealer Natural Blackjack.
   - Split hand reaching 21 is marked `isSplitHand = true` and pays 1:1, NOT 3:2.
   - Natural Blackjack vs Natural Blackjack resolves to PUSH (stake returned).
   - Natural Blackjack strictly beats dealer 3-card 21.
2. **B2: Soft 17 vs Hard 17 Dealer Behavior (5 tests)**:
   - Dealer Soft 17 [A, 6] stands immediately under S17 rules.
   - Dealer Hard 17 [10, 7] stands immediately.
   - Dealer Soft 16 [A, 5] must draw additional cards.
   - Multi-Ace dealer hand [A, A, 5] evaluates as Soft 17 and stands.
   - Dealer bust (e.g. 24) awards all unbusted players 1:1 win regardless of total.
3. **B3: Split Aces Restricted to 1 Card & Auto-Stand (5 tests)**:
   - Splitting pair of Aces deducts equal secondary wager.
   - Split Ace Hand 0 receives exactly 1 card and automatically stands.
   - Split Ace Hand 1 receives exactly 1 card and automatically stands.
   - Additional hit on split Ace is rejected (`ACTION_NOT_ALLOWED`).
   - Double down on split Ace is rejected (`ACTION_NOT_ALLOWED`).
4. **B4: Turn Timer Expiration Anti-Stall (5 tests)**:
   - Countdown to 0s triggers `autoStand` without table stall.
   - Auto-stand advances active turn clockwise to next seated player.
   - Last seated player auto-stand advances round to `DEALER_TURN`.
   - AFK player standing on 12 still wins if dealer busts.
   - Auto-stand on split Hand 0 advances to split Hand 1.
5. **B5: Disconnection During Active Bet (5 tests)**:
   - Active bet remains locked and active on table when player socket drops.
   - Engine authoritatively completes round and resolves payouts for disconnected player.
   - Winnings are credited directly to persistent account ledger.
   - Reconnecting with session token retrieves updated bankroll with credited winnings.
   - Losses during disconnect forfeit stake and write through accurately to disk.

### Tier 3: Cross-Feature Combinations (3 tests)
- **C1: Blackjack Bet Blocks Roulette Navigation**: Active bet blocks `player_set_game('Roulette')` with `CANNOT_LEAVE_ACTIVE_BETS`; allowed once round concludes.
- **C2: Table Chat Room Isolation**: Table messages restricted to active table room; global messages delivered to all connected players across rooms.
- **C3: Session Reload While Seated**: Browser refresh with session token preserves seat occupancy, active stake, and chip balance.

### Tier 4: Real-World Application Workloads (1 comprehensive scenario)
- **W1: 3-Player Concurrent Multiplayer Round**:
  - Alice (Seat 0, bets 500), Bob (Seat 2, bets 1000), Charlie (Seat 4, bets 250) seated concurrently.
  - Alice dealt [8, 3] = 11, doubles down (bet becomes 1000), draws 10 -> stands on 21.
  - Bob dealt [10, 6] = 16, hits, draws 3 -> stands on 19.
  - Charlie dealt [9, 9] = 18, stands on 18.
  - Dealer reveals [10, 6] = 16, draws 8 -> 24 (Busts!).
  - Payouts: Alice wins 2,000 chips (doubled bet), Bob wins 2,000 chips, Charlie wins 500 chips.
  - Atomic disk persistence: All 3 accounts updated and verified on disk (`players.json`).

---

## 5. Test Harness Design (`tests/e2e/harness.js`)
The test harness provides ephemeral in-process server management on port 0 (`127.0.0.1:0`), guaranteeing zero port collisions and instant socket teardown. It provides typed, promise-based client wrappers (`createTestClient`) with `waitFor(event)`, `waitForNext(event)`, `placeBet`, `clearBets`, and `sendChat`.

---

## 6. How to Run the Tests

```bash
# 1. Run the new E2E Casino Blackjack & Persistence Suite (Tiers 1–4):
node --test tests/e2e/e2eCasinoBlackjackSuite.test.js

# 2. Run existing Roulette E2E Suites:
node --test tests/e2e/e2e_tier1_features.test.js
node --test tests/e2e/e2e_tier2_boundaries.test.js
node --test tests/e2e/e2e_tier3_combinations.test.js
node --test tests/e2e/e2e_tier4_scenarios.test.js

# 3. Run all E2E Tests:
node --test tests/e2e/*.test.js

# 4. Run entire project test suite:
npm test
```
