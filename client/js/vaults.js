/**
 * vaults.js
 * Client controller for Monte Carlo Kluizenroof — Multiplayer Vault Door Survival Battle-Royale.
 * Zero audio, zero Unicode emojis, zero banned brand terms.
 */

(function (global) {
  'use strict';

  function formatF(val) {
    return `${Math.round(Number(val) || 0).toLocaleString()} F`;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  class CasinoVaults {
    constructor({ network, ui }) {
      this.network = network;
      this.ui = ui;

      this.selectedStake = 1000;
      this.state = {
        matchId: 1,
        phase: 'WAITING',
        stakeAmount: 1000,
        stakeOptions: [500, 1000, 2500, 5000, 10000, 25000],
        stakeLocked: false,
        houseRakeRate: 0.02,
        grossPot: 0,
        houseRake: 0,
        netPot: 0,
        minPlayers: 2,
        maxPlayers: 12,
        participantCount: 0,
        aliveCount: 0,
        maxPerDoor: 1,
        roundNumber: 0,
        doorCount: 5,
        doors: [],
        participants: [],
        myState: { inPot: false, status: 'SPECTATOR', ready: false, chosenDoor: null, stake: 0, canLeave: false },
        lastRoundSummary: null,
        lastWinner: null,
        recentWins: []
      };

      this._viewActive = false;
      this._countdownTimer = null;
      this.el = {};
    }

    init() {
      const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
      this.el = {
        view: byId('vaults-view'),
        matchId: byId('vaults-match-id'),
        phasePill: byId('vaults-phase-pill'),
        timerVal: byId('vaults-timer-val'),
        potVal: byId('vaults-pot-val'),
        netPotVal: byId('vaults-net-pot-val'),
        rakeVal: byId('vaults-rake-val'),
        survivorsVal: byId('vaults-survivors-val'),
        roundBadge: byId('vaults-round-badge'),
        statusBanner: byId('vaults-status-banner'),
        doorsGrid: byId('vaults-doors-grid'),
        stakeRow: byId('vaults-stake-row'),
        btnJoinPot: byId('btn-vaults-join-pot'),
        btnReady: byId('btn-vaults-ready'),
        btnLeavePot: byId('btn-vaults-leave-pot'),
        rosterCount: byId('vaults-roster-count'),
        rosterList: byId('vaults-roster-list'),
        winsList: byId('vaults-wins-list')
      };

      this._bindDomEvents();
      this._bindNetworkEvents();
      this.render();
    }

    _bindDomEvents() {
      if (this.el.stakeRow) {
        this.el.stakeRow.addEventListener('click', (e) => {
          const btn = e.target && typeof e.target.closest === 'function'
            ? e.target.closest('.vaults-stake-btn')
            : null;
          if (!btn || btn.disabled) return;
          const stake = parseInt(btn.getAttribute('data-stake'), 10);
          if (!Number.isInteger(stake) || stake <= 0) return;
          this.selectedStake = stake;
          if (this.network && typeof this.network.vaultsSetStake === 'function') {
            this.network.vaultsSetStake(stake);
          }
          this.render();
        });
      }

      if (this.el.btnJoinPot) {
        this.el.btnJoinPot.addEventListener('click', () => {
          if (!this.network || typeof this.network.vaultsJoinPot !== 'function') return;
          const stake = this.state.participantCount === 0 ? this.selectedStake : this.state.stakeAmount;
          this.network.vaultsJoinPot(stake);
        });
      }

      if (this.el.btnLeavePot) {
        this.el.btnLeavePot.addEventListener('click', () => {
          if (this.network && typeof this.network.vaultsLeavePot === 'function') {
            this.network.vaultsLeavePot();
          }
        });
      }

      if (this.el.btnReady) {
        this.el.btnReady.addEventListener('click', () => {
          if (this.network && typeof this.network.vaultsReady === 'function') {
            this.network.vaultsReady();
          }
        });
      }

      if (this.el.doorsGrid) {
        this.el.doorsGrid.addEventListener('click', (e) => {
          const card = e.target && typeof e.target.closest === 'function'
            ? e.target.closest('.vault-door-card')
            : null;
          if (!card) return;
          const doorIdx = parseInt(card.getAttribute('data-door-index'), 10);
          if (!Number.isInteger(doorIdx)) return;
          this.pickDoor(doorIdx);
        });
      }
    }

    _bindNetworkEvents() {
      if (!this.network || typeof this.network.on !== 'function') return;

      this.network.on('vaults_state', (data) => {
        if (!data || typeof data !== 'object') return;
        this.applyState(data);
      });

      this.network.on('vaults_joined', (data) => {
        if (this.ui && typeof this.ui.showToast === 'function' && data) {
          this.ui.showToast(`Je doet mee met Kluizenroof (${formatF(data.stake)} in de pot)!`, 'success');
        }
      });

      this.network.on('vaults_round_reveal', (data) => {
        if (!this._viewActive || !data || !this.ui || typeof this.ui.showToast !== 'function') return;
        if (Array.isArray(data.eliminatedNames) && data.eliminatedNames.length > 0) {
          this.ui.showToast(
            `${data.trappedDoorCode}: valstrik! Afgevallen: ${data.eliminatedNames.join(', ')}.`,
            'info'
          );
        } else {
          this.ui.showToast(`${data.trappedDoorCode} had de valstrik — iedereen overleefde!`, 'success');
        }
      });

      this.network.on('vaults_match_won', (data) => {
        if (!data || !this.ui || typeof this.ui.showToast !== 'function') return;
        const myId = this.ui.myPlayer ? this.ui.myPlayer.id : null;
        if (myId && data.playerId === myId) {
          this.ui.showToast(`KLUIS GEKRAAKT! Jij wint de hele pot: +${formatF(data.netPrize)}!`, 'success');
        } else if (this._viewActive) {
          this.ui.showToast(`${data.playerName} wint Kluizenroof (+${formatF(data.netPrize)})!`, 'info');
        }
      });

      this.network.on('vaults_rejected', (err) => {
        if (this.ui && typeof this.ui.showToast === 'function' && err && err.reason) {
          this.ui.showToast(err.reason, 'error');
        }
      });
    }

    onViewActivated() {
      this._viewActive = true;
      if (this.network && typeof this.network.vaultsJoin === 'function') {
        this.network.vaultsJoin();
      }
      this._syncCountdownTimer();
      this.render();
      this._syncTopHudPhase();
    }

    onViewDeactivated() {
      this._viewActive = false;
      this._stopTimer();
      if (this.network && typeof this.network.vaultsLeave === 'function') {
        this.network.vaultsLeave();
      }
    }

    hasActiveBets() {
      const s = this.state;
      if (!s || !s.myState || !s.myState.inPot) return false;
      if (s.phase === 'LOBBY_COUNTDOWN') return true;
      if (s.phase === 'CHOOSING' || s.phase === 'REVEALING') {
        return s.myState.status === 'ALIVE';
      }
      return false;
    }

    pickDoor(doorIndex) {
      if (!this.network || typeof this.network.vaultsPickDoor !== 'function') return;
      if (this.state.phase !== 'CHOOSING') return;
      if (!this.state.myState || !this.state.myState.inPot || this.state.myState.status !== 'ALIVE') {
        if (this.ui && typeof this.ui.showToast === 'function') {
          this.ui.showToast('Neem eerst deel aan de pot of wacht tot de volgende roof.', 'info');
        }
        return;
      }
      this.network.vaultsPickDoor(doorIndex);
    }

    applyState(data) {
      this.state = {
        ...this.state,
        ...data
      };
      if (typeof data.stakeAmount === 'number') {
        this.selectedStake = data.stakeAmount;
      }
      if (this._viewActive) {
        this._syncCountdownTimer();
        this._syncTopHudPhase();
      }
      this.render();
      if (this.ui && typeof this.ui.setNavigationLocked === 'function') {
        this.ui.setNavigationLocked(this.hasActiveBets());
      }
    }

    _syncTopHudPhase() {
      if (!this._viewActive || !this.ui || typeof this.ui.updatePhase !== 'function') return;
      const secs = this._getLiveSecondsRemaining();
      const map = {
        WAITING: ['WAITING_FOR_PLAYERS', 0, 'MIN 2 SPELERS'],
        LOBBY_COUNTDOWN: ['LOBBY_COUNTDOWN', 8, secs],
        CHOOSING: ['VAULT_CHOOSING', 10, secs],
        REVEALING: ['VAULT_REVEALING', 3, secs],
        COMPLETE: ['PAYOUT', 5, secs]
      };
      const cfg = map[this.state.phase] || ['WAITING_FOR_PLAYERS', 0, 'KLUIZEN'];
      this.ui.updatePhase(cfg[0], cfg[1], cfg[2]);
    }

    _getLiveSecondsRemaining() {
      const endsAt = Number(this.state.phaseEndsAt) || 0;
      if (endsAt <= 0) return 0;
      return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    }

    _syncCountdownTimer() {
      const needsTimer = this._viewActive && Number(this.state.phaseEndsAt) > 0 && this.state.phase !== 'WAITING';
      if (!needsTimer) {
        this._stopTimer();
        return;
      }
      if (!this._countdownTimer) {
        this._countdownTimer = setInterval(() => {
          if (!this._viewActive) {
            this._stopTimer();
            return;
          }
          if (this.el.timerVal) {
            const secs = this._getLiveSecondsRemaining();
            this.el.timerVal.textContent = secs > 0 ? `${secs}s` : 'NU';
          }
          this._syncTopHudPhase();
        }, 400);
      }
    }

    _stopTimer() {
      if (this._countdownTimer) {
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
      }
    }

    render() {
      this._renderHeaderStats();
      this._renderStatusBanner();
      this._renderDoors();
      this._renderControls();
      this._renderRoster();
      this._renderRecentWins();
    }

    _renderHeaderStats() {
      const s = this.state;
      if (this.el.matchId) {
        this.el.matchId.textContent = `#${s.matchId || 1}`;
      }
      if (this.el.phasePill) {
        const labels = {
          WAITING: `WACHTEN (${s.participantCount}/${s.minPlayers}+ SPELERS)`,
          LOBBY_COUNTDOWN: `START OVER ${this._getLiveSecondsRemaining()}s`,
          CHOOSING: `RONDE ${s.roundNumber} — KIES JE KLUIS`,
          REVEALING: `RONDE ${s.roundNumber} — ALARM CHECK!`,
          COMPLETE: 'POT GEWONNEN!'
        };
        this.el.phasePill.className = `vaults-phase-pill phase-${String(s.phase || 'WAITING').toLowerCase()}`;
        this.el.phasePill.textContent = labels[s.phase] || 'KLUIS';
      }
      if (this.el.timerVal) {
        const secs = this._getLiveSecondsRemaining();
        this.el.timerVal.textContent = s.phase === 'WAITING'
          ? `${s.participantCount}/${s.minPlayers}`
          : (secs > 0 ? `${secs}s` : 'NU');
      }
      if (this.el.potVal) {
        this.el.potVal.textContent = formatF(s.grossPot);
      }
      if (this.el.netPotVal) {
        this.el.netPotVal.textContent = formatF(s.netPot);
      }
      if (this.el.rakeVal) {
        this.el.rakeVal.textContent = `${Math.round((Number(s.houseRakeRate) || 0.02) * 100)}% (${formatF(s.houseRake)})`;
      }
      if (this.el.survivorsVal) {
        this.el.survivorsVal.textContent = `${s.aliveCount || 0} / ${s.participantCount || 0}`;
      }
      if (this.el.roundBadge) {
        this.el.roundBadge.textContent = s.roundNumber > 0
          ? `Ronde ${s.roundNumber} • ${s.doorCount || 5} actieve kluizen`
          : `5 Kluizen gereed • Inzet: ${formatF(s.stakeAmount)}`;
      }
    }

    _renderStatusBanner() {
      if (!this.el.statusBanner) return;
      const s = this.state;
      let cls = 'vaults-status-banner';
      let msg = `Iedereen legt ${formatF(s.stakeAmount)} in (min. ${s.minPlayers} spelers). Kies elke ronde een kluisdeur — elke ronde valt er 1 kluis af!`;

      if (s.phase === 'LOBBY_COUNTDOWN') {
        cls += ' is-countdown';
        msg = `Kluizenroof start over ${this._getLiveSecondsRemaining()}s met ${s.participantCount} spelers! Andere spelers kunnen nog meedoen op ${formatF(s.stakeAmount)}.`;
      } else if (s.phase === 'CHOOSING') {
        cls += ' is-choosing';
        const pickedDoor = s.myState && Number.isInteger(s.myState.chosenDoor)
          ? `Je zit in KLUIS ${s.myState.chosenDoor + 1} — je mag nog wisselen voor de timer afloopt.`
          : `Klik op 1 van de ${s.doorCount} open kluisdeuren! Max ${s.maxPerDoor} speler${s.maxPerDoor === 1 ? '' : 's'} per kluis.`;
        msg = (s.myState && s.myState.status === 'ALIVE')
          ? pickedDoor
          : `Ronde ${s.roundNumber} loopt! Er zijn nog ${s.aliveCount} spelers over in ${s.doorCount} kluizen.`;
      } else if (s.phase === 'REVEALING' && s.lastRoundSummary) {
        const rs = s.lastRoundSummary;
        if (rs.eliminatedNames && rs.eliminatedNames.length > 0) {
          cls += ' is-alarm';
          msg = `${rs.trappedDoorCode} (${rs.trappedDoorName}) had het laser-alarm! Afgevallen: ${rs.eliminatedNames.join(', ')}.`;
        } else {
          cls += ' is-safe';
          msg = `${rs.trappedDoorCode} (${rs.trappedDoorName}) had het alarm, maar niemand zat erin! Iedereen door.`;
        }
      } else if (s.phase === 'COMPLETE' && s.lastWinner) {
        cls += ' is-winner';
        msg = `${s.lastWinner.playerName} kraakt de laatste kluis en wint ${formatF(s.lastWinner.netPrize)}!`;
      }

      this.el.statusBanner.className = cls;
      this.el.statusBanner.textContent = msg;
    }

    _renderDoors() {
      if (!this.el.doorsGrid) return;
      const s = this.state;
      const doors = Array.isArray(s.doors) && s.doors.length > 0
        ? s.doors
        : [0, 1, 2, 3, 4].map((idx) => ({
            index: idx,
            code: `KLUIS ${['I', 'II', 'III', 'IV', 'V'][idx]}`,
            name: 'Suite',
            accent: '#d4af37',
            isActive: true,
            isSealed: false,
            isTrapped: false,
            isSafe: false,
            occupants: [],
            capacity: 1
          }));

      const myId = this.ui && this.ui.myPlayer ? this.ui.myPlayer.id : null;
      const canClickDoors = s.phase === 'CHOOSING' && s.myState && s.myState.inPot && s.myState.status === 'ALIVE';
      const myDoor = s.myState && Number.isInteger(s.myState.chosenDoor) ? s.myState.chosenDoor : -1;

      this.el.doorsGrid.innerHTML = doors.map((door) => {
        const isMine = myDoor === door.index;
        const isFull = door.isActive && !isMine && door.occupants.length >= Math.max(1, door.capacity || 1);
        const stateClasses = [
          'vault-door-card',
          door.isSealed ? 'is-sealed' : 'is-active',
          isMine ? 'is-mine' : '',
          door.isTrapped ? 'is-trapped' : '',
          door.isSafe ? 'is-safe' : '',
          canClickDoors && door.isActive && !isFull ? 'is-clickable' : '',
          isFull && canClickDoors ? 'is-full' : ''
        ].filter(Boolean).join(' ');

        const occHtml = door.occupants.length > 0
          ? door.occupants.map((occ) => (
              `<span class="vd-occupant${occ.playerId === myId ? ' is-self' : ''}${occ.status === 'ELIMINATED' ? ' is-elim' : ''}" title="${escapeHtml(occ.name)}">` +
                `<i class="vd-dot" style="background:${escapeHtml(occ.color || '#d4af37')}">${escapeHtml(occ.monogram)}</i>` +
                `<span>${escapeHtml(occ.name)}</span>` +
              `</span>`
            )).join('')
          : `<span class="vd-empty-slot">${door.isSealed ? `Afgevallen in R${door.sealedAtRound}` : 'Nog niemand binnen'}</span>`;

        let ctaText = 'KLUIS GEREED';
        if (door.isSealed) ctaText = `WEGGEVALLEN (R${door.sealedAtRound})`;
        else if (door.isTrapped) ctaText = 'VALSTRIK GEACTIVEERD!';
        else if (door.isSafe) ctaText = 'VEILIG — OVERLEEFD!';
        else if (isMine) ctaText = 'JOUW KEUZE (KLIK WISSELEN)';
        else if (isFull && canClickDoors) ctaText = 'KLUIS VOL';
        else if (canClickDoors) ctaText = 'STAP IN DEZE KLUIS';

        const capBadge = door.isSealed
          ? 'VERZEGELD'
          : (s.phase === 'CHOOSING' ? `${door.occupants.length}/${door.capacity}` : (door.isTrapped ? 'ALARM' : 'OPEN'));

        return (
          `<button type="button" class="${stateClasses}" data-door-index="${door.index}" style="--door-accent:${escapeHtml(door.accent || '#d4af37')}" ${door.isSealed ? 'disabled' : ''}>` +
            `<div class="vd-top">` +
              `<span class="vd-code">${escapeHtml(door.code)}</span>` +
              `<span class="vd-cap">${escapeHtml(capBadge)}</span>` +
            `</div>` +
            `<div class="vd-name">${escapeHtml(door.name)}</div>` +
            `<div class="vd-visual">` +
              `<svg class="vd-wheel-svg" viewBox="0 0 64 64" aria-hidden="true">` +
                `<rect x="6" y="6" width="52" height="52" rx="10" fill="rgba(10,14,22,0.85)" stroke="currentColor" stroke-width="2.4"/>` +
                `<circle cx="32" cy="32" r="15" fill="none" stroke="currentColor" stroke-width="2.4"/>` +
                `<circle cx="32" cy="32" r="4.5" fill="currentColor"/>` +
                `<line x1="32" y1="14" x2="32" y2="50" stroke="currentColor" stroke-width="2"/>` +
                `<line x1="14" y1="32" x2="50" y2="32" stroke="currentColor" stroke-width="2"/>` +
                `<line x1="20" y1="20" x2="44" y2="44" stroke="currentColor" stroke-width="1.6"/>` +
                `<line x1="44" y1="20" x2="20" y2="44" stroke="currentColor" stroke-width="1.6"/>` +
              `</svg>` +
              `<div class="vd-laser-overlay"></div>` +
            `</div>` +
            `<div class="vd-occupants">${occHtml}</div>` +
            `<div class="vd-cta">${escapeHtml(ctaText)}</div>` +
          `</button>`
        );
      }).join('');
    }

    _renderControls() {
      const s = this.state;
      const my = s.myState || {};
      const stakes = Array.isArray(s.stakeOptions) ? s.stakeOptions : [500, 1000, 2500, 5000, 10000, 25000];
      const activeStake = s.stakeLocked ? s.stakeAmount : (my.inPot ? s.stakeAmount : this.selectedStake);

      if (this.el.stakeRow) {
        this.el.stakeRow.innerHTML = stakes.map((val) => (
          `<button type="button" class="vaults-stake-btn${activeStake === val ? ' active' : ''}" data-stake="${val}" ${s.stakeLocked ? 'disabled' : ''}>${val >= 1000 ? `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}K F` : `${val} F`}</button>`
        )).join('');
      }

      if (this.el.btnJoinPot) {
        const showJoin = !my.inPot && (s.phase === 'WAITING' || s.phase === 'LOBBY_COUNTDOWN');
        const showWaiting = my.inPot && s.phase === 'WAITING';
        this.el.btnJoinPot.classList.toggle('hidden', !showJoin && !showWaiting);
        if (showWaiting) {
          this.el.btnJoinPot.disabled = true;
          this.el.btnJoinPot.textContent = `INGEZET (${formatF(s.stakeAmount)}) — WACHT OP 2E SPELER`;
        } else if (showJoin) {
          const stakeToJoin = s.participantCount === 0 ? this.selectedStake : s.stakeAmount;
          this.el.btnJoinPot.disabled = false;
          this.el.btnJoinPot.textContent = s.participantCount === 0
            ? `OPEN POT MET ${formatF(stakeToJoin)}`
            : `DOE MEE VOOR ${formatF(stakeToJoin)}`;
        }
      }

      if (this.el.btnReady) {
        const showReady = my.inPot && s.phase === 'LOBBY_COUNTDOWN';
        this.el.btnReady.classList.toggle('hidden', !showReady);
        this.el.btnReady.disabled = Boolean(my.ready);
        this.el.btnReady.textContent = my.ready ? 'KLAAR — WACHT OP OVERIGE' : 'START NU!';
      }

      if (this.el.btnLeavePot) {
        const showLeave = Boolean(my.inPot && my.canLeave && s.phase === 'WAITING');
        this.el.btnLeavePot.classList.toggle('hidden', !showLeave);
      }
    }

    _renderRoster() {
      const list = Array.isArray(this.state.participants) ? this.state.participants : [];
      if (this.el.rosterCount) {
        this.el.rosterCount.textContent = `${list.length}/${this.state.maxPlayers || 12}`;
      }
      if (!this.el.rosterList) return;
      if (list.length === 0) {
        this.el.rosterList.innerHTML = '<div class="vaults-empty-note">Nog geen kluiskrakers in de pot. Stap in om te starten!</div>';
        return;
      }

      const myId = this.ui && this.ui.myPlayer ? this.ui.myPlayer.id : null;
      const ordered = [...list].sort((a, b) => {
        const rank = (x) => (x.status === 'WINNER' ? 0 : (x.status === 'ALIVE' ? 1 : 2));
        return rank(a) - rank(b);
      });

      this.el.rosterList.innerHTML = ordered.map((p) => {
        let badge = 'IN DE POT';
        let badgeCls = 'is-alive';
        if (p.status === 'WINNER') {
          badge = 'WINNAAR';
          badgeCls = 'is-winner';
        } else if (p.status === 'ELIMINATED') {
          badge = `AF R${p.eliminatedRound || '?'}`;
          badgeCls = 'is-elim';
        } else if (this.state.phase === 'CHOOSING') {
          badge = Number.isInteger(p.chosenDoor) ? `KLUIS ${p.chosenDoor + 1}` : 'KIEST...';
          badgeCls = Number.isInteger(p.chosenDoor) ? 'is-picked' : 'is-alive';
        } else if (this.state.phase === 'LOBBY_COUNTDOWN') {
          badge = p.ready ? 'KLAAR' : 'WACHT';
          badgeCls = p.ready ? 'is-picked' : 'is-alive';
        }
        return (
          `<div class="vaults-roster-row ${badgeCls}${p.playerId === myId ? ' is-self' : ''}">` +
            `<span class="vr-mono" style="background:${escapeHtml(p.color || '#d4af37')}">${escapeHtml(p.monogram)}</span>` +
            `<span class="vr-name">${escapeHtml(p.name)}</span>` +
            `<strong class="vr-badge ${badgeCls}">${escapeHtml(badge)}</strong>` +
          `</div>`
        );
      }).join('');
    }

    _renderRecentWins() {
      if (!this.el.winsList) return;
      const wins = Array.isArray(this.state.recentWins) ? this.state.recentWins : [];
      if (wins.length === 0) {
        this.el.winsList.innerHTML = '<div class="vaults-empty-note">Nog geen kluizenroof-winnaars in deze sessie.</div>';
        return;
      }
      this.el.winsList.innerHTML = wins.slice(0, 10).map((w) => (
        `<div class="vaults-win-row">` +
          `<span class="vw-name" style="color:${escapeHtml(w.playerColor || '#fde047')}">${escapeHtml(w.playerName)}</span>` +
          `<span class="vw-meta">${Number(w.participantCount) || 2}p • ${Number(w.roundsSurvived) || 1}r</span>` +
          `<strong class="vw-prize">+${formatF(w.netPrize)}</strong>` +
        `</div>`
      )).join('');
    }
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = CasinoVaults;
  } else {
    global.CasinoVaults = CasinoVaults;
  }
}(typeof window !== 'undefined' ? window : globalThis));
