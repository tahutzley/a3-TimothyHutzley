async function me() {
  const r = await fetch('/me');
  const { user } = await r.json().catch(() => ({ user: null }));
  return user;
}

async function upsert(username, password) {
  const r = await fetch('/auth/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!r.ok) throw new Error('auth_failed');
  return r.json();
}

async function doLogout() {
  await fetch('/auth/logout', { method: 'POST' });
}

async function refreshAuthUI() {
  const who = document.getElementById('user');
  const loginButton  = document.getElementById('loginButton'); 
  const logoutButton = document.getElementById('logoutButton'); 
  const authUser = document.getElementById('authUser');
  const authPass = document.getElementById('authPass');

  const controls  = document.getElementById('controls');
  const timerCard = document.getElementById('timerCard');
  const statusEl  = document.getElementById('status');
  const nameEntry = document.getElementById('nameEntry');
  const board     = document.getElementById('board');
  const scoreTable = document.getElementById('scoreTable');

  const user = await me();
  console.log('Current user:', user);

  if (user) {
    if (who) who.textContent = `Signed in as ${user.username}`;

    if (loginButton)  loginButton.hidden = true;
    if (logoutButton) logoutButton.hidden = false;
    if (authUser)  { authUser.disabled = true; authUser.hidden = true; }
    if (authPass)  { authPass.disabled = true; authPass.hidden = true; }

    if (controls)  controls.hidden  = false;
    if (timerCard) timerCard.hidden = false;
    if (statusEl)  statusEl.hidden  = false;
    if (nameEntry) nameEntry.hidden = true;
    if (board)     board.hidden     = false;

    await loadHighscores();
  } else {
    if (who) who.textContent = 'Not signed in';

    if (loginButton)  loginButton.hidden = false;
    if (logoutButton) logoutButton.hidden = true;
    if (authUser)  { authUser.disabled = false; authUser.hidden = false; }
    if (authPass)  { authPass.disabled = false; authPass.hidden = false; }

    if (controls)  controls.hidden  = true;
    if (timerCard) timerCard.hidden = true;
    if (statusEl)  statusEl.hidden  = true;
    if (nameEntry) nameEntry.hidden = true;
    if (board)     board.hidden     = true;

    if (scoreTable) scoreTable.innerHTML = '';
  }
}

async function getHighscores() {
  try {
    const response = await fetch('/highscores');
    if (!response.ok) {
      throw new Error('bad status');
    } 
    const data = await response.json();
    return data.entries;
  } catch {
    return [];
  }
}

async function loadHighscores() {
  const scoreTable = document.getElementById('scoreTable');
  const entries = await getHighscores();
  scoreTable.innerHTML = '';
  entries.forEach((entry, i) => {
    const tr = document.createElement('tr');
    const rank = document.createElement('td');
    const name = document.createElement('td');
    const time = document.createElement('td');
    const score = document.createElement('td');

    const actions = document.createElement('td');
    const editButton = document.createElement('button');
    editButton.addEventListener('click', () => editName(entry.ts, name, entry.name));
    const delButton = document.createElement('button');
    delButton.addEventListener('click', async () => {
      await deleteScore(entry.ts);
      await loadHighscores();
    });

    rank.textContent = String(i + 1);
    name.textContent = entry.name;
    time.textContent = String(entry.timeMs);
    score.textContent = String(entry.score);
    actions.append(editButton, delButton);
    delButton.textContent = 'Delete';
    editButton.textContent = 'Edit Name';
    tr.append(rank, name, time, score, actions);
    scoreTable.appendChild(tr);
  });
}

let endAt = 0;
let isPlaying = false;
let roundFailed = false;
let tickerId = null;
let timeLeft = null;

function formatTime(ms) {
  return (ms / 1000).toFixed(2) + 's';
}

function setControls(startEnabled, stopEnabled) {
  const startButton = document.getElementById('startButton');
  const stopButton  = document.getElementById('stopButton');
  if (startButton) {
    startButton.disabled = !startEnabled;
  } 
  if (stopButton) {
    stopButton.disabled  = !stopEnabled;
  }  
}

function resetRound() {
  const timer = document.getElementById('timer');
  const status = document.getElementById('status');
  const nameEntry = document.getElementById('nameEntry');

  if (timer) {
    timer.textContent = '—';
  }
  if (status) {
    status.textContent = 'Press “Start Round”.';
  }    
  if (nameEntry) {
    nameEntry.hidden = true;
  }   

  timeLeft = null;
  isPlaying = false;
  roundFailed = false;
  setControls(true, false);
  if (tickerId) {
    cancelAnimationFrame(tickerId);
  }
}

function startRound() {
  const status = document.getElementById('status');
  const nameEntry = document.getElementById('nameEntry');

  endAt = performance.now() + 5000;
  isPlaying = true;
  roundFailed = false;
  timeLeft = null;

  if (status) {
    status.textContent = 'Round running… Stop before 0.00s!';
  }
  if (nameEntry) {
    nameEntry.hidden = true;
  }
  setControls(false, true);

  if (tickerId) {
    cancelAnimationFrame(tickerId);
  }
  tick();
}

function updateDisplays() {
  const timer = document.getElementById('timer');
  const status = document.getElementById('status');

  const now = performance.now();
  const rem = Math.max(0, endAt - now);
  if (timer) timer.textContent = formatTime(rem);

  if (isPlaying && !roundFailed && now >= endAt) {
    roundFailed = true;
    isPlaying = false;
    setControls(true, false);
    if (status) {
      status.textContent = 'Fail! You let the timer reach 0... Start a new round!';
    }
    const nameEntry = document.getElementById('nameEntry');
    if (nameEntry) {
      nameEntry.hidden = true;
    }
  }
}

function tick() {
  updateDisplays();
  if (isPlaying) {
    tickerId = requestAnimationFrame(tick);
  }
}

function stopRound() {
  if (!isPlaying || roundFailed) return;

  const status = document.getElementById('status');
  const now = performance.now();

  isPlaying = false;
  setControls(true, false);
  const remaining = Math.max(0, Math.round(endAt - now));
  timeLeft = remaining;
  if (status) {
    status.textContent = 'Success! Time left: ' + remaining + ' ms';
  }
  const nameEntry = document.getElementById('nameEntry');
  if (nameEntry) {
    nameEntry.hidden = false;
  }
}

async function deleteScore(id) {
  try {
    const response = await fetch('/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (!response.ok) { throw new Error('bad status'); }
  } catch {}
}

async function renameScore(id, newName) {
  try {
    const response = await fetch('/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, yourName: newName })
    });
    if (!response.ok) { throw new Error('bad status'); }
  } catch {}
}

function editName(id, td, current) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.maxLength = 40;
  input.style.width = '12rem';

  const save = document.createElement('button');
  save.textContent = 'Save';

  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';

  td.innerHTML = '';
  td.append(input, save, cancel);
  input.focus();

  const done = async (ok) => {
    if (ok) {
      const name = (input.value || '').trim();
      if (name) { await renameScore(id, name); }
    }
    await loadHighscores();
  };

  save.addEventListener('click', () => done(true));
  cancel.addEventListener('click', () => done(false));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { done(true); }
    if (e.key === 'Escape') { done(false); }
  });
}

async function submitScore(event) {
  event.preventDefault();
  if (timeLeft == null || roundFailed) {
    return;
  }

  const input = document.querySelector('#yourName');
  const name = (input.value);

  const body = JSON.stringify({ yourName: name, timeMs: timeLeft });
  const response = await fetch('/submit', { method: 'POST', body });
  await response.json().catch(() => ({}));

  if (input) {
    input.value = '';
  }
  const nameEntry = document.getElementById('nameEntry');
  if (nameEntry) {
    nameEntry.hidden = true;
  }
  const status = document.getElementById('status');
  if (status) {
    status.textContent = 'Score saved! Play another round!';
  }
  loadHighscores();
  const nameInput = document.getElementById('yourName');
  if (nameInput) { nameInput.focus(); }
}

window.onload = function () {
  const authForm = document.getElementById('authForm');
  const authUser = document.getElementById('authUser');
  const authPass = document.getElementById('authPass');
  const loginButton  = document.getElementById('loginButton');  
  const logoutButton = document.getElementById('logoutButton');  

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await upsert(authUser.value.trim(), authPass.value);
        authPass.value = '';
        await refreshAuthUI();
      } catch {
        alert('Auth failed. Check username/password.');
      }
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      await doLogout();
      await refreshAuthUI();
    });
  }

  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');
  const nameEntry = document.getElementById('nameEntry');

  if (startButton) startButton.addEventListener('click', startRound);
  if (stopButton) stopButton.addEventListener('click', stopRound);
  if (nameEntry) nameEntry.addEventListener('submit', submitScore);

  resetRound();
  refreshAuthUI();
};