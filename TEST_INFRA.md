# Monte Carlo Royale Multiplayer Casino — Test Infrastructure Specification

## 1. Overview & Test Philosophy
This document outlines the testing architecture, harness design, execution protocol, and verification standards for the **Monte Carlo Royale Luxury Multiplayer Casino** web application (`casino-multiplayer`), encompassing **European Roulette**, **6-Seat Multiplayer Blackjack**, and **Authoritative 6-Seat No-Limit Texas Hold'em Poker**, alongside **Persistent Session Management**, **Two-Tier Cash Game Wallet**, **Navigation Bet Lock**, **Tabbed Chat**, and **100% Silent Luxury Aesthetics**.

### Core Test Principles:
1. **Opaque-Box & Requirement-Driven**: Tests interact with the casino application strictly from the outside—via HTTP/REST endpoints, typed Socket.io WebSocket connections, public interface contracts, and filesystem audits.
2. **Zero Facade / No Cheating**: All tests execute genuine mathematical and state machine logic. No trivial assertions (`assert.ok(true)`), no hardcoded passes, and no bypassed business logic. Every test asserts authoritative expected outputs derived from mathematical ground truth and official game rules.
3. **Progressive Testability**: Tests are designed to be self-contained and independently verifiable across parallel development tracks. Tests dynamically verify newly landing modules while validating interface contracts and mathematical invariants without stalling or failing.
4. **Systematic Test Design Methodologies**: Test scenarios are derived using formal software engineering methodologies:
   - **Category-Partition Testing**: Partitioning input domains, table configurations, player actions, and wallet operations into exhaustive, mutually exclusive equivalence classes.
   - **Boundary Value Analysis (BVA)**: Probing off-by-one limits, minimum raise deltas, short-stack all-ins, exact stack zeroes, wheel and broadway straights, odd chip distributions, and heads-up transitions.
   - **Pairwise & Combinatorial Testing**: Verifying interactions across orthogonal features—multi-way unequal all-ins with side pots, dead money retention, turn timer countdown anti-stall, mid-hand disconnect/reconnect, and multi-game navigation bet locks.
   - **Workload & Stress Testing**: Simulating realistic multi-player concurrent cash games with full hand progressions, rebuys, showdown distributions, and atomic disk persistence.
5. **Strict Guardrails Enforcement**: Automated forensic scanners enforce 100% silent design (zero audio files, zero Web Audio API, zero `<audio>` elements), zero unicode emojis (pure SVG card suits), and complete brand sanitization (zero GTA references).
6. **Zero External Test Dependencies**: Built entirely on Node.js's native test runner (`node:test`) and assertion library (`node:assert/strict`), executing hundreds of tests in milliseconds without heavy third-party framework overhead.

---

## 2. Test Architecture

The testing architecture is organized into unit, integration, and opaque-box end-to-end layers across all casino game modules:

```
casino-multiplayer/
├── tests/
│   ├── unit/
│   │   ├── rouletteMath.test.js          # Pure Roulette math, 37 pockets, 2.7027% house edge
│   │   ├── rouletteEngine.test.js        # Roulette state transitions (BETTING, SPINNING, PAYOUT)
│   │   ├── blackjackRules.test.js        # Dynamic Ace 1/11 valuation, Soft 17 rules, bust detection
│   │   ├── blackjackDeck.test.js         # 6-deck shoe (312 cards), crypto Fisher-Yates shuffle
│   │   ├── blackjackEngine.test.js       # S17 6-seat blackjack state machine, dealer AI, turn timers
│   │   ├── pokerDeck.test.js             # 52-card deck, crypto Fisher-Yates shuffle, burn cards
│   │   ├── pokerRules.test.js            # 7-card evaluator, 10 hand ranks, wheel straight, tie-breakers
│   │   ├── pokerPotManager.test.js       # Side pots, multiple all-ins, dead money, odd chips
│   │   ├── pokerEngine.test.js           # 6-seat NL state machine, action validation, delta-raise, turn timeout
│   │   ├── playerManager.test.js         # Player registry, 10,000 chip bankroll, atomic ledger
│   │   ├── bankManager.test.js           # P2P transfers, loan agreements, win deduction amortizations
│   │   ├── accountPersistence.test.js    # Disk storage, password authentication
│   │   ├── sessionPersistence.test.js    # Bearer tokens, atomic swap, auto-recovery
│   │   ├── clientUiUx.test.js            # Monogram generation, 12-hue palette, toast messages
│   │   ├── socketDefense.test.js         # Malformed payloads, rate-limiting, crash defense
│   │   └── tunnel.test.js                # Cloudflare Quick Tunnel extraction & bypass logic
│   ├── integration/
│   │   ├── serverRoute.test.js           # HTTP endpoints, static delivery, silent & brand audit
│   │   ├── socketEvents.test.js          # Socket connection, betting, payouts, chat broadcasts
│   │   ├── playerProfileSockets.test.js  # Profile fetching, avatar/color customization
│   │   ├── bankSockets.test.js           # P2P loan socket events & notifications
│   │   ├── pokerSockets.test.js          # Multi-player seat join, betting rounds, hole card masking
│   │   ├── pokerBuyInCashout.test.js     # Two-tier wallet buy-in, rebuys, and clean cashout to playerManager
│   │   └── pokerBetLock.test.js          # Navigation bet lock on active poker hands
│   └── e2e/
│       ├── harness.js                    # Ephemeral test server & instrumented Socket client
│       ├── e2e_tier1_features.test.js    # Roulette Tier 1: Feature Coverage (38 tests)
│       ├── e2e_tier2_boundaries.test.js  # Roulette Tier 2: Boundary & Corner Cases (30 tests)
│       ├── e2e_tier3_combinations.test.js# Roulette Tier 3: Cross-Feature Interactions (9 tests)
│       ├── e2e_tier4_scenarios.test.js   # Roulette Tier 4: Real-World Scenarios (5 tests)
│       ├── e2eCasinoBlackjackSuite.test.js # Comprehensive 4-Tier Blackjack & Casino Suite (58 tests)
│       └── e2eCasinoPokerSuite.test.js   # Comprehensive 4-Tier Texas Hold'em Poker Suite (70+ tests)
```

---

## 3. Feature Inventory Coverage Matrix

The matrix below maps all 71 features from `PROJECT.md` to their corresponding automated test suites:

| # | Feature Name | Primary Scope | Test Suite Location | Coverage Type |
|---|---|---|---|---|
| 1 | Dedicated Project Directory | Root layout | `tests/integration/serverRoute.test.js` | Integration |
| 2 | Brand Sanitization & Luxury Styling | Theme/Copy | `tests/integration/serverRoute.test.js`, `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Audit |
| 3 | 100% Silent Client ("geen audio") | Audio removal | `tests/integration/serverRoute.test.js`, `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Forensic |
| 4 | Low-Poly Procedural 3D Wheel | Three.js geometry | `tests/integration/serverRoute.test.js` | Integration |
| 5 | Single-Texture Pocket Atlas | Canvas atlas | `tests/integration/serverRoute.test.js` | Integration |
| 6 | Dual-Rate Thermal Throttling | 30/60 FPS clamp | `tests/integration/serverRoute.test.js` | Integration |
| 7 | Synchronized Animation Physics | Ball trajectory | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 8 | Responsive Viewport & Camera | CSS/DOM | `tests/integration/serverRoute.test.js` | Integration |
| 9 | European Betting Grid | 37 pockets | `tests/unit/rouletteMath.test.js` | Unit |
| 10 | Multi-Player Chip Placement | Live board | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 11 | Player Onboarding Modal | Registration | `tests/unit/playerManager.test.js`, `tests/e2e/e2e_tier1_features.test.js` | Unit/E2E |
| 12 | 10,000 Chip Starting Balance | Bankroll | `tests/unit/playerManager.test.js`, `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 13 | Real-Time Chat & Event Feed | Multiplayer chat | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 14 | European Roulette Math Engine | Odds & payouts | `tests/unit/rouletteMath.test.js` | Unit |
| 15 | Authoritative State Machine | Roulette phases | `tests/unit/rouletteEngine.test.js` | Unit |
| 16 | Server Clock Synchronization | Timestamps | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 17 | Real-Time Socket Protocol | Sockets | `tests/integration/socketEvents.test.js` | Integration |
| 18 | Disconnection & Edge Handling | Active bets | `tests/e2e/e2e_tier1_features.test.js`, `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E |
| 19 | Windows Cloudflare Quick Tunnel | `cloudflared` | `tests/unit/tunnel.test.js` | Unit |
| 20 | 1-Click Cloud Deployment | Docker/Render | `tests/integration/serverRoute.test.js` | Integration |
| 21 | Automated Unit & Integration Tests| Core engine | `tests/unit/*.test.js`, `tests/integration/*.test.js` | Full Suite |
| 22 | Requirement-Driven E2E Suite | 4-Tier E2E | `tests/e2e/*.test.js` | E2E |
| 23 | Persistent Session Authentication | Bearer tokens | `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/unit/sessionPersistence.test.js` | Unit/E2E |
| 24 | Resilient Atomic Disk Storage | `players.json` | `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/unit/sessionPersistence.test.js` | Unit/E2E |
| 25 | Refresh Session Auto-Recovery | Browser reload | `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 & 3 |
| 26 | Multi-Game Player Presence | Lobby/Roulette/BJ/Poker | `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 27 | Server Navigation Bet Lock | Active bets | `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 & 3 |
| 28 | 6-Deck Cryptographic Shoe | 312 cards | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 29 | Pure Blackjack Math & Scoring | Dynamic Ace/S17 | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 2 |
| 30 | Standard Blackjack Player Actions | Hit/Stand/Dbl/Splt | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 2 |
| 31 | Authoritative S17 Dealer AI | Dealer hits <=16 | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 2 |
| 32 | 6-Seat State Machine & Turn Timers| Clockwise turns | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 2 |
| 33 | Dealer Hole Card Masking | Anti-cheat | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 34 | Enhanced Avatar & Monogram System| Monograms | `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/unit/clientUiUx.test.js` | E2E Tier 1 |
| 35 | Active Turn & Seated Status Badges| Turn pulses | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 36 | Semicircular 6-Seat Blackjack Arc | Table seats | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 4 |
| 37 | Tabbed Casino Chat System | Global/Table | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 3 |
| 38 | Zero Emoji & Pure SVG Card Suits | Vector suits | `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 39 | 3D Card Dealing Micro-animations | Perspective flip | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 40 | Win Shimmers & Chip Balance Ticker| Ticker animation | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 4 |
| 41 | Regal Outcome Banners | Victory banners | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 42 | Client Navigation Lock Interceptor | Lock toasts | `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 & 3 |
| 43 | Comprehensive E2E Testing Suite | Tiers 1-4 | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | Complete E2E |
| 44 | Forensic Integrity Audit | Security/Brand | `tests/e2e/e2eCasinoBlackjackSuite.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Forensic E2E |
| 45 | 52-Card Cryptographic Poker Deck | Single deck & burns | `tests/unit/pokerDeck.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 46 | 7-Card Hand Evaluation Algorithm | C(7,5)=21, 10 ranks | `tests/unit/pokerRules.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 47 | Side Pot Partitioning Engine | Cumulative tiers | `tests/unit/pokerPotManager.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 48 | No-Limit Hold'em State Machine | WAITING..SHOWDOWN | `tests/unit/pokerEngine.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 49 | No-Limit Delta Raise & Reopening | Min-raise delta | `tests/unit/pokerEngine.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 50 | Authoritative Private Hole Card Masking | Anti-cheat masking | `tests/integration/pokerSockets.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Integ/E2E |
| 51 | 15s Poker Turn Timer & Anti-Stall| Auto-check/fold | `tests/unit/pokerEngine.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 52 | Two-Tier Cash Game Wallet | Buy-in/Rebuy/Cashout| `tests/integration/pokerBuyInCashout.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js`| Integ/E2E |
| 53 | Multi-Game Poker Presence Whitelist| Whitelist 'POKER' | `tests/integration/betLockPresence.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Integ/E2E |
| 54 | Backward-Compatible Bet Lock | 4th arg optional | `tests/integration/pokerBetLock.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Integ/E2E |
| 55 | Real-Time Poker Socket Protocol | Typed poker events | `tests/integration/pokerSockets.test.js` | Integration |
| 56 | Disconnect Graceful Seat Reservation| Reconnection window| `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 3 |
| 57 | Multi-Table Poker Support | poker_1, poker_2 | `tests/integration/pokerSockets.test.js` | Integration |
| 58 | Top Header Poker Navigation | #pill-poker | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 59 | 6-Seat Elliptical Felt Stage | 1080x540 felt UI | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 60 | Hero Seat Ergonomics & Badges | Radial seat layout | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 61 | Community Cards & Dynamic Pot UI | 5 card slots & pots | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 62 | Poker Action Bar & Bet Sizing Slider| Fold/Check/Bet/Raise| `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 63 | Visual Turn Timer Bar | 15s countdown bar | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 64 | Cash Game Buy-In Modal | 20 BB - 100 BB | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 65 | Poker Tabbed Chat Integration | table:poker room | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 & 3 |
| 66 | 100% Silent Poker Client | Zero audio files/APIs| `tests/e2e/e2eCasinoPokerSuite.test.js` | Guardrails |
| 67 | Zero Emoji Pure SVG Vector Suits | SVG #suit-* | `tests/e2e/e2eCasinoPokerSuite.test.js` | Guardrails |
| 68 | Monte Carlo Luxury Aesthetic | Emerald/gold theme | `tests/e2e/e2eCasinoPokerSuite.test.js` | Guardrails |
| 69 | Comprehensive Poker E2E Suite | 4-Tier Poker E2E | `tests/e2e/e2eCasinoPokerSuite.test.js` | Complete E2E |
| 70 | Regression Safety (382 Tests Pass)| Zero regressions | `tests/**/*.test.js` (npm test) | Full Suite |
| 71 | Forensic Integrity Audit | Security/Brand/Rules| `tests/e2e/e2eCasinoPokerSuite.test.js` | Audit Gate |

---

## 4. Texas Hold'em Poker Test Methodology Across Tiers 1–4

The Texas Hold'em Poker test suite in `tests/e2e/e2eCasinoPokerSuite.test.js` uses four rigorous test engineering disciplines to achieve 100% requirements and edge-case coverage:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TEXAS HOLD'EM TEST METHODOLOGY                        │
├───────────────────────────────┬─────────────────────────────────────────────┤
│ 1. Category-Partitioning      │ Equivalence classes for Seating, Blinds,    │
│    (Tier 1: Feature Coverage) │ Deals, Streets, Actions, Buy-In, Cashout    │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 2. Boundary Value Analysis    │ Off-by-one Delta Raises, Short All-Ins,     │
│    (Tier 2: Boundary/Corners) │ Exact Stacks, Wheel/Broadway, Odd Chips     │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 3. Pairwise & Combinatorial   │ Multi-Way Side Pots, Dead Money Retention,  │
│    (Tier 3: Combinations)     │ Auto-Check/Fold Anti-Stall, Bet Locks       │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 4. Workload & Simulation      │ 6-Player End-to-End Cash Game, Rebuys,      │
│    (Tier 4: Real-World)       │ Hand Rotations, Atomic Disk Persistence     │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 5. Automated Guardrails       │ 0 Audio Files/APIs, 0 Emojis, SVG Suits,    │
│    (Forensic Verification)    │ Zero GTA / Brand Sanitization               │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

### 4.1 Category-Partition Testing (Tier 1: Feature Coverage)
We partition the poker system into 7 primary functional categories, identifying parameters, environment characteristics, and valid/invalid equivalence classes with at least 5 distinct test cases per category:

1. **F1: Table Accommodating 6 Seats (5 tests)**:
   - *Valid Seat Claim*: Seating at open indices $0 \le s \le 5$ assigns player, sets seat status to `seated`, initializes table chip stack.
   - *Occupied Seat Rejection*: Claiming an already occupied seat rejects with `SEAT_OCCUPIED`.
   - *Invalid Seat Bounds*: Attempting to claim negative index, index $\ge 6$, or non-integer is rejected with `INVALID_SEAT`.
   - *Full Table Capacity*: Table supports exactly 6 simultaneous players across all seat indices 0 to 5.
   - *Seat Evacuation & Reclaim*: Leaving a seat cleanly frees the seat for another player to occupy without altering adjacent seat states.
2. **F2: Blinds Posting and Button Rotation (5 tests)**:
   - *Standard Blind Positions*: In 3+ player games, Small Blind is posted by seat left of Button, Big Blind by seat left of SB.
   - *Button Clockwise Advancement*: Button advances by +1 active seat at the start of each hand, wrapping around seat 5 to seat 0.
   - *Automatic Chip Commitment*: Blinds are automatically debited from player table stacks and committed to the pot.
   - *Short Stack Blind Posting*: A player with stack $< \text{SB}$ or $< \text{BB}$ is posted All-In for their entire stack.
   - *Inactive Seat Skipping*: Button rotation and blind assignment skip empty seats and players sitting out.
3. **F3: Hole Cards Deal (5 tests)**:
   - *2-Card Deal Distribution*: Each active player receives exactly 2 private hole cards dealt from a 52-card deck.
   - *Non-Overlapping Cards*: No card identity appears twice across any dealt hands.
   - *Public Payload Masking*: Table broadcast payloads replace opponents' hole cards with `{ hidden: true }` without exposing rank or suit.
   - *Private Delivery Isolation*: Private hole cards are delivered exclusively to the seat owner via private unicast socket message.
   - *Deck Depletion Mechanics*: Dealt cards reduce the available deck count consistently with standard 2-card round-robin dealing.
4. **F4: Flop, Turn, and River Progression (5 tests)**:
   - *Flop Burn and Deal*: Exactly 1 card is burned face down, followed by 3 community cards dealt face up.
   - *Turn Burn and Deal*: Exactly 1 card is burned face down, followed by 1 community card dealt face up (total 4 community cards).
   - *River Burn and Deal*: Exactly 1 card is burned face down, followed by 1 community card dealt face up (total 5 community cards).
   - *Street Advancement Invariant*: A new street is dealt only when every active player has acted and matched the current highest bet.
   - *Community Card Immutability*: Community cards remain immutable, public, and shared across all active participants.
5. **F5: Check, Bet, Call, Raise, and Fold Actions (6 tests)**:
   - *Check Validation*: Valid when `callAmount === 0`; rejected with `CANNOT_CHECK` when facing an uncalled wager.
   - *Bet Sizing*: Places initial round wager $\ge \text{BB}$; wagers $< \text{BB}$ rejected with `BET_TOO_SMALL`.
   - *Call Deduction*: Matches current bet, deducting exactly `currentBet - playerRoundBet` from player stack.
   - *Raise Delta Enforcement*: Increases wager above `currentBet`, enforcing legal raise increment; raises below minimum rejected with `RAISE_TOO_SMALL`.
   - *Fold Surrender*: Relinquishes hole cards, sets `isFolded = true`, excludes player from pot eligibility, and ends their action for the hand.
   - *Immediate Win on Fold*: If all active players except one fold, the last remaining player wins the entire pot immediately without showdown.
6. **F6: Buy-In from Bankroll (5 tests)**:
   - *Legal Buy-In Range*: Allows buy-ins between 20 BB and 100 BB (e.g. 2,000 to 10,000 chips for 50/100 stakes).
   - *Two-Tier Wallet Debit*: Atomic deduction from persistent account in `PlayerManager` into table stack.
   - *Under-Minimum Buy-In*: Buy-ins $< 20 \text{ BB}$ rejected with `INVALID_BUY_IN`.
   - *Over-Maximum Buy-In*: Buy-ins $> 100 \text{ BB}$ rejected with `INVALID_BUY_IN`.
   - *Insufficient Funds*: Buy-in exceeding player's available bankroll rejected with `INSUFFICIENT_FUNDS`.
7. **F7: Cashout to Bankroll (5 tests)**:
   - *Clean Exit Cashout*: Vacating seat atomically credits remaining `seat.stack` chips back to `PlayerManager` balance.
   - *Zero-Chip Bust Exit*: Exiting with 0 chips completes cleanly without creating negative balances or corrupting account state.
   - *Between-Hand Rebuys*: Rebuying between hands debits bankroll and tops up table stack up to table limit (100 BB).
   - *Stats and Persistence Write-Through*: Payouts and cashouts update persistent stats and survive server restarts.
   - *Seat Liberation*: Cashing out and leaving vacates the seat immediately for another player to claim.

---

### 4.2 Boundary Value Analysis (Tier 2: Boundary & Corner Cases)
BVA targets critical numeric thresholds and boundary conditions:

1. **B1: Minimum Raise Delta Enforcement**:
   - Formula: $\text{Min Raise To} = \text{currentBet} + \max(\text{BB}, \Delta)$, where $\Delta = \text{currentBet} - \text{previousBet}$.
   - Tests initial pre-flop raise threshold ($C = 100, \Delta = 100 \implies \min = 200$).
   - Tests multi-stage raise sequences: Bet 300, Raise to 700 ($\Delta = 400$). Next legal raise must be $\ge 1100$. Attempt to raise to 1000 is rejected with `RAISE_TOO_SMALL`.
   - Tests all-in exemption: A player holding 950 chips may go All-In despite it being below 1100.
2. **B2: All-In with Less than Minimum Bet**:
   - Short-stacked blind posting: Player with 60 chips (where BB = 100) posts All-In for 60 chips; pot manager partitions this into an initial 60-chip tier.
   - Facing a bet of 300 with only 80 chips: Calling commits all 80 chips and marks player `ALL_IN`.
   - Under-Raise Rule: An incomplete all-in raise ($\Delta_{\text{all-in}} < \Delta$) does **not** reopen the betting to players who already acted.
3. **B3: Exact Stack Call and All-In**:
   - Player stack exactly matches the required call amount (e.g. stack = 500, toCall = 500): Calling leaves exactly 0 chips and transitions status to `ALL_IN`.
   - Player stack exactly matches raise amount: Stack reaches 0 with no phantom chips or rounding artifacts.
4. **B4: Wheel Straight (A-2-3-4-5) Evaluation**:
   - Evaluates 5-high straight (`A-2-3-4-5`) with Ace low, producing tie-breaker vector $[4, 5, 0, 0, 0, 0]$.
   - Wheel straight strictly loses to 6-high straight (`2-3-4-5-6`, vector $[4, 6, 0, 0, 0, 0]$).
   - Wheel straight strictly beats Three of a Kind, Two Pair, One Pair, and High Card.
   - Wraparound sequences (`Q-K-A-2-3` and `K-A-2-3-4`) are verified as **invalid** straights (evaluated as Ace High or Pairs).
   - Wheel Straight Flush (`5s-4s-3s-2s-As`) evaluates to Straight Flush 5-High ($[8, 5, 0, 0, 0, 0]$), losing to 6-high straight flush.
5. **B5: Broadway Straight (10-J-Q-K-A) Evaluation**:
   - Evaluates 14-high straight (`10-J-Q-K-A`) with Ace high, producing tie-breaker vector $[4, 14, 0, 0, 0, 0]$.
   - Broadway straight strictly beats King-high straight (`9-10-J-Q-K`, vector $[4, 13, 0, 0, 0, 0]$).
   - Royal Flush: Broadway with identical suits evaluates to rank 9 ($[9, 14, 0, 0, 0, 0]$), strictly beating straight flushes.
6. **B6: Split Pot with Odd Chip Distribution Clockwise from Button**:
   - Two players tie with identical hands for an odd pot of 151 chips (base split: 75 chips each, remainder: 1 chip).
   - Remainder chip is awarded to the player seated closest clockwise from the Dealer Button.
   - Three players tie for 100 chips (33 each + 1 remainder): Odd chip awarded to closest clockwise player from Button.
   - Multi-chip odd distribution: 4 players tie for 102 chips (25 each + 2 odd chips): Awarded 1 chip each to the 1st and 2nd players clockwise from Button.
7. **B7: Heads-Up Button and Blind Order**:
   - Exactly 2 players seated at table.
   - Dealer Button posts Small Blind (SB) and non-button posts Big Blind (BB).
   - Pre-flop: Button acts FIRST (option to call, raise, or fold).
   - Post-flop: Non-Button (BB) acts FIRST, Button acts LAST on Flop, Turn, and River.

---

### 4.3 Pairwise & Combinatorial Testing (Tier 3: Cross-Feature Interactions)
We test orthogonal features in realistic combinatorial scenarios:

1. **C1: Multi-Way Unequal All-Ins with Multiple Side Pots**:
   - 4 players with unequal stacks: A (100 chips), B (250 chips), C (600 chips), D (1,000 chips).
   - Main Pot: $100 \times 4 = 400$ chips (eligible: A, B, C, D).
   - Side Pot 1: $(250 - 100) \times 3 = 450$ chips (eligible: B, C, D; A ineligible).
   - Side Pot 2: $(600 - 250) \times 2 = 700$ chips (eligible: C, D; A, B ineligible).
   - Uncalled bet of 400 chips refunded to Player D.
   - Showdown awards each pot to its highest-ranking eligible player independently.
2. **C2: Dead Money Retained from Folded Players**:
   - Players commit chips across pre-flop and flop. When a player folds, their committed chips are preserved in the pot tiers, but the folded player is permanently excluded from pot eligibility.
3. **C3: Turn Countdown Timer Auto-Check/Fold Anti-Stall**:
   - 15-second countdown timer runs per player turn.
   - On timeout (0s):
     - If `callAmount === 0`: Engine executes automatic **CHECK**.
     - If `callAmount > 0`: Engine executes automatic **FOLD**.
   - Game advances immediately without stalling the table.
4. **C4: Mid-Hand Disconnect Preservation and Seat Reconnect**:
   - A player dropping connection mid-hand maintains their seat and chips in play.
   - Turns auto-act without delay.
   - Reconnecting via persistent session token restores seat ownership and active table stack.
5. **C5: Navigation Bet Lock on Poker**:
   - Active player holding hole cards or committed bets is prevented from navigating away with `CANNOT_LEAVE_ACTIVE_BETS`.
   - Once the hand concludes or the player folds, the lock is lifted and room switching is permitted.

---

### 4.4 Workload & Real-World Simulation (Tier 4: End-to-End Simulation)
- **W1: 6-Player Texas Hold'em Cash Game Simulation**:
  - 6 distinct players join table with 10,000 chip accounts.
  - Each player buys in for 3,000 chips. Persistent bankrolls debited to 7,000 chips.
  - Hand 1: Blinds posted, pre-flop raises, flop checks, turn bets, river raises, and showdown settlement with flush beating two pair.
  - Rebuys: Short player tops up stack by 2,000 chips between hands.
  - Hand 2: Button advances, blinds advance, multi-way all-in occurs with main and side pots settled.
  - Clean Cashout: All players leave table; remaining stacks are atomically credited back to persistent balances in `PlayerManager` and verified on disk, proving 100% chip conservation.

---

### 4.5 Forensic Guardrails Verification
Automated static scanners verify project integrity across five non-negotiable rules:
1. **Zero Audio Files**: Scans repository for `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`, `.weba` (asserts 0 found).
2. **Zero Web Audio APIs**: Scans client JavaScript and HTML for `AudioContext`, `webkitAudioContext`, `createOscillator`, `createGain`, `<audio>`, `new Audio` (asserts 0 found).
3. **Zero Unicode Emojis**: Scans all client files (HTML, JS, CSS) for unicode emoji ranges (asserts 0 found).
4. **Vector Card Suits**: Verifies card suits are authored strictly as clean SVG symbols (`#suit-spade`, `#suit-heart`, `#suit-diamond`, `#suit-club`).
5. **Brand Sanitization**: Verifies zero GTA or Diamond Casino branding across client and server files.

---

## 5. How to Run the Tests

```bash
# 1. Run the new E2E Texas Hold'em Poker Suite (Tiers 1–4):
node --test tests/e2e/e2eCasinoPokerSuite.test.js

# 2. Run the E2E Blackjack & Casino Suite:
node --test tests/e2e/e2eCasinoBlackjackSuite.test.js

# 3. Run all E2E Tests:
node --test tests/e2e/*.test.js

# 4. Run entire casino test suite (all unit, integration, and E2E tests):
npm test
```
