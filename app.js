const ROWS = 9;
const COLS = 7;
const MULTIPLIERS = [1.09, 1.2, 1.54, 2, 3.16, 5, 10, 20, 120];
const TRAP_PROBABILITY = [0.092, 0.092, 0.225, 0.225, 0.368, 0.368, 0.5, 0.5, 0.833];

const MODES = {
  shared: {
    kicker: "LIVE SHARED ROUND",
    title: "Get in. Read the room. Get out.",
    description: "Everyone moves one row at the same time. Choose one of the outlined tiles above you, then decide whether the next multiplier is worth the risk.",
    crowd: "12 thieves waiting",
    microcopy: "Test credits exist only in this browser. This uses the validated lockstep movement and deep-vault Warden configuration."
  },
  practice: {
    kicker: "PRIVATE PRACTICE VAULT",
    title: "Nothing to read but your nerve.",
    description: "The same risk curve without a crowd or Warden. Learn the route controls, feel the cash-out tension, and see whether the core loop works alone.",
    crowd: "Private map",
    microcopy: "Practice uses pure RNG traps and play credits. It is the always-on mode between shared rounds."
  },
  warden: {
    kicker: "ASYMMETRIC WARDEN SEAT",
    title: "Predict the crowd. Guard the deep vault.",
    description: "You hold the other side of the round. Place three traps where you think survivors will walk, then watch your kill income fight your share of core payouts.",
    crowd: "22 thieves assembling",
    microcopy: "Warden traps are limited to rows 6–9, one per row. A kill pays position value; the bond backs 50% of core payouts."
  }
};

const el = {
  balance: document.querySelector("#balance"),
  resetBalance: document.querySelector("#resetBalance"),
  modeButtons: [...document.querySelectorAll(".mode-button")],
  modeKicker: document.querySelector("#modeKicker"),
  modeTitle: document.querySelector("#modeTitle"),
  modeDescription: document.querySelector("#modeDescription"),
  betPanel: document.querySelector("#betPanel"),
  chips: [...document.querySelectorAll(".chip")],
  wardenInstructions: document.querySelector("#wardenInstructions"),
  trapCount: document.querySelector("#trapCount"),
  startButton: document.querySelector("#startButton"),
  escapeButton: document.querySelector("#escapeButton"),
  positionValue: document.querySelector("#positionValue"),
  payoutValue: document.querySelector("#payoutValue"),
  microcopy: document.querySelector("#microcopy"),
  roundStatusDot: document.querySelector("#roundStatusDot"),
  roundStatus: document.querySelector("#roundStatus"),
  crowdStatus: document.querySelector("#crowdStatus"),
  vaultFrame: document.querySelector("#vaultFrame"),
  vaultBoard: document.querySelector("#vaultBoard"),
  depthLabels: document.querySelector("#depthLabels"),
  entryToken: document.querySelector("#entryToken"),
  eventStrip: document.querySelector("#eventStrip"),
  ledgerList: document.querySelector("#ledgerList"),
  validationStrip: document.querySelector("#validationStrip"),
  feedbackNote: document.querySelector("#feedbackNote"),
  feedbackButtons: [...document.querySelectorAll("[data-feedback]")]
};

const storedBalanceRaw = localStorage.getItem("breach-demo-balance");
const storedBalance = storedBalanceRaw === null ? Number.NaN : Number(storedBalanceRaw);
const state = {
  mode: "shared",
  phase: "idle",
  balance: Number.isFinite(storedBalance) && storedBalance >= 0 ? storedBalance : 500,
  bet: 10,
  player: null,
  ai: [],
  rngTraps: new Set(),
  wardenTraps: new Set(),
  safeTiles: new Set(),
  deadTiles: new Set(),
  events: [],
  tick: 0,
  stepping: false,
  revealed: false,
  wardenIncome: 0,
  wardenBacking: 0,
  wardenKills: 0,
  coreHits: 0
};

function key(row, col) {
  return `${row}-${col}`;
}

function formatCredits(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function saveBalance() {
  localStorage.setItem("breach-demo-balance", String(state.balance));
  el.balance.textContent = formatCredits(state.balance);
}

function randomTrapMap() {
  const map = new Set();
  for (let row = 1; row <= ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (Math.random() < TRAP_PROBABILITY[row - 1]) map.add(key(row, col));
    }
  }
  return map;
}

function randomWardenMap() {
  const traps = new Set();
  const rows = [6, 7, 8, 9].sort(() => Math.random() - 0.5).slice(0, 3);
  rows.forEach((row) => {
    const weights = [1, 2, 4, 6, 4, 2, 1];
    traps.add(key(row, weightedIndex(weights)));
  });
  return traps;
}

function weightedIndex(weights) {
  const total = weights.reduce((sum, item) => sum + item, 0);
  let roll = Math.random() * total;
  for (let index = 0; index < weights.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return index;
  }
  return weights.length - 1;
}

function availableColumns(col) {
  return [col - 1, col, col + 1].filter((candidate) => candidate >= 0 && candidate < COLS);
}

function chooseCrowdColumn(col) {
  const options = availableColumns(col);
  const weights = options.map((candidate) => 5 - Math.abs(3 - candidate));
  return options[weightedIndex(weights)];
}

function sampleTarget() {
  const roll = Math.random();
  if (roll < 0.35) return 2;
  if (roll < 0.65) return 4;
  if (roll < 0.85) return 6;
  if (roll < 0.95) return 8;
  return 9;
}

function buildDepthLabels() {
  el.depthLabels.innerHTML = "";
  for (let row = ROWS; row >= 1; row -= 1) {
    const label = document.createElement("div");
    label.className = "depth-label";
    const important = [2, 4, 6, 8, 9].includes(row);
    label.innerHTML = important ? `<strong>×${formatCredits(MULTIPLIERS[row - 1])}</strong>` : `R${row}`;
    el.depthLabels.appendChild(label);
  }
}

function renderBoard() {
  el.vaultBoard.innerHTML = "";
  const crowdByTile = new Map();
  state.ai.filter((thief) => thief.alive && thief.row > 0).forEach((thief) => {
    const tileKey = key(thief.row, thief.col);
    crowdByTile.set(tileKey, (crowdByTile.get(tileKey) || 0) + 1);
  });

  for (let row = ROWS; row >= 1; row -= 1) {
    for (let col = 0; col < COLS; col += 1) {
      const tile = document.createElement("button");
      const tileKey = key(row, col);
      tile.type = "button";
      tile.className = "tile";
      tile.dataset.row = String(row);
      tile.dataset.col = String(col);
      tile.setAttribute("role", "gridcell");
      tile.setAttribute("aria-label", `Row ${row}, lane ${col + 1}`);

      if (row >= 6) tile.classList.add("deep-zone");
      if (state.safeTiles.has(tileKey)) tile.classList.add("safe-tile");
      if (state.deadTiles.has(tileKey)) tile.classList.add("dead-tile");

      let interactive = false;
      if (state.mode === "warden" && state.phase === "placing" && row >= 6) {
        tile.classList.add("warden-placeable", `heat-${Math.min(3, 4 - Math.abs(3 - col))}`);
        interactive = true;
      }

      if (state.wardenTraps.has(tileKey) && (state.mode === "warden" || state.revealed)) {
        tile.classList.add("warden-trap");
      } else if (state.revealed && state.rngTraps.has(tileKey)) {
        tile.classList.add("trap-tile");
      }

      if (isReachable(row, col)) {
        tile.classList.add("reachable");
        interactive = true;
      }
      tile.disabled = !interactive;

      const count = crowdByTile.get(tileKey) || 0;
      if (count > 0) {
        const crowd = document.createElement("span");
        crowd.className = "crowd-token";
        tile.appendChild(crowd);
        if (count > 1) {
          const number = document.createElement("span");
          number.className = "crowd-count";
          number.textContent = String(count);
          tile.appendChild(number);
        }
      }

      if (state.player && state.player.row === row && state.player.col === col) {
        const player = document.createElement("span");
        player.className = `player-token${state.player.alive ? "" : " dead"}`;
        player.innerHTML = "<span>YOU</span>";
        tile.appendChild(player);
      }

      el.vaultBoard.appendChild(tile);
    }
  }

  el.entryToken.hidden = Boolean(state.player && state.player.row > 0) || state.mode === "warden";
  el.entryToken.classList.toggle("dead", Boolean(state.player && !state.player.alive && state.player.row === 0));
}

function isReachable(row, col) {
  if (!state.player || state.phase !== "running" || state.stepping || !state.player.alive) return false;
  if (row !== state.player.row + 1) return false;
  return availableColumns(state.player.col).includes(col);
}

function renderLedger() {
  if (!state.events.length) {
    el.ledgerList.innerHTML = '<div class="ledger-empty">The vault has not opened yet.</div>';
    return;
  }
  el.ledgerList.innerHTML = state.events.slice(0, 8).map((event) => `
    <div class="ledger-item">
      <span>${event.label}</span>
      <strong class="${event.type || ""}">${event.value}</strong>
    </div>
  `).join("");
}

function addLedger(label, value, type = "") {
  state.events.unshift({ label, value, type });
  renderLedger();
}

function setEvent(message) {
  const seconds = String(state.tick * 3).padStart(2, "0");
  el.eventStrip.innerHTML = `<span class="event-time">00:${seconds}</span><p>${message}</p>`;
}

function setStatus(label, hot = false) {
  el.roundStatus.textContent = label;
  el.roundStatusDot.classList.toggle("hot", hot);
}

function updateReadout() {
  if (state.mode === "warden") {
    const net = state.wardenIncome - state.wardenBacking;
    el.positionValue.textContent = state.phase === "placing" ? "PLANNING" : `${state.wardenKills} KILLS`;
    el.payoutValue.textContent = `${net >= 0 ? "+" : ""}${formatCredits(net)}`;
    return;
  }

  if (!state.player || state.player.row === 0) {
    el.positionValue.textContent = "OUTSIDE";
    el.payoutValue.textContent = formatCredits(state.bet);
    return;
  }
  el.positionValue.textContent = state.player.alive ? `ROW ${state.player.row}` : "CAUGHT";
  const held = state.bet * MULTIPLIERS[state.player.row - 1];
  el.payoutValue.textContent = state.player.alive ? formatCredits(held) : "0";
}

function updateControls() {
  if (state.mode === "warden") {
    el.startButton.textContent = state.phase === "ended" ? "Set a new defense" : "Release the crowd";
    el.startButton.disabled = state.phase === "simulating" || (state.phase === "placing" && state.wardenTraps.size !== 3);
    el.escapeButton.hidden = true;
    el.trapCount.textContent = String(state.wardenTraps.size);
    return;
  }

  el.escapeButton.hidden = false;
  el.escapeButton.disabled = state.phase !== "running" || !state.player || state.player.row < 1 || state.stepping;
  el.startButton.disabled = state.phase === "running" || state.balance < state.bet;
  el.startButton.textContent = state.phase === "ended" ? `Go again with ${state.bet}` : `Enter with ${state.bet}`;
}

function render() {
  saveBalance();
  renderBoard();
  renderLedger();
  updateReadout();
  updateControls();
}

function resetVisualDoor() {
  el.vaultFrame.classList.remove("sealed", "revealing", "revealed");
}

function configureMode(mode) {
  state.mode = mode;
  state.phase = mode === "warden" ? "placing" : "idle";
  state.player = null;
  state.ai = [];
  state.rngTraps = new Set();
  state.wardenTraps = new Set();
  state.safeTiles = new Set();
  state.deadTiles = new Set();
  state.events = [];
  state.tick = 0;
  state.revealed = false;
  state.wardenIncome = 0;
  state.wardenBacking = 0;
  state.wardenKills = 0;
  state.coreHits = 0;
  resetVisualDoor();

  const config = MODES[mode];
  el.modeKicker.textContent = config.kicker;
  el.modeTitle.textContent = config.title;
  el.modeDescription.textContent = config.description;
  el.crowdStatus.textContent = config.crowd;
  el.microcopy.textContent = config.microcopy;
  el.betPanel.hidden = mode === "warden";
  el.wardenInstructions.hidden = mode !== "warden";
  el.modeButtons.forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));

  if (mode === "warden") {
    state.rngTraps = randomTrapMap();
    setStatus("TRAP COMMIT", true);
    setEvent("Place three traps in separate deep-vault rows. Center lanes carry more traffic.");
  } else {
    setStatus("ROUND OPEN", false);
    setEvent("Select an entry and open the vault.");
  }
  render();
}

function createCrowd(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    row: 0,
    col: weightedIndex([1, 2, 4, 6, 4, 2, 1]),
    target: sampleTarget(),
    alive: true,
    escaped: false
  }));
}

function startThiefRound() {
  if (state.balance < state.bet) {
    setEvent("Not enough test credits. Reset the balance to keep testing.");
    return;
  }

  state.balance -= state.bet;
  state.phase = "running";
  state.player = { row: 0, col: 3, alive: true };
  state.ai = state.mode === "shared" ? createCrowd(12) : [];
  state.rngTraps = randomTrapMap();
  state.wardenTraps = state.mode === "shared" ? randomWardenMap() : new Set();
  state.safeTiles = new Set();
  state.deadTiles = new Set();
  state.events = [];
  state.tick = 0;
  state.revealed = false;
  resetVisualDoor();
  setStatus("BREACH IN PROGRESS", true);
  el.crowdStatus.textContent = state.mode === "shared" ? "12 thieves inside" : "Private map active";
  setEvent("The first row is live. Choose one of the outlined entry tiles.");
  addLedger("Your entry", `−${state.bet}`, "loss");
  render();
}

function moveCrowd(nextRow) {
  let deaths = 0;
  let escapes = 0;
  state.ai.forEach((thief) => {
    if (!thief.alive || thief.escaped) return;
    if (thief.target < nextRow) {
      thief.escaped = true;
      escapes += 1;
      return;
    }
    thief.col = chooseCrowdColumn(thief.col);
    thief.row = nextRow;
    const tileKey = key(nextRow, thief.col);
    if (state.rngTraps.has(tileKey) || state.wardenTraps.has(tileKey)) {
      thief.alive = false;
      state.deadTiles.add(tileKey);
      deaths += 1;
    } else {
      state.safeTiles.add(tileKey);
      if (thief.target === nextRow) {
        thief.escaped = true;
        escapes += 1;
      }
    }
  });
  return { deaths, escapes };
}

async function advancePlayer(col) {
  if (state.stepping || state.phase !== "running") return;
  const nextRow = state.player.row + 1;
  if (!isReachable(nextRow, col)) return;

  state.stepping = true;
  state.tick += 1;
  state.player.col = col;
  const crowdResult = state.mode === "shared" ? moveCrowd(nextRow) : { deaths: 0, escapes: 0 };
  render();
  await delay(260);

  state.player.row = nextRow;
  const tileKey = key(nextRow, col);
  const caught = state.rngTraps.has(tileKey) || state.wardenTraps.has(tileKey);

  if (caught) {
    state.player.alive = false;
    state.deadTiles.add(tileKey);
    addLedger(`You · row ${nextRow}`, "CAUGHT", "loss");
    setEvent(`Trap. The vault kept your ${state.bet} credits${crowdResult.deaths ? `; ${crowdResult.deaths} others were caught on the same tick` : ""}.`);
    state.stepping = false;
    render();
    endThiefRound("caught");
    return;
  }

  state.safeTiles.add(tileKey);
  const held = state.bet * MULTIPLIERS[nextRow - 1];
  addLedger(`You · row ${nextRow}`, `×${formatCredits(MULTIPLIERS[nextRow - 1])}`, "win");
  setEvent(`Clear. You hold ${formatCredits(held)} credits${crowdResult.deaths ? `; ${crowdResult.deaths} other ${crowdResult.deaths === 1 ? "thief was" : "thieves were"} caught` : ""}. Escape or move again.`);
  state.stepping = false;

  if (nextRow === ROWS) {
    cashOut(true);
    return;
  }

  const activeCrowd = state.ai.filter((thief) => thief.alive && !thief.escaped).length;
  if (state.mode === "shared") el.crowdStatus.textContent = `${activeCrowd} still moving`;
  render();
}

function cashOut(core = false) {
  if (state.phase !== "running" || !state.player || !state.player.alive || state.player.row < 1) return;
  const payout = state.bet * MULTIPLIERS[state.player.row - 1];
  state.balance += payout;
  addLedger(core ? "Core extracted" : `Escaped · row ${state.player.row}`, `+${formatCredits(payout)}`, "win");
  setEvent(core ? `Core breach. ${formatCredits(payout)} credits extracted.` : `Out alive with ${formatCredits(payout)} credits. The full map is now declassified.`);
  endThiefRound(core ? "core" : "escaped");
}

function endThiefRound(outcome) {
  state.phase = "ended";
  state.revealed = true;
  setStatus(outcome === "caught" ? "RUN ENDED" : "EXTRACTION COMPLETE", outcome === "caught");
  el.crowdStatus.textContent = "Map declassified";
  el.vaultFrame.classList.add("revealing");
  render();
  window.setTimeout(() => {
    el.vaultFrame.classList.remove("revealing");
    el.vaultFrame.classList.add("revealed");
    render();
  }, 760);
  window.setTimeout(() => el.validationStrip.scrollIntoView({ behavior: "smooth", block: "center" }), 1050);
}

function toggleWardenTrap(row, col) {
  if (state.mode !== "warden" || state.phase !== "placing" || row < 6) return;
  const tileKey = key(row, col);
  if (state.wardenTraps.has(tileKey)) {
    state.wardenTraps.delete(tileKey);
  } else {
    const sameRow = [...state.wardenTraps].find((item) => item.startsWith(`${row}-`));
    if (sameRow) state.wardenTraps.delete(sameRow);
    if (state.wardenTraps.size >= 3) {
      setEvent("Loadout full. Remove a trap or replace one in the same row.");
      render();
      return;
    }
    state.wardenTraps.add(tileKey);
  }
  setEvent(`${state.wardenTraps.size}/3 traps armed. Deep lanes near the center usually carry more survivors.`);
  render();
}

function resetWardenPlacement() {
  state.phase = "placing";
  state.ai = [];
  state.rngTraps = randomTrapMap();
  state.wardenTraps = new Set();
  state.safeTiles = new Set();
  state.deadTiles = new Set();
  state.events = [];
  state.tick = 0;
  state.revealed = false;
  state.wardenIncome = 0;
  state.wardenBacking = 0;
  state.wardenKills = 0;
  state.coreHits = 0;
  resetVisualDoor();
  setStatus("TRAP COMMIT", true);
  el.crowdStatus.textContent = "22 thieves assembling";
  setEvent("Place three traps in separate deep-vault rows.");
  render();
}

async function simulateWardenRound() {
  if (state.phase === "ended") {
    resetWardenPlacement();
    return;
  }
  if (state.phase !== "placing" || state.wardenTraps.size !== 3) return;

  state.phase = "simulating";
  state.ai = createCrowd(22);
  state.events = [];
  state.safeTiles = new Set();
  state.deadTiles = new Set();
  state.tick = 0;
  state.wardenIncome = 0;
  state.wardenBacking = 0;
  state.wardenKills = 0;
  state.coreHits = 0;
  setStatus("WARDEN MAP COMMITTED", true);
  setEvent("Bets closed. The crowd is moving in lockstep.");
  render();

  for (let row = 1; row <= ROWS; row += 1) {
    state.tick += 1;
    let tickKills = 0;
    let tickEscapes = 0;

    state.ai.forEach((thief) => {
      if (!thief.alive || thief.escaped) return;
      if (thief.target < row) {
        thief.escaped = true;
        return;
      }

      thief.col = chooseCrowdColumn(thief.col);
      thief.row = row;
      const tileKey = key(row, thief.col);
      const rngHit = state.rngTraps.has(tileKey);
      const wardenHit = state.wardenTraps.has(tileKey);

      if (rngHit || wardenHit) {
        thief.alive = false;
        state.deadTiles.add(tileKey);
        if (wardenHit && !rngHit) {
          const killValue = 10 * MULTIPLIERS[row - 1] * 0.9;
          state.wardenIncome += killValue;
          state.wardenKills += 1;
          tickKills += 1;
        }
      } else {
        state.safeTiles.add(tileKey);
        if (thief.target === row) {
          thief.escaped = true;
          tickEscapes += 1;
          if (row === ROWS) {
            state.coreHits += 1;
            state.wardenBacking += 10 * 120 * 0.5;
          }
        }
      }
    });

    const moving = state.ai.filter((thief) => thief.alive && !thief.escaped).length;
    el.crowdStatus.textContent = `${moving} moving · ${state.wardenKills} warden kills`;
    if (tickKills > 0) {
      setEvent(`Row ${row}: your trap caught ${tickKills} ${tickKills === 1 ? "thief" : "thieves"}. Position-value income added.`);
    } else if (tickEscapes > 0) {
      setEvent(`Row ${row}: ${tickEscapes} ${tickEscapes === 1 ? "thief escapes" : "thieves escape"}; the remaining crowd presses deeper.`);
    } else {
      setEvent(`Row ${row}: the surviving crowd advances.`);
    }
    render();
    await delay(420);
  }

  const net = state.wardenIncome - state.wardenBacking;
  addLedger("Trap income", `+${formatCredits(state.wardenIncome)}`, "win");
  addLedger("Core backing", `−${formatCredits(state.wardenBacking)}`, state.wardenBacking ? "loss" : "");
  addLedger("Warden result", `${net >= 0 ? "+" : ""}${formatCredits(net)}`, net >= 0 ? "win" : "loss");
  addLedger("Core hits", String(state.coreHits), state.coreHits ? "loss" : "");
  state.phase = "ended";
  state.revealed = true;
  setStatus(net >= 0 ? "WARDEN PROFIT" : "BOND HIT", net < 0);
  el.crowdStatus.textContent = `${state.wardenKills} kills · ${state.coreHits} core hits`;
  setEvent(`Round settled. You earned ${formatCredits(state.wardenIncome)}, backed ${formatCredits(state.wardenBacking)}, and finished ${net >= 0 ? "+" : ""}${formatCredits(net)}.`);
  el.vaultFrame.classList.add("revealing");
  render();
  window.setTimeout(() => {
    el.vaultFrame.classList.remove("revealing");
    el.vaultFrame.classList.add("revealed");
    render();
  }, 760);
  window.setTimeout(() => el.validationStrip.scrollIntoView({ behavior: "smooth", block: "center" }), 1050);
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

el.modeButtons.forEach((button) => {
  button.addEventListener("click", () => configureMode(button.dataset.mode));
});

el.chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    if (state.phase === "running") return;
    state.bet = Number(chip.dataset.bet);
    el.chips.forEach((item) => item.classList.toggle("active", item === chip));
    render();
  });
});

el.startButton.addEventListener("click", () => {
  if (state.mode === "warden") simulateWardenRound();
  else startThiefRound();
});

el.escapeButton.addEventListener("click", () => cashOut(false));

el.vaultBoard.addEventListener("click", (event) => {
  const tile = event.target.closest(".tile");
  if (!tile) return;
  const row = Number(tile.dataset.row);
  const col = Number(tile.dataset.col);
  if (state.mode === "warden") toggleWardenTrap(row, col);
  else if (isReachable(row, col)) advancePlayer(col);
});

el.resetBalance.addEventListener("click", () => {
  state.balance = 500;
  saveBalance();
  setEvent("Test credit balance reset to 500.");
  render();
});

el.feedbackButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const modeName = MODES[state.mode].kicker.toLowerCase();
    const response = `BREACH demo feedback (${modeName}): ${button.dataset.feedback}`;
    try {
      await navigator.clipboard.writeText(response);
      el.feedbackNote.textContent = "Copied. Paste the response back into the chat where you received this link.";
    } catch {
      el.feedbackNote.textContent = response;
    }
  });
});

buildDepthLabels();
configureMode("shared");
