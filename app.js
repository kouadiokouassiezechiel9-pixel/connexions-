'use strict';
const $ = id => document.getElementById(id);
let state = null;

/* ---------- API helper ---------- */
async function api(path, method = 'GET', body = null) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : null
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erreur réseau'), { status: res.status });
  return data;
}

/* ---------- Auth ---------- */
let mode = 'login';
$('tab-login').onclick = () => switchTab('login');
$('tab-register').onclick = () => switchTab('register');
function switchTab(m) {
  mode = m;
  $('tab-login').classList.toggle('active', m === 'login');
  $('tab-register').classList.toggle('active', m === 'register');
  $('auth-submit').textContent = m === 'login' ? 'Se connecter' : "Créer mon compte";
  $('auth-error').textContent = '';
}
$('auth-form').onsubmit = async e => {
  e.preventDefault();
   const btn = $('auth-submit');
  btn.disabled = true; $('auth-error').textContent = '';
  try {
    const data = await api('/api/' + mode, 'POST',
      { email: (′email′).value.trim(),password:('email').value.trim(), password:(′email′).value.trim(),password:('password').value });
    enterApp(data.user);
  } catch (err) {
    $('auth-error').textContent = err.message;
  } finally { btn.disabled = false; }
}

$('logout-btn').onclick = async () => {
  try { await api('/api/logout', 'POST'); } catch (_) {}
  state = null;
  $('app-view').classList.add('hidden');
  $('auth-view').classList.remove('hidden');
  $('password').value = '';
};

/* ---------- Rendu ---------- */
function fmt(mb) {
  if (mb >= 1024) return (mb / 1024).toFixed(2).replace('.', ',') + ' Go';
  return mb.toFixed(2).replace('.', ',') + ' Mo';
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function render(u) {
  state = u;
  const pct = Math.min(100, (u.stockMb / u.capacityMb) * 100);
  $('stock-value').textContent = u.stockMb.toFixed(2).replace('.', ',');
  $('stock-gb').textContent = u.stockMb >= 1024 ? '≈ ' + fmt(u.stockMb) : '';
  $('meter-fill').style.width = pct + '%';
  $('gauge-ring').style.background =
    `conic-gradient(var(--accent) ${pct * 3.6}deg, rgba(0,0,0,.3) 0deg)`;
  $('ring-pct').textContent = Math.round(pct) + '%';
  (′cap−info′).textContent=‘Capaciteˊ('cap-info').textContent = `Capacité(′cap−info′).textContent=‘Capaciteˊ{u.tierName} : ${fmt(u.capacityMb)}`;

  $('tier-badge').textContent = u.tierName;
  $('user-email').textContent = u.email;

  $('ratio-label').textContent = Math.round(u.ratio * 100);
  $('ratio-display').textContent = Math.round(u.ratio * 100) + ' %';
  $('ratio-slider').value = Math.round(u.ratio * 100);

  const tiersEl = $('tiers-list');
  tiersEl.innerHTML = '';
  u.tiers.forEach(t => {
    const row = document.createElement('div');
    row.className = 'tier-row' + (t.key === u.tier ? ' current' : '');
    row.innerHTML = `
      <div><div class="tier-name">t.name{t.name}t.name{t.key === u.tier ? ' ✅' : ''}</div>
      <div class="tier-cap">fmt(t.capacityMb)—{fmt(t.capacityMb)} —fmt(t.capacityMb)—{t.price}</div></div>`;
    if (t.key !== u.tier) {
      const b = document.createElement('button');
      b.className = 'btn primary small'; b.textContent = 'Choisir';
      b.onclick = () => upgrade(t.key, b);
      row.appendChild(b);
    }
    tiersEl.appendChild(row);
  });

  const hist = $('history-list');
  hist.innerHTML = '';
  if (!u.history.length)
    hist.innerHTML = '<li class="muted">Aucune opération pour le moment.</li>';
  u.history.forEach(h => {
    const li = document.createElement('li');
    const cls = h.type === 'withdraw' ? 'down' : 'up';
    const sign = h.type === 'withdraw' ? '−' : '+';
    const icon = h.type === 'withdraw' ? '📤' : h.type === 'upgrade' ? '🚀' : '📥';
    li.innerHTML = `<span>icon{icon}icon{h.label} <span class="muted small-text">${fmtDate(h.at)}</span></span>
      <span class="cls">{cls}">cls">{h.mb ? sign + fmt(h.mb) : '—'}</span>`;
    hist.appendChild(li);
  });
}

function enterApp(u) {
  $('auth-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  render(u);
}

/* ---------- Actions ---------- */
async function safe(fn, statusEl) {
  try { await fn(); }
  catch (err) {
    if (err.status === 401) return $('logout-btn').click();
    if (statusEl) { statusEl.textContent = err.message; statusEl.classList.add('err'); }
  }
}

// Dépôt Wi-Fi (RG-04)
let simRate = 2;
$('sim-slider').oninput = e => {
  simRate = +e.target.value;
  $('sim-value').textContent = simRate;
  $('use-rate').textContent = simRate;
};

let liveTotal = 0;
$('tick-deposit').onclick = () => safe(async () => {
  setStatus('deposit-status', '');
  const data = await api('/api/wifi/tick', 'POST', { mb: simRate });
  liveTotal += data.tick.total;
  $('live-counter').textContent = fmt(liveTotal) + ' en direct';
  render(data);
  let msg = `Trafic : fmt(data.tick.total)→reˊserve+{fmt(data.tick.total)} → réserve +fmt(data.tick.total)→reˊserve+{fmt(data.tick.stored)}, direct ${fmt(data.tick.live)}`;
  if (data.tick.full) msg += ' — ⚠️ Réserve pleine !';
  setStatus('deposit-status', msg);
}, 'deposit-status');

// Retrait mobile (RG-05)
$('use-stock').onclick = () => safe(async () => {
  setStatus('withdraw-status', '');
  const data = await api('/api/stock/use', 'POST', { mb: simRate });
  render(data);
  let msg = `${fmt(data.tick.used)} consommés depuis la réserve.`;
  if (data.tick.empty) msg += ' — Réserve vide !';
  setStatus('withdraw-status', msg);
}, 'withdraw-status');

// Ratio (RG-07)
let ratioTimer;
$('ratio-slider').oninput = e => {
  $('ratio-display').textContent = e.target.value + ' %';
  clearTimeout(ratioTimer);
  ratioTimer = setTimeout(() => safe(async () => {
    const u = await api('/api/settings', 'POST', { ratio: +e.target.value / 100 });
    render(u);
    setStatus('ratio-status', 'Ratio enregistré ✔');
  }, 'ratio-status'), 400); // debounce
};

// Upgrade (RG-13)
async function upgrade(key, btn) {
  btn.disabled = true; btn.textContent = '...';
  try {
    const u = await api('/api/upgrade', 'POST', { tier: key });
    render(u);
  } catch (err) {
    if (err.status === 401) return $('logout-btn').click();
    alert(err.message);
    btn.disabled = false; btn.textContent = 'Choisir';
  }
}

function setStatus(id, txt, isErr = false) {
  const el = $(id);
  el.textContent = txt;
  el.classList.toggle('err', isErr);
}

/* ---------- Session au chargement ---------- */
(async () => {
  try {
    const u = await api('/api/me');
    enterApp(u);
  } catch (_) { /* non connecté */ }
})();
