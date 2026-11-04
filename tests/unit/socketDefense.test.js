const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: Client } = require('socket.io-client');

const app = require('../../server/app');
const { setupSocket } = require('../../server/socket');
const PlayerManager = require('../../server/game/playerManager');
const RouletteEngine = require('../../server/game/rouletteEngine');
const { BET_TYPES } = require('../../server/game/rouletteConstants');

describe('Socket & Engine Adversarial Defense Suite', () => {
  describe('Unit-Level Defensive Hardening', () => {
    it('PlayerManager.registerPlayer should handle null, undefined, primitive, and array options without throwing', () => {
      const pm = new PlayerManager();
      const testCases = [
        null,
        undefined,
        'string_payload',
        12345,
        true,
        [],
        [1, 2, 3],
        {},
        { id: null, name: null, color: null, avatar: null },
        { id: 123, name: {}, color: [], avatar: false }
      ];

      testCases.forEach((malformedInput, idx) => {
        assert.doesNotThrow(() => {
          const player = pm.registerPlayer(`sock_${idx}`, malformedInput);
          assert.ok(player, 'Player object should be returned');
          assert.ok(player.id, 'Player ID must exist');
          assert.equal(player.chips, 10000, 'Starting chips should be 10,000');
          assert.equal(typeof player.name, 'string', 'Player name must be a string');
        }, `Failed on input: ${JSON.stringify(malformedInput)}`);
      });
    });

    it('RouletteEngine.placeBet should reject null, undefined, primitive, and empty payloads without throwing', () => {
      const pm = new PlayerManager();
      const engine = new RouletteEngine(pm);
      const player = pm.registerPlayer('s1', { name: 'Defender' });

      const malformedBets = [
        null,
        undefined,
        'not_a_bet',
        99999,
        true,
        false
      ];

      malformedBets.forEach((input) => {
        const result = engine.placeBet(player.id, input);
        assert.equal(result.success, false);
        assert.equal(result.code, 'INVALID_PAYLOAD');
      });

      // Array or empty object
      const emptyResult = engine.placeBet(player.id, {});
      assert.equal(emptyResult.success, false);

      const arrayResult = engine.placeBet(player.id, []);
      assert.equal(arrayResult.success, false);

      engine.stop();
    });
  });

  describe('Socket Network-Level Adversarial Stress Test', () => {
    let server;
    let socketHandler;
    let serverPort;
    let clientSocket;

    before(async () => {
      server = http.createServer(app);
      socketHandler = setupSocket(server);

      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          serverPort = server.address().port;
          resolve();
        });
      });
    });

    after(async () => {
      if (clientSocket && clientSocket.connected) {
        clientSocket.disconnect();
      }
      if (socketHandler && socketHandler.engine) {
        socketHandler.engine.stop();
      }
      if (socketHandler && socketHandler.io) {
        await new Promise((resolve) => socketHandler.io.close(resolve));
      }
      await new Promise((resolve) => server.close(resolve));
    });

    it('should connect and survive malformed join_table payloads', async () => {
      clientSocket = Client(`http://127.0.0.1:${serverPort}`, {
        transports: ['websocket'],
        forceNew: true
      });

      await new Promise((resolve) => clientSocket.on('connect', resolve));

      // Array of malformed payloads sent to join_table
      const malformedPayloads = [null, undefined, 'bad_string', 12345, [1, 2, 3], {}];

      for (const payload of malformedPayloads) {
        const tableStatePromise = new Promise((resolve) => {
          clientSocket.once('table_state', resolve);
        });

        clientSocket.emit('join_table', payload);

        const state = await tableStatePromise;
        assert.ok(state, 'table_state must be emitted without crash');
        assert.ok(Array.isArray(state.players), 'players array must be present');
      }
    });

    it('should reject malformed place_bet payloads gracefully with bet_rejected', async () => {
      const invalidBets = [
        null,
        undefined,
        'string_bet',
        12345,
        false,
        [],
        [1, 2, 3],
        {},
        { type: null, value: null, amount: null },
        { type: 'straight', value: 99, amount: -100 },
        { type: 'unknown_type', value: 0, amount: 100 }
      ];

      for (const bet of invalidBets) {
        const rejectionPromise = new Promise((resolve) => {
          clientSocket.once('bet_rejected', resolve);
        });

        clientSocket.emit('place_bet', bet);

        const rejection = await rejectionPromise;
        assert.ok(rejection.code, 'Must return rejection code');
        assert.ok(rejection.reason, 'Must return rejection reason');
      }
    });

    it('should ignore malformed chat_message payloads without crashing or throwing', async () => {
      const malformedChats = [
        null,
        undefined,
        'bare_string_not_object',
        12345,
        true,
        [],
        ['some', 'array'],
        {},
        { text: null },
        { text: 12345 },
        { text: '' },
        { text: '   ' }
      ];

      // None of these should throw or crash the server. We emit them all rapidly.
      for (const chat of malformedChats) {
        clientSocket.emit('chat_message', chat);
      }

      // Allow event loop ticks to process all messages
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now verify server is still responsive by sending a legitimate chat message
      const legitPromise = new Promise((resolve) => {
        const onChat = (msg) => {
          if (!msg.isSystem && msg.text === 'Server is healthy and responsive!') {
            clientSocket.off('chat_message', onChat);
            resolve(msg);
          }
        };
        clientSocket.on('chat_message', onChat);
      });

      clientSocket.emit('chat_message', { text: 'Server is healthy and responsive!' });

      const received = await legitPromise;
      assert.ok(received);
      assert.equal(received.text, 'Server is healthy and responsive!');
    });

    it('should still process valid bets and game operations after surviving attacks', async () => {
      const betAcceptedPromise = new Promise((resolve) => {
        clientSocket.once('bet_accepted', resolve);
      });

      clientSocket.emit('place_bet', {
        type: BET_TYPES.RED,
        value: null,
        amount: 200
      });

      const accepted = await betAcceptedPromise;
      assert.equal(accepted.bet.type, 'red');
      assert.equal(accepted.bet.amount, 200);
      assert.equal(accepted.remainingChips, 9800);
    });
  });
});
