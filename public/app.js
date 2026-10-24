const $ = (id) => document.getElementById(id);

const el = {
  status: $('status'), video: $('video'), screenEmpty: $('screenEmpty'),
  shareBtn: $('shareBtn'), skipShareBtn: $('skipShareBtn'),
  scoreboard: $('scoreboard'), sbHome: $('sbHome'), sbAway: $('sbAway'),
  sbScore: $('sbScore'), sbClock: $('sbClock'),
  matchTitle: $('matchTitle'), matchRef: $('matchRef'),
  playBtn: $('playBtn'), scrub: $('scrub'), tclock: $('tclock'), speed: $('speed'),
  markers: $('markers'), jumpBtn: $('jumpBtn'),
  feed: $('feed'), askForm: $('askForm'), askInput: $('askInput'), askBtn: $('askBtn'),
};

const state = {
  fixture: null,
  minute: 0,
  playing: false,
  fired: new Set(),
  timer: null,
  asking: false,
};

const FULL_TIME = 96;

/**
 * Three of the five contested moments happen in stoppage time. Collapsing them
 * onto minute 90 loses their order, so 90+2 counts as 92 on one linear clock.
 * `clock` ("90+2") stays the label the viewer reads.
 */
const effTime = (e) => e.minute + (e.stoppage || 0);

/** Fixture clocks are "58:00" in regular time and "90+2" in stoppage. Feeds show 58'. */
const clockLabel = (e) => (e.clock?.includes(':') ? `${e.minute}'` : e.clock);

// ── screen share ───────────────────────────────────────────
// getDisplayMedia hands us a MediaStream that lives entirely in this tab.
// Nothing is uploaded — the model never sees a pixel, only the event feed.

el.shareBtn.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });
    el.video.srcObject = stream;
    el.video.classList.add('live');
    el.screenEmpty.hidden = true;
    el.scoreboard.hidden = false;
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      el.video.classList.remove('live');
      el.screenEmpty.hidden = false;
      el.scoreboard.hidden = true;
    });
  } catch {
    // User dismissed the picker. Nothing to recover from.
  }
});

el.skipShareBtn.addEventListener('click', () => {
  el.screenEmpty.hidden = true;
  el.scoreboard.hidden = false;
});

// ── feed ───────────────────────────────────────────────────

function scrollFeed() {
  el.feed.scrollTop = el.feed.scrollHeight;
}

function clearHint() {
  el.feed.querySelector('.feed-hint')?.remove();
}

function addEntry({ clock, head, body, kind = '', tag = '' }) {
  clearHint();
  const div = document.createElement('div');
  div.className = `entry ${kind}`.trim();
  div.innerHTML = `
    ${clock ? `<div class="entry-min">${escapeHtml(clock)}</div>` : ''}
    <div class="entry-head">${escapeHtml(head)}${tag ? `<span class="tag">${tag}</span>` : ''}</div>
    ${body ? `<div class="entry-body">${escapeHtml(body)}</div>` : ''}
  `;
  el.feed.appendChild(div);
  scrollFeed();
  return div;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

// ── fixture + clock ────────────────────────────────────────

async function loadFixture() {
  const res = await fetch('/api/fixture');
  if (!res.ok) throw new Error('Fixture failed to load');
  state.fixture = await res.json();

  const f = state.fixture;
  el.matchTitle.textContent = `${f.home.team} vs ${f.away.team}`;
  el.matchRef.textContent = `${f.round.toUpperCase()} · REF ${f.referee.toUpperCase()}`;
  el.sbHome.textContent = f.home.code;
  el.sbAway.textContent = f.away.code;

  for (const e of f.events) {
    if (!e.contested) continue;
    const m = document.createElement('div');
    m.className = 'marker';
    m.style.left = `${(effTime(e) / FULL_TIME) * 100}%`;
    m.title = `${clockLabel(e)} ${e.headline}`;
    el.markers.appendChild(m);
  }
}

function labelFor(minute) {
  return minute > 90 ? `90+${minute - 90}` : `${minute}'`;
}

function setMinute(minute, { replay = false } = {}) {
  state.minute = minute;
  el.scrub.value = minute;
  el.tclock.textContent = labelFor(minute);
  el.sbClock.textContent = labelFor(minute);

  // Scrubbing backwards should let events fire again on the way forward.
  if (replay) {
    state.fired.clear();
    el.feed.innerHTML = '';
  }

  let score = { home: 0, away: 0 };
  for (const e of state.fixture.events) {
    if (effTime(e) > minute) break;
    if (e.scoreAfter) score = e.scoreAfter;
    if (state.fired.has(e.id)) continue;
    state.fired.add(e.id);
    if (e.type === 'kickoff') continue;
    addEntry({
      clock: clockLabel(e),
      head: e.headline,
      body: e.detail,
      kind: [e.type === 'goal' ? 'goal' : '', e.contested ? 'contested' : ''].filter(Boolean).join(' '),
      tag: e.contested ? 'CONTESTED' : '',
    });
  }
  el.sbScore.textContent = `${score.home}-${score.away}`;
}

function play() {
  if (state.playing) return;
  state.playing = true;
  el.playBtn.textContent = '❚❚';
  const tick = () => {
    if (state.minute >= FULL_TIME) return pause();
    setMinute(state.minute + 1);
    state.timer = setTimeout(tick, 60000 / Number(el.speed.value));
  };
  state.timer = setTimeout(tick, 60000 / Number(el.speed.value));
}

function pause() {
  state.playing = false;
  el.playBtn.textContent = '▶';
  clearTimeout(state.timer);
}

el.playBtn.addEventListener('click', () => (state.playing ? pause() : play()));

el.scrub.addEventListener('input', () => {
  pause();
  setMinute(Number(el.scrub.value), { replay: true });
});

el.jumpBtn.addEventListener('click', () => {
  // Target the last waved-away penalty shout, not merely the last contested
  // event — chronologically that's the coach's card, which is a different
  // argument and doesn't match the question this button pre-fills.
  const appeals = state.fixture.events.filter((e) => e.contested && e.type === 'penalty_appeal');
  const contested = state.fixture.events.filter((e) => e.contested);
  const target = appeals.at(-1) || contested.at(-1);
  if (!target) return;

  pause();
  setMinute(effTime(target), { replay: true });
  el.askInput.value = 'Why did the referee not give a penalty?';
  el.askInput.focus();
});

// ── ask ────────────────────────────────────────────────────
// EventSource is GET-only, so the SSE frames are parsed off a fetch body.

el.askForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = el.askInput.value.trim();
  if (!question || state.asking) return;

  state.asking = true;
  el.askBtn.disabled = true;
  el.askInput.value = '';
  pause();

  addEntry({ head: question, kind: 'you' });

  const answer = addEntry({ head: 'Ball Knowledge', body: '', kind: 'answer' });
  const thinkEl = document.createElement('div');
  thinkEl.className = 'thinking';
  const bodyEl = answer.querySelector('.entry-body');
  answer.insertBefore(thinkEl, bodyEl);

  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  bodyEl.appendChild(cursor);

  let text = '';
  let think = '';

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fixtureId: state.fixture.id,
        minute: state.minute,
        question,
      }),
    });

    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE frames are delimited by a blank line; keep the trailing partial in buf.
      const frames = buf.split('\n\n');
      buf = frames.pop();

      for (const frame of frames) {
        const evLine = frame.match(/^event: (.+)$/m);
        const dataLine = frame.match(/^data: (.+)$/m);
        if (!evLine || !dataLine) continue;

        const type = evLine[1];
        const data = JSON.parse(dataLine[1]);

        if (type === 'thinking') {
          think += data.text;
          thinkEl.textContent = think;
          scrollFeed();
        } else if (type === 'text') {
          text += data.text;
          bodyEl.textContent = text;
          bodyEl.appendChild(cursor);
          scrollFeed();
        } else if (type === 'error') {
          throw new Error(data.message);
        }
      }
    }

    if (!text) throw new Error('Model returned nothing.');
  } catch (err) {
    bodyEl.textContent = `Couldn't answer — ${err.message}`;
    bodyEl.style.color = 'var(--red)';
  } finally {
    cursor.remove();
    if (!think) thinkEl.remove();
    state.asking = false;
    el.askBtn.disabled = false;
    scrollFeed();
  }
});

// ── boot ───────────────────────────────────────────────────

(async () => {
  try {
    const health = await (await fetch('/api/health')).json();
    if (health.ready) {
      el.status.textContent = `${health.provider} · ${health.model}`;
    } else {
      el.status.textContent = 'no api key — chat disabled';
      el.status.classList.add('bad');
    }
    if (health.corpusError) {
      el.status.textContent = 'no rulebook loaded';
      el.status.classList.add('bad');
    }
    await loadFixture();
    setMinute(0);
  } catch (err) {
    el.status.textContent = err.message;
    el.status.classList.add('bad');
  }
})();
