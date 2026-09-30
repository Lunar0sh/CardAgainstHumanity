const socket = io();

// UI Elemente
const lobbyMenu = document.getElementById('lobby-menu');
const waitingRoom = document.getElementById('waiting-room');
const gameUi = document.getElementById('game-ui');
const waitingRoomCode = document.getElementById('waiting-room-code');
const playerList = document.getElementById('player-list');
const gameLeaderboard = document.getElementById('game-leaderboard');
const startGameBtn = document.getElementById('start-game-btn');
const waitingText = document.getElementById('waiting-text');
const czarSelectionArea = document.getElementById('czar-selection');
const blackCardOptionsArea = document.getElementById('black-card-options');
const confirmBlackCardBtn = document.getElementById('confirm-black-card-btn');
const confirmWinnerBtn = document.getElementById('confirm-winner-btn');
const statusText = document.getElementById('status-text');
const myScoreEl = document.getElementById('my-score');
const blackCardEl = document.getElementById('black-card');
const handEl = document.getElementById('hand');
const submittedAreaEl = document.getElementById('submitted-area');
const submitBtn = document.getElementById('submit-btn');
const handWrapper = document.getElementById('hand-wrapper');
const playerArea = document.getElementById('player-area');

// Settings & Action Buttons
const hostSettings = document.getElementById('host-settings');
const settingTimer = document.getElementById('setting-timer');
const settingTime = document.getElementById('setting-time');
const settingJudging = document.getElementById('setting-judging');
const settingScore = document.getElementById('setting-score');

const valTime = document.getElementById('val-time');
const valJudging = document.getElementById('val-judging');
const valScore = document.getElementById('val-score');
const infoTimer = document.getElementById('info-timer');
const infoScore = document.getElementById('info-score');
const extensionsStatus = document.getElementById('extensions-status');

const leaveGameBtn = document.getElementById('leave-game-btn');
const endGameBtn = document.getElementById('end-game-btn');

// Timer
const timerContainer = document.getElementById('timer-container');
const timerBar = document.getElementById('timer-bar');
const timerText = document.getElementById('timer-text');

// Modals
const rulesModal = document.getElementById('rules-modal');
const openRulesBtn = document.getElementById('open-rules-btn');
const closeRulesBtn = document.getElementById('close-rules-btn');
const gameOverModal = document.getElementById('game-over-modal');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverMessage = document.getElementById('game-over-message');
const backToLobbyBtn = document.getElementById('back-to-lobby-btn');

const toastContainer = document.getElementById('toast-container');

// State
let myId = null;
let roomCode = null;
let gameMode = 'normal';
let isHost = false;
let isCzar = false;
let isSpectator = false;
let currentGameState = 'waiting';
let requiredPicks = 1;
let selectedCards = [];
let selectedBlackCard = null;
let selectedCardToWin = null;
let originalBlackCardText = "";
let currentSubmittedCards = [];
let timerInterval = null;

// ==========================================
// TOAST BENACHRICHTIGUNGEN
// ==========================================
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        if(toast.parentElement) toast.remove();
    }, 4000);
}

socket.on('playerLeft', (playerName) => {
    showToast(`🚪 ${playerName} hat das Spiel verlassen.`);
});

// ==========================================
// MODAL LOGIK
// ==========================================
openRulesBtn.onclick = () => rulesModal.classList.remove('hidden');
closeRulesBtn.onclick = () => rulesModal.classList.add('hidden');
backToLobbyBtn.onclick = () => window.location.reload();

window.onclick = (event) => {
    if (event.target === rulesModal) rulesModal.classList.add('hidden');
};

// ==========================================
// SETTINGS SLIDER & LOBBY LOGIK
// ==========================================

function sendSettings() {
    if(!isHost) return;
    socket.emit('updateSettings', {
        roomCode,
        settings: {
            useTimer: settingTimer.checked,
            timeLimit: parseInt(settingTime.value),
            judgingTimeLimit: parseInt(settingJudging.value),
            scoreLimit: parseInt(settingScore.value)
        }
    });
}
settingTimer.addEventListener('change', sendSettings);
settingTime.addEventListener('change', sendSettings);
settingJudging.addEventListener('change', sendSettings);
settingScore.addEventListener('change', sendSettings);

socket.on('settingsUpdated', (settings) => {
    settingTimer.checked = settings.useTimer;
    settingTime.value = settings.timeLimit;
    settingJudging.value = settings.judgingTimeLimit;
    settingScore.value = settings.scoreLimit;

    if (valTime) valTime.innerText = settings.timeLimit + 's';
    if (valJudging) valJudging.innerText = settings.judgingTimeLimit + 's';
    if (valScore) valScore.innerText = settings.scoreLimit + ' Pkt';

    const timerSettingsWrapper = document.getElementById('timer-settings-wrapper');
    if (timerSettingsWrapper) {
        timerSettingsWrapper.style.opacity = settings.useTimer ? '1' : '0.4';
        timerSettingsWrapper.style.pointerEvents = settings.useTimer ? 'auto' : 'none';
    }

    infoTimer.innerText = settings.useTimer ? `An (${settings.timeLimit}s / ${settings.judgingTimeLimit}s)` : "Aus";
    infoScore.innerText = settings.scoreLimit;
});

leaveGameBtn.onclick = () => window.location.reload();
endGameBtn.onclick = () => {
    if(confirm("Möchtest du das Spiel für alle abbrechen?")) {
        socket.emit('endGame', roomCode);
    }
};

socket.on('gameOver', (data) => {
    if (data.aborted) {
        gameOverTitle.innerText = "SPIEL ABGEBROCHEN";
        gameOverMessage.innerText = "Der Host hat das Spiel beendet.";
        gameOverTitle.style.color = "var(--danger)";
    } else {
        gameOverTitle.innerText = "SPIEL BEENDET!";
        gameOverMessage.innerText = `${data.winnerName} hat das Punkte-Ziel erreicht und gewinnt!`;
    }
    gameOverModal.classList.remove('hidden');
});

// ==========================================
// TIMER LOGIK
// ==========================================
function startLocalTimer(endTime) {
    clearInterval(timerInterval);
    if (!endTime) {
        timerContainer.classList.add('hidden');
        return;
    }

    timerContainer.classList.remove('hidden');
    const totalDuration = endTime - Date.now();

    timerInterval = setInterval(() => {
        const remaining = endTime - Date.now();
        if (remaining <= 0) {
            clearInterval(timerInterval);
            timerBar.style.width = '0%';
            timerText.innerText = "0s";
            return;
        }

        const percentage = (remaining / totalDuration) * 100;
        timerBar.style.width = `${percentage}%`;
        timerText.innerText = `${Math.ceil(remaining / 1000)}s`;

        if (percentage < 25) {
            timerBar.style.backgroundColor = '#cf6679';
        } else {
            timerBar.style.backgroundColor = 'var(--accent)';
        }
    }, 100);
}

// ==========================================
// SPIEL LOGIK & RENDERING
// ==========================================

handWrapper.addEventListener('wheel', (evt) => {
    evt.preventDefault();
    handWrapper.scrollLeft += evt.deltaY;
});

function updateBlackCardPreview(whiteTexts) {
    if (!whiteTexts || whiteTexts.length === 0) {
        blackCardEl.innerHTML = originalBlackCardText;
        return;
    }
    let filledText = originalBlackCardText;
    if (filledText.includes('____')) {
        whiteTexts.forEach(text => {
            let cleanText = text.replace(/\.$/, '');
            filledText = filledText.replace('____', `<span class="filled-blank">${cleanText}</span>`);
        });
        blackCardEl.innerHTML = filledText;
    } else {
        blackCardEl.innerHTML = originalBlackCardText + `<br><br><span class="filled-blank">${whiteTexts[0].replace(/\.$/, '')}</span>`;
    }
}

function renderHand(cards) {
    handEl.innerHTML = '';
    cards.forEach((cardText, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card white';
        cardDiv.innerText = cardText;
        cardDiv.style.animation = `dealCard 0.4s cubic-bezier(0.25, 0.8, 0.25, 1) forwards`;
        cardDiv.style.animationDelay = `${index * 0.05}s`;

        cardDiv.onclick = () => {
            if (isCzar || isSpectator || currentGameState !== 'playing') return;

            if (selectedCards.includes(cardText)) {
                selectedCards = selectedCards.filter(c => c !== cardText);
                cardDiv.classList.remove('selected');
            } else {
                if (selectedCards.length < requiredPicks) {
                    selectedCards.push(cardText);
                    cardDiv.classList.add('selected');
                } else if (requiredPicks === 1) {
                    selectedCards = [cardText];
                    Array.from(handEl.children).forEach(c => c.classList.remove('selected'));
                    cardDiv.classList.add('selected');
                }
            }
            submitBtn.disabled = selectedCards.length !== requiredPicks;
            updateBlackCardPreview(selectedCards);
        };
        handEl.appendChild(cardDiv);
    });
}

document.getElementById('create-lobby-btn').onclick = () => {
    const username = document.getElementById('username').value.trim();
    const mode = document.getElementById('game-mode-select').value;
    if (username) socket.emit('createLobby', { username, mode });
};

document.getElementById('join-lobby-btn').onclick = () => {
    const username = document.getElementById('username').value.trim();
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (username && code) socket.emit('joinLobby', { username, roomCode: code });
};

socket.on('lobbyJoined', (data) => {
    myId = data.player.id;
    roomCode = data.roomCode;
    isHost = data.isHost;
    gameMode = data.mode;
    isSpectator = data.player.isSpectator;

    if(isSpectator) playerArea.classList.add('hidden');
    if(isHost) {
        hostSettings.classList.remove('hidden');
        endGameBtn.classList.remove('hidden');
    }

    if (data.hasExtensions) {
        extensionsStatus.innerText = "Aktiviert ✅";
        extensionsStatus.classList.add('active');
    } else {
        extensionsStatus.innerText = "Keine gefunden";
        extensionsStatus.classList.remove('active');
    }

    lobbyMenu.classList.add('hidden');
    waitingRoom.classList.remove('hidden');
    waitingRoomCode.innerText = roomCode;
    document.getElementById('mode-display').innerText = gameMode === 'normal' ? 'Modus: Kartenmeister' : 'Modus: Demokratie (Abstimmung)';
    document.getElementById('display-room-code').innerText = roomCode;
    document.getElementById('my-username').innerText = data.player.name;
    myScoreEl.innerText = data.player.score;

    settingTimer.checked = data.settings.useTimer;
    settingTime.value = data.settings.timeLimit;
    settingJudging.value = data.settings.judgingTimeLimit;
    settingScore.value = data.settings.scoreLimit;

    if (valTime) valTime.innerText = data.settings.timeLimit + 's';
    if (valJudging) valJudging.innerText = data.settings.judgingTimeLimit + 's';
    if (valScore) valScore.innerText = data.settings.scoreLimit + ' Pkt';

    infoTimer.innerText = data.settings.useTimer ? `An (${data.settings.timeLimit}s / ${data.settings.judgingTimeLimit}s)` : "Aus";
    infoScore.innerText = data.settings.scoreLimit;

    if(!isSpectator) renderHand(data.player.hand);
});

socket.on('lobbyUpdate', (players) => {
    players.sort((a, b) => b.score - a.score);
    playerList.innerHTML = '';
    gameLeaderboard.innerHTML = '';

    let activeCount = 0;
    players.forEach(p => {
        if (!p.isSpectator) activeCount++;
        const scoreDisplay = p.score % 1 === 0 ? p.score : p.score.toFixed(1);

        const li1 = document.createElement('li');
        li1.innerText = `${p.name} ${p.score > 0 ? `(${scoreDisplay} Pkt)` : ''}`;
        if(p.isSpectator) li1.innerText += ' 👁️';
        playerList.appendChild(li1);

        if (!p.isSpectator) {
            const li2 = document.createElement('li');
            li2.innerHTML = `<span>${p.name}</span> <strong>${scoreDisplay}</strong>`;
            if(p.id === myId) {
                li2.style.borderColor = '#ffd700';
                myScoreEl.innerText = scoreDisplay;
            }
            gameLeaderboard.appendChild(li2);
        }
    });

    if (isHost) {
        if (activeCount >= 3) {
            startGameBtn.classList.remove('hidden');
            waitingText.classList.add('hidden');
        } else {
            startGameBtn.classList.add('hidden');
            waitingText.classList.remove('hidden');
            waitingText.innerText = `Warte auf Spieler... (${activeCount}/3 aktive)`;
        }
    }
});

startGameBtn.onclick = () => { socket.emit('startGame', roomCode); };

socket.on('czarPicking', (data) => {
    waitingRoom.classList.add('hidden');
    gameUi.classList.remove('hidden');
    currentGameState = 'czar_picking';
    isCzar = (data.czarId === myId);

    if(!isSpectator) handWrapper.classList.add('hidden');
    blackCardEl.classList.add('hidden');
    submittedAreaEl.innerHTML = '';
    submitBtn.disabled = true;
    confirmWinnerBtn.classList.add('hidden');
    selectedCards = [];
    currentSubmittedCards = [];

    clearInterval(timerInterval);
    timerContainer.classList.add('hidden');

    if (isCzar) {
        statusText.innerText = "Wähle deine schwarze Karte für diese Runde!";
        czarSelectionArea.classList.remove('hidden');
        blackCardOptionsArea.innerHTML = '';
        selectedBlackCard = null;
        confirmBlackCardBtn.disabled = true;

        data.options.forEach((card, index) => {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'card black';
            cardDiv.innerText = card.text;
            if(card.pick > 1) cardDiv.innerHTML += `<br><br><em>(Pick ${card.pick})</em>`;

            cardDiv.style.animation = `dealCard 0.5s forwards`;
            cardDiv.style.animationDelay = `${index * 0.1}s`;

            cardDiv.onclick = () => {
                Array.from(blackCardOptionsArea.children).forEach(c => c.classList.remove('selected'));
                cardDiv.classList.add('selected');
                selectedBlackCard = card;
                confirmBlackCardBtn.disabled = false;
            };
            blackCardOptionsArea.appendChild(cardDiv);
        });
    } else {
        czarSelectionArea.classList.add('hidden');
        statusText.innerText = "Der Kartenmeister sucht eine schwarze Karte aus...";
    }
});

confirmBlackCardBtn.onclick = () => {
    if (selectedBlackCard) {
        socket.emit('selectBlackCard', { roomCode, card: selectedBlackCard });
        czarSelectionArea.classList.add('hidden');
    }
};

socket.on('newRound', (data) => {
    waitingRoom.classList.add('hidden');
    gameUi.classList.remove('hidden');

    currentGameState = data.state;
    isCzar = (data.czarId === myId);
    requiredPicks = data.blackCard.pick || 1;
    selectedCards = [];
    selectedCardToWin = null;
    currentSubmittedCards = [];
    originalBlackCardText = data.blackCard.text;

    startLocalTimer(data.endTime);

    czarSelectionArea.classList.add('hidden');
    blackCardEl.classList.remove('hidden');
    blackCardEl.innerHTML = originalBlackCardText;
    if(requiredPicks > 1) blackCardEl.innerHTML += `<br><br><em>(Pick ${requiredPicks})</em>`;

    blackCardEl.style.animation = `dealCard 0.4s forwards`;
    submittedAreaEl.innerHTML = '';
    submitBtn.disabled = true;
    submitBtn.innerText = requiredPicks > 1 ? `Karten legen (${requiredPicks})` : "Karte legen";
    confirmWinnerBtn.classList.add('hidden');

    if (!isSpectator) {
        handWrapper.classList.remove('hidden');
        Array.from(handEl.children).forEach(c => {
            c.classList.remove('grayed-out');
            c.classList.remove('selected');
        });
    }

    if (isSpectator) {
        statusText.innerText = "Spieler wählen ihre Karten...";
    } else if (gameMode === 'vote') {
        statusText.innerText = requiredPicks > 1 ? `Wähle ${requiredPicks} weiße Karten!` : "Wähle eine weiße Karte!";
    } else {
        if (isCzar) {
            statusText.innerText = "Warte, bis alle Mitspieler ihre Karten gelegt haben.";
            handWrapper.classList.add('hidden');
        } else {
            statusText.innerText = requiredPicks > 1 ? `Wähle ${requiredPicks} weiße Karten!` : "Wähle eine weiße Karte!";
        }
    }
});

socket.on('updateHand', (newHand) => {
    if(!isSpectator) renderHand(newHand);
});

submitBtn.onclick = () => {
    if (selectedCards.length === requiredPicks) {
        socket.emit('submitCards', { roomCode, cards: selectedCards });
        submitBtn.disabled = true;
        statusText.innerText = "Karten abgelegt. Warte auf andere...";

        Array.from(handEl.children).forEach(c => {
            if (c.classList.contains('selected')) {
                c.remove();
            } else {
                c.classList.add('grayed-out');
            }
        });
        selectedCards = [];
    }
};

socket.on('allCardsSubmitted', (data) => {
    currentGameState = 'judging';
    currentSubmittedCards = data.submissions;
    if(!isSpectator) handWrapper.classList.add('hidden');

    startLocalTimer(data.endTime);

    if (isSpectator) {
        statusText.innerText = (gameMode === 'vote') ? "Spieler stimmen ab!" : "Kartenmeister entscheidet!";
    } else {
        statusText.innerText = (gameMode === 'vote') ? "Wähle deinen Favoriten (Die eigene Karte gibt nur 0.5)!" : (isCzar ? "Decke die Karten auf und wähle den Gewinner!" : "Der Kartenmeister entscheidet.");
    }

    submittedAreaEl.innerHTML = '';
    confirmWinnerBtn.disabled = true;

    data.submissions.forEach((submission, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card white';
        cardDiv.dataset.playerId = submission.playerId;

        // FIX: Saubere Formatierung für Pick 2 Karten
        const cardContent = submission.cards.map(text => `<div class="pick-text">${text}</div>`).join('<div class="pick-divider"></div>');
        cardDiv.innerHTML = cardContent;

        cardDiv.style.animation = `dealCard 0.4s forwards`;
        cardDiv.style.animationDelay = `${index * 0.1}s`;

        if (!isSpectator && (isCzar || gameMode === 'vote')) {
            cardDiv.onclick = () => {
                Array.from(submittedAreaEl.children).forEach(c => c.classList.remove('selected'));
                cardDiv.classList.add('selected');
                selectedCardToWin = submission.playerId;

                confirmWinnerBtn.classList.remove('hidden');
                confirmWinnerBtn.disabled = false;
                updateBlackCardPreview(submission.cards);
            };
        }

        if (!isSpectator && gameMode === 'vote' && submission.playerId === myId) {
            cardDiv.innerHTML += '<div class="my-card-label">(Deine Karte)</div>';
        }

        submittedAreaEl.appendChild(cardDiv);
    });
});

confirmWinnerBtn.onclick = () => {
    if (selectedCardToWin) {
        if (gameMode === 'vote') {
            socket.emit('voteWinner', { roomCode, votedPlayerId: selectedCardToWin });
            statusText.innerText = "Stimme abgegeben. Warte auf die anderen...";
        } else {
            socket.emit('pickWinner', { roomCode, winningPlayerId: selectedCardToWin });
            isCzar = false;
        }
        confirmWinnerBtn.classList.add('hidden');
        Array.from(submittedAreaEl.children).forEach(c => c.style.pointerEvents = 'none');
    }
};

socket.on('roundWinner', (data) => {
    startLocalTimer(data.endTime);

    Array.from(submittedAreaEl.children).forEach(c => {
        if (data.winnerIds.includes(c.dataset.playerId)) {
            c.classList.remove('grayed-out');
            c.classList.add('selected');
            c.style.borderColor = '#ffd700';
            c.style.boxShadow = '0 0 40px rgba(255, 215, 0, 0.8), 0 15px 25px rgba(0,0,0,0.8)';
            c.style.transform = 'translateY(-30px) scale(1.1)';
            c.style.zIndex = '50';
        } else {
            c.classList.remove('selected');
            c.classList.add('grayed-out');
        }
    });

    const winningSubmission = currentSubmittedCards.find(s => data.winnerIds.includes(s.playerId));
    if (winningSubmission) {
        updateBlackCardPreview(winningSubmission.cards);
    }

    if (data.winnerIds.includes(myId)) {
        statusText.innerText = "🏆 Du hast die Runde gewonnen!";
    } else {
        statusText.innerText = `🏆 Sieger steht fest! Neue Runde startet gleich...`;
    }
});