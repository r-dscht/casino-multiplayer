/**
 * clientUiUx.test.js
 * Unit and structural regression suite for Milestone 3:
 * Client UI, Avatar Presence & Game Feel.
 * 
 * Verifies:
 * - Monogram generation across diverse name formats
 * - 12-hue Monte Carlo luxury palette definitions
 * - 6-seat Blackjack arc, dealer area, and shoe layout
 * - Tabbed chat DOM architecture (Global vs Table) with unread counters
 * - Pure SVG vector suit sprites (spade, heart, diamond, club)
 * - 3D card perspective and active turn pulse keyframes
 * - Navigation bet lock styling and client-side interceptors
 * - Zero audio and zero unicode emojis guardrails
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('Client UI, Avatar Presence & Game Feel (Milestone 3)', () => {
  const clientDir = path.join(__dirname, '..', '..', 'client');
  const indexHtml = fs.readFileSync(path.join(clientDir, 'index.html'), 'utf8');
  const styleCss = fs.readFileSync(path.join(clientDir, 'css', 'style.css'), 'utf8');
  const layoutCss = fs.readFileSync(path.join(clientDir, 'css', 'layout.css'), 'utf8');
  const uiJs = fs.readFileSync(path.join(clientDir, 'js', 'ui.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(clientDir, 'js', 'app.js'), 'utf8');
  const networkJs = fs.readFileSync(path.join(clientDir, 'js', 'network.js'), 'utf8');
  const pokerJs = fs.readFileSync(path.join(clientDir, 'js', 'poker.js'), 'utf8');

  describe('1. Monogram Extraction (getMonogram)', () => {
    // Extract getMonogram function from ui.js for direct behavioral testing
    const monoMatch = uiJs.match(/function getMonogram\([\s\S]*?\n  \}/);
    assert.ok(monoMatch, 'getMonogram function must exist in ui.js');
    const getMonogram = new Function(`${monoMatch[0]}; return getMonogram;`)();

    it('should extract first letters of two-word names', () => {
      assert.equal(getMonogram('John Doe'), 'JD');
      assert.equal(getMonogram('Monte Carlo'), 'MC');
      assert.equal(getMonogram('Alice Smith'), 'AS');
    });

    it('should handle hyphenated and compound names gracefully', () => {
      assert.equal(getMonogram('Jean-Luc Picard'), 'JL');
      assert.equal(getMonogram('Anne-Marie'), 'AM');
      assert.equal(getMonogram('High_Roller'), 'HR');
    });

    it('should take first 2 letters for single-word names longer than 1 character', () => {
      assert.equal(getMonogram('Winner'), 'WI');
      assert.equal(getMonogram('Casino'), 'CA');
      assert.equal(getMonogram('Ace'), 'AC');
    });

    it('should return single uppercase letter for 1-character names', () => {
      assert.equal(getMonogram('X'), 'X');
      assert.equal(getMonogram('a'), 'A');
    });

    it('should strip HTML tags and sanitize inputs', () => {
      assert.equal(getMonogram('<b>Player</b>'), 'PL');
      assert.equal(getMonogram('<span>King</span>'), 'KI');
    });

    it('should return fallback ? for empty, null, or whitespace-only inputs', () => {
      assert.equal(getMonogram(''), '?');
      assert.equal(getMonogram(null), '?');
      assert.equal(getMonogram(undefined), '?');
      assert.equal(getMonogram('   '), '?');
    });
  });

  describe('2. 12-Hue Monte Carlo Luxury Palette', () => {
    const requiredHues = [
      '#c5a059', // Imperial Gold
      '#0d5c3a', // Monte Carlo Emerald
      '#1e3a8a', // Royal Sapphire
      '#991b1b', // Crimson Ruby
      '#18181b', // Smoked Obsidian
      '#475569', // Polished Platinum
      '#581c87', // Monaco Amethyst
      '#78350f', // Antique Bronze
      '#0f766e', // Riviera Turquoise
      '#831843', // Champagne Rose
      '#92400e', // Cognac Amber
      '#334155'  // Brushed Titanium
    ];

    it('ui.js LUXURY_SWATCHES must define all 12 luxury colors', () => {
      for (const hue of requiredHues) {
        assert.ok(uiJs.includes(hue), `ui.js must include palette color ${hue}`);
      }
    });

    it('style.css must define avatar swatches and metallic rim treatments', () => {
      assert.ok(styleCss.includes('.avatar-gold'));
      assert.ok(styleCss.includes('.avatar-emerald'));
      assert.ok(styleCss.includes('.avatar-badge'));
      assert.ok(styleCss.includes('radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.4)'));
    });
  });

  describe('3. Blackjack Table View & Semicircular 6-Seat Arc (index.html & layout.css)', () => {
    it('index.html must enable the Blackjack game switcher pill', () => {
      assert.ok(indexHtml.includes('id="pill-blackjack"'));
      assert.equal(indexHtml.includes('id="pill-blackjack" disabled'), false, 'Blackjack pill must not be disabled');
    });

    it('index.html must contain view panes for Roulette and Blackjack', () => {
      assert.ok(indexHtml.includes('id="roulette-view"'));
      assert.ok(indexHtml.includes('id="blackjack-view"'));
      assert.ok(indexHtml.includes('id="win-shimmer-canvas"'));
      assert.ok(indexHtml.includes('id="blackjack-result-banner"'));
    });

    it('index.html must define table header, switcher pills, and shoe indicator', () => {
      assert.ok(indexHtml.includes('id="bj-table-btn-1"'));
      assert.ok(indexHtml.includes('id="bj-table-btn-2"'));
      assert.ok(indexHtml.includes('id="bj-shoe-fill"'));
      assert.ok(indexHtml.includes('id="bj-shoe-text"'));
    });

    it('index.html must define dealer area and all 6 individual player seats', () => {
      assert.ok(indexHtml.includes('id="bj-dealer-cards"'));
      assert.ok(indexHtml.includes('id="bj-dealer-score"'));
      assert.ok(indexHtml.includes('id="bj-seats-arc"'));

      for (let i = 0; i <= 5; i++) {
        assert.ok(indexHtml.includes(`id="bj-seat-${i}"`), `Seat ${i} must exist in HTML`);
        assert.ok(indexHtml.includes(`data-seat="${i}"`), `Seat ${i} data attribute must exist`);
        assert.ok(indexHtml.includes(`id="betting-spot-${i}"`), `Betting spot for seat ${i} must exist`);
        assert.ok(indexHtml.includes(`id="seat-cards-dock-${i}-0"`), `Primary hand dock for seat ${i} must exist`);
        assert.ok(indexHtml.includes(`id="seat-cards-dock-${i}-1"`), `Split hand dock for seat ${i} must exist`);
      }
    });

    it('index.html must provide Blackjack action buttons and chip selectors', () => {
      assert.ok(indexHtml.includes('id="btn-bj-hit"'));
      assert.ok(indexHtml.includes('id="btn-bj-stand"'));
      assert.ok(indexHtml.includes('id="btn-bj-double"'));
      assert.ok(indexHtml.includes('id="btn-bj-split"'));
      assert.ok(indexHtml.includes('id="btn-bj-clear"'));
    });

    it('layout.css must position seats in a semicircular arc with CSS transforms', () => {
      assert.ok(layoutCss.includes('#bj-seat-0'));
      assert.ok(layoutCss.includes('#bj-seat-5'));
      assert.ok(layoutCss.includes('transform: translateY('));
    });

    it('layout.css must provide height-based media queries for laptop zero-scroll fit', () => {
      assert.ok(layoutCss.includes('@media (max-height: 900px)'));
      assert.ok(layoutCss.includes('@media (max-height: 760px)'));
    });
  });

  describe('4. Tabbed Chat Architecture', () => {
    it('index.html must contain tabbed chat bar with Global and Table channels', () => {
      assert.ok(indexHtml.includes('id="chat-panel"'));
      assert.ok(indexHtml.includes('id="tab-chat-global"'));
      assert.ok(indexHtml.includes('id="tab-chat-table"'));
      assert.ok(indexHtml.includes('id="badge-unread-global"'));
      assert.ok(indexHtml.includes('id="badge-unread-table"'));
      assert.ok(indexHtml.includes('id="chat-messages-global"'));
      assert.ok(indexHtml.includes('id="chat-messages-table"'));
    });

    it('style.css must style active chat tab with gold accent and translucent backdrop', () => {
      assert.ok(styleCss.includes('.chat-tab-btn.active'));
      assert.ok(styleCss.includes('.chat-unread-badge'));
    });

    it('ui.js must implement scope switching and unread counter management', () => {
      assert.ok(uiJs.includes('switchChatScope('));
      assert.ok(uiJs.includes('this.unreadCounts'));
      assert.ok(uiJs.includes('this.activeChatScope'));
    });
  });

  describe('5. Pure Vector Card Suits & Micro-Animations', () => {
    it('index.html must contain pure SVG sprite definitions for all 4 suits', () => {
      assert.ok(indexHtml.includes('id="suit-spade"'));
      assert.ok(indexHtml.includes('id="suit-heart"'));
      assert.ok(indexHtml.includes('id="suit-diamond"'));
      assert.ok(indexHtml.includes('id="suit-club"'));
    });

    it('style.css must implement 3D card perspective and flip transforms', () => {
      assert.ok(styleCss.includes('perspective: 1200px'));
      assert.ok(styleCss.includes('transform: rotateY(180deg)'));
      assert.ok(styleCss.includes('.bj-card-inner'));
      assert.ok(styleCss.includes('.bj-card-front'));
      assert.ok(styleCss.includes('.bj-card-back'));
    });

    it('style.css must implement active turn thinking pulse animation', () => {
      assert.ok(styleCss.includes('@keyframes activeTurnPulse'));
      assert.ok(styleCss.includes('.is-active-turn'));
    });

    it('ui.js must render cards using pure SVG <use> tags without unicode suit characters', () => {
      const freshUiJs = fs.readFileSync(path.join(clientDir, 'js', 'ui.js'), 'utf8');
      assert.ok(freshUiJs.includes('renderBlackjackCardHtml'));
      assert.ok(freshUiJs.includes('#suit-${suitKey}'));
      // Verify simulated rendering output
      const renderCardMatch = freshUiJs.match(/renderBlackjackCardHtml\([\s\S]*?\n    \}/);
      assert.ok(renderCardMatch);
      const renderBlackjackCardHtml = new Function(`return function ${renderCardMatch[0]}`)();
      const cardHtml = renderBlackjackCardHtml({ rank: 'K', suit: 'spades' });
      assert.ok(cardHtml.includes('href="#suit-spade"'));
      assert.ok(cardHtml.includes('card-rank'));
    });
  });

  describe('6. Navigation Bet Lock & Interactive Handlers', () => {
    it('style.css must style navigation-locked elements with disabled aesthetics', () => {
      assert.ok(styleCss.includes('.navigation-locked'));
    });

    it('app.js must check hasUnsettledBets before allowing game view or table changes', () => {
      assert.ok(appJs.includes('hasUnsettledBets()'));
      assert.ok(appJs.includes('Inzet actief — Navigatie vergrendeld tot einde van de ronde'));
    });

    it('app.js must wire all bj_* socket listeners to ui renderers', () => {
      const requiredListeners = [
        'bj_table_state',
        'bj_seat_taken',
        'bj_seat_left',
        'bj_seat_accepted',
        'bj_seat_vacated',
        'bj_bet_accepted',
        'bj_bet_placed',
        'bj_bet_cleared',
        'bj_action_applied',
        'bj_action_executed',
        'bj_phase_tick',
        'bj_phase_change',
        'bj_turn_change',
        'bj_dealer_reveal',
        'bj_dealer_draw',
        'bj_shoe_reshuffle',
        'bj_round_result',
        'navigation_blocked'
      ];

      for (const eventName of requiredListeners) {
        assert.ok(appJs.includes(`network.on('${eventName}'`), `app.js must listen to ${eventName}`);
      }
    });

    it('network.js must expose client emit methods for Blackjack operations', () => {
      assert.ok(networkJs.includes('bjJoinTable('));
      assert.ok(networkJs.includes('bjTakeSeat('));
      assert.ok(networkJs.includes('bjLeaveSeat('));
      assert.ok(networkJs.includes('bjPlaceBet('));
      assert.ok(networkJs.includes('bjClearBet('));
      assert.ok(networkJs.includes('bjAction('));
    });
  });

  describe('7. Strict Zero Audio & Zero Emojis Guardrails', () => {
    const audioForbidden = [
      /AudioContext/i,
      /webkitAudioContext/i,
      /createOscillator/i,
      /createGain/i,
      /<audio/i,
      /new Audio\(/i
    ];

    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;

    it('client codebase must contain zero Web Audio API references or <audio> tags', () => {
      const files = [indexHtml, styleCss, layoutCss, uiJs, appJs, networkJs, pokerJs];
      for (const content of files) {
        for (const pattern of audioForbidden) {
          assert.equal(pattern.test(content), false, `Forbidden audio pattern ${pattern} detected`);
        }
      }
    });

    it('client codebase must contain zero unicode emoji glyphs', () => {
      const files = [
        { name: 'index.html', content: indexHtml },
        { name: 'style.css', content: styleCss },
        { name: 'layout.css', content: layoutCss },
        { name: 'ui.js', content: uiJs },
        { name: 'app.js', content: appJs },
        { name: 'network.js', content: networkJs },
        { name: 'poker.js', content: pokerJs }
      ];

      for (const file of files) {
        const lines = file.content.split('\n');
        lines.forEach((line, idx) => {
          const sanitized = line.replace(/[\u00A9\u00AE\u2122]/g, '');
          assert.equal(emojiRegex.test(sanitized), false, `Unicode emoji found in ${file.name}:${idx + 1}: ${line}`);
        });
      }
    });
  });

  describe('8. Texas Hold\'em Poker Table View & 6-Seat Elliptical Felt (PK-M3)', () => {
    it('index.html must enable the Poker game switcher pill (#pill-poker)', () => {
      assert.ok(indexHtml.includes('id="pill-poker"'));
      assert.equal(indexHtml.includes('id="pill-poker" disabled'), false, 'Poker pill must not be disabled');
    });

    it('index.html must contain poker view pane (#poker-view) and felt stage (#poker-felt-stage)', () => {
      assert.ok(indexHtml.includes('id="poker-view"'));
      assert.ok(indexHtml.includes('id="poker-felt-stage"'));
      assert.ok(indexHtml.includes('id="poker-win-shimmer-canvas"'));
      assert.ok(indexHtml.includes('id="poker-result-banner"'));
    });

    it('index.html must define table header, switcher pills, limits, and hand counter', () => {
      assert.ok(indexHtml.includes('id="poker-table-btn-1"'));
      assert.ok(indexHtml.includes('id="poker-table-btn-2"'));
      assert.ok(indexHtml.includes('id="poker-table-name"'));
      assert.ok(indexHtml.includes('id="poker-table-stakes"'));
      assert.ok(indexHtml.includes('id="poker-hand-number"'));
    });

    it('index.html must define community center with pot badges and 5 community card slots', () => {
      assert.ok(indexHtml.includes('id="poker-community-center"'));
      assert.ok(indexHtml.includes('id="poker-main-pot"'));
      assert.ok(indexHtml.includes('id="poker-pot-amount"'));
      assert.ok(indexHtml.includes('id="poker-side-pots"'));
      assert.ok(indexHtml.includes('id="poker-community-cards"'));
      assert.ok(indexHtml.includes('id="poker-phase-indicator"'));
      assert.ok(indexHtml.includes('id="poker-phase-text"'));

      for (let i = 0; i < 5; i++) {
        assert.ok(indexHtml.includes(`id="poker-card-slot-${i}"`), `Community card slot ${i} must exist`);
      }
      assert.ok(indexHtml.includes('data-slot="flop-1"'));
      assert.ok(indexHtml.includes('data-slot="flop-2"'));
      assert.ok(indexHtml.includes('data-slot="flop-3"'));
      assert.ok(indexHtml.includes('data-slot="turn"'));
      assert.ok(indexHtml.includes('data-slot="river"'));
    });

    it('index.html must define all 6 radial seats with hero bottom-center', () => {
      for (let i = 0; i <= 5; i++) {
        assert.ok(indexHtml.includes(`id="poker-seat-${i}"`), `Seat ${i} must exist in HTML`);
        assert.ok(indexHtml.includes(`data-seat="${i}"`), `Seat ${i} data attribute must exist`);
        assert.ok(indexHtml.includes(`id="btn-poker-sit-${i}"`), `Sit button for seat ${i} must exist`);
        assert.ok(indexHtml.includes(`id="poker-player-box-${i}"`), `Player box for seat ${i} must exist`);
        assert.ok(indexHtml.includes(`id="poker-cards-dock-${i}"`), `Hole cards dock for seat ${i} must exist`);
        assert.ok(indexHtml.includes(`id="poker-dealer-btn-${i}"`), `Dealer puck for seat ${i} must exist`);
        assert.ok(indexHtml.includes(`id="poker-action-pill-${i}"`), `Action status pill for seat ${i} must exist`);
        assert.ok(indexHtml.includes(`id="poker-street-bet-${i}"`), `Street bet badge for seat ${i} must exist`);
      }
    });

    it('index.html must define player action controls, sizing slider, presets, and 15s timer', () => {
      assert.ok(indexHtml.includes('id="poker-controls-panel"'));
      assert.ok(indexHtml.includes('id="poker-turn-timer-fill"'));
      assert.ok(indexHtml.includes('id="poker-turn-timer-text"'));
      assert.ok(indexHtml.includes('id="poker-raise-slider"'));
      assert.ok(indexHtml.includes('id="poker-raise-input"'));
      assert.ok(indexHtml.includes('id="btn-preset-1bb"'));
      assert.ok(indexHtml.includes('id="btn-preset-2x"'));
      assert.ok(indexHtml.includes('id="btn-preset-3x"'));
      assert.ok(indexHtml.includes('id="btn-preset-half-pot"'));
      assert.ok(indexHtml.includes('id="btn-preset-pot"'));
      assert.ok(indexHtml.includes('id="btn-preset-allin"'));
      assert.ok(indexHtml.includes('id="btn-poker-fold"'));
      assert.ok(indexHtml.includes('id="btn-poker-check-call"'));
      assert.ok(indexHtml.includes('id="btn-poker-raise"'));
    });

    it('index.html must define the Buy-In modal with range slider and quick chips', () => {
      assert.ok(indexHtml.includes('id="poker-buyin-modal"'));
      assert.ok(indexHtml.includes('id="poker-buyin-bankroll"'));
      assert.ok(indexHtml.includes('id="poker-buyin-amount"'));
      assert.ok(indexHtml.includes('id="poker-buyin-slider"'));
      assert.ok(indexHtml.includes('id="btn-buyin-min"'));
      assert.ok(indexHtml.includes('id="btn-buyin-mid"'));
      assert.ok(indexHtml.includes('id="btn-buyin-max"'));
      assert.ok(indexHtml.includes('id="btn-confirm-poker-buyin"'));
    });

    it('layout.css must style 1080x540px elliptical felt and radial seat coordinates', () => {
      assert.ok(layoutCss.includes('.poker-felt-stage'));
      assert.ok(layoutCss.includes('max-width: 1080px'));
      assert.ok(layoutCss.includes('height: 540px'));
      assert.ok(layoutCss.includes('#poker-seat-0'));
      assert.ok(layoutCss.includes('bottom: -22px'));
      assert.ok(layoutCss.includes('#poker-seat-3'));
      assert.ok(layoutCss.includes('top: -22px'));
    });

    it('network.js must expose client emit methods for Poker operations', () => {
      assert.ok(networkJs.includes('pokerJoinTable('));
      assert.ok(networkJs.includes('pokerLeaveTable('));
      assert.ok(networkJs.includes('pokerTakeSeat('));
      assert.ok(networkJs.includes('pokerLeaveSeat('));
      assert.ok(networkJs.includes('pokerAction('));
      assert.ok(networkJs.includes('pokerBuyIn('));
      assert.ok(networkJs.includes('pokerRebuy('));
    });

    it('app.js and ui.js must wire navigation, bet lock, and poker controller', () => {
      assert.ok(appJs.includes('poker'));
      assert.ok(appJs.includes('CasinoPoker'));
      assert.ok(uiJs.includes('viewPoker'));
      assert.ok(uiJs.includes('pillPoker'));
    });
  });
});
