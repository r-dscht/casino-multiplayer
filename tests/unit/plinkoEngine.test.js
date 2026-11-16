const { describe, it, beforeEach, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');
const PlayerManager = require('../../server/game/playerManager');
const BankManager = require('../../server/game/bankManager');
const PlinkoEngine = require('../../server/game/plinkoEngine');

const {
    MULTIPLIER_TABLES,
    VALID_ROWS,
    VALID_RISKS,
    MIN_BET,
    MAX_BET,
    MAX_BALLS_PER_BURST,
} = PlinkoEngine;

function waitForEvent(socket, eventName, predicate = null, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(eventName, handler);
            reject(new Error(`Timed out waiting for socket event "${eventName}"`));
        }, timeoutMs);

        function handler(data) {
            if (!predicate || predicate(data)) {
                clearTimeout(timer);
                socket.off(eventName, handler);
                resolve(data);
            }
        }

        socket.on(eventName, handler);
    });
}

describe('PlinkoEngine unit tests', () => {
    let playerManager;
    let bankManager;
    let engine;
    let player;

    beforeEach(() => {
        playerManager = new PlayerManager({ storagePath: null });
        bankManager = new BankManager(playerManager);
        engine = new PlinkoEngine({ playerManager, bankManager });
        player = playerManager.registerPlayer('sock_plinko_1', {
            name: 'Renzo',
            color: '#D4AF37',
        });
    });

    it('exposes symmetric MULTIPLIER_TABLES with R+1 buckets for every valid rows/risk combination', () => {
        assert.deepEqual(VALID_ROWS, [8, 10, 12, 14, 16]);
        assert.deepEqual(VALID_RISKS, ['low', 'medium', 'high']);

        for (const rows of VALID_ROWS) {
            assert.ok(MULTIPLIER_TABLES[rows], `Missing table for rows=${rows}`);
            for (const risk of VALID_RISKS) {
                const table = MULTIPLIER_TABLES[rows][risk];
                assert.ok(Array.isArray(table), `Missing table for rows=${rows}, risk=${risk}`);
                assert.equal(table.length, rows + 1);
                for (let i = 0; i < table.length; i += 1) {
                    assert.equal(
                        table[i],
                        table[table.length - 1 - i],
                        `Asymmetric bucket at rows=${rows}, risk=${risk}, index=${i}`
                    );
                    assert.ok(table[i] > 0, `Non-positive multiplier at rows=${rows}, risk=${risk}`);
                }
            }
        }

        assert.equal(MULTIPLIER_TABLES[16].high[0], 1000);
        assert.equal(MULTIPLIER_TABLES[16].high[16], 1000);

        // Verify genuine casino house edge (~5-7% edge => RTP between 0.90 and 0.96) across every table
        for (const rows of VALID_ROWS) {
            for (const risk of VALID_RISKS) {
                const table = MULTIPLIER_TABLES[rows][risk];
                let rtp = 0;
                let comb = 1;
                const denom = Math.pow(2, rows);
                for (let k = 0; k <= rows; k += 1) {
                    if (k > 0) comb = (comb * (rows - k + 1)) / k;
                    rtp += (comb / denom) * table[k];
                }
                assert.ok(
                    rtp >= 0.90 && rtp <= 0.96,
                    `Expected Plinko casino house edge (90%-96% RTP) for rows=${rows}, risk=${risk}, got ${(rtp * 100).toFixed(2)}%`
                );
            }
        }
    });

    it('removes passive Auto-Bet UI controls from Plinko and Slots views', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'index.html'), 'utf8');
        assert.equal(html.includes('btn-auto-plinko'), false, 'Plinko auto-drop button must be removed');
        assert.equal(html.includes('btn-slots-auto'), false, 'Slots auto-spin button must be removed');
        assert.equal(html.includes('slots-auto-count'), false, 'Slots auto-spin selector must be removed');
        assert.equal(html.includes('slots-sticky-layer'), false, 'Slots sticky overlay must be removed');
    });

    it('normalizes risk aliases like "med" to "medium"', () => {
        assert.equal(engine.normalizeRisk('med'), 'medium');
        assert.equal(engine.normalizeRisk('HIGH'), 'high');
        const res = engine.dropBalls(player.id, { amount: 10, rows: 12, risk: 'med', count: 1 });
        assert.equal(res.ok, true);
        assert.equal(res.drops.length, 1);
        assert.equal(res.drops[0].risk, 'medium');
    });

    it('rejects invalid payloads, unknown players, out-of-range bets/rows/risk/count, and insufficient funds', () => {
        const badPayload = engine.dropBalls(player.id, null);
        assert.equal(badPayload.ok, false);
        assert.equal(badPayload.code, 'INVALID_PAYLOAD');

        const missingPlayer = engine.dropBalls('unknown_player_id', { amount: 10, rows: 12, risk: 'medium' });
        assert.equal(missingPlayer.ok, false);
        assert.equal(missingPlayer.code, 'PLAYER_NOT_FOUND');

        for (const badAmount of [0, -5, MIN_BET - 0.5, MAX_BET + 1, 'abc', Number.NaN]) {
            const res = engine.dropBalls(player.id, { amount: badAmount, rows: 12, risk: 'medium' });
            assert.equal(res.ok, false);
            assert.equal(res.code, 'INVALID_BET');
        }

        const badRows = engine.dropBalls(player.id, { amount: 10, rows: 9, risk: 'medium' });
        assert.equal(badRows.ok, false);
        assert.equal(badRows.code, 'INVALID_ROWS');

        const badRisk = engine.dropBalls(player.id, { amount: 10, rows: 12, risk: 'ultra' });
        assert.equal(badRisk.ok, false);
        assert.equal(badRisk.code, 'INVALID_RISK');

        for (const badCount of [0, -1, 1.5, MAX_BALLS_PER_BURST + 1]) {
            const res = engine.dropBalls(player.id, { amount: 10, rows: 12, risk: 'medium', count: badCount });
            assert.equal(res.ok, false);
            assert.equal(res.code, 'INVALID_COUNT');
        }

        const tooExpensive = engine.dropBalls(player.id, {
            amount: player.chips + 100,
            rows: 12,
            risk: 'medium',
            count: 1,
        });
        assert.equal(tooExpensive.ok, false);
        assert.equal(tooExpensive.code, 'INSUFFICIENT_FUNDS');
    });

    it('produces consistent binomial paths, slotIndex, payout, chip balance, and stats for multi-ball bursts', () => {
        playerManager.addChips(player.id, 10000);
        const startChips = playerManager.getPlayerById(player.id).chips;

        const res = engine.dropBalls(player.id, {
            amount: 100,
            rows: 14,
            risk: 'high',
            count: 5,
        });

        assert.equal(res.ok, true);
        assert.equal(res.totalBet, 500);
        assert.equal(res.drops.length, 5);

        let sumPayout = 0;
        let sumProfit = 0;
        let maxProfit = 0;
        for (const drop of res.drops) {
            assert.equal(drop.path.length, 14);
            for (const bit of drop.path) {
                assert.ok(bit === 0 || bit === 1);
            }
            const bitSum = drop.path.reduce((s, b) => s + b, 0);
            assert.equal(drop.slotIndex, bitSum);
            const expectedMult = MULTIPLIER_TABLES[14].high[drop.slotIndex];
            assert.equal(drop.multiplier, expectedMult);
            assert.equal(drop.payout, Math.round(100 * expectedMult));
            assert.equal(drop.profit, Math.max(0, drop.payout - 100));
            sumPayout += drop.payout;
            sumProfit += drop.profit;
            if (drop.profit > maxProfit) maxProfit = drop.profit;
        }

        assert.equal(res.totalPayout, sumPayout);
        assert.equal(res.netProfit, sumPayout - 500);
        assert.equal(res.newChips, startChips - 500 + sumPayout);

        const updated = playerManager.getPlayerById(player.id);
        assert.equal(updated.chips, res.newChips);
        assert.equal(updated.stats.roundsPlayed, 5);
        assert.equal(updated.stats.totalWon, sumProfit);
        assert.equal(updated.stats.biggestWin, maxProfit);
    });

    it('caps recentDrops history at 25 entries', () => {
        playerManager.addChips(player.id, 50000);

        for (let b = 0; b < 3; b += 1) {
            const res = engine.dropBalls(player.id, {
                amount: 10,
                rows: 8,
                risk: 'low',
                count: 10,
            });
            assert.equal(res.ok, true);
        }

        const recent = engine.getRecentDrops();
        const state = engine.getState();
        assert.equal(recent.length, 25);
        assert.equal(state.recentDrops.length, 25);
        assert.deepEqual(state.validRows, VALID_ROWS);
        assert.deepEqual(state.validRisks, VALID_RISKS);
    });

    it('invokes bankManager.processWinRepayment when net profit is positive and returns repayments', () => {
        playerManager.addChips(player.id, 50000);

        const repaymentCalls = [];
        const stubBankManager = {
            processWinRepayment(targetPlayerId, netProfit) {
                repaymentCalls.push({ targetPlayerId, netProfit });
                return [
                    {
                        loanId: 'loan_test_1',
                        lenderId: 'lender_1',
                        borrowerId: targetPlayerId,
                        amountPaid: Math.min(50, netProfit),
                        remaining: 0,
                        fullyRepaid: true,
                    },
                ];
            },
        };

        const engineWithLoan = new PlinkoEngine({ playerManager, bankManager: stubBankManager });
        engineWithLoan.generatePath = () => new Array(16).fill(1); // guarantees 1000x on high risk

        const res = engineWithLoan.dropBalls(player.id, {
            amount: 10,
            rows: 16,
            risk: 'high',
            count: 1,
        });

        assert.equal(res.ok, true);
        assert.equal(res.drops[0].multiplier, 1000);
        assert.equal(res.drops[0].payout, 10000);
        assert.equal(res.netProfit, 9990);
        assert.equal(repaymentCalls.length, 1);
        assert.equal(repaymentCalls[0].targetPlayerId, player.id);
        assert.equal(repaymentCalls[0].netProfit, 9990);
        assert.equal(res.repayments.length, 1);
        assert.equal(res.repayments[0].amountPaid, 50);
        assert.equal(res.stats.totalWon, 9990);
        assert.equal(res.stats.biggestWin, 9990);
    });
});

describe('Plinko Socket.IO integration tests', () => {
    let server;
    let socketHandler;
    let baseUrl;
    let client1;
    let client2;

    before(async () => {
        server = http.createServer(app);
        socketHandler = setupSocket(server);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;

        client1 = Client(baseUrl, { transports: ['websocket'], forceNew: true });
        client2 = Client(baseUrl, { transports: ['websocket'], forceNew: true });

        await Promise.all([
            waitForEvent(client1, 'connect'),
            waitForEvent(client2, 'connect'),
        ]);

        const p1Join = waitForEvent(client1, 'table_state');
        const p2Join = waitForEvent(client2, 'table_state');
        client1.emit('join_table', { name: 'PlinkoAlice', color: '#D4AF37' });
        client2.emit('join_table', { name: 'PlinkoBob', color: '#38BDF8' });
        await Promise.all([p1Join, p2Join]);
    });

    after(async () => {
        if (client1) client1.disconnect();
        if (client2) client2.disconnect();
        if (socketHandler && typeof socketHandler.stop === 'function') {
            socketHandler.stop();
        }
        if (socketHandler && socketHandler.engine && typeof socketHandler.engine.stop === 'function') {
            socketHandler.engine.stop();
        }
        if (socketHandler && socketHandler.crashEngine && typeof socketHandler.crashEngine.stop === 'function') {
            socketHandler.crashEngine.stop();
        }
        if (socketHandler && socketHandler.io) {
            socketHandler.io.close();
        }
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('emits plinko_state on plinko_join', async () => {
        const statePromise = waitForEvent(client1, 'plinko_state');
        client1.emit('plinko_join');
        const state = await statePromise;

        assert.ok(state);
        assert.deepEqual(state.validRows, [8, 10, 12, 14, 16]);
        assert.deepEqual(state.validRisks, ['low', 'medium', 'high']);
        assert.ok(state.multiplierTables && state.multiplierTables[16] && state.multiplierTables[16].high);
    });

    it('handles plinko_drop with plinko_drop_accepted, chips_update, and plinko_ball_dropped broadcast', async () => {
        const acceptedPromise = waitForEvent(client1, 'plinko_drop_accepted');
        const chipsPromise = waitForEvent(client1, 'chips_update', (d) => d && d.source === 'plinko');
        const broadcastPromise = waitForEvent(client2, 'plinko_ball_dropped');

        client1.emit('plinko_drop', {
            amount: 25,
            rows: 12,
            risk: 'medium',
            count: 2,
        });

        const [accepted, chipsEvt, broadcast] = await Promise.all([
            acceptedPromise,
            chipsPromise,
            broadcastPromise,
        ]);

        assert.equal(accepted.totalBet, 50);
        assert.equal(accepted.drops.length, 2);
        assert.equal(chipsEvt.source, 'plinko');
        assert.equal(chipsEvt.chips, accepted.newChips);
        assert.ok(Array.isArray(broadcast.drops) && broadcast.drops.length === 2);
        assert.equal(broadcast.drops[0].playerName, 'PlinkoAlice');
        assert.ok(Array.isArray(broadcast.recentDrops) && broadcast.recentDrops.length >= 2);
    });

    it('emits plinko_drop_rejected on invalid bet payload', async () => {
        const rejectedPromise = waitForEvent(client1, 'plinko_drop_rejected');
        client1.emit('plinko_drop', {
            amount: -50,
            rows: 12,
            risk: 'high',
            count: 1,
        });

        const rejected = await rejectedPromise;
        assert.equal(rejected.code, 'INVALID_BET');
        assert.ok(typeof rejected.reason === 'string' && rejected.reason.length > 0);
    });
});

describe('Plinko audio-free and emoji-free compliance', () => {
    it('contains zero audio APIs and zero unicode emojis in Plinko server and client files', () => {
        const filesToCheck = [
            path.join(__dirname, '../../server/game/plinkoEngine.js'),
            path.join(__dirname, '../../client/js/plinko.js'),
        ];
        const forbiddenAudioTokens = [
            'AudioContext',
            'webkitAudioContext',
            'createOscillator',
            'createGain',
            '<audio',
            'new Audio(',
        ];
        const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

        for (const filePath of filesToCheck) {
            const content = fs.readFileSync(filePath, 'utf8');
            for (const token of forbiddenAudioTokens) {
                assert.equal(
                    content.includes(token),
                    false,
                    `${path.basename(filePath)} must not contain forbidden audio token ${token}`
                );
            }
            assert.equal(
                emojiRegex.test(content),
                false,
                `${path.basename(filePath)} must not contain Unicode emojis`
            );
        }
    });
});
