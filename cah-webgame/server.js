const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cardsData = require('./cards.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const lobbies = {};

function generateRoomCode() {
    let code;
    do { code = Math.random().toString(36).substring(2, 6).toUpperCase(); } while (lobbies[code]);
    return code;
}

function initLobby(hostId, mode) {
    return {
        hostId: hostId,
        mode: mode,
        settings: { useTimer: true, timeLimit: 60, scoreLimit: 10 },
        players: [],
        whiteDeck: [...cardsData.whiteCards].sort(() => Math.random() - 0.5),
        blackDeck: [...cardsData.blackCards].sort(() => Math.random() - 0.5),
        currentCzarIndex: -1,
        currentBlackCard: null,
        submittedCards: [],
        votes: [],
        gameState: 'lobby',
        timer: null
    };
}

function drawWhiteCards(lobby, count) {
    if (lobby.whiteDeck.length < count) {
        lobby.whiteDeck = [...cardsData.whiteCards].sort(() => Math.random() - 0.5);
    }
    return lobby.whiteDeck.splice(0, count);
}

function getActivePlayers(lobby) {
    return lobby.players.filter(p => !p.isSpectator);
}

function startCzarPickingPhase(roomCode) {
    const lobby = lobbies[roomCode];
    const activePlayers = getActivePlayers(lobby);
    if (!lobby || activePlayers.length < 3) return;

    lobby.gameState = 'czar_picking';
    lobby.submittedCards = [];

    lobby.currentCzarIndex = (lobby.currentCzarIndex + 1) % activePlayers.length;
    const czar = activePlayers[lobby.currentCzarIndex];

    const options = [];
    for(let i=0; i<3; i++) {
        if(lobby.blackDeck.length === 0) lobby.blackDeck = [...cardsData.blackCards].sort(() => Math.random() - 0.5);
        options.push(lobby.blackDeck.pop());
    }

    io.to(roomCode).emit('czarPicking', { czarId: czar.id, options: options });
}

function startNextRound(roomCode) {
    const lobby = lobbies[roomCode];
    if (!lobby) return;
    clearTimeout(lobby.timer);

    if (lobby.mode === 'normal') {
        startCzarPickingPhase(roomCode);
    } else {
        startPlayingPhase(lobby, roomCode, null);
    }
}

function startPlayingPhase(lobby, roomCode, czarId) {
    lobby.gameState = 'playing';
    lobby.submittedCards = [];
    lobby.votes = [];

    if (!lobby.currentBlackCard || lobby.mode === 'vote') {
        if(lobby.blackDeck.length === 0) lobby.blackDeck = [...cardsData.blackCards].sort(() => Math.random() - 0.5);
        lobby.currentBlackCard = lobby.blackDeck.pop();
    }

    const duration = lobby.settings.timeLimit * 1000;
    const endTime = lobby.settings.useTimer ? Date.now() + duration : null;

    io.to(roomCode).emit('newRound', {
        blackCard: lobby.currentBlackCard,
        czarId: czarId,
        state: lobby.gameState,
        endTime: endTime
    });

    if (lobby.settings.useTimer) {
        lobby.timer = setTimeout(() => {
            forceSubmitMissing(lobby, roomCode);
        }, duration);
    }
}

function forceSubmitMissing(lobby, roomCode) {
    const activePlayers = getActivePlayers(lobby);
    activePlayers.forEach(p => {
        if (lobby.mode === 'normal' && p.id === activePlayers[lobby.currentCzarIndex].id) return;

        const hasSubmitted = lobby.submittedCards.some(s => s.playerId === p.id);
        if (!hasSubmitted) {
            const required = lobby.currentBlackCard.pick || 1;
            const randomCards = p.hand.splice(0, required);
            lobby.submittedCards.push({ playerId: p.id, cards: randomCards });
        }
    });
    triggerJudgingPhase(lobby, roomCode);
}

function triggerJudgingPhase(lobby, roomCode) {
    clearTimeout(lobby.timer);
    lobby.gameState = 'judging';
    lobby.submittedCards.sort(() => Math.random() - 0.5);

    const judgingDuration = Math.max(15000, (lobby.settings.timeLimit * 1000) / 2); // Halbe Lege-Zeit, min 15s
    const endTime = lobby.settings.useTimer ? Date.now() + judgingDuration : null;

    io.to(roomCode).emit('allCardsSubmitted', { submissions: lobby.submittedCards, endTime: endTime });

    if (lobby.settings.useTimer) {
        lobby.timer = setTimeout(() => {
            if (lobby.mode === 'vote') {
                evaluateVotes(lobby, roomCode);
            } else {
                if (lobby.submittedCards.length > 0) {
                    const randomSub = lobby.submittedCards[Math.floor(Math.random() * lobby.submittedCards.length)];
                    finalizeRound(lobby, roomCode, [randomSub.playerId]);
                } else {
                    startNextRound(roomCode);
                }
            }
        }, judgingDuration);
    }
}

function evaluateVotes(lobby, roomCode) {
    if (lobby.votes.length === 0) {
        finalizeRound(lobby, roomCode, []);
        return;
    }

    const counts = {};
    lobby.votes.forEach(vote => {
        const weight = (vote.voter === vote.votedFor) ? 0.5 : 1;
        counts[vote.votedFor] = (counts[vote.votedFor] || 0) + weight;
    });

    let maxPoints = -1;
    for (let id in counts) { if (counts[id] > maxPoints) maxPoints = counts[id]; }

    const winners = Object.keys(counts).filter(id => counts[id] === maxPoints);
    finalizeRound(lobby, roomCode, winners);
}

function finalizeRound(lobby, roomCode, winnerIds) {
    clearTimeout(lobby.timer);

    winnerIds.forEach(id => {
        const winner = lobby.players.find(p => p.id === id);
        if (winner) winner.score += 1;
    });

    const endTime = Date.now() + 5000;
    io.to(roomCode).emit('roundWinner', { winnerIds: winnerIds, endTime: endTime });
    io.to(roomCode).emit('lobbyUpdate', lobby.players);

    // Sieg-Bedingung prüfen
    const isGameOver = lobby.players.some(p => p.score >= lobby.settings.scoreLimit);
    if (isGameOver) {
        const overallWinner = lobby.players.reduce((prev, current) => (prev.score > current.score) ? prev : current);
        setTimeout(() => {
            io.to(roomCode).emit('gameOver', { aborted: false, winnerName: overallWinner.name });
            delete lobbies[roomCode];
        }, 5000);
        return;
    }

    getActivePlayers(lobby).forEach(p => {
        p.hand = drawWhiteCards(lobby, 10);
        io.to(p.id).emit('updateHand', p.hand);
    });

    lobby.timer = setTimeout(() => startNextRound(roomCode), 5000);
}

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('createLobby', (data) => {
        const roomCode = generateRoomCode();
        lobbies[roomCode] = initLobby(socket.id, data.mode);
        joinRoom(socket, roomCode, data.username, true);
    });

    socket.on('joinLobby', (data) => {
        const { username, roomCode } = data;
        if (!lobbies[roomCode]) return socket.emit('lobbyError', 'Lobby existiert nicht.');
        if (lobbies[roomCode].gameState !== 'lobby') return socket.emit('lobbyError', 'Spiel läuft bereits.');
        joinRoom(socket, roomCode, username, false);
    });

    function joinRoom(socket, roomCode, username, isHost) {
        currentRoom = roomCode;
        socket.join(roomCode);

        const lobby = lobbies[roomCode];
        const isSpectator = username.trim().toLowerCase() === 'host';

        const newPlayer = {
            id: socket.id,
            name: isSpectator ? 'Zuschauer' : username,
            hand: isSpectator ? [] : drawWhiteCards(lobby, 10),
            score: 0,
            isSpectator: isSpectator
        };
        lobby.players.push(newPlayer);

        socket.emit('lobbyJoined', { roomCode, player: newPlayer, isHost, mode: lobby.mode, settings: lobby.settings });
        io.to(roomCode).emit('lobbyUpdate', lobby.players);
    }

    socket.on('updateSettings', (data) => {
        const lobby = lobbies[data.roomCode];
        if (lobby && lobby.hostId === socket.id && lobby.gameState === 'lobby') {
            lobby.settings = data.settings;
            io.to(data.roomCode).emit('settingsUpdated', lobby.settings);
        }
    });

    socket.on('startGame', (roomCode) => {
        const lobby = lobbies[roomCode];
        if (lobby && lobby.hostId === socket.id && getActivePlayers(lobby).length >= 3) {
            startNextRound(roomCode);
        }
    });

    socket.on('endGame', (roomCode) => {
        const lobby = lobbies[roomCode];
        if (lobby && lobby.hostId === socket.id) {
            io.to(roomCode).emit('gameOver', { aborted: true });
            clearTimeout(lobby.timer);
            delete lobbies[roomCode];
        }
    });

    socket.on('selectBlackCard', (data) => {
        const lobby = lobbies[data.roomCode];
        if (!lobby || lobby.gameState !== 'czar_picking') return;
        lobby.currentBlackCard = data.card;
        startPlayingPhase(lobby, data.roomCode, socket.id);
    });

    socket.on('submitCards', (data) => {
        const lobby = lobbies[data.roomCode];
        if (!lobby || lobby.gameState !== 'playing') return;

        lobby.submittedCards.push({ playerId: socket.id, cards: data.cards });
        const player = lobby.players.find(p => p.id === socket.id);
        if(player) player.hand = player.hand.filter(c => !data.cards.includes(c));

        const activePlayers = getActivePlayers(lobby);
        const requiredSubmissions = lobby.mode === 'vote' ? activePlayers.length : activePlayers.length - 1;

        if (lobby.submittedCards.length >= requiredSubmissions) {
            triggerJudgingPhase(lobby, data.roomCode);
        }
    });

    socket.on('pickWinner', (data) => {
        const lobby = lobbies[data.roomCode];
        if (!lobby || lobby.gameState !== 'judging') return;
        finalizeRound(lobby, data.roomCode, [data.winningPlayerId]);
    });

    socket.on('voteWinner', (data) => {
        const lobby = lobbies[data.roomCode];
        if (!lobby || lobby.gameState !== 'judging') return;

        if (!lobby.votes.some(v => v.voter === socket.id)) {
            lobby.votes.push({ voter: socket.id, votedFor: data.votedPlayerId });
        }

        if (lobby.votes.length >= getActivePlayers(lobby).length) {
            evaluateVotes(lobby, data.roomCode);
        }
    });

    socket.on('disconnect', () => {
        if (!currentRoom || !lobbies[currentRoom]) return;
        const lobby = lobbies[currentRoom];
        lobby.players = lobby.players.filter(p => p.id !== socket.id);
        io.to(currentRoom).emit('lobbyUpdate', lobby.players);

        if (lobby.players.length === 0) {
            clearTimeout(lobby.timer);
            delete lobbies[currentRoom];
        } else if (lobby.hostId === socket.id) {
            lobby.hostId = lobby.players[0].id;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server läuft auf Port ${PORT}`); });