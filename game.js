(() => {
  const ROWS = 16;
  const COLS = 16;
  const MINES = 40;
  const INVERT_BASE = 999999;

  const boardEl = document.getElementById('ms-board');
  const minesLeftEl = document.getElementById('mines-left');
  const timerEl = document.getElementById('timer');
  const flagModeBtn = document.getElementById('flag-mode-btn');
  const newGameBtn = document.getElementById('new-game-btn');

  const startScreen = document.getElementById('start-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const startBtn = document.getElementById('start-btn');
  const restartBtn = document.getElementById('restart-btn');
  const gameoverTitleEl = document.getElementById('gameover-title');
  const finalTimeLineEl = document.getElementById('final-time-line');
  const bestTimeEl = document.getElementById('best-time');
  const startBestTimeEl = document.getElementById('start-best-time');
  const scoreSubmitEl = document.getElementById('score-submit');
  const callsignInput = document.getElementById('callsign-input');
  const submitScoreBtn = document.getElementById('submit-score-btn');
  const submitStatusEl = document.getElementById('submit-status');

  const BEST_TIME_KEY = 'minesweeperBestTime';
  const CALLSIGN_KEY = 'minesweeperCallsign';
  const LEADERBOARD_API = 'https://lab.slippylabs.com/api/scores/minesweeper';

  let cells = []; // flat array of {mine, revealed, flagged, adjacent, el}
  let gameState = 'ready'; // ready | playing | won | lost
  let firstClickDone = false;
  let flagCount = 0;
  let revealedSafeCount = 0;
  let elapsedSeconds = 0;
  let timerHandle = null;
  let flagModeOn = false;

  function idx(r, c) { return r * COLS + c; }
  function inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
  function neighbors(r, c) {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        if (inBounds(r + dr, c + dc)) out.push([r + dr, c + dc]);
      }
    }
    return out;
  }

  function getBestTime() {
    const v = parseInt(localStorage.getItem(BEST_TIME_KEY) || '', 10);
    return Number.isFinite(v) ? v : null;
  }
  function setBestTime(v) {
    localStorage.setItem(BEST_TIME_KEY, String(v));
  }
  function getCallsign() { return localStorage.getItem(CALLSIGN_KEY) || ''; }
  function setCallsign(v) { localStorage.setItem(CALLSIGN_KEY, v); }

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function refreshBestTimeLabels() {
    const best = getBestTime();
    startBestTimeEl.textContent = best === null ? '--:--' : formatTime(best);
  }

  function buildBoard() {
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
    cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const el = document.createElement('div');
        el.className = 'ms-cell hidden-tile';
        el.dataset.r = r;
        el.dataset.c = c;
        boardEl.appendChild(el);
        cells.push({ mine: false, revealed: false, flagged: false, adjacent: 0, el });
      }
    }
  }

  function placeMines(safeR, safeC) {
    const safeZone = new Set(neighbors(safeR, safeC).map(([r, c]) => idx(r, c)));
    safeZone.add(idx(safeR, safeC));

    const candidates = [];
    for (let i = 0; i < cells.length; i++) if (!safeZone.has(i)) candidates.push(i);
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (let i = 0; i < MINES; i++) cells[candidates[i]].mine = true;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (cells[idx(r, c)].mine) continue;
        let count = 0;
        for (const [nr, nc] of neighbors(r, c)) if (cells[idx(nr, nc)].mine) count++;
        cells[idx(r, c)].adjacent = count;
      }
    }
  }

  function updateMinesLeft() {
    minesLeftEl.textContent = String(MINES - flagCount);
  }

  function startTimer() {
    elapsedSeconds = 0;
    timerEl.textContent = '000';
    timerHandle = setInterval(() => {
      elapsedSeconds++;
      timerEl.textContent = String(Math.min(elapsedSeconds, 999)).padStart(3, '0');
    }, 1000);
  }
  function stopTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
  }

  function revealCell(r, c) {
    const cell = cells[idx(r, c)];
    if (cell.revealed || cell.flagged) return;

    // flood fill via stack, revealing zero-adjacency chains
    const stack = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      const cur = cells[idx(cr, cc)];
      if (cur.revealed || cur.flagged) continue;
      cur.revealed = true;
      revealedSafeCount++;
      cur.el.classList.remove('hidden-tile');
      cur.el.classList.add('revealed');
      if (cur.adjacent > 0) {
        cur.el.textContent = cur.adjacent;
        cur.el.classList.add('n' + cur.adjacent);
      } else {
        for (const [nr, nc] of neighbors(cr, cc)) {
          if (!cells[idx(nr, nc)].revealed) stack.push([nr, nc]);
        }
      }
    }
  }

  function revealAllMines(hitR, hitC) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = cells[idx(r, c)];
        if (cell.mine && !cell.flagged) {
          cell.el.classList.remove('hidden-tile');
          cell.el.classList.add('revealed', 'mine');
          cell.el.textContent = '\u{1F4A3}';
          if (r === hitR && c === hitC) cell.el.classList.add('mine-hit');
        } else if (cell.flagged && !cell.mine) {
          cell.el.classList.add('wrong-flag');
          cell.el.textContent = '\u{274C}';
        }
      }
    }
  }

  function flagAllMines() {
    for (const cell of cells) {
      if (cell.mine && !cell.flagged) {
        cell.flagged = true;
        cell.el.classList.add('flagged');
        cell.el.textContent = '\u{1F6A9}';
        flagCount++;
      }
    }
    updateMinesLeft();
  }

  function endGame(won, hitR, hitC) {
    gameState = won ? 'won' : 'lost';
    stopTimer();

    if (won) {
      flagAllMines();
      gameoverTitleEl.textContent = 'BOARD CLEARED';
      finalTimeLineEl.textContent = 'Time: ' + formatTime(elapsedSeconds);

      const best = getBestTime();
      const newBest = best === null || elapsedSeconds < best;
      if (newBest) setBestTime(elapsedSeconds);
      bestTimeEl.textContent = formatTime(newBest ? elapsedSeconds : best);

      scoreSubmitEl.classList.remove('hidden');
      callsignInput.value = getCallsign();
      submitStatusEl.textContent = '';
      submitStatusEl.className = 'submit-status';
      submitScoreBtn.disabled = false;
      submitScoreBtn.textContent = 'Submit to Leaderboard';
    } else {
      revealAllMines(hitR, hitC);
      gameoverTitleEl.textContent = 'BOOM';
      finalTimeLineEl.textContent = 'Hit a mine at ' + formatTime(elapsedSeconds);
      const best = getBestTime();
      bestTimeEl.textContent = best === null ? '--:--' : formatTime(best);
      scoreSubmitEl.classList.add('hidden');
    }

    gameoverScreen.classList.remove('hidden');
  }

  function checkWin() {
    if (revealedSafeCount === ROWS * COLS - MINES) endGame(true);
  }

  function handleReveal(r, c) {
    if (gameState === 'won' || gameState === 'lost') return;
    const cell = cells[idx(r, c)];
    if (cell.flagged || cell.revealed) return;

    if (!firstClickDone) {
      firstClickDone = true;
      placeMines(r, c);
      gameState = 'playing';
      startTimer();
    }

    if (cell.mine) {
      cell.el.classList.remove('hidden-tile');
      cell.el.classList.add('revealed');
      endGame(false, r, c);
      return;
    }

    revealCell(r, c);
    checkWin();
  }

  function handleFlagToggle(r, c) {
    if (gameState === 'won' || gameState === 'lost') return;
    const cell = cells[idx(r, c)];
    if (cell.revealed) return;
    cell.flagged = !cell.flagged;
    flagCount += cell.flagged ? 1 : -1;
    cell.el.classList.toggle('flagged', cell.flagged);
    cell.el.textContent = cell.flagged ? '\u{1F6A9}' : '';
    updateMinesLeft();
  }

  boardEl.addEventListener('click', (e) => {
    const target = e.target.closest('.ms-cell');
    if (!target) return;
    const r = parseInt(target.dataset.r, 10);
    const c = parseInt(target.dataset.c, 10);
    if (flagModeOn) handleFlagToggle(r, c);
    else handleReveal(r, c);
  });

  boardEl.addEventListener('contextmenu', (e) => {
    const target = e.target.closest('.ms-cell');
    e.preventDefault();
    if (!target) return;
    const r = parseInt(target.dataset.r, 10);
    const c = parseInt(target.dataset.c, 10);
    handleFlagToggle(r, c);
  });

  flagModeBtn.addEventListener('click', () => {
    flagModeOn = !flagModeOn;
    flagModeBtn.textContent = '\u{1F6A9} FLAG: ' + (flagModeOn ? 'ON' : 'OFF');
    flagModeBtn.classList.toggle('flag-active', flagModeOn);
  });

  function newBoard() {
    stopTimer();
    gameState = 'ready';
    firstClickDone = false;
    flagCount = 0;
    revealedSafeCount = 0;
    elapsedSeconds = 0;
    timerEl.textContent = '000';
    buildBoard();
    updateMinesLeft();
    gameoverScreen.classList.add('hidden');
    refreshBestTimeLabels();
  }
  newGameBtn.addEventListener('click', newBoard);
  startBtn.addEventListener('click', () => { startScreen.classList.add('hidden'); });
  restartBtn.addEventListener('click', newBoard);

  async function submitScore() {
    const name = callsignInput.value.trim();
    if (!name) {
      submitStatusEl.textContent = 'Enter a callsign first.';
      submitStatusEl.className = 'submit-status err';
      return;
    }

    setCallsign(name);
    submitScoreBtn.disabled = true;
    submitScoreBtn.textContent = 'Uplinking…';
    submitStatusEl.textContent = '';
    submitStatusEl.className = 'submit-status';

    try {
      const res = await fetch(LEADERBOARD_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, score: INVERT_BASE - elapsedSeconds }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        submitStatusEl.textContent = `Banked at rank #${data.rank} globally.`;
        submitStatusEl.className = 'submit-status ok';
        submitScoreBtn.textContent = 'Submitted';
      } else {
        submitStatusEl.textContent = data.error || 'Uplink failed. Try again.';
        submitStatusEl.className = 'submit-status err';
        submitScoreBtn.disabled = false;
        submitScoreBtn.textContent = 'Submit to Leaderboard';
      }
    } catch {
      submitStatusEl.textContent = 'Uplink lost. Check your connection.';
      submitStatusEl.className = 'submit-status err';
      submitScoreBtn.disabled = false;
      submitScoreBtn.textContent = 'Submit to Leaderboard';
    }
  }
  submitScoreBtn.addEventListener('click', submitScore);

  buildBoard();
  updateMinesLeft();
  refreshBestTimeLabels();
})();
