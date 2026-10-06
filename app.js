(() => {
  'use strict';

  const WORDS = [
    // Level 1 — common adult vocabulary
    ...['abrupt','adapt','adequate','ambiguous','apparent','assume','coherent','compile','concede','conspicuous','crucial','derive','diminish','dispute','elaborate','feasible','impartial','inevitable','notion','reluctant'].map(word => ({word, level:1})),
    // Level 2 — intermediate
    ...['alleviate','anomaly','arbitrary','bolster','candid','complacent','conventional','diligent','disparity','elusive','empirical','exacerbate','fluctuate','frugal','inhibit','meticulous','plausible','pragmatic','scrutinize','tenuous'].map(word => ({word, level:2})),
    // Level 3 — advanced
    ...['aberration','ameliorate','antithetical','capricious','cogent','deleterious','didactic','equivocal','fastidious','iconoclast','intransigent','laconic','magnanimous','obfuscate','parsimonious','perfunctory','prosaic','sagacious','ubiquitous','vacillate'].map(word => ({word, level:3})),
    // Level 4 — expert
    ...['abstemious','apocryphal','calumny','circumlocution','contumacious','desultory','diaphanous','eleemosynary','epistemic','execrable','fulsome','impecunious','inveterate','meretricious','perspicacious','recondite','sesquipedalian','supercilious','trenchant','vicissitude'].map(word => ({word, level:4})),
    // Level 5 — obscure / literary
    ...['abecedarian','adumbrate','anfractuous','antediluvian','apothegm','ataraxia','catachresis','concinnity','crepuscular','defenestration','epigone','farrago','ineluctable','noisome','palimpsest','panegyric','ratiocinate','susurrus','tergiversate','zeugma'].map(word => ({word, level:5}))
  ];

  const APP_VERSION = '0.5';
  const LEVEL_NAMES = {1:'Common',2:'Intermediate',3:'Advanced',4:'Expert',5:'Obscure'};
  const STATUS_NAMES = ['New','Learning','Familiar','Strong','Mastered'];
  const DUE_MS = [0, 86400000, 3*86400000, 10*86400000, 30*86400000];
  const KEY_STORAGE = 'vocabTrackerKeysV01';
  const PROGRESS_STORAGE = 'vocabTrackerProgressV01';
  const SETTINGS_STORAGE = 'vocabTrackerSettingsV01';
  const ACTIVE_SESSION_STORAGE = 'vocabTrackerActiveSessionV01';

  const $ = id => document.getElementById(id);
  const qs = sel => document.querySelector(sel);
  const qsa = sel => [...document.querySelectorAll(sel)];

  let keys = loadJson(KEY_STORAGE, {dictionary:'', thesaurus:''});
  let progress = loadJson(PROGRESS_STORAGE, defaultProgress());
  let settings = loadJson(SETTINGS_STORAGE, {sessionSize:10, direction:'word-def', levels:[1,2,3], source:'all', focusedPractice:false, appearance:'system', wordActivation:'options', lastVersion:null});
  let session = null;
  let installPrompt = null;
  let currentLookup = null;
  const transientDictionary = new Map();
  const transientThesaurus = new Map();

  function defaultProgress() {
    return {
      words: {},
      customWords: [],
      placement: null,
      recentLookups: [],
      totals: {answers:0, correct:0, sessions:0},
      streak: {current:0, longest:0, lastStudyDate:null}
    };
  }

  function allStudyWords() {
    const base = WORDS.map(item => ({...item, custom:false}));
    const known = new Set(base.map(item => item.word));
    const custom = Array.isArray(progress.customWords) ? progress.customWords : [];
    for (const item of custom) {
      const word = String(item?.word || '').trim().toLowerCase();
      const level = Math.max(1, Math.min(5, Number(item?.level) || 3));
      if (word && !known.has(word)) {
        base.push({word, level, custom:true});
        known.add(word);
      }
    }
    return base;
  }

  function studyWordExists(word) {
    const normalized = String(word || '').trim().toLowerCase();
    return allStudyWords().some(item => item.word === normalized);
  }

  function addCustomStudyWord(word, level=3) {
    const normalized = String(word || '').trim().toLowerCase();
    if (!normalized || studyWordExists(normalized)) return false;
    if (!Array.isArray(progress.customWords)) progress.customWords = [];
    progress.customWords.push({
      word: normalized,
      level: Math.max(1, Math.min(5, Number(level) || 3)),
      addedAt: Date.now()
    });
    saveState();
    return true;
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? {...fallback, ...JSON.parse(raw)} : fallback;
    } catch { return fallback; }
  }

  function saveState() {
    localStorage.setItem(PROGRESS_STORAGE, JSON.stringify(progress));
    localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(settings));
  }

  function saveKeys() {
    localStorage.setItem(KEY_STORAGE, JSON.stringify(keys));
  }


  function applyAppearance() {
    const mode = ['light','dark'].includes(settings.appearance) ? settings.appearance : 'system';
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const dark = mode === 'dark' || (mode === 'system' && systemDark);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', dark ? '#0d1117' : '#14324a');
  }

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function updateInstallUI() {
    if (!$('installButton')) return;
    const show = Boolean(installPrompt) && !isStandalone();
    $('installButton').classList.toggle('hidden', !show);
  }

  function sanitizedSessionSnapshot() {
    if (!session) return null;
    const resumeIndex = Number.isInteger(session.resumeIndex) ? session.resumeIndex : session.index;
    return {
      mode: session.mode,
      queue: (session.queue || []).map(item => ({word:item.word, level:item.level, custom:Boolean(item.custom), repeat:Boolean(item.repeat)})),
      index: Math.max(0, resumeIndex || 0),
      answered: Number(session.answered) || 0,
      correct: Number(session.correct) || 0,
      direction: session.direction || 'word-def',
      levels: Array.isArray(session.levels) ? session.levels : [1,2,3],
      source: session.source || 'all',
      plannedCount: Number(session.plannedCount) || (session.queue || []).length,
      placementResults: session.placementResults || null,
      savedAt: Date.now()
    };
  }

  function persistSession() {
    const snapshot = sanitizedSessionSnapshot();
    if (!snapshot) return;
    localStorage.setItem(ACTIVE_SESSION_STORAGE, JSON.stringify(snapshot));
  }

  function clearSavedSession() {
    localStorage.removeItem(ACTIVE_SESSION_STORAGE);
  }

  function loadSavedSession() {
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.queue) || !saved.queue.length) return null;
      if (!Number.isInteger(saved.index) || saved.index < 0 || saved.index > saved.queue.length) return null;
      if (saved.savedAt && Date.now() - saved.savedAt > 30*86400000) {
        clearSavedSession();
        return null;
      }
      return {...saved, current:null, completed:false, resumeIndex:saved.index};
    } catch {
      clearSavedSession();
      return null;
    }
  }

  function hasResumableSession() {
    return Boolean(session || loadSavedSession());
  }

  async function resumeSavedSession() {
    if (!session) session = loadSavedSession();
    else if (Number.isInteger(session.resumeIndex) && session.resumeIndex > session.index) session.index = session.resumeIndex;
    if (!session) {
      showToast('No unfinished session is available.');
      renderHome();
      return;
    }
    switchView('practice', false);
    setFocusedPracticeActive(true);
    $('practiceSetup').classList.add('hidden');
    $('sessionComplete').classList.add('hidden');
    $('quizArea').classList.remove('hidden');
    $('endSessionButton').classList.remove('hidden');
    await presentQuestion();
  }

  function wordState(word) {
    if (!progress.words[word]) {
      progress.words[word] = {mastery:0, seen:0, correct:0, wrong:0, nextDue:0, lastSeen:null, suspended:false, markedKnown:false, luckyGuesses:0};
    }
    return progress.words[word];
  }

  function getExistingWordState(word) {
    return progress.words[word] || {mastery:0, seen:0, correct:0, wrong:0, nextDue:0, lastSeen:null, suspended:false, markedKnown:false, luckyGuesses:0};
  }

  function statusOf(state) {
    return STATUS_NAMES[Math.max(0, Math.min(4, Number(state.mastery)||0))];
  }

  function localDateString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth()+1).padStart(2,'0');
    const d = String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  function daysBetweenLocal(a, b) {
    const [ay,am,ad] = a.split('-').map(Number);
    const [by,bm,bd] = b.split('-').map(Number);
    return Math.round((new Date(by,bm-1,bd)-new Date(ay,am-1,ad))/86400000);
  }

  function markStudyDay() {
    const today = localDateString();
    const s = progress.streak || {current:0,longest:0,lastStudyDate:null};
    if (s.lastStudyDate !== today) {
      if (!s.lastStudyDate) s.current = 1;
      else {
        const gap = daysBetweenLocal(s.lastStudyDate, today);
        s.current = gap === 1 ? s.current + 1 : 1;
      }
      s.lastStudyDate = today;
      s.longest = Math.max(s.longest || 0, s.current);
      progress.streak = s;
    }
  }

  function updateWordProgress(word, correct) {
    const state = wordState(word);
    const now = Date.now();
    state.seen += 1;
    state.lastSeen = now;
    state.markedKnown = false;
    if (correct) {
      state.correct += 1;
      state.mastery = Math.min(4, state.mastery + 1);
      state.nextDue = now + DUE_MS[state.mastery];
    } else {
      state.wrong += 1;
      state.mastery = Math.max(0, state.mastery - 1);
      state.nextDue = now + 10 * 60 * 1000;
    }
    progress.totals.answers += 1;
    if (correct) progress.totals.correct += 1;
    markStudyDay();
    saveState();
  }

  function accuracy(correct, total) {
    return total ? `${Math.round((correct/total)*100)}%` : '—';
  }

  function shuffle(items) {
    const a = [...items];
    for (let i=a.length-1;i>0;i--) {
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]] = [a[j],a[i]];
    }
    return a;
  }

  function showToast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  function setFocusedPracticeActive(active) {
    document.body.classList.toggle('focus-practice', Boolean(active && settings.focusedPractice));
  }

  function updateQuestionCounter() {
    if (!session) return;
    const total = session.queue.length;
    if (session.mode === 'placement') {
      $('questionCounter').textContent = `Placement question ${session.index+1} of ${total}`;
      return;
    }
    const recycled = Math.max(0, total - session.plannedCount);
    const current = session.queue[session.index];
    let text = `Question ${session.index+1} of ${total}`;
    if (current?.repeat) text += ' — recycled review of a missed word';
    else if (recycled) text += ` — ${recycled} recycled review${recycled===1?'':'s'} added`;
    $('questionCounter').textContent = text;
  }

  function setMenuOpen(open, focusFirst=false) {
    const menu = $('mainMenu');
    const button = $('menuButton');
    if (!menu || !button) return;
    menu.classList.toggle('hidden', !open);
    button.setAttribute('aria-expanded', String(Boolean(open)));
    if (open && focusFirst) menu.querySelector('button[data-view]')?.focus();
  }

  function switchView(name, focus=true) {
    qsa('.view').forEach(v => v.classList.add('hidden'));
    $(`view-${name}`).classList.remove('hidden');
    qsa('#mainMenu button[data-view]').forEach(b => b.setAttribute('aria-current', b.dataset.view===name ? 'page' : 'false'));
    setMenuOpen(false);
    if (name === 'home') renderHome();
    if (name === 'lookup') renderRecentLookups();
    if (name === 'words') renderWords();
    if (name === 'stats') renderStats();
    if (name === 'settings') renderSettings();
    if (name === 'practice' && !session) renderPracticeSetup();
    if (name === 'practice' && session) setFocusedPracticeActive(true);
    else setFocusedPracticeActive(false);
    if (focus) $('main').focus();
  }

  function renderHome() {
    const studyItems = allStudyWords();
    const activeItems = studyItems.filter(({word}) => !getExistingWordState(word).suspended);
    const states = studyItems.map(({word}) => getExistingWordState(word));
    const seen = states.filter(s => s.seen>0);
    const mastered = states.filter(s => s.mastery===4).length;
    const learning = states.filter(s => s.mastery>0 && s.mastery<4).length;
    const due = activeItems.filter(({word}) => {
      const s = getExistingWordState(word);
      return s.nextDue && s.nextDue <= Date.now();
    }).length;
    $('homeMastered').textContent = mastered;
    $('homeLearning').textContent = learning;
    $('homeDue').textContent = due;
    $('homeAccuracy').textContent = accuracy(progress.totals.correct, progress.totals.answers);
    $('homeStreak').textContent = progress.streak?.current || 0;
    $('homeSeen').textContent = seen.length;
    const personalCount = studyItems.filter(item => item.custom).length;
    $('homePersonal').textContent = personalCount;
    const ready = Boolean(keys.dictionary && keys.thesaurus);
    $('setupNotice').textContent = ready
      ? 'Reference keys are configured on this device. Practice is ready.'
      : 'Before your first practice session, open Settings and enter your two Merriam-Webster API keys.';

    const resumable = hasResumableSession();
    $('resumeSessionButton').classList.toggle('hidden', !resumable);
    $('startPracticeButton').disabled = !ready || resumable;
    $('homePlacementButton').disabled = !keys.dictionary || resumable;
    $('homePersonalButton').disabled = !ready || personalCount===0 || resumable;
    $('reviewDueButton').disabled = !ready || due===0 || resumable;
    const difficult = activeItems.filter(({word}) => {
      const s = getExistingWordState(word);
      return s.wrong>0 && (s.correct+s.wrong) && s.correct/(s.correct+s.wrong)<0.7;
    }).length;
    $('reviewMissedButton').disabled = !ready || difficult===0 || resumable;
    const placement = progress.placement;
    $('homePlacementStatus').textContent = placement?.recommendedLevel
      ? `Latest placement recommendation: Level ${placement.recommendedLevel}: ${LEVEL_NAMES[placement.recommendedLevel]}.`
      : 'No placement check completed yet.';
  }

  function renderPracticeSetup() {
    $('practiceSetup').classList.remove('hidden');
    $('quizArea').classList.add('hidden');
    $('sessionComplete').classList.add('hidden');
    $('endSessionButton').classList.add('hidden');
    $('placementApplyButton').classList.add('hidden');
    $('anotherSessionButton').classList.remove('hidden');
    $('anotherSessionButton').textContent = 'Start another session';
    $('sessionSize').value = String(settings.sessionSize || 10);
    $('questionDirection').value = settings.direction || 'word-def';
    $('practiceSource').value = settings.source || 'all';
    qsa('input[name="level"]').forEach(cb => cb.checked = (settings.levels || [1,2,3]).includes(Number(cb.value)));
  }

  function buildSession(mode='normal') {
    if (mode === 'placement') {
      const selected = [];
      for (let level=1; level<=5; level++) {
        selected.push(...shuffle(WORDS.filter(item => item.level===level)).slice(0,3));
      }
      return {
        mode:'placement',
        queue:shuffle(selected).map(w => ({...w, custom:false, repeat:false})),
        index:0,
        answered:0,
        correct:0,
        current:null,
        completed:false,
        direction:'word-def',
        levels:[1,2,3,4,5],
        source:'starter',
        plannedCount:selected.length,
        placementResults:{
          1:{answered:0,correct:0},
          2:{answered:0,correct:0},
          3:{answered:0,correct:0},
          4:{answered:0,correct:0},
          5:{answered:0,correct:0}
        }
      };
    }

    const levels = qsa('input[name="level"]:checked').map(cb => Number(cb.value));
    if (!levels.length) {
      showToast('Select at least one difficulty level.');
      return null;
    }
    const size = Number($('sessionSize').value);
    const direction = $('questionDirection').value;
    const source = $('practiceSource').value || 'all';
    settings = {...settings, sessionSize:size, direction, levels, source};
    saveState();

    let pool = allStudyWords().filter(w => levels.includes(w.level) && !getExistingWordState(w.word).suspended);
    if (source === 'personal') pool = pool.filter(w => w.custom);
    if (source === 'starter') pool = pool.filter(w => !w.custom);

    const now = Date.now();
    let candidates;
    if (mode === 'due') {
      candidates = pool.filter(({word}) => {
        const s = getExistingWordState(word);
        return s.seen>0 && s.nextDue && s.nextDue<=now;
      });
    } else if (mode === 'difficult') {
      candidates = pool.filter(({word}) => {
        const s = getExistingWordState(word);
        return s.seen>0 && s.wrong>0 && s.correct/(s.correct+s.wrong)<0.7;
      });
    } else {
      const due = pool.filter(({word}) => {
        const s=getExistingWordState(word); return s.seen>0 && s.nextDue && s.nextDue<=now;
      });
      const fresh = pool.filter(({word}) => getExistingWordState(word).seen===0);
      const continuing = pool.filter(({word}) => {
        const s=getExistingWordState(word); return s.seen>0 && s.mastery<4 && !(s.nextDue && s.nextDue<=now);
      });
      const mastered = pool.filter(({word}) => getExistingWordState(word).mastery===4);
      const prioritizePersonal = items => [...shuffle(items.filter(x=>x.custom)), ...shuffle(items.filter(x=>!x.custom))];
      candidates = [
        ...prioritizePersonal(due),
        ...prioritizePersonal(fresh),
        ...prioritizePersonal(continuing),
        ...prioritizePersonal(mastered)
      ];
    }
    const unique = [];
    const seenWords = new Set();
    for (const item of candidates) {
      if (!seenWords.has(item.word)) { unique.push(item); seenWords.add(item.word); }
    }
    const selected = unique.slice(0, Math.min(size, unique.length));
    if (!selected.length) {
      const sourceMessage = source==='personal' ? 'No personal words match the selected levels.' :
        (mode==='due' ? 'No words are due in the selected levels.' : 'No matching words are available.');
      showToast(sourceMessage);
      return null;
    }
    return {
      mode,
      queue: selected.map(w => ({...w, repeat:false})),
      index:0,
      answered:0,
      correct:0,
      current:null,
      completed:false,
      direction,
      levels,
      source,
      plannedCount:selected.length
    };
  }

  function startBuiltSession(built) {
    if (!built) return;
    session = {...built, resumeIndex:built.index || 0};
    persistSession();
    setFocusedPracticeActive(true);
    $('practiceSetup').classList.add('hidden');
    $('sessionComplete').classList.add('hidden');
    $('quizArea').classList.remove('hidden');
    $('endSessionButton').classList.remove('hidden');
    presentQuestion();
  }

  async function beginSession(mode='normal') {
    if (!keys.dictionary) { switchView('settings'); $('dictionaryKey').focus(); return; }
    if (!session && loadSavedSession()) {
      showToast('Resume or end your unfinished session before starting a new one.');
      switchView('home');
      return;
    }
    const built = buildSession(mode);
    if (!built) return;
    startBuiltSession(built);
  }

  async function apiLookup(kind, word, apiKey) {
    const response = await fetch('/api/lookup', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      cache:'no-store',
      body: JSON.stringify({kind, word, apiKey})
    });
    const data = await response.json().catch(() => ({error:'Unreadable response.'}));
    if (!response.ok) throw new Error(data.error || `Lookup failed (${response.status}).`);
    return data;
  }

  function normalizeHeadword(hw) {
    return String(hw || '').replace(/\*/g,'').replace(/\u00b7/g,'');
  }

  async function getDictionary(word) {
    if (transientDictionary.has(word)) return transientDictionary.get(word);
    const data = await apiLookup('dictionary', word, keys.dictionary);
    if (!Array.isArray(data)) throw new Error('Unexpected dictionary response.');
    if (data.length && typeof data[0] === 'string') throw new Error(`No exact dictionary entry for ${word}.`);
    const entry = data.find(item => item && typeof item==='object' && Array.isArray(item.shortdef) && item.shortdef.length)
      || data.find(item => item && typeof item==='object');
    if (!entry || !Array.isArray(entry.shortdef) || !entry.shortdef.length) throw new Error(`No usable definition for ${word}.`);
    const result = {
      word,
      headword: normalizeHeadword(entry.hwi?.hw) || word,
      partOfSpeech: entry.fl || '',
      shortdefs: entry.shortdef.filter(Boolean).slice(0,3),
      definition: entry.shortdef[0]
    };
    transientDictionary.set(word, result);
    return result;
  }

  async function getThesaurus(word) {
    if (transientThesaurus.has(word)) return transientThesaurus.get(word);
    const data = await apiLookup('thesaurus', word, keys.thesaurus);
    if (!Array.isArray(data) || (data.length && typeof data[0] === 'string')) {
      const empty = {synonyms:[], antonyms:[]};
      transientThesaurus.set(word, empty); return empty;
    }
    const entries = data.filter(x => x && typeof x==='object');
    const syns = [];
    const ants = [];
    for (const e of entries.slice(0,4)) {
      for (const group of (e.meta?.syns || [])) for (const item of group) if (typeof item==='string') syns.push(item);
      for (const group of (e.meta?.ants || [])) for (const item of group) if (typeof item==='string') ants.push(item);
    }
    const unique = arr => [...new Set(arr.map(x => String(x).replace(/\{.*?\}/g,'').trim()).filter(Boolean))];
    const result = {synonyms:unique(syns).slice(0,12), antonyms:unique(ants).slice(0,12)};
    transientThesaurus.set(word, result);
    return result;
  }

  function ensureStudyWord(word, level=3) {
    const normalized = String(word || '').trim().toLowerCase();
    if (!normalized) return null;
    if (!studyWordExists(normalized)) addCustomStudyWord(normalized, level);
    return allStudyWords().find(item => item.word === normalized) || null;
  }

  function markWordKnown(word, level=3) {
    const item = ensureStudyWord(word, level);
    if (!item) return;
    const state = wordState(item.word);
    state.mastery = 4;
    state.markedKnown = true;
    state.suspended = false;
    state.nextDue = Date.now() + DUE_MS[4];
    saveState();
    renderHome(); renderWords(); renderStats();
    showToast(`${item.word} marked as already known.`);
  }

  function setWordSuspended(word, suspended, level=3) {
    const item = ensureStudyWord(word, level);
    if (!item) return;
    const state = wordState(item.word);
    state.suspended = Boolean(suspended);
    saveState();
    renderHome(); renderWords(); renderStats();
    showToast(`${item.word} ${state.suspended ? 'suspended from practice' : 'returned to practice'}.`);
  }

  function updatePersonalWordLevel(word, level) {
    const normalized = String(word || '').trim().toLowerCase();
    const target = Array.isArray(progress.customWords) ? progress.customWords.find(item => String(item.word).toLowerCase()===normalized) : null;
    if (!target) return;
    target.level = Math.max(1, Math.min(5, Number(level) || 3));
    saveState();
    renderWords(); renderStats();
    showToast(`${normalized} moved to Level ${target.level}: ${LEVEL_NAMES[target.level]}.`);
  }

  function openLookupForWord(word) {
    switchView('lookup');
    $('lookupWord').value = word;
    lookupWord(word);
  }

  function practiceWordNow(word, level=3) {
    if (!keys.dictionary) { switchView('settings'); $('dictionaryKey').focus(); return; }
    if (hasResumableSession()) {
      showToast('Resume or end your unfinished session before starting one-word practice.');
      return;
    }
    const item = ensureStudyWord(word, level);
    if (!item) return;
    const state = wordState(item.word);
    state.suspended = false;
    saveState();
    const built = {
      mode:'single',
      queue:[{...item, repeat:false}],
      index:0,
      answered:0,
      correct:0,
      current:null,
      completed:false,
      direction:settings.direction || 'word-def',
      levels:[item.level],
      source:item.custom ? 'personal' : 'starter',
      plannedCount:1
    };
    switchView('practice', false);
    startBuiltSession(built);
  }

  function rememberLookup(word) {
    const normalized = String(word || '').trim().toLowerCase();
    if (!normalized) return;
    const existing = Array.isArray(progress.recentLookups) ? progress.recentLookups : [];
    progress.recentLookups = [normalized, ...existing.filter(item => item !== normalized)].slice(0,12);
    saveState();
    renderRecentLookups();
  }

  function renderRecentLookups() {
    const section = $('recentLookups');
    const container = $('recentLookupButtons');
    if (!section || !container) return;
    const items = Array.isArray(progress.recentLookups) ? progress.recentLookups : [];
    container.innerHTML = '';
    if (!items.length) {
      section.classList.add('hidden');
      return;
    }
    items.forEach(word => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = word;
      button.addEventListener('click', () => {
        $('lookupWord').value = word;
        lookupWord(word);
      });
      container.appendChild(button);
    });
    section.classList.remove('hidden');
  }

  function clearRecentLookups() {
    progress.recentLookups = [];
    saveState();
    renderRecentLookups();
    showToast('Recent lookups cleared.');
  }

  function addRelatedWord(word, level, button) {
    const normalized = String(word || '').trim().toLowerCase();
    if (!normalized) return;
    if (addCustomStudyWord(normalized, level)) {
      showToast(`${word} added to My Words at Level ${level}.`);
      renderHome();
      renderWords();
      renderStats();
    }
    if (button) {
      button.disabled = true;
      button.textContent = 'In My Words';
    }
  }

  function appendThesaurusWordGroup(panel, label, words, getLevel) {
    if (!words?.length) return;
    const section = document.createElement('section');
    section.className = 'thesaurus-group';
    const h = document.createElement('h5');
    h.textContent = label;
    section.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'thesaurus-word-list';
    words.forEach(word => {
      const li = document.createElement('li');
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'related-word-trigger';
      trigger.setAttribute('aria-expanded','false');
      trigger.textContent = `${word}${studyWordExists(word) ? ' — in My Words' : ''}`;

      const actions = document.createElement('div');
      actions.className = 'related-word-actions hidden';
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.textContent = studyWordExists(word) ? 'Already in My Words' : 'Add to My Words';
      addButton.disabled = studyWordExists(word);
      addButton.addEventListener('click', () => {
        addRelatedWord(word, Number(getLevel()) || 3, addButton);
        trigger.textContent = `${word} — in My Words`;
      });
      const lookupButton = document.createElement('button');
      lookupButton.type = 'button'; lookupButton.textContent = 'Look up this word';
      lookupButton.addEventListener('click', () => openLookupForWord(word));
      const practiceButton = document.createElement('button');
      practiceButton.type = 'button'; practiceButton.textContent = 'Practice this word now';
      practiceButton.addEventListener('click', () => practiceWordNow(word, Number(getLevel()) || 3));
      const knownButton = document.createElement('button');
      knownButton.type = 'button'; knownButton.textContent = 'Mark as already known';
      knownButton.addEventListener('click', () => markWordKnown(word, Number(getLevel()) || 3));
      actions.append(addButton, lookupButton, practiceButton, knownButton);

      trigger.addEventListener('click', () => {
        if ((settings.wordActivation || 'options') === 'add' && !studyWordExists(word)) {
          addRelatedWord(word, Number(getLevel()) || 3, addButton);
          trigger.textContent = `${word} — in My Words`;
          return;
        }
        const open = actions.classList.contains('hidden');
        actions.classList.toggle('hidden', !open);
        trigger.setAttribute('aria-expanded', String(open));
        if (open) actions.querySelector('button')?.focus();
      });
      li.append(trigger, actions);
      ul.appendChild(li);
    });
    section.appendChild(ul);
    panel.appendChild(section);
  }

  function renderThesaurusWithAdd(panel, thesaurus, getLevel) {
    panel.innerHTML = '';
    const h = document.createElement('h4');
    h.textContent = 'Thesaurus';
    panel.appendChild(h);
    appendThesaurusWordGroup(panel, 'Synonyms', thesaurus.synonyms, getLevel);
    appendThesaurusWordGroup(panel, 'Antonyms', thesaurus.antonyms, getLevel);
    if (!thesaurus.synonyms.length && !thesaurus.antonyms.length) {
      const p = document.createElement('p');
      p.textContent = 'No synonym or antonym list was returned for this entry.';
      panel.appendChild(p);
    }
  }

  function renderLookupSuggestions(suggestions) {
    const section = $('lookupSuggestions');
    const list = $('lookupSuggestionList');
    list.innerHTML = '';
    if (!suggestions?.length) {
      section.classList.add('hidden');
      return;
    }
    suggestions.slice(0,8).forEach(suggestion => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = suggestion;
      button.addEventListener('click', () => {
        $('lookupWord').value = suggestion;
        lookupWord(suggestion);
      });
      li.appendChild(button);
      list.appendChild(li);
    });
    section.classList.remove('hidden');
  }

  function updateLookupAddControls() {
    const controls = $('lookupAddControls');
    const button = $('addLookupWordButton');
    if (!currentLookup?.word) {
      controls.classList.add('hidden');
      return;
    }
    controls.classList.remove('hidden');
    const exists = studyWordExists(currentLookup.word);
    button.disabled = exists;
    button.textContent = exists ? 'Already in My Words' : 'Add to My Words';
  }

  async function lookupWord(overrideWord=null) {
    const input = $('lookupWord');
    const raw = String(overrideWord ?? input.value).trim();
    const word = raw.toLowerCase();
    const status = $('lookupStatus');
    const result = $('lookupResult');
    currentLookup = null;
    result.classList.add('hidden');
    $('lookupAddControls').classList.add('hidden');
    renderLookupSuggestions([]);

    if (!word) {
      status.textContent = 'Enter a word to look up.';
      input.focus();
      return;
    }
    if (!keys.dictionary) {
      status.textContent = 'Your Merriam-Webster Dictionary API key is not configured. Open Settings first.';
      return;
    }

    status.textContent = `Looking up ${raw}…`;
    $('lookupButton').disabled = true;
    try {
      const data = await apiLookup('dictionary', word, keys.dictionary);
      if (!Array.isArray(data)) throw new Error('Unexpected dictionary response.');

      if (!data.some(item => item && typeof item === 'object')) {
        const suggestions = data.filter(item => typeof item === 'string');
        status.textContent = suggestions.length
          ? `No exact dictionary entry was returned for ${raw}. Choose a suggested spelling below.`
          : `No dictionary entry was returned for ${raw}.`;
        renderLookupSuggestions(suggestions);
        return;
      }

      const entry = data.find(item => item && typeof item === 'object' && Array.isArray(item.shortdef) && item.shortdef.length)
        || data.find(item => item && typeof item === 'object');
      if (!entry || !Array.isArray(entry.shortdef) || !entry.shortdef.length) {
        status.textContent = `Merriam-Webster returned an entry for ${raw}, but it did not include a usable short definition.`;
        return;
      }

      const displayWord = normalizeHeadword(entry.hwi?.hw) || raw;
      const storedWord = displayWord.toLowerCase();
      const dictionary = {
        word: storedWord,
        headword: displayWord,
        partOfSpeech: entry.fl || '',
        shortdefs: entry.shortdef.filter(Boolean).slice(0,3),
        definition: entry.shortdef[0]
      };
      transientDictionary.set(storedWord, dictionary);
      currentLookup = dictionary;
      rememberLookup(storedWord);

      $('lookupResultHeading').textContent = displayWord;
      $('lookupPartOfSpeech').textContent = dictionary.partOfSpeech ? `Part of speech: ${dictionary.partOfSpeech}` : '';
      const definitions = $('lookupDefinitions');
      definitions.innerHTML = '';
      const heading = document.createElement('h4');
      heading.textContent = 'Definitions';
      definitions.appendChild(heading);
      const ol = document.createElement('ol');
      dictionary.shortdefs.forEach(def => {
        const li = document.createElement('li');
        li.textContent = def;
        ol.appendChild(li);
      });
      definitions.appendChild(ol);

      const thesaurusPanel = $('lookupThesaurus');
      thesaurusPanel.innerHTML = '';
      if (keys.thesaurus) {
        try {
          const thesaurus = await getThesaurus(storedWord);
          renderThesaurusWithAdd(thesaurusPanel, thesaurus, () => Number($('lookupLevel').value) || 3);
        } catch (error) {
          const p = document.createElement('p');
          p.textContent = `Thesaurus lookup was unavailable: ${error.message}`;
          thesaurusPanel.appendChild(p);
        }
      } else {
        const p = document.createElement('p');
        p.textContent = 'Add your Thesaurus API key in Settings to see synonyms and antonyms.';
        thesaurusPanel.appendChild(p);
      }

      updateLookupAddControls();
      result.classList.remove('hidden');
      status.textContent = `Lookup complete for ${displayWord}.`;
      result.focus();
    } catch (error) {
      status.textContent = `Lookup failed: ${error.message}`;
    } finally {
      $('lookupButton').disabled = false;
    }
  }

  function addLookupWordToStudy() {
    if (!currentLookup?.word) return;
    const level = Number($('lookupLevel').value) || 3;
    if (addCustomStudyWord(currentLookup.word, level)) {
      showToast(`${currentLookup.headword || currentLookup.word} added to My Words.`);
      renderHome();
      renderWords();
      renderStats();
    }
    updateLookupAddControls();
  }

  async function makeQuestion(item) {
    const questionPool = session?.mode === 'placement' ? WORDS.map(w => ({...w, custom:false})) : allStudyWords().filter(w => !getExistingWordState(w.word).suspended || w.word===item.word);
    const levelPool = questionPool.filter(w => w.word!==item.word && (w.level===item.level || Math.abs(w.level-item.level)<=1));
    const distractorWords = shuffle(levelPool).slice(0,3);
    const allItems = [item, ...distractorWords];
    const entries = await Promise.all(allItems.map(x => getDictionary(x.word)));
    const target = entries[0];
    const distractors = entries.slice(1);
    let direction = session.direction;
    if (direction === 'mixed') direction = Math.random()<0.5 ? 'word-def' : 'def-word';
    const rawOptions = direction === 'word-def'
      ? [{value:target.definition, correct:true, word:item.word}, ...distractors.map((e,i)=>({value:e.definition,correct:false,word:distractorWords[i].word}))]
      : [{value:item.word, correct:true, word:item.word}, ...distractorWords.map(x=>({value:x.word,correct:false,word:x.word}))];
    const options = shuffle(rawOptions).map((o,i)=>({...o, letter:'ABCD'[i]}));
    return {item,target,distractors,direction,options};
  }

  async function presentQuestion() {
    if (!session || session.index >= session.queue.length) { finishSession(); return; }
    $('feedbackPanel').classList.add('hidden');
    $('detailsPanel').classList.add('hidden');
    $('luckyGuessButton').classList.add('hidden');
    $('luckyGuessButton').disabled = false;
    $('luckyGuessButton').textContent = 'Lucky guess — review sooner';
    $('confidenceStatus').classList.add('hidden');
    $('confidenceStatus').textContent = '';
    session.resumeIndex = session.index;
    persistSession();
    $('questionCard').classList.add('hidden');
    $('loadingQuestion').classList.remove('hidden');
    updateQuestionCounter();
    const item = session.queue[session.index];
    try {
      session.current = await makeQuestion(item);
      renderQuestion(session.current);
    } catch (error) {
      $('loadingQuestion').classList.add('hidden');
      const panel = $('feedbackPanel');
      panel.className = 'feedback';
      panel.classList.remove('hidden');
      $('feedbackHeading').textContent = 'Could not load this question';
      $('feedbackText').textContent = `${error.message} Check your connection and API key, then try again.`;
      $('wordFacts').innerHTML = '';
      $('detailsButton').classList.add('hidden');
      $('nextQuestionButton').textContent = 'Skip this word';
      $('nextQuestionButton').onclick = () => { session.index += 1; session.resumeIndex = session.index; persistSession(); presentQuestion(); };
      panel.focus();
    }
  }

  function renderQuestion(q) {
    $('loadingQuestion').classList.add('hidden');
    $('questionCard').classList.remove('hidden');
    $('feedbackPanel').classList.add('hidden');
    const prompt = q.direction==='word-def' ? q.item.word : q.target.definition;
    $('questionType').textContent = q.direction==='word-def' ? 'Choose the definition' : 'Choose the word';
    $('questionPrompt').textContent = prompt;
    const choices = $('answerChoices');
    choices.innerHTML = '';
    q.options.forEach(option => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'answer-button';
      b.dataset.correct = String(option.correct);
      b.dataset.value = option.value;
      b.textContent = `${option.letter}. ${option.value}`;
      b.setAttribute('aria-label', `${option.letter}. ${option.value}`);
      b.addEventListener('click', () => answerQuestion(option, b));
      choices.appendChild(b);
    });
    $('questionPrompt').focus();
  }

  function answerQuestion(option, button) {
    if (!session?.current || session.current.answered) return;
    session.current.answered = true;
    const q = session.current;
    const isCorrect = option.correct;
    const isPlacement = session.mode === 'placement';
    session.answered += 1;
    if (isCorrect) session.correct += 1;

    if (isPlacement) {
      const levelResult = session.placementResults[q.item.level];
      levelResult.answered += 1;
      if (isCorrect) levelResult.correct += 1;
    } else {
      q.progressBefore = {...getExistingWordState(q.item.word)};
      q.wasCorrect = isCorrect;
      updateWordProgress(q.item.word, isCorrect);
    }

    qsa('.answer-button').forEach(b => {
      b.disabled = true;
      if (b.dataset.correct === 'true') {
        b.classList.add('correct-answer');
        b.textContent += ' — correct answer';
      }
    });
    if (!isCorrect) {
      button.classList.add('incorrect-answer');
      button.textContent += ' — your answer';
      if (!isPlacement) {
        const repeatExists = session.queue.slice(session.index+1).some(x => x.word===q.item.word && x.repeat);
        if (!repeatExists) {
          const insertAt = Math.min(session.queue.length, session.index + 5);
          session.queue.splice(insertAt, 0, {...q.item, repeat:true});
          showToast(`${q.item.word} will return later for review.`);
        }
      }
    }

    const state = getExistingWordState(q.item.word);
    const panel = $('feedbackPanel');
    panel.className = `feedback ${isCorrect ? 'correct' : 'incorrect'}`;
    panel.classList.remove('hidden');
    $('feedbackHeading').textContent = isCorrect ? 'Correct' : 'Incorrect';
    if (isPlacement) {
      $('feedbackText').textContent = isCorrect
        ? `${q.item.word}: ${q.target.definition}`
        : `The correct answer is ${q.target.definition}. Placement answers do not change your mastery record.`;
    } else {
      $('feedbackText').textContent = isCorrect
        ? `${q.item.word}: ${q.target.definition}`
        : `The correct answer is ${q.direction==='word-def' ? q.target.definition : q.item.word}. This word will return later in this session.`;
    }
    $('wordFacts').innerHTML = '';
    addFact('Word', q.target.headword || q.item.word);
    if (q.target.partOfSpeech) addFact('Part of speech', q.target.partOfSpeech);
    if (isPlacement) {
      addFact('Placement', 'Does not affect mastery or study statistics');
      $('detailsButton').classList.add('hidden');
    } else {
      addFact('Mastery', statusOf(state));
      addFact('Record', `${state.correct} correct, ${state.wrong} incorrect`);
      $('detailsButton').classList.remove('hidden');
      if (isCorrect) $('luckyGuessButton').classList.remove('hidden');
      else $('luckyGuessButton').classList.add('hidden');
      $('detailsButton').textContent = 'Show synonyms and antonyms';
      $('detailsButton').disabled = false;
    }
    $('nextQuestionButton').textContent = 'Next question';
    $('nextQuestionButton').onclick = nextQuestion;
    updateQuestionCounter();
    session.resumeIndex = session.index + 1;
    persistSession();
    panel.focus();
    if (!isPlacement) renderHome();
  }

  function markLuckyGuess() {
    if (!session?.current || session.mode === 'placement') return;
    const q = session.current;
    if (!q.wasCorrect || q.luckyGuessMarked) return;
    const before = q.progressBefore || {mastery:0};
    const state = wordState(q.item.word);
    state.mastery = Number(before.mastery) || 0;
    state.nextDue = Date.now() + 10*60*1000;
    state.luckyGuesses = (Number(state.luckyGuesses) || 0) + 1;
    q.luckyGuessMarked = true;
    saveState();
    $('luckyGuessButton').disabled = true;
    $('luckyGuessButton').textContent = 'Lucky guess recorded';
    $('confidenceStatus').textContent = 'The answer stays correct in your accuracy statistics, but this word did not gain mastery and will be reviewed sooner.';
    $('confidenceStatus').classList.remove('hidden');
    renderHome(); renderWords(); renderStats();
    persistSession();
  }

  function addFact(term, value) {
    const dl = $('wordFacts');
    const dt = document.createElement('dt'); dt.textContent = term;
    const dd = document.createElement('dd'); dd.textContent = value;
    dl.append(dt,dd);
  }

  async function showDetails() {
    if (!session?.current || session.mode === 'placement') return;
    const q = session.current;
    const button = $('detailsButton');
    button.disabled = true;
    button.textContent = 'Loading thesaurus…';
    const panel = $('detailsPanel');
    panel.classList.remove('hidden');
    panel.textContent = 'Loading official thesaurus information…';
    try {
      const t = await getThesaurus(q.item.word);
      panel.innerHTML = '';
      const h = document.createElement('h4'); h.textContent = `Thesaurus for ${q.item.word}`; panel.appendChild(h);
      appendThesaurusWordGroup(panel, 'Synonyms', t.synonyms, () => q.item.level || 3);
      appendThesaurusWordGroup(panel, 'Antonyms', t.antonyms, () => q.item.level || 3);
      if (!t.synonyms.length && !t.antonyms.length) panel.append('No synonym or antonym list was returned for this word.');
      button.textContent = 'Synonyms and antonyms shown';
    } catch (e) {
      panel.textContent = `Thesaurus lookup failed: ${e.message}`;
      button.textContent = 'Try synonyms and antonyms again';
      button.disabled = false;
    }
  }

  function nextQuestion() {
    if (!session) return;
    session.index += 1;
    session.resumeIndex = session.index;
    persistSession();
    presentQuestion();
  }

  function placementRecommendation(results) {
    for (let level=1; level<=5; level++) {
      const result = results[level] || {answered:0,correct:0};
      const ratio = result.answered ? result.correct/result.answered : 0;
      if (ratio < 2/3) return level;
    }
    return 5;
  }

  function finishPlacementSession(summary) {
    const recommendedLevel = placementRecommendation(summary.placementResults);
    const scores = {};
    const scoreText = [];
    for (let level=1; level<=5; level++) {
      const result = summary.placementResults[level] || {answered:0,correct:0};
      scores[level] = {answered:result.answered, correct:result.correct};
      scoreText.push(`Level ${level}: ${result.correct} of ${result.answered}`);
    }
    progress.placement = {
      completedAt:new Date().toISOString(),
      recommendedLevel,
      scores
    };
    saveState();
    $('quizArea').classList.add('hidden');
    $('endSessionButton').classList.add('hidden');
    $('sessionComplete').classList.remove('hidden');
    $('sessionSummary').textContent = `Placement complete. ${scoreText.join('; ')}. Recommended starting point: Level ${recommendedLevel}: ${LEVEL_NAMES[recommendedLevel]}. This quick estimate did not change mastery or study statistics.`;
    $('anotherSessionButton').classList.add('hidden');
    $('placementApplyButton').classList.remove('hidden');
    setFocusedPracticeActive(false);
    $('sessionComplete').focus();
    session = null;
    clearSavedSession();
    renderHome();
    renderStats();
  }

  function applyPlacementRecommendation() {
    const level = Number(progress.placement?.recommendedLevel);
    if (!level) return;
    settings = {...settings, levels:[level], source:'all'};
    saveState();
    renderPracticeSetup();
    showToast(`Practice set to Level ${level}: ${LEVEL_NAMES[level]}.`);
  }

  function finishSession() {
    if (!session) return;
    const summary = session;
    if (summary.mode === 'placement') {
      finishPlacementSession(summary);
      return;
    }
    progress.totals.sessions += 1;
    saveState();
    session.completed = true;
    $('quizArea').classList.add('hidden');
    $('endSessionButton').classList.add('hidden');
    $('sessionComplete').classList.remove('hidden');
    $('placementApplyButton').classList.add('hidden');
    $('anotherSessionButton').classList.remove('hidden');
    const recycled = Math.max(0, summary.queue.length - summary.plannedCount);
    const composition = recycled
      ? `${summary.plannedCount} planned plus ${recycled} recycled review${recycled===1?'':'s'}`
      : `${summary.plannedCount} planned questions`;
    $('sessionSummary').textContent = `You answered ${summary.answered} questions (${composition}) with ${summary.correct} correct (${accuracy(summary.correct,summary.answered)}).`;
    setFocusedPracticeActive(false);
    $('sessionComplete').focus();
    session = null;
    clearSavedSession();
    renderHome();
    renderStats();
  }

  function endSession() {
    if (!session) return;
    const ok = confirm(session.mode === 'placement'
      ? 'End the placement check now? An incomplete placement result will not be saved.'
      : 'End this session now? Answers already completed will remain in your progress.');
    if (!ok) return;
    session = null;
    clearSavedSession();
    setFocusedPracticeActive(false);
    renderPracticeSetup();
    renderHome();
  }

  function renderWords() {
    const search = $('wordSearch')?.value?.trim().toLowerCase() || '';
    const status = $('statusFilter')?.value || 'all';
    const level = $('levelFilter')?.value || 'all';
    const source = $('sourceFilter')?.value || 'all';
    const availability = $('availabilityFilter')?.value || 'all';
    const items = allStudyWords().filter(item => {
      const state = getExistingWordState(item.word);
      const sourceMatch = source==='all' || (source==='personal' && item.custom) || (source==='starter' && !item.custom);
      const availabilityMatch = availability==='all' || (availability==='suspended' && state.suspended) || (availability==='active' && !state.suspended);
      return (!search || item.word.includes(search)) && sourceMatch && availabilityMatch && (status==='all' || statusOf(state)===status) && (level==='all' || String(item.level)===level);
    }).sort((a,b)=>a.word.localeCompare(b.word));
    $('wordListSummary').textContent = `${items.length} words shown. Activate a word to show its actions.`;
    const list = $('wordList'); list.innerHTML='';
    items.forEach(item => {
      const state = getExistingWordState(item.word);
      const li=document.createElement('li');
      const h=document.createElement('h3');
      const trigger=document.createElement('button');
      trigger.type='button'; trigger.className='word-trigger'; trigger.setAttribute('aria-expanded','false');
      const name=document.createElement('span'); name.className='word-name'; name.textContent=item.word;
      const brief=document.createElement('span'); brief.className='word-state'; brief.textContent=state.suspended ? 'Suspended' : statusOf(state);
      trigger.append(name,brief); h.appendChild(trigger);
      const p1=document.createElement('p');
      const sourceLabel = item.custom ? 'Personal word' : 'Starter word';
      const suspendedLabel = state.suspended ? '; Suspended from practice' : '';
      p1.textContent=`${sourceLabel}; Level ${item.level}: ${LEVEL_NAMES[item.level]} — ${statusOf(state)}${suspendedLabel}`;
      const p2=document.createElement('p');
      if (state.markedKnown && !state.seen) p2.textContent='Marked already known; no quiz answers recorded.';
      else p2.textContent=state.seen ? `${state.correct} correct, ${state.wrong} incorrect; accuracy ${accuracy(state.correct,state.correct+state.wrong)}${state.luckyGuesses ? `; ${state.luckyGuesses} lucky guess${state.luckyGuesses===1?'':'es'}` : ''}` : 'Not encountered yet.';

      const actions=document.createElement('div'); actions.className='word-actions hidden';
      const row=document.createElement('div'); row.className='action-row';
      const lookup=document.createElement('button'); lookup.type='button'; lookup.textContent='Look up'; lookup.addEventListener('click',()=>openLookupForWord(item.word));
      const practice=document.createElement('button'); practice.type='button'; practice.textContent='Practice now'; practice.addEventListener('click',()=>practiceWordNow(item.word,item.level));
      const known=document.createElement('button'); known.type='button'; known.textContent='Mark as already known'; known.addEventListener('click',()=>markWordKnown(item.word,item.level));
      const suspend=document.createElement('button'); suspend.type='button'; suspend.textContent=state.suspended?'Return to practice':'Suspend from practice'; suspend.addEventListener('click',()=>setWordSuspended(item.word,!state.suspended,item.level));
      row.append(lookup,practice,known,suspend); actions.appendChild(row);
      if (item.custom) {
        const label=document.createElement('label'); label.textContent='Personal word difficulty';
        const select=document.createElement('select');
        for (let n=1;n<=5;n++) {
          const option=document.createElement('option'); option.value=String(n); option.textContent=`Level ${n}: ${LEVEL_NAMES[n]}`; option.selected=n===item.level; select.appendChild(option);
        }
        select.addEventListener('change',()=>updatePersonalWordLevel(item.word,select.value));
        label.appendChild(select); actions.appendChild(label);
      }
      trigger.addEventListener('click',()=>{
        const open=actions.classList.contains('hidden');
        actions.classList.toggle('hidden',!open);
        trigger.setAttribute('aria-expanded',String(open));
        if(open) actions.querySelector('button,select')?.focus();
      });
      li.append(h,p1,p2,actions); list.appendChild(li);
    });
  }

  function renderStats() {
    const dl = $('overallStats'); dl.innerHTML='';
    const studyWords = allStudyWords();
    const seenCount = studyWords.filter(({word})=>getExistingWordState(word).seen>0).length;
    const mastered = studyWords.filter(({word})=>getExistingWordState(word).mastery===4).length;
    const personalCount = studyWords.filter(item=>item.custom).length;
    const suspendedCount = studyWords.filter(({word})=>getExistingWordState(word).suspended).length;
    const luckyGuessCount = studyWords.reduce((total,{word})=>total+(Number(getExistingWordState(word).luckyGuesses)||0),0);
    const placementText = progress.placement?.recommendedLevel
      ? `Level ${progress.placement.recommendedLevel}: ${LEVEL_NAMES[progress.placement.recommendedLevel]}`
      : 'Not completed';
    const stats = [
      ['Total answers', progress.totals.answers],
      ['Correct answers', progress.totals.correct],
      ['Overall accuracy', accuracy(progress.totals.correct,progress.totals.answers)],
      ['Completed sessions', progress.totals.sessions],
      ['Words encountered', `${seenCount} of ${studyWords.length}`],
      ['Words mastered', mastered],
      ['Personal words', personalCount],
      ['Suspended words', suspendedCount],
      ['Lucky guesses marked', luckyGuessCount],
      ['Placement recommendation', placementText],
      ['Current study streak', `${progress.streak?.current || 0} days`],
      ['Longest study streak', `${progress.streak?.longest || 0} days`]
    ];
    stats.forEach(([k,v])=>{const dt=document.createElement('dt');dt.textContent=k;const dd=document.createElement('dd');dd.textContent=v;dl.append(dt,dd);});
    const levelStats=$('levelStats'); levelStats.innerHTML='';
    for(let level=1;level<=5;level++){
      const words=studyWords.filter(x=>x.level===level);
      const seen=words.filter(({word})=>getExistingWordState(word).seen>0);
      const masteredN=words.filter(({word})=>getExistingWordState(word).mastery===4).length;
      const c=seen.reduce((n,{word})=>n+getExistingWordState(word).correct,0);
      const a=seen.reduce((n,{word})=>n+getExistingWordState(word).correct+getExistingWordState(word).wrong,0);
      const div=document.createElement('div');div.className='level-stat';
      const h=document.createElement('h4');h.textContent=`Level ${level}: ${LEVEL_NAMES[level]}`;
      const p=document.createElement('p');p.textContent=`Encountered ${seen.length} of ${words.length}; mastered ${masteredN}; accuracy ${accuracy(c,a)}.`;
      div.append(h,p);levelStats.appendChild(div);
    }
  }

  function renderSettings() {
    $('dictionaryKey').value = keys.dictionary || '';
    $('thesaurusKey').value = keys.thesaurus || '';
    $('showKeys').checked = false;
    $('focusedPractice').checked = Boolean(settings.focusedPractice);
    $('appearanceMode').value = settings.appearance || 'system';
    $('wordActivation').value = settings.wordActivation || 'options';
    $('dictionaryKey').type='password'; $('thesaurusKey').type='password';
    $('keyStatus').textContent = keys.dictionary && keys.thesaurus ? 'Two API keys are saved on this device.' : 'API keys have not both been saved yet.';
  }

  function saveKeysFromForm() {
    keys = {dictionary:$('dictionaryKey').value.trim(), thesaurus:$('thesaurusKey').value.trim()};
    saveKeys();
    transientDictionary.clear(); transientThesaurus.clear();
    $('keyStatus').textContent = keys.dictionary && keys.thesaurus ? 'Keys saved on this device.' : 'Please enter both keys.';
    renderHome();
  }

  async function testKeys() {
    saveKeysFromForm();
    if (!keys.dictionary || !keys.thesaurus) return;
    const button=$('testKeysButton');button.disabled=true;
    $('keyStatus').textContent='Testing both keys…';
    try {
      const [d,t]=await Promise.all([
        apiLookup('dictionary','voluminous',keys.dictionary),
        apiLookup('thesaurus','umpire',keys.thesaurus)
      ]);
      const dictOK=Array.isArray(d)&&d.some(x=>x&&typeof x==='object'&&x.shortdef?.length);
      const thesOK=Array.isArray(t)&&t.some(x=>x&&typeof x==='object');
      if(!dictOK||!thesOK) throw new Error('One key returned an unexpected result.');
      $('keyStatus').textContent='Success. Both Merriam-Webster keys returned usable results.';
    } catch(e) {
      $('keyStatus').textContent=`Test failed: ${e.message}`;
    } finally { button.disabled=false; }
  }

  function exportProgress() {
    const payload={version:1, exportedAt:new Date().toISOString(), progress, settings};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url;a.download=`vocabulary-progress-${localDateString()}.json`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  async function importProgress(file) {
    try {
      const text=await file.text(); const data=JSON.parse(text);
      if(!data || data.version!==1 || !data.progress) throw new Error('This is not a compatible backup.');
      progress={...defaultProgress(),...data.progress};
      settings={...settings,...(data.settings||{})};
      clearSavedSession();
      saveState();
      applyAppearance();
      renderHome();renderWords();renderStats();renderSettings();renderRecentLookups();
      showToast('Progress backup imported.');
    } catch(e) { showToast(`Import failed: ${e.message}`); }
  }

  function resetProgress() {
    if(!confirm('Reset all vocabulary progress and statistics? Your API keys and personal word list will be kept.')) return;
    const customWords = Array.isArray(progress.customWords) ? [...progress.customWords] : [];
    const recentLookups = Array.isArray(progress.recentLookups) ? [...progress.recentLookups] : [];
    progress=defaultProgress();
    progress.customWords = customWords;
    progress.recentLookups = recentLookups;
    clearSavedSession();
    saveState(); renderHome();renderWords();renderStats();
    showToast('Study progress reset. Personal words were kept.');
  }

  function configureEvents() {
    qsa('#mainMenu button[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $('menuButton').addEventListener('click',()=>{
      const open = $('menuButton').getAttribute('aria-expanded') !== 'true';
      setMenuOpen(open, open);
    });
    $('resumeSessionButton').addEventListener('click',resumeSavedSession);
    $('startPracticeButton').addEventListener('click',()=>{switchView('practice'); beginSession('normal');});
    $('homePlacementButton').addEventListener('click',()=>{switchView('practice'); beginSession('placement');});
    $('homePersonalButton').addEventListener('click',()=>{
      settings={...settings, source:'personal', levels:[1,2,3,4,5]};
      saveState();
      switchView('practice');
    });
    $('homeLookupButton').addEventListener('click',()=>switchView('lookup'));
    $('lookupForm').addEventListener('submit',e=>{e.preventDefault();lookupWord();});
    $('addLookupWordButton').addEventListener('click',addLookupWordToStudy);
    $('clearRecentLookupsButton').addEventListener('click',clearRecentLookups);
    $('reviewDueButton').addEventListener('click',()=>{switchView('practice'); beginSession('due');});
    $('reviewMissedButton').addEventListener('click',()=>{switchView('practice'); beginSession('difficult');});
    $('placementButton').addEventListener('click',()=>beginSession('placement'));
    $('beginSessionButton').addEventListener('click',()=>beginSession('normal'));
    $('endSessionButton').addEventListener('click',endSession);
    $('anotherSessionButton').addEventListener('click',()=>renderPracticeSetup());
    $('placementApplyButton').addEventListener('click',applyPlacementRecommendation);
    $('detailsButton').addEventListener('click',showDetails);
    $('luckyGuessButton').addEventListener('click',markLuckyGuess);
    $('wordSearch').addEventListener('input',renderWords);
    $('statusFilter').addEventListener('change',renderWords);
    $('levelFilter').addEventListener('change',renderWords);
    $('sourceFilter').addEventListener('change',renderWords);
    $('availabilityFilter').addEventListener('change',renderWords);
    $('appearanceMode').addEventListener('change',e=>{ settings={...settings,appearance:e.target.value}; saveState(); applyAppearance(); });
    $('wordActivation').addEventListener('change',e=>{ settings={...settings,wordActivation:e.target.value}; saveState(); });
    $('showKeys').addEventListener('change',e=>{
      const type=e.target.checked?'text':'password';$('dictionaryKey').type=type;$('thesaurusKey').type=type;
    });
    $('focusedPractice').addEventListener('change',e=>{ settings={...settings, focusedPractice:e.target.checked}; saveState(); showToast(e.target.checked ? 'Focused Practice mode enabled.' : 'Focused Practice mode disabled.'); });
    $('saveKeysButton').addEventListener('click',saveKeysFromForm);
    $('testKeysButton').addEventListener('click',testKeys);
    $('exportProgressButton').addEventListener('click',exportProgress);
    $('importProgressInput').addEventListener('change',e=>{const f=e.target.files?.[0];if(f) importProgress(f);e.target.value='';});
    $('resetProgressButton').addEventListener('click',resetProgress);

    window.addEventListener('beforeinstallprompt',e=>{
      e.preventDefault(); installPrompt=e; updateInstallUI();
    });
    window.addEventListener('appinstalled',()=>{ installPrompt=null; updateInstallUI(); showToast('Vocabulary Tracker installed.'); });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{ if ((settings.appearance || 'system') === 'system') applyAppearance(); });
    window.addEventListener('pagehide',()=>{ if(session) persistSession(); });
    $('installButton').addEventListener('click',async()=>{
      if(!installPrompt){ updateInstallUI(); return; }
      installPrompt.prompt(); await installPrompt.userChoice; installPrompt=null; updateInstallUI();
    });
  }

  function initServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'})
        .then(registration => registration.update())
        .catch(()=>{});
    }
  }

  function init() {
    applyAppearance();
    configureEvents();
    renderHome(); renderWords(); renderStats(); renderSettings(); renderPracticeSetup(); renderRecentLookups();
    initServiceWorker();
    updateInstallUI();
    if (!keys.dictionary || !keys.thesaurus) {
      $('setupNotice').textContent='Before your first practice session, open Settings and enter your two Merriam-Webster API keys.';
    }
    if (settings.lastVersion !== APP_VERSION) {
      $('versionNotice').textContent = 'Updated to v0.5: resumable sessions, dark mode, recent lookups, expandable word actions, suspend/mark-known controls, and lucky-guess review correction.';
      $('versionNotice').classList.remove('hidden');
      settings = {...settings, lastVersion:APP_VERSION};
      saveState();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
