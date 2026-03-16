const KEY = 'glow-up-planner-v1';

const pillars = [
  { title: 'Mom first', text: 'Wake early, get dressed, skincare, protein, and mindset reset.' },
  { title: 'Predictable rhythms', text: 'Meals, naps/rest, outside, learning, cleanup, bedtime anchors.' },
  { title: 'One focus per block', text: 'Single-purpose blocks beat multitasking overload.' },
  { title: 'Daily home reset', text: 'Morning, afternoon, evening resets prevent chaos.' },
  { title: 'Strong + warm parenting', text: 'Calm voice, clear expectations, consistent follow-through.' },
  { title: 'Weekly planning', text: 'Sunday prep decides the week before Monday arrives.' }
];

const routines = {
  'Mon–Fri': [
    ['5:45–6:15', 'Mom wake-up anchor', ['Make bed', 'Skincare + get dressed', 'Water + coffee', '5 min planning', 'Quick kitchen straighten']],
    ['6:15–7:00', 'Prep before kids', ['Breakfast + school items', 'Calendar glance', 'Start laundry']],
    ['7:00–8:00', 'Kids up + breakfast + out the door', ['Calm efficiency', 'Final bag/shoe checks', 'Leave by 8:00']],
    ['8:00–9:00', 'Drop-off + transition home', ['15-min power reset', 'Protein breakfast', 'Review day']],
    ['9:00–11:00', 'High-value mom block', ['Theme-day focus tasks', 'Nurturing structured activities for little ones']],
    ['11:00–12:30', 'Lunch + tidy + connection', ['Eat together', 'Quick wipe/reset']],
    ['12:30–2:30', 'Nap/rest + productivity', ['Admin/laundry/light clean', '20 min self-care', 'Prep dinner parts']],
    ['2:30–4:30', 'Pickup + afternoon rhythm', ['Snack + decompress', 'Outside + homework/reading']],
    ['4:30–5:30', 'Dinner prep + family reset', ['Kids help by age', 'Protect this transition block']],
    ['5:30–6:15', 'Family dinner', ['Everyone sits', 'High/low share', 'Clear plates']],
    ['6:15–7:15', 'Evening reset + baths + pajamas', ['Kitchen reset', 'Prep tomorrow items']],
    ['7:15–8:15', 'Bedtime flow', ['1-year-old', '3-year-old', '9-year-old wind-down']],
    ['8:15–9:15', 'Mom closing shift', ['Kitchen fully closed', 'Outfits + calendar check', '10-minute pickup']],
  ],
  'Saturday': [
    ['6:30–8:00', 'Mom up + simple breakfast + family reset', ['Set tone early']],
    ['8:00–11:00', 'Outing/activity block', ['Park, library, groceries, seasonal outing']],
    ['11:00–1:00', 'Lunch + tidy + rest block', ['Youngest naps; older child independent project']],
    ['1:00–4:00', 'Family outing or home project', ['Rotate household project weekly']],
    ['4:00–6:00', 'Free play + easy dinner prep', ['Family cleanup sprint']],
    ['6:00–8:30', 'Dinner + baths + bedtime', ['Calmer evening']],
  ],
  'Sunday': [
    ['6:30–8:00', 'CEO mom start', ['Coffee, planning, dressed, tidy kitchen']],
    ['8:00–10:00', 'Breakfast + family reset', ['Laundry catch-up', 'Kids tidy rooms']],
    ['10:00–12:00', 'Family/church/outdoor time', ['Connection over errands']],
    ['12:00–2:00', 'Lunch + naps/rest', ['Keep predictable rhythms']],
    ['2:00–4:00', 'Mandatory weekly prep block', ['Meal plan + grocery list', 'Calendar + outfits + backpacks', 'Top 3 week priorities']],
    ['4:00–6:00', 'Meal prep + fridge reset', ['Prep 1–2 easy meals']],
    ['6:00–8:00', 'Dinner + baths + early bedtime', ['Full Monday setup complete']],
  ]
};

const homeChecks = ['Beds made','Dishes done','Counters clear','One load of laundry fully done','Floor pickup','Dining table cleared','Bathroom quick wipe','Tomorrow prepped tonight'];
const momChecks = ['Get dressed','Skincare','Water','Protein','Vitamins','20–30 min movement','No chaos clothes all day','10 min for yourself'];
const themes = ['Sunday — Reset', 'Monday — Laundry + planning', 'Tuesday — Deep clean', 'Wednesday — Errands + appointments', 'Thursday — Child enrichment', 'Friday — Home polish', 'Saturday — Family + projects'];
const quotes = [
  'Steady leadership beats perfect plans.',
  'Less reacting. More preparing.',
  'Consistency creates calm children and a calmer home.',
  'Progress over perfection, every single day.'
];

const state = load();
const pillarGrid = document.getElementById('pillarGrid');
const daySwitcher = document.getElementById('daySwitcher');
const timeline = document.getElementById('timeline');
const homeChecksEl = document.getElementById('homeChecks');
const momChecksEl = document.getElementById('momChecks');
const progressEl = document.getElementById('todayProgress');
const streakChip = document.getElementById('streakChip');
const themeDay = document.getElementById('themeDay');
const motivation = document.getElementById('motivation');

renderPillars();
renderSwitcher();
renderTimeline();
renderChecks(homeChecksEl, homeChecks, 'home');
renderChecks(momChecksEl, momChecks, 'mom');
refreshStats();

document.getElementById('completeDayBtn').addEventListener('click', markComplete);
document.getElementById('resetBtn').addEventListener('click', () => {
  localStorage.removeItem(KEY);
  location.reload();
});

function renderPillars() {
  pillarGrid.innerHTML = pillars.map((p, i) => `
    <article class="card">
      <h3>${i + 1}. ${p.title}</h3>
      <p>${p.text}</p>
    </article>
  `).join('');
}

function renderSwitcher() {
  Object.keys(routines).forEach(day => {
    const b = document.createElement('button');
    b.textContent = day;
    b.className = day === state.day ? 'active' : '';
    b.onclick = () => { state.day = day; save(); renderSwitcher(); renderTimeline(); };
    daySwitcher.appendChild(b);
  });
}

function renderTimeline() {
  const currentHour = new Date().getHours();
  timeline.innerHTML = routines[state.day].map(([time, focus, tasks]) => {
    const hour = Number(time.split(':')[0]);
    const now = state.day === guessDayMode() && hour === currentHour;
    return `
      <div class="block ${now ? 'now' : ''}">
        <div class="time">${time}</div>
        <div>
          <div class="focus">${focus}</div>
          <ul class="tasklist">${tasks.map(t => `<li>${t}</li>`).join('')}</ul>
        </div>
        <input type="checkbox" ${checkedFor(focus) ? 'checked' : ''} onchange="toggleBlock('${encodeURIComponent(focus)}', this.checked)">
      </div>
    `;
  }).join('');
}

window.toggleBlock = (encodedFocus, checked) => {
  const focus = decodeURIComponent(encodedFocus);
  state.blocks[focus] = checked;
  save();
  refreshStats();
};

function renderChecks(container, items, group) {
  container.innerHTML = items.map((item, idx) => `
    <label>
      <input type="checkbox" ${state.checks[group]?.[idx] ? 'checked' : ''} onchange="toggleCheck('${group}', ${idx}, this.checked)">
      <span>${item}</span>
    </label>
  `).join('');
}

window.toggleCheck = (group, idx, checked) => {
  state.checks[group] ||= {};
  state.checks[group][idx] = checked;
  save();
  refreshStats();
};

function refreshStats() {
  const all = [...Object.values(state.blocks), ...Object.values(state.checks.home || {}), ...Object.values(state.checks.mom || {})];
  const total = all.length || 1;
  const done = all.filter(Boolean).length;
  progressEl.textContent = `${Math.round((done / total) * 100)}%`;
  streakChip.textContent = `🔥 Streak: ${state.streak} days`;

  const dayIdx = new Date().getDay();
  themeDay.textContent = themes[dayIdx];
  motivation.textContent = `"${quotes[dayIdx % quotes.length]}"`;
}

function markComplete() {
  const today = new Date().toDateString();
  if (state.lastComplete !== today) {
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    state.streak = state.lastComplete === yesterday ? state.streak + 1 : 1;
    state.lastComplete = today;
    save();
    refreshStats();
  }
}

function checkedFor(focus) {
  return !!state.blocks[focus];
}

function guessDayMode() {
  const d = new Date().getDay();
  if (d === 0) return 'Sunday';
  if (d === 6) return 'Saturday';
  return 'Mon–Fri';
}

function load() {
  const raw = localStorage.getItem(KEY);
  const base = { day: guessDayMode(), checks: { home: {}, mom: {} }, blocks: {}, streak: 0, lastComplete: '' };
  try { return raw ? { ...base, ...JSON.parse(raw) } : base; }
  catch { return base; }
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}
