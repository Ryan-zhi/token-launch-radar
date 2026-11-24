// Token Launch Radar dashboard: renders window.RADAR (written by main.ts as
// data.js) with no network and no framework. Three views, all reachable by
// URL hash so they can be shared and screenshotted:
//   #/                      the ranked board (filters in the query part)
//   #/?category=Lending     the board, filtered
//   #/protocol/<slug>       one protocol's detail view
'use strict';

const R = window.RADAR;
const $ = (id) => document.getElementById(id);

const money = (n) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
};
const pct = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
const ageText = (d) => {
  if (d === null || d === undefined) return '—';
  if (d < 90) return `${d}d`;
  if (d < 730) return `${Math.round(d / 30.4)} mo`;
  return `${(d / 365.25).toFixed(1)} yr`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderMasthead() {
  $('masthead-stats').innerHTML = [
    [R.board_size, 'pre-token ranked'],
    [R.watchlist_size, 'on the watchlist'],
    [R.live_size, 'already live'],
    [`${R.global_multiple.toFixed(2)}×`, 'median peer value'],
    [R.as_of, 'snapshot date'],
  ].map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${l}</span></div>`).join('');
}

function renderMethod() {
  $('method').innerHTML = `
    <div class="card"><h3>1 · Peer multiple</h3><p>Each protocol is priced off its traded relatives: <b>TVL × the median market-cap/TVL of its category's token-bearing peers</b> (${R.peer_count} of them in this snapshot). No peers, no invented price — thin categories fall back to their family, then to the market median.</p></div>
    <div class="card"><h3>2 · Growth tilt</h3><p>A protocol gaining TVL is worth more than a shrinking one of the same size. The multiple moves by <b>half the 7-day TVL change, clamped between 0.85× and 1.30×</b> — a tilt, never a takeover.</p></div>
    <div class="card"><h3>3 · Freshness tilt</h3><p>Younger protocols carry more launch optionality; older ones have had their chances. A mild tilt from <b>1.15× for the newest to 0.85× at ten years</b>, from the day DefiLlama first tracked each protocol.</p></div>`;
}

function fillFilters() {
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  $('f-category').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('f-chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
}

function currentFilters() {
  const hash = location.hash.replace(/^#\/?/, '');
  const params = new URLSearchParams(hash.startsWith('?') ? hash.slice(1) : '');
  return {
    q: params.get('q') ?? $('q').value.trim().toLowerCase(),
    category: params.get('category') ?? $('f-category').value,
    chain: params.get('chain') ?? $('f-chain').value,
    watch: params.get('watch') === '1' || $('f-watch').checked,
    sort: params.get('sort') ?? $('f-sort').value,
  };
}

function applyFilters(pushHash) {
  const f = {
    q: $('q').value.trim().toLowerCase(),
    category: $('f-category').value,
    chain: $('f-chain').value,
    watch: $('f-watch').checked,
    sort: $('f-sort').value,
  };
  if (pushHash) {
    const p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    if (f.category) p.set('category', f.category);
    if (f.chain) p.set('chain', f.chain);
    if (f.watch) p.set('watch', '1');
    if (f.sort !== 'rank') p.set('sort', f.sort);
    const s = p.toString();
    history.replaceState(null, '', s ? `#/?${s}` : '#/');
  }
  renderBoard(f);
}

function renderBoard(f) {
  let rows = R.rows.filter((r) =>
    (f.q === '' || r.name.toLowerCase().includes(f.q) || r.slug.includes(f.q)) &&
    (f.category === '' || r.category === f.category) &&
    (f.chain === '' || r.chains.includes(f.chain)) &&
    (!f.watch || r.on_watchlist));
  if (f.sort === 'tvl') rows = [...rows].sort((a, b) => b.tvl_usd - a.tvl_usd);
  else if (f.sort === 'growth') rows = [...rows].sort((a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9));
  else if (f.sort === 'age') rows = [...rows].sort((a, b) => (a.age_days ?? 1e9) - (b.age_days ?? 1e9));
  $('row-count').textContent = `${rows.length} of ${R.board_size} protocols`;
  $('board-body').innerHTML = rows.map((r) => `
    <tr data-slug="${esc(r.slug)}">
      <td class="rank num">${r.rank}</td>
      <td class="name"><b>${esc(r.name)}</b>${r.on_watchlist ? '<span class="watch-dot" title="On the house watchlist">● watchlist</span>' : ''}</td>
      <td>${esc(r.category ?? '—')}</td>
      <td>${r.chains.slice(0, 3).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}${r.chains.length > 3 ? `<span class="chip">+${r.chains.length - 3}</span>` : ''}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}">${pct(r.change_7d)}</td>
      <td class="num">${ageText(r.age_days)}</td>
      <td class="num">${r.base_multiple.toFixed(2)}×</td>
      <td class="num implied"><b>${money(r.implied_value_usd)}</b></td>
    </tr>`).join('');
  for (const tr of $('board-body').querySelectorAll('tr')) {
    tr.addEventListener('click', () => { location.hash = `#/protocol/${tr.dataset.slug}`; });
  }
}

const FAMILIES = {
  credit: ['Lending', 'CDP', 'Uncollateralized Lending', 'Leveraged Farming', 'Risk Curators'],
  exchange: ['Dexs', 'Derivatives', 'Perps', 'Options', 'Prediction Market'],
  yield: ['Yield', 'Yield Aggregator', 'Basis Trading', 'Indexes', 'Farm'],
  realworld: ['RWA', 'RWA Lending'],
  infra: ['Cross Chain Bridge', 'Bridge', 'Canonical Bridge', 'Oracles', 'Services', 'Privacy'],
};
const familyOf = (cat) => Object.keys(FAMILIES).find((f) => FAMILIES[f].includes(cat)) ?? null;

function renderDetail(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  const view = $('detail-view');
  if (!r) {
    view.innerHTML = '<p><a class="back" href="#/">← Back to the board</a></p><p>No such protocol on the board.</p>';
    return;
  }
  const ownPeers = R.live.filter((l) => l.category === r.category && l.multiple !== null);
  let peers = ownPeers;
  let peerNote = `Priced from the median of the ${ownPeers.length} traded ${esc(r.category ?? '')} protocols below.`;
  if (ownPeers.length < 3) {
    const fam = familyOf(r.category);
    const famPeers = fam === null ? [] : R.live.filter((l) => FAMILIES[fam].includes(l.category ?? '') && l.multiple !== null);
    if (famPeers.length >= 3) {
      peers = famPeers;
      peerNote = `${esc(r.category ?? 'This category')} has only ${ownPeers.length} traded peer${ownPeers.length === 1 ? '' : 's'} in the snapshot, so the model priced from the median of its ${esc(fam)} family (${famPeers.length} protocols below).`;
    } else {
      peerNote = `Too few traded peers in this category or its family, so the model priced from the market-wide median multiple (${R.global_multiple.toFixed(2)}×).`;
    }
  }
  peers = [...peers].sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0)).slice(0, 8);
  view.innerHTML = `
    <a class="back" href="#/">← Back to the board</a>
    <div class="detail-head">
      <div>
        <h2>${esc(r.name)} ${r.on_watchlist ? '<span class="watch-dot">● house watchlist</span>' : ''}</h2>
        <div class="sub">Rank #${r.rank} of ${R.board_size} pre-token protocols · ${esc(r.category ?? 'Uncategorised')} · ${r.chains.map(esc).join(', ') || 'chain n/a'} · age ${ageText(r.age_days)}</div>
      </div>
      <div class="big-value"><b>${money(r.implied_value_usd)}</b><span>implied launch value</span></div>
    </div>
    <div class="kv">
      <div class="stat"><b>${money(r.tvl_usd)}</b><span>TVL</span></div>
      <div class="stat"><b>${pct(r.change_7d)}</b><span>TVL change, 7d</span></div>
      <div class="stat"><b>${r.base_multiple.toFixed(2)}×</b><span>peer multiple</span></div>
      <div class="stat"><b>${r.chains.length}</b><span>chains</span></div>
    </div>
    <div class="grid">
      <div class="panel math">
        <h3>How the model prices ${esc(r.name)}</h3>
        <div class="line"><span>Total value locked</span><b>${money(r.tvl_usd)}</b></div>
        <div class="line"><span>× category peer multiple (median mcap / TVL)</span><b>${r.base_multiple.toFixed(3)}×</b></div>
        <div class="line"><span>× growth tilt (7d TVL ${pct(r.change_7d)})</span><b>${r.growth_multiplier.toFixed(3)}×</b></div>
        <div class="line"><span>× freshness tilt (age ${ageText(r.age_days)})</span><b>${r.maturity_multiplier.toFixed(3)}×</b></div>
        <div class="line total"><span>= implied value if it launched today</span><b>${money(r.implied_value_usd)}</b></div>
        <p class="foot">The same three lines price every row on the board, from the same frozen snapshot. Change any assumption and the ranking moves — that is the point of showing the working.</p>
      </div>
      <div class="panel">
        <h3>Traded peers behind the multiple</h3>
        ${peers.length === 0 ? '<p class="foot">No traded protocol shares this category in the snapshot.</p>' : `
        <table class="peers"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap/TVL</th></tr></thead>
        <tbody>${peers.map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${money(l.tvl_usd)}</td><td class="num">${money(l.mcap_usd)}</td><td class="num">${l.multiple.toFixed(2)}×</td></tr>`).join('')}</tbody></table>`}
        <p class="foot">${peerNote}</p>
      </div>
    </div>
    <div class="panel" style="margin-top:14px">
      <h3>Farm plan — positioning before any launch</h3>
      <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="foot">No token has been announced for ${esc(r.name)}. This plan is a positioning checklist, not a promise: it only makes sense if using the protocol is worthwhile for you even if nothing is ever distributed.</p>
    </div>`;
}

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const detail = hash.match(/^protocol\/(.+)$/);
  $('board-view').hidden = detail !== null;
  $('detail-view').hidden = detail === null;
  if (detail) {
    renderDetail(decodeURIComponent(detail[1]));
    window.scrollTo(0, 0);
  } else {
    const f = currentFilters();
    if (f.category) $('f-category').value = f.category;
    if (f.chain) $('f-chain').value = f.chain;
    if (f.sort) $('f-sort').value = f.sort;
    $('f-watch').checked = f.watch;
    renderBoard(f);
  }
}

renderMasthead();
renderMethod();
fillFilters();
for (const id of ['q', 'f-category', 'f-chain', 'f-watch', 'f-sort']) {
  $(id).addEventListener('input', () => applyFilters(true));
  $(id).addEventListener('change', () => applyFilters(true));
}
window.addEventListener('hashchange', route);
route();
