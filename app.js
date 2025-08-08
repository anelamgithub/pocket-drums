// Pocket Drums — Vanilla JS, Web Audio, PWA, <50KB JS (excluding samples)
// Audio engine overview:
// - Unlocks AudioContext on first user gesture
// - Two kits made with runtime synthesis (royalty-free). You can swap to file-based samples.
// - Per-pad gain -> master -> destination and MediaStreamDestination (for recording)
// - Metronome scheduled on the audio clock with lookahead loop
// - Velocity via TouchEvent.force when available; fallback long-press accent
// - Latency compensation saved to localStorage
// - Multi-touch + keyboard triggers
// - Recording via MediaRecorder

const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => [...el.querySelectorAll(q)];

const state = {
  ctx: null,
  master: null,
  recDest: null,
  running: false,
  lookahead: 25, // ms
  scheduleAheadTime: 0.12, // s
  nextTick: 0,
  isMetronomeOn: false,
  bpm: 120,
  latencyMs: parseInt(localStorage.getItem('latencyMs')||'0',10),
  kit: 'rock',
  longPressMs: 220,
  maxRecSec: 60,
  recording: false,
  recorder: null,
  chunks: [],
  buffers: {},
  gains: {},
  masterGain: 0.9
};

const PADS = [
  {id:'kick',  label:'Kick',  key:'K'},
  {id:'snare', label:'Snare', key:'S'},
  {id:'hatC',  label:'Hi-Hat Closed', key:'H'},
  {id:'hatO',  label:'Hi-Hat Open',   key:'O'},
  {id:'hatP',  label:'Hi-Hat Pedal',  key:'P'},
  {id:'tom1',  label:'Tom 1', key:'1'},
  {id:'tom2',  label:'Tom 2', key:'2'},
  {id:'tom3',  label:'Tom 3', key:'3'},
  {id:'crash', label:'Crash', key:'C'},
  {id:'ride',  label:'Ride',  key:'R'},
];

const clamp = (x,min,max)=>Math.max(min,Math.min(max,x));

// PWA registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
document.addEventListener('touchstart', () => initAudio(), {once:true, passive:true});
document.addEventListener('pointerdown', e => { if (e.pointerType==='mouse') initAudio() }, {once:true});

async function initAudio(){
  if (state.ctx) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)({latencyHint:'interactive', sampleRate: 44100});
  state.ctx = ctx;

  // Master chain
  state.master = ctx.createGain();
  state.master.gain.value = state.masterGain;
  state.recDest = ctx.createMediaStreamDestination();

  // Gentle limiter to prevent clipping
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeSoftClipCurve(0.9);
  shaper.oversample = '2x';

  state.master.connect(shaper).connect(ctx.destination);
  shaper.connect(state.recDest);

  // Per-pad gains
  PADS.forEach(p => {
    const g = ctx.createGain();
    g.gain.value = defaultPadGain(p.id);
    g.connect(state.master);
    state.gains[p.id] = g;
  });

  // Build synthesized sample buffers for both kits
  state.buffers.rock = await synthKit(ctx, 'rock');
  state.buffers.jazz = await synthKit(ctx, 'jazz');

  hydrateMixer();
}

function makeSoftClipCurve(amount=0.9){
  const n = 1024, curve = new Float32Array(n);
  for (let i=0;i<n;i++){
    const x = (i/(n-1))*2 - 1;
    curve[i] = Math.tanh(amount * 2 * x) / Math.tanh(amount * 2);
  }
  return curve;
}

function defaultPadGain(id){
  return ({
    kick:0.9, snare:0.85, hatC:0.6, hatO:0.6, hatP:0.5,
    tom1:0.8, tom2:0.8, tom3:0.8, crash:0.65, ride:0.65
  })[id] ?? 0.7;
}

// ---------- Synthesis (royalty-free) ----------
async function synthKit(ctx, flavor){
  const make = {
    kick: ()=> synthKick(ctx, flavor),
    snare:()=> synthSnare(ctx, flavor),
    hatC: ()=> synthHat(ctx, 'closed', flavor),
    hatO: ()=> synthHat(ctx, 'open', flavor),
    hatP: ()=> synthHat(ctx, 'pedal', flavor),
    tom1: ()=> synthTom(ctx, 170, flavor),
    tom2: ()=> synthTom(ctx, 130, flavor),
    tom3: ()=> synthTom(ctx, 100, flavor),
    crash:()=> synthCymbal(ctx, 'crash', flavor),
    ride: ()=> synthCymbal(ctx, 'ride', flavor),
  };
  const entries = await Promise.all(PADS.map(async p => [p.id, await make[p.id]()] ));
  return Object.fromEntries(entries);
}

function renderToBuffer(ctx, seconds, renderFn){
  const sr = ctx.sampleRate, len = Math.round(seconds*sr);
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  renderFn(data, sr);
  // quick DC-ish filter
  let prev=0;
  for (let i=0;i<data.length;i++){ const x=data[i]; data[i]=x-prev+0.995*(data[i-1]||0); prev=x; }
  return buf;
}

function synthKick(ctx, flavor){
  const dur = 1.0;
  const punch = flavor==='rock' ? 1.0 : 0.7;
  return renderToBuffer(ctx, dur, (data,sr)=>{
    const f0 = flavor==='rock'? 90:70, f1=30;
    for (let i=0;i<data.length;i++){
      const t=i/sr;
      const env = Math.exp(-t*5);
      const f = f1 + (f0-f1)*Math.exp(-t*30);
      const click = (t<0.005? (1-t/0.005) : 0)*punch;
      data[i] = 0.9*Math.sin(2*Math.PI*f*t) * env + click*(Math.random()*2-1)*0.2;
    }
  });
}

function synthSnare(ctx, flavor){
  const dur=1.0, tone = flavor==='rock'? 210: 180, noiseAmt = flavor==='rock'?0.75:0.9;
  return renderToBuffer(ctx, dur, (data,sr)=>{
    for (let i=0;i<data.length;i++){
      const t=i/sr;
      const env = Math.exp(-t*8);
      const toneEnv = Math.exp(-t*12);
      const noise = (Math.random()*2-1)*env*noiseAmt;
      const body = Math.sin(2*Math.PI*tone*t)*toneEnv*0.8;
      data[i] = noise + body;
    }
  });
}

function synthHat(ctx, type, flavor){
  const dur = type==='open'? 1.6 : type==='pedal'? 0.12 : 0.25;
  const br = flavor==='rock'? 9000: 7000;
  return renderToBuffer(ctx, dur, (data,sr)=>{
    const cutoff = br;
    for (let i=0;i<data.length;i++){
      const t=i/sr;
      const env = type==='open' ? Math.exp(-t*3) : Math.exp(-t*35);
      const s = Math.sign(Math.sin(2*Math.PI*215*t))
              ^ Math.sign(Math.sin(2*Math.PI*341*t))
              ^ Math.sign(Math.sin(2*Math.PI*456*t));
      const n = ((s?1:-1) + (Math.random()*0.2))*env;
      const alpha = Math.exp(-2*Math.PI*cutoff/sr);
      data[i] = (data[i-1]||0)*alpha + (1-alpha)*n;
    }
  });
}

function synthTom(ctx, freq, flavor){
  const dur=1.2, damp = flavor==='rock'? 6: 4;
  return renderToBuffer(ctx, dur, (data,sr)=>{
    for (let i=0;i<data.length;i++){
      const t=i/sr;
      const env = Math.exp(-t*damp);
      const bend = freq* (1 + 0.15*Math.exp(-t*20));
      data[i] = Math.sin(2*Math.PI*bend*t) * env * 0.95;
    }
  });
}

function synthCymbal(ctx, type, flavor){
  const dur = type==='ride'? 3.5 : 2.8;
  const brightness = flavor==='rock'? 1.0 : 0.8;
  return renderToBuffer(ctx, dur, (data,sr)=>{
    for (let i=0;i<data.length;i++){
      const t=i/sr;
      const env = Math.exp(-t*(type==='ride'?0.7:1.2));
      const metal = (
        Math.sin(2*Math.PI*211*t)+Math.sin(2*Math.PI*318*t)+Math.sin(2*Math.PI*477*t)+
        Math.sin(2*Math.PI*587*t)+Math.sin(2*Math.PI*751*t)
      )/5;
      const noise = (Math.random()*2-1)*0.6;
      data[i] = (metal*0.7 + noise*0.3) * env * brightness;
    }
  });
}

// ---------- Playback ----------
function playPad(id, velocity=1){
  if (!state.ctx) return;
  const kit = state.buffers[state.kit];
  const buf = kit[id];
  if (!buf) return;

  if (navigator.vibrate) navigator.vibrate(6);

  // hi-hat choke logic: closed or pedal chokes open
  if (id==='hatC' || id==='hatP') chokeHiHat();

  const when = state.ctx.currentTime + (state.latencyMs/1000);
  const src = state.ctx.createBufferSource();
  src.buffer = buf;
  const vca = state.ctx.createGain();
  vca.gain.value = velocity;
  src.connect(vca).connect(state.gains[id]);
  src.start(when);
}

function chokeHiHat(){
  const gOpen = state.gains.hatO;
  if (!gOpen) return;
  const t = state.ctx.currentTime;
  gOpen.gain.cancelScheduledValues(t);
  gOpen.gain.setTargetAtTime(0.0001, t, 0.01);
  setTimeout(()=>{ gOpen.gain.setTargetAtTime(defaultPadGain('hatO'), state.ctx.currentTime, 0.05); }, 30);
}

// ---------- UI wiring ----------
const tempoEl = $('#tempo');
const tempoValEl = $('#tempoVal');
const metroBtn = $('#metroBtn');
const kitBtn = $('#kitBtn');
const masterGainEl = $('#masterGain');
const perPadMixer = $('#perPadMixer');
const pulse = $('#pulse');

const latencyEl = $('#latency');
const saveLatencyBtn = $('#saveLatency');
const latencySaved = $('#latencySaved');

tempoEl.addEventListener('input', () => {
  state.bpm = parseInt(tempoEl.value,10);
  tempoValEl.textContent = state.bpm;
});
kitBtn.addEventListener('click', () => {
  state.kit = state.kit==='rock' ? 'jazz' : 'rock';
  kitBtn.textContent = state.kit==='rock' ? 'Rock' : 'Jazz';
  kitBtn.setAttribute('aria-pressed', state.kit==='jazz' ? 'true' : 'false');
});
masterGainEl.addEventListener('input', () => {
  state.masterGain = parseFloat(masterGainEl.value);
  if (state.master) state.master.gain.value = state.masterGain;
});
function hydrateMixer(){
  perPadMixer.innerHTML = '';
  PADS.forEach(p=>{
    const wrap = document.createElement('label');
    wrap.innerHTML = `${p.label}<input type="range" min="0" max="1" step="0.01" value="${defaultPadGain(p.id)}" data-mix="${p.id}" aria-label="${p.label} gain">`;
    perPadMixer.appendChild(wrap);
  });
  perPadMixer.addEventListener('input', e=>{
    const id = e.target.dataset.mix;
    if (id && state.gains[id]) state.gains[id].gain.value = parseFloat(e.target.value);
  }, {passive:true});
}

// Pads events
const padEls = $$('.pad');
padEls.forEach(el=>{
  const id = el.dataset.pad;
  let pressTimer = 0, isLong = false;

  const start = (e)=>{
    el.classList.add('active');
    const force = ('touches' in e && e.touches[0] && e.touches[0].force) || 0;
    const vFromForce = force ? clamp(0.5 + force*0.8, 0.5, 1.2) : 0.9;

    isLong = false;
    pressTimer = setTimeout(()=>{ isLong = true; }, state.longPressMs);

    playPad(id, vFromForce);
    e.preventDefault();
  };
  const end = ()=>{
    clearTimeout(pressTimer);
    if (isLong) playPad(id, 1.2); // accent on long press
    el.classList.remove('active');
  };

  el.addEventListener('touchstart', start, {passive:false});
  el.addEventListener('touchend', end);
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end);
  el.addEventListener('keydown', e=>{
    if (e.key===' ' || e.key==='Enter'){ start(e); }
  });
});

document.addEventListener('keydown', e=>{
  const pad = PADS.find(p=> p.key.toLowerCase()===e.key.toLowerCase());
  if (pad){ const el = document.querySelector(`.pad[data-pad="${pad.id}"]`); el.classList.add('active'); playPad(pad.id, 1.0); }
});
document.addEventListener('keyup', e=>{
  const pad = PADS.find(p=> p.key.toLowerCase()===e.key.toLowerCase());
  if (pad){ const el = document.querySelector(`.pad[data-pad="${pad.id}"]`); el.classList.remove('active'); }
});

// Latency settings
latencyEl.value = state.latencyMs;
saveLatencyBtn.addEventListener('click', ()=>{
  state.latencyMs = parseInt(latencyEl.value,10)||0;
  localStorage.setItem('latencyMs', String(state.latencyMs));
  latencySaved.textContent = 'Saved ✓';
  setTimeout(()=> latencySaved.textContent='', 1200);
});

// ---------- Metronome ----------
metroBtn.addEventListener('click', ()=>{
  if (!state.ctx) initAudio();
  state.isMetronomeOn = !state.isMetronomeOn;
  metroBtn.setAttribute('aria-pressed', String(state.isMetronomeOn));
  if (state.isMetronomeOn){
    state.nextTick = state.ctx.currentTime + 0.05;
    runScheduler();
  }
});

function runScheduler(){
  if (!state.isMetronomeOn) return;
  const secondsPerBeat = 60.0 / state.bpm;
  while (state.nextTick < state.ctx.currentTime + state.scheduleAheadTime){
    scheduleClick(state.nextTick);
    state.nextTick += secondsPerBeat;
  }
  setTimeout(runScheduler, state.lookahead);
}

function scheduleClick(when){
  const osc = state.ctx.createOscillator();
  const gain = state.ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.8, when+0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, when+0.03);
  osc.connect(gain).connect(state.master);
  osc.start(when);
  osc.stop(when+0.05);

  const lag = (state.latencyMs/1000);
  setTimeout(()=>{ const el = $('#pulse'); el.classList.add('on'); setTimeout(()=>el.classList.remove('on'), 60); }, Math.max(0,(when - state.ctx.currentTime + lag)*1000));
}

// ---------- Recording ----------
const recBtn = $('#recBtn'), playBtn = $('#playBtn'), dlBtn = $('#dlBtn'), clearBtn = $('#clearBtn'), playback = $('#playback'), recTimer = $('#recTimer');

recBtn.addEventListener('click', ()=>{
  if (!state.ctx) initAudio();
  if (state.recording){ stopRecording(); } else { startRecording(); }
});

playBtn.addEventListener('click', ()=> playback.play());
clearBtn.addEventListener('click', clearRecording);
dlBtn.addEventListener('click', downloadRecording);

function startRecording(){
  if (state.recording) return;
  state.recorder = new MediaRecorder(state.recDest.stream, {mimeType: preferredMime()});
  state.chunks = [];
  state.recorder.ondataavailable = e=>{ if (e.data.size>0) state.chunks.push(e.data); };
  state.recorder.onstop = onRecStop;
  state.recorder.start();
  state.recording = true;
  recBtn.textContent = '■ Stop';
  let started = Date.now();
  const tick = ()=>{
    if (!state.recording) return;
    const sec = Math.floor((Date.now()-started)/1000);
    recTimer.textContent = fmt(sec);
    if (sec >= state.maxRecSec) stopRecording();
    else setTimeout(tick, 250);
  };
  tick();
}

function stopRecording(){
  if (!state.recording) return;
  state.recording = false;
  recBtn.textContent = '● Record';
  state.recorder.stop();
}

function onRecStop(){
  const blob = new Blob(state.chunks, {type: state.chunks[0]?.type || 'audio/webm'});
  playback.src = URL.createObjectURL(blob);
  playback.style.display = 'block';
  playBtn.disabled = dlBtn.disabled = clearBtn.disabled = false;
  playback.onended = ()=> playback.currentTime = 0;
}

function clearRecording(){
  playback.removeAttribute('src');
  playback.style.display = 'none';
  playBtn.disabled = dlBtn.disabled = clearBtn.disabled = true;
  recTimer.textContent = '00:00';
}

function preferredMime(){
  const types = ['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4','audio/webm'];
  return types.find(t=> MediaRecorder.isTypeSupported(t)) || '';
}

function downloadRecording(){
  if (!playback.src) return;
  fetch(playback.src).then(r=>r.blob()).then(blob=>{
    const a = document.createElement('a');
    const ext = blob.type.includes('mp4')? 'm4a' : blob.type.includes('ogg')? 'ogg' : 'webm';
    a.href = URL.createObjectURL(blob);
    a.download = `pocket-drums-${Date.now()}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
  });
}

function fmt(s){ const m=String(Math.floor(s/60)).padStart(2,'0'); const ss=String(s%60).padStart(2,'0'); return `${m}:${ss}`; }

// Basic error resilience
window.addEventListener('error', ()=>{ /* noop */ });
