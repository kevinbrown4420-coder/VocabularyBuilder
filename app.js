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

  const CURRICULUM_ROWS = Array.isArray(window.VOCAB_CURRICULUM_V06) ? window.VOCAB_CURRICULUM_V06 : [];
  const COLLECTIONS = Array.isArray(window.VOCAB_COLLECTIONS_V06) ? window.VOCAB_COLLECTIONS_V06 : [];
  const CURRICULUM = (CURRICULUM_ROWS.length ? CURRICULUM_ROWS : WORDS.map(({word,level}) => [word,level,'']))
    .map(([word,level,tags='']) => ({word:String(word).toLowerCase(), level:Number(level)||3, collections:String(tags||'').split(',').filter(Boolean), custom:false}));
  const CURRICULUM_MAP = new Map(CURRICULUM.map(item => [item.word,item]));
  const COLLECTION_MAP = new Map(COLLECTIONS.map(item => [item.id,item]));

  const APP_VERSION = '0.8';
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
  let settings = loadJson(SETTINGS_STORAGE, {sessionSize:10, direction:'word-def', levels:[1,2,3,4,5], source:'all', collection:'all', novelty:'balanced', focusedPractice:false, appearance:'system', wordActivation:'options', lastVersion:null});
  let session = null;
  let installPrompt = null;
  let currentLookup = null;
  let wordPage = 0;
  let historyLimit = 50;
  const transientDictionary = new Map();
  const transientThesaurus = new Map();
  const ANSWER_MAX_CHARS = 96;
  const ANSWER_MAX_WORDS = 16;
  let prefetchToken = 0;

  function defaultProgress() {
    return {
      words: {},
      customWords: [],
      placement: null,
      recentLookups: [],
      wordHistory: [],
      invalidSeeds: {},
      totals: {answers:0, correct:0, sessions:0},
      streak: {current:0, longest:0, lastStudyDate:null}
    };
  }

  function allStudyWords() {
    const base = [...CURRICULUM];
    const known = new Set(base.map(item => item.word));
    const custom = Array.isArray(progress.customWords) ? progress.customWords : [];
    for (const item of custom) {
      const word = String(item?.word || '').trim().toLowerCase();
      const level = Math.max(1, Math.min(5, Number(item?.level) || 3));
      if (word && !known.has(word)) {
        base.push({word, level, collections:[], custom:true, addedAt:item.addedAt || null});
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
    recordWordHistory(normalized, 'added');
    saveState();
    return true;
  }


  function studyWordItem(word) {
    const normalized = String(word || '').trim().toLowerCase();
    const curriculum = CURRICULUM_MAP.get(normalized);
    if (curriculum) return curriculum;
    const custom = Array.isArray(progress.customWords) ? progress.customWords.find(item => String(item.word||'').toLowerCase()===normalized) : null;
    return custom ? {word:normalized, level:Math.max(1,Math.min(5,Number(custom.level)||3)), collections:[], custom:true, addedAt:custom.addedAt||null} : null;
  }

  function collectionName(id) {
    return COLLECTION_MAP.get(id)?.name || id;
  }

  function wordMatchesCollection(item, collectionId) {
    return collectionId === 'all' || (Array.isArray(item.collections) && item.collections.includes(collectionId));
  }

  function populateCollectionControls() {
    for (const id of ['practiceCollection','collectionFilter']) {
      const select=$(id);
      if (!select) continue;
      const first=select.options[0]?.cloneNode(true);
      select.innerHTML='';
      if (first) select.appendChild(first);
      for (const collection of COLLECTIONS) {
        const option=document.createElement('option');
        option.value=collection.id; option.textContent=collection.name;
        select.appendChild(option);
      }
    }
  }

  function recordWordHistory(word, kind='practice') {
    const normalized=String(word||'').trim().toLowerCase();
    if (!normalized) return;
    const history=Array.isArray(progress.wordHistory) ? progress.wordHistory : [];
    const entry={word:normalized, at:Date.now(), kind};
    progress.wordHistory=[entry, ...history.filter(item=>item?.word!==normalized)].slice(0,500);
  }

  function recentPracticeWords(limit=30) {
    const history=Array.isArray(progress.wordHistory) ? progress.wordHistory : [];
    return new Set(history.filter(item=>item?.kind==='practice').slice(0,limit).map(item=>item.word));
  }

  function isUnusableDictionaryError(error) {
    const message=String(error?.message||'');
    return message.startsWith('No exact dictionary entry') || message.startsWith('No usable definition');
  }

  function markInvalidSeed(word) {
    const normalized=String(word||'').trim().toLowerCase();
    if (!CURRICULUM_MAP.has(normalized)) return;
    if (!progress.invalidSeeds || typeof progress.invalidSeeds!=='object') progress.invalidSeeds={};
    progress.invalidSeeds[normalized]=Date.now();
    saveState();
  }

  function isInvalidSeed(word) {
    return Boolean(progress.invalidSeeds && progress.invalidSeeds[String(word||'').toLowerCase()]);
  }

  function openLibraryWith({source='all',status='all',collection='all',availability='all'}={}) {
    switchView('words', false);
    $('sourceFilter').value=source;
    $('statusFilter').value=status;
    $('collectionFilter').value=collection;
    $('availabilityFilter').value=availability;
    $('wordSearch').value='';
    wordPage=0;
    renderWords();
    $('wordsHeading').focus?.();
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
    if (themeMeta) themeMeta.setAttribute('content', dark ? '#0d1117' : '#4b1f69');
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
      collection: session.collection || 'all',
      novelty: session.novelty || 'balanced',
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
    const view=$(`view-${name}`);
    if (!view) return;
    view.classList.remove('hidden');
    qsa('#mainMenu button[data-view]').forEach(b => b.setAttribute('aria-current', b.dataset.view===name ? 'page' : 'false'));
    setMenuOpen(false);
    if (name === 'home') renderHome();
    if (name === 'lookup') renderRecentLookups();
    if (name === 'words') renderWords();
    if (name === 'collections') renderCollections();
    if (name === 'history') renderHistory();
    if (name === 'stats') renderStats();
    if (name === 'settings') renderSettings();
    if (name === 'practice' && !session) renderPracticeSetup();
    if (name === 'practice' && session) setFocusedPracticeActive(true);
    else setFocusedPracticeActive(false);
    if (focus) $('main').focus();
  }

  function renderHome() {
    const studyItems = allStudyWords();
    const activeItems = studyItems.filter(({word}) => !getExistingWordState(word).suspended && !isInvalidSeed(word));
    const states = studyItems.map(({word}) => getExistingWordState(word));
    const seen = states.filter(s => s.seen>0);
    const mastered = states.filter(s => s.mastery===4).length;
    const learning = states.filter(s => s.mastery>0 && s.mastery<4).length;
    const due = activeItems.filter(({word}) => {
      const st = getExistingWordState(word);
      return st.nextDue && st.nextDue <= Date.now();
    }).length;
    const difficult = activeItems.filter(({word}) => {
      const st = getExistingWordState(word);
      return st.wrong>0 && (st.correct+st.wrong) && st.correct/(st.correct+st.wrong)<0.7;
    }).length;
    const personalCount = studyItems.filter(item => item.custom).length;
    const accuracyText=accuracy(progress.totals.correct, progress.totals.answers);
    const streak=progress.streak?.current || 0;

    $('homeMasteredStat').textContent=`Mastered: ${mastered}`;
    $('homeLearningStat').textContent=`In progress: ${learning}`;
    $('homeSeenStat').textContent=`Words encountered: ${seen.length}`;
    $('homePersonalStat').textContent=`Personal words: ${personalCount}`;
    $('homeAccuracyStat').textContent=`Accuracy: ${accuracyText}`;
    $('homeStreakStat').textContent=`Study streak: ${streak} day${streak===1?'':'s'}`;
    $('reviewDueButton').textContent=`Due reviews: ${due}`;
    $('reviewMissedButton').textContent=`Difficult words: ${difficult}`;

    const ready = Boolean(keys.dictionary && keys.thesaurus);
    $('setupNotice').textContent = ready
      ? `Reference keys are configured. The curriculum contains ${CURRICULUM.length.toLocaleString()} seed words plus your personal words.`
      : 'Before your first practice session, open Settings and enter your two Merriam-Webster API keys.';

    const resumable = hasResumableSession();
    $('resumeSessionButton').classList.toggle('hidden', !resumable);
    $('startPracticeButton').disabled = !ready || resumable;
    $('homeDiscoverButton').disabled = !ready || resumable;
    $('homePlacementButton').disabled = !keys.dictionary || resumable;
    $('homePersonalButton').disabled = !ready || personalCount===0 || resumable;
    $('reviewDueButton').disabled = !ready || due===0 || resumable;
    $('reviewMissedButton').disabled = !ready || difficult===0 || resumable;
    for (let level=1; level<=5; level++) {
      const levelItems=studyItems.filter(item=>item.level===level && !item.custom);
      const encountered=levelItems.filter(item=>getExistingWordState(item.word).seen>0).length;
      const masteredLevel=levelItems.filter(item=>getExistingWordState(item.word).mastery===4).length;
      const total=levelItems.length || 1;
      const text=`${encountered.toLocaleString()} of ${levelItems.length.toLocaleString()} encountered; ${masteredLevel.toLocaleString()} mastered`;
      const progressEl=$(`homeLevel${level}Progress`);
      const barEl=$(`homeLevel${level}Bar`);
      if (progressEl) progressEl.textContent=text;
      if (barEl) barEl.style.width=`${Math.min(100,Math.round(encountered/total*100))}%`;
    }
    qsa('[data-home-level]').forEach(button => { button.disabled = !ready || resumable; });

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
    $('practiceCollection').value = COLLECTION_MAP.has(settings.collection) ? settings.collection : 'all';
    $('newWordMix').value = ['low','balanced','high'].includes(settings.novelty) ? settings.novelty : 'balanced';
    qsa('input[name="level"]').forEach(cb => cb.checked = (settings.levels || [1,2,3,4,5]).includes(Number(cb.value)));
  }

  function buildSession(mode='normal') {
    if (mode === 'placement') {
      const selected = [];
      for (let level=1; level<=5; level++) selected.push(...shuffle(WORDS.filter(item => item.level===level)).slice(0,3));
      return {
        mode:'placement', queue:shuffle(selected).map(w => ({...w, custom:false, repeat:false})), index:0, answered:0, correct:0,
        current:null, completed:false, direction:'def-word', levels:[1,2,3,4,5], source:'starter', collection:'all', novelty:'balanced',
        plannedCount:selected.length,
        placementResults:{1:{answered:0,correct:0},2:{answered:0,correct:0},3:{answered:0,correct:0},4:{answered:0,correct:0},5:{answered:0,correct:0}}
      };
    }

    const levels = qsa('input[name="level"]:checked').map(cb => Number(cb.value));
    if (!levels.length) { showToast('Select at least one difficulty level.'); return null; }
    const size = Number($('sessionSize').value);
    const direction = $('questionDirection').value;
    const source = (mode==='normal' ? $('practiceSource').value : 'all') || 'all';
    const collection = mode==='normal' ? ($('practiceCollection').value || 'all') : 'all';
    const novelty = mode==='normal' ? ($('newWordMix').value || 'balanced') : 'balanced';
    settings = {...settings, sessionSize:size, direction, levels, source, collection, novelty};
    saveState();

    let pool = allStudyWords().filter(w => levels.includes(w.level) && !getExistingWordState(w.word).suspended && !isInvalidSeed(w.word));
    if (source === 'personal') pool = pool.filter(w => w.custom);
    if (source === 'starter') pool = pool.filter(w => !w.custom);
    if (collection !== 'all') pool = pool.filter(w => wordMatchesCollection(w, collection));

    const now = Date.now();
    const prioritizePersonal = items => [...shuffle(items.filter(x=>x.custom)), ...shuffle(items.filter(x=>!x.custom))];
    let selected=[];
    if (mode === 'due') {
      selected = prioritizePersonal(pool.filter(({word}) => {
        const st=getExistingWordState(word); return st.seen>0 && st.nextDue && st.nextDue<=now;
      })).slice(0,size);
    } else if (mode === 'difficult') {
      selected = prioritizePersonal(pool.filter(({word}) => {
        const st=getExistingWordState(word); return st.seen>0 && st.wrong>0 && st.correct/(st.correct+st.wrong)<0.7;
      })).slice(0,size);
    } else {
      const due = pool.filter(({word}) => { const st=getExistingWordState(word); return st.seen>0 && st.nextDue && st.nextDue<=now; });
      const difficult = pool.filter(({word}) => { const st=getExistingWordState(word); return st.seen>0 && st.wrong>0 && st.correct/(st.correct+st.wrong)<0.7; });
      const fresh = pool.filter(({word}) => getExistingWordState(word).seen===0);
      const recent = recentPracticeWords(80);
      const continuing = pool.filter(({word}) => { const st=getExistingWordState(word); return st.seen>0 && st.mastery<4 && !(st.nextDue && st.nextDue<=now) && !recent.has(word); });
      const mastered = pool.filter(({word}) => getExistingWordState(word).mastery===4 && !recent.has(word));

      const freshRatio={low:0.25,balanced:0.50,high:0.70}[novelty] ?? 0.50;
      let freshTarget=Math.min(fresh.length, Math.max(1,Math.round(size*freshRatio)));
      const reviewOrder=[]; const reviewSeen=new Set();
      for (const item of [...prioritizePersonal(due),...prioritizePersonal(difficult),...prioritizePersonal(continuing),...prioritizePersonal(mastered)]) {
        if (!reviewSeen.has(item.word)) { reviewSeen.add(item.word); reviewOrder.push(item); }
      }
      let reviewTarget=Math.min(reviewOrder.length, size-freshTarget);
      if (reviewTarget < size-freshTarget) freshTarget=Math.min(fresh.length,size-reviewTarget);
      const chosenFresh=prioritizePersonal(fresh).slice(0,freshTarget);
      const chosenReview=reviewOrder.slice(0,size-chosenFresh.length);
      selected=shuffle([...chosenReview,...chosenFresh]);
      if (selected.length<size) {
        const used=new Set(selected.map(x=>x.word));
        const filler=prioritizePersonal(pool.filter(x=>!used.has(x.word)));
        selected.push(...filler.slice(0,size-selected.length));
      }
    }

    const unique=[]; const seenWords=new Set();
    for (const item of selected) if (!seenWords.has(item.word)) { unique.push(item); seenWords.add(item.word); }
    selected=unique.slice(0,Math.min(size,unique.length));
    if (!selected.length) {
      const sourceMessage = source==='personal' ? 'No personal words match these filters.' :
        (mode==='due' ? 'No words are due in the selected levels.' : mode==='difficult' ? 'No difficult words match the selected levels.' : 'No matching words are available.');
      showToast(sourceMessage); return null;
    }
    return {mode, queue:selected.map(w=>({...w,repeat:false})), index:0, answered:0, correct:0, current:null, completed:false,
      direction, levels, source, collection, novelty, plannedCount:selected.length};
  }

  function chooseBroadFresh(items, count) {
    const weights = {1:0.15, 2:0.25, 3:0.30, 4:0.20, 5:0.10};
    const quotas={};
    const fractions=[];
    let allocated=0;
    for (let level=1; level<=5; level++) {
      const exact=count*weights[level];
      quotas[level]=Math.floor(exact);
      allocated+=quotas[level];
      fractions.push({level,fraction:exact-quotas[level]});
    }
    fractions.sort((a,b)=>b.fraction-a.fraction || a.level-b.level);
    for (let i=0; allocated<count && i<fractions.length; i++,allocated++) quotas[fractions[i].level]+=1;
    const selected=[];
    const used=new Set();
    for (let level=1; level<=5; level++) {
      for (const item of shuffle(items.filter(entry => entry.level===level)).slice(0,quotas[level])) {
        if (!used.has(item.word)) { used.add(item.word); selected.push(item); }
      }
    }
    if (selected.length < count) {
      for (const item of shuffle(items)) {
        if (selected.length >= count) break;
        if (!used.has(item.word)) { used.add(item.word); selected.push(item); }
      }
    }
    return shuffle(selected).slice(0,count);
  }

  function buildLevelSession(level) {
    const size=10;
    const recent=recentPracticeWords(100);
    const pool=allStudyWords().filter(item=>item.level===level && !getExistingWordState(item.word).suspended && !isInvalidSeed(item.word));
    const fresh=shuffle(pool.filter(item=>getExistingWordState(item.word).seen===0 && !recent.has(item.word)));
    const due=shuffle(pool.filter(item=>{ const st=getExistingWordState(item.word); return st.seen>0 && st.nextDue && st.nextDue<=Date.now(); }));
    const difficult=shuffle(pool.filter(item=>{ const st=getExistingWordState(item.word); return st.wrong>0 && st.correct/(st.correct+st.wrong)<0.7; }));
    const review=[]; const used=new Set();
    for (const item of [...due,...difficult,...shuffle(pool.filter(item=>getExistingWordState(item.word).seen>0 && !recent.has(item.word)))]) {
      if (!used.has(item.word)) { used.add(item.word); review.push(item); }
    }
    const selected=[...review.slice(0,3),...fresh.slice(0,7)];
    if (selected.length<size) {
      const chosen=new Set(selected.map(item=>item.word));
      selected.push(...shuffle(pool.filter(item=>!chosen.has(item.word))).slice(0,size-selected.length));
    }
    if (!selected.length) return null;
    return {mode:'level',queue:shuffle(selected.slice(0,size)).map(item=>({...item,repeat:false})),index:0,answered:0,correct:0,current:null,completed:false,
      direction:'word-def',levels:[level],source:'all',collection:'all',novelty:'high',plannedCount:Math.min(size,selected.length)};
  }

  async function beginLevelSession(level) {
    if (!keys.dictionary) { switchView('settings'); $('dictionaryKey').focus(); return; }
    if (!session && loadSavedSession()) {
      showToast('Resume or end your unfinished session before starting a new round.');
      switchView('home');
      return;
    }
    const built=buildLevelSession(Number(level));
    if (!built) { showToast('No words are available in this level.'); return; }
    switchView('practice',false);
    startBuiltSession(built);
  }

  function buildQuickSession(kind='quick') {
    const size=10;
    const now=Date.now();
    const recent=recentPracticeWords(100);
    const pool=allStudyWords().filter(item => !getExistingWordState(item.word).suspended && !isInvalidSeed(item.word));
    const fresh=pool.filter(item => getExistingWordState(item.word).seen===0);
    const due=pool.filter(item => { const st=getExistingWordState(item.word); return st.seen>0 && st.nextDue && st.nextDue<=now; });
    const difficult=pool.filter(item => { const st=getExistingWordState(item.word); return st.seen>0 && st.wrong>0 && st.correct/(st.correct+st.wrong)<0.7; });
    const continuing=pool.filter(item => { const st=getExistingWordState(item.word); return st.seen>0 && st.mastery<4 && !recent.has(item.word) && !(st.nextDue && st.nextDue<=now); });
    let selected=[];
    if (kind==='discover') {
      selected=chooseBroadFresh(fresh,size);
    } else {
      const review=[]; const reviewSeen=new Set();
      for (const item of [...shuffle(due), ...shuffle(difficult), ...shuffle(continuing)]) {
        if (!reviewSeen.has(item.word)) { reviewSeen.add(item.word); review.push(item); }
      }
      const reviewTarget=Math.min(3,review.length);
      const reviewPick=review.slice(0,reviewTarget);
      const freshPick=chooseBroadFresh(fresh,size-reviewPick.length);
      selected=shuffle([...reviewPick,...freshPick]);
      if (selected.length<size) {
        const used=new Set(selected.map(item=>item.word));
        selected.push(...shuffle(pool.filter(item=>!used.has(item.word) && !recent.has(item.word))).slice(0,size-selected.length));
      }
    }
    if (!selected.length) return null;
    return {
      mode:kind==='discover' ? 'discover' : 'quick',
      queue:selected.slice(0,size).map(item=>({...item,repeat:false})),
      index:0, answered:0, correct:0, current:null, completed:false,
      direction:'word-def', levels:[1,2,3,4,5], source:'all', collection:'all', novelty:kind==='discover'?'high':'balanced', plannedCount:Math.min(size,selected.length)
    };
  }

  async function beginQuickSession(kind='quick') {
    if (!keys.dictionary) { switchView('settings'); $('dictionaryKey').focus(); return; }
    if (!session && loadSavedSession()) {
      showToast('Resume or end your unfinished session before starting a new one.');
      switchView('home');
      return;
    }
    const built=buildQuickSession(kind);
    if (!built) {
      showToast(kind==='discover' ? 'No unseen curriculum words are currently available.' : 'No words are available for a quick round.');
      return;
    }
    switchView('practice',false);
    startBuiltSession(built);
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

  function normalizeWordForMatch(value) {
    return normalizeHeadword(value).toLowerCase().replace(/[^a-z0-9'-]/g,'').trim();
  }

  const DEFINITION_STOP_WORDS = new Set([
    'a','an','and','are','as','at','be','been','being','by','for','from','has','have','having','in','is','it','its','of','on','or','that','the','their','this','to','used','using','was','were','which','with','without','one','someone','something','such','especially','usually','often','also'
  ]);

  function definitionTokens(text) {
    return String(text || '').toLowerCase()
      .replace(/[^a-z0-9\s-]/g,' ')
      .split(/\s+/)
      .map(token => token.replace(/^-+|-+$/g,''))
      .filter(token => token.length > 2 && !DEFINITION_STOP_WORDS.has(token))
      .map(token => token.length > 5 && token.endsWith('ing') ? token.slice(0,-3) : token)
      .map(token => token.length > 4 && token.endsWith('ed') ? token.slice(0,-2) : token)
      .map(token => token.length > 4 && token.endsWith('s') ? token.slice(0,-1) : token);
  }

  function definitionSimilarity(a, b) {
    const left = new Set(definitionTokens(a));
    const right = new Set(definitionTokens(b));
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    for (const token of left) if (right.has(token)) overlap += 1;
    return overlap / Math.min(left.size, right.size);
  }

  function definitionWordCount(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function isConciseAnswerDefinition(text) {
    const value=String(text || '').trim();
    if (!value) return false;
    return value.length <= ANSWER_MAX_CHARS && definitionWordCount(value) <= ANSWER_MAX_WORDS;
  }

  function chooseStudyDefinition(shortdefs, word) {
    const normalizedWord = normalizeWordForMatch(word);
    const defs = [...new Set((shortdefs || []).map(value => String(value || '').trim()).filter(Boolean))];
    const useful = defs.filter(definition => {
      const tokens = definitionTokens(definition);
      const normalizedDefinition = normalizeWordForMatch(definition);
      return tokens.length >= 2 && normalizedDefinition !== normalizedWord;
    });
    const ordered=(useful.length ? useful : defs).sort((a,b)=>a.length-b.length);
    return ordered[0] || '';
  }

  function chooseAnswerDefinition(shortdefs, word) {
    const normalizedWord = normalizeWordForMatch(word);
    const defs=[...new Set((shortdefs || []).map(value => String(value || '').trim()).filter(Boolean))]
      .filter(definition => definitionTokens(definition).length >= 2 && normalizeWordForMatch(definition)!==normalizedWord)
      .filter(isConciseAnswerDefinition)
      .sort((a,b)=>a.length-b.length);
    return defs[0] || '';
  }

  function parseDictionaryData(word, data) {
    if (!Array.isArray(data)) throw new Error('Unexpected dictionary response.');
    if (data.length && typeof data[0] === 'string') throw new Error(`No exact dictionary entry for ${word}.`);
    const entries = data.filter(item => item && typeof item==='object' && Array.isArray(item.shortdef) && item.shortdef.length);
    if (!entries.length) throw new Error(`No usable definition for ${word}.`);
    const query = normalizeWordForMatch(word);
    const exact = entries.filter(entry => normalizeWordForMatch(entry.hwi?.hw) === query);
    const stemMatches = entries.filter(entry => Array.isArray(entry.meta?.stems) && entry.meta.stems.some(stem => normalizeWordForMatch(stem) === query));
    const entry = exact[0] || stemMatches[0] || entries[0];
    const shortdefs = [...new Set(entry.shortdef.map(value => String(value || '').trim()).filter(Boolean))].slice(0,3);
    const definition = chooseStudyDefinition(shortdefs, word);
    const answerDefinition = chooseAnswerDefinition(shortdefs, word);
    if (!definition) throw new Error(`No usable definition for ${word}.`);
    return {
      word:String(word || '').toLowerCase(),
      headword: normalizeHeadword(entry.hwi?.hw) || word,
      partOfSpeech: entry.fl || '',
      shortdefs,
      definition,
      answerDefinition,
      source: 'Merriam-Webster Collegiate Dictionary'
    };
  }

  async function apiLookupBatch(kind, words, apiKey) {
    const requested=[...new Set((words || []).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean))].slice(0,8);
    if (!requested.length) return [];
    try {
      const response = await fetch('/api/lookup', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        cache:'no-store',
        body:JSON.stringify({kind,words:requested,apiKey})
      });
      const data = await response.json().catch(() => ({error:'Unreadable response.'}));
      if (!response.ok || !Array.isArray(data.results)) throw new Error(data.error || 'Batch lookup unavailable.');
      return data.results;
    } catch {
      return Promise.all(requested.map(async word => {
        try { return {word,status:200,data:await apiLookup(kind,word,apiKey)}; }
        catch (error) { return {word,status:502,error:error.message || 'Lookup failed.'}; }
      }));
    }
  }

  async function getDictionary(word) {
    const cacheKey = String(word || '').toLowerCase();
    if (transientDictionary.has(cacheKey)) return transientDictionary.get(cacheKey);
    const data = await apiLookup('dictionary', word, keys.dictionary);
    const result=parseDictionaryData(word,data);
    transientDictionary.set(cacheKey,result);
    return result;
  }

  async function getDictionaryBatch(words) {
    const requested=[...new Set((words || []).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean))];
    const results=new Map();
    for (const word of requested) if (transientDictionary.has(word)) results.set(word,{entry:transientDictionary.get(word)});
    const missing=requested.filter(word=>!transientDictionary.has(word));
    for (let i=0;i<missing.length;i+=8) {
      const chunk=missing.slice(i,i+8);
      let rows;
      try { rows=await apiLookupBatch('dictionary',chunk,keys.dictionary); }
      catch (error) {
        for (const word of chunk) results.set(word,{error});
        continue;
      }
      const rowMap=new Map(rows.map(row=>[String(row.word||'').toLowerCase(),row]));
      for (const word of chunk) {
        const row=rowMap.get(word);
        if (!row || row.error || Number(row.status)>=400) {
          results.set(word,{error:new Error(row?.error || `Lookup failed (${row?.status || 'unknown'}).`)});
          continue;
        }
        try {
          const entry=parseDictionaryData(word,row.data);
          transientDictionary.set(word,entry);
          results.set(word,{entry});
        } catch (error) {
          results.set(word,{error});
        }
      }
    }
    return results;
  }

  async function prefetchSessionDictionary(fromIndex=0) {
    if (!session?.queue?.length || !keys.dictionary) return;
    const token=++prefetchToken;
    const words=[];
    for (const item of session.queue.slice(fromIndex)) {
      const word=String(item.word||'').toLowerCase();
      if (word && !transientDictionary.has(word) && !words.includes(word)) words.push(word);
      if (words.length>=8) break;
    }
    if (!words.length) return;
    try {
      const batch=await getDictionaryBatch(words);
      if (token!==prefetchToken) return;
      for (const [word,result] of batch) {
        if (result.error && isUnusableDictionaryError(result.error) && CURRICULUM_MAP.has(word)) markInvalidSeed(word);
      }
    } catch {}
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
    renderHome(); renderWords(); renderHistory(); renderStats();
    showToast(`${item.word} marked as already known.`);
  }

  function setWordSuspended(word, suspended, level=3) {
    const item = ensureStudyWord(word, level);
    if (!item) return;
    const state = wordState(item.word);
    state.suspended = Boolean(suspended);
    saveState();
    renderHome(); renderWords(); renderHistory(); renderStats();
    showToast(`${item.word} ${state.suspended ? 'suspended from practice' : 'returned to practice'}.`);
  }

  function updatePersonalWordLevel(word, level) {
    const normalized = String(word || '').trim().toLowerCase();
    const target = Array.isArray(progress.customWords) ? progress.customWords.find(item => String(item.word).toLowerCase()===normalized) : null;
    if (!target) return;
    target.level = Math.max(1, Math.min(5, Number(level) || 3));
    saveState();
    renderWords(); renderHistory(); renderStats();
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
    recordWordHistory(normalized, 'lookup');
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
      showToast(`${word} added to your vocabulary at Level ${level}.`);
      renderHome();
      renderWords();
      renderHistory();
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
      trigger.textContent = `${word}${studyWordExists(word) ? ' — in vocabulary' : ''}`;

      const actions = document.createElement('div');
      actions.className = 'related-word-actions hidden';
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.textContent = studyWordExists(word) ? 'Already in vocabulary' : 'Add to vocabulary';
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
    button.textContent = exists ? 'Already in vocabulary' : 'Add to vocabulary';
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

      const dictionary=parseDictionaryData(word,data);
      const storedWord=String(dictionary.headword || word).toLowerCase();
      dictionary.word=storedWord;
      transientDictionary.set(storedWord,dictionary);
      transientDictionary.set(word,dictionary);
      currentLookup=dictionary;
      rememberLookup(storedWord);

      $('lookupResultHeading').textContent = dictionary.headword || raw;
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
      const loading=document.createElement('p');
      loading.textContent=keys.thesaurus ? 'Loading synonyms and antonyms…' : 'Add your Thesaurus API key in Settings to see synonyms and antonyms.';
      thesaurusPanel.appendChild(loading);

      updateLookupAddControls();
      result.classList.remove('hidden');
      status.textContent = `Dictionary loaded for ${dictionary.headword || raw}.`;
      result.focus();
      $('lookupButton').disabled = false;

      if (keys.thesaurus) {
        void (async()=>{
          try {
            const thesaurus = await getThesaurus(storedWord);
            renderThesaurusWithAdd(thesaurusPanel, thesaurus, () => Number($('lookupLevel').value) || 3);
          } catch (error) {
            thesaurusPanel.innerHTML='';
            const p = document.createElement('p');
            p.textContent = `Thesaurus lookup was unavailable: ${error.message}`;
            thesaurusPanel.appendChild(p);
          }
        })();
      }
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
      showToast(`${currentLookup.headword || currentLookup.word} added to your vocabulary.`);
      renderHome();
      renderWords();
      renderStats();
    }
    updateLookupAddControls();
  }

  function sharedCollectionCount(a, b) {
    const left=new Set(Array.isArray(a?.collections) ? a.collections : []);
    return (Array.isArray(b?.collections) ? b.collections : []).filter(value => left.has(value)).length;
  }

  function candidateScore(targetItem, targetEntry, candidateItem, candidateEntry, similarity) {
    let score=0;
    if (targetEntry.partOfSpeech && candidateEntry.partOfSpeech && targetEntry.partOfSpeech===candidateEntry.partOfSpeech) score += 5;
    const levelDifference=Math.abs((targetItem.level||3)-(candidateItem.level||3));
    if (levelDifference===0) score += 3;
    else if (levelDifference===1) score += 2;
    if (sharedCollectionCount(targetItem,candidateItem)===0) score += 2;
    score += Math.max(0, 2 - similarity*4);
    return score;
  }

  async function makeQuestion(item) {
    const questionPool = session?.mode === 'placement'
      ? WORDS.map(word => ({...word, custom:false, collections:[]}))
      : allStudyWords().filter(word => (!getExistingWordState(word.word).suspended && !isInvalidSeed(word.word)) || word.word===item.word);

    const sessionWords=[];
    if (Array.isArray(session?.queue)) {
      for (const queued of shuffle(session.queue.filter(entry=>entry.word!==item.word))) {
        if (!sessionWords.some(existing=>existing.word===queued.word)) sessionWords.push(queued);
      }
    }
    const backupWords=shuffle(questionPool.filter(candidate=>candidate.word!==item.word && !sessionWords.some(existing=>existing.word===candidate.word)));
    const candidateItems=[...sessionWords,...backupWords].slice(0,7);
    const batchWords=[item.word,...candidateItems.map(candidate=>candidate.word)];
    const loaded=await getDictionaryBatch(batchWords);
    const targetResult=loaded.get(String(item.word).toLowerCase());
    if (!targetResult?.entry) throw targetResult?.error || new Error(`No usable definition for ${item.word}.`);
    const target=targetResult.entry;

    const candidates=[];
    const seenDefinitions=new Set([String(target.definition||'').toLowerCase().trim()]);
    for (const candidate of candidateItems) {
      const result=loaded.get(String(candidate.word).toLowerCase());
      if (!result?.entry) {
        if (result?.error && isUnusableDictionaryError(result.error) && CURRICULUM_MAP.has(candidate.word)) markInvalidSeed(candidate.word);
        continue;
      }
      const entry=result.entry;
      if (normalizeWordForMatch(entry.headword)===normalizeWordForMatch(target.headword)) continue;
      const normalizedDefinition=String(entry.definition||'').toLowerCase().trim();
      if (!normalizedDefinition || seenDefinitions.has(normalizedDefinition)) continue;
      const similarity=definitionSimilarity(target.definition,entry.definition);
      if (similarity>0.32) continue;
      if (sharedCollectionCount(item,candidate)>=2 && similarity>0.12) continue;
      seenDefinitions.add(normalizedDefinition);
      candidates.push({item:candidate,entry,similarity,score:candidateScore(item,target,candidate,entry,similarity)});
    }
    candidates.sort((a,b)=>b.score-a.score);

    let direction=session.direction;
    if (direction==='mixed') direction=Math.random()<0.7 ? 'word-def' : 'def-word';
    if (direction==='word-def' && !target.answerDefinition) direction='def-word';

    let chosen=[];
    if (direction==='word-def') chosen=candidates.filter(candidate=>candidate.entry.answerDefinition).slice(0,3);
    else chosen=candidates.slice(0,3);
    if (chosen.length<3) {
      if (direction==='word-def') {
        direction='def-word';
        chosen=candidates.slice(0,3);
      }
      if (chosen.length<3) throw new Error('Not enough clear answer choices were available for this question.');
    }

    const rawOptions = direction === 'word-def'
      ? [{value:target.answerDefinition, correct:true, word:item.word, source:target.source}, ...chosen.map(({item:candidate,entry})=>({value:entry.answerDefinition,correct:false,word:candidate.word,source:entry.source}))]
      : [{value:item.word, correct:true, word:item.word}, ...chosen.map(({item:candidate})=>({value:candidate.word,correct:false,word:candidate.word}))];
    const options=shuffle(rawOptions).map((option,index)=>({...option,letter:'ABCD'[index]}));
    return {item,target,distractors:chosen.map(value=>value.entry),direction,options,screened:true};
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
      recordWordHistory(item.word, 'practice');
      saveState();
      renderQuestion(session.current);
    } catch (error) {
      if (session?.mode!=='placement' && isUnusableDictionaryError(error) && CURRICULUM_MAP.has(item.word)) {
        markInvalidSeed(item.word);
        session.queue.splice(session.index,1);
        session.plannedCount=Math.max(0,session.plannedCount-1);
        persistSession();
        showToast(`${item.word} was skipped because no usable Merriam-Webster entry was available.`);
        await presentQuestion();
        return;
      }
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
      requestAnimationFrame(() => $('feedbackHeading').focus());
    }
  }

  function renderQuestion(q) {
    $('loadingQuestion').classList.add('hidden');
    $('questionCard').classList.remove('hidden');
    const feedback=$('feedbackPanel');
    feedback.className='feedback hidden';
    $('feedbackHeading').textContent='';
    $('feedbackText').textContent='';
    $('wordFacts').innerHTML='';
    $('officialDefinitions').classList.add('hidden');
    $('officialDefinitionList').innerHTML='';
    const prompt = q.direction==='word-def' ? q.item.word : q.target.definition;
    $('questionType').textContent = q.direction==='word-def' ? 'Choose the official definition' : 'Choose the word';
    $('questionContext').textContent = q.target.partOfSpeech ? `Part of speech: ${q.target.partOfSpeech}` : '';
    $('questionPrompt').textContent = prompt;
    const choices = $('answerChoices');
    choices.innerHTML = '';
    q.options.forEach(option => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'answer-button';
      b.dataset.correct = String(option.correct);
      b.dataset.value = option.value;
      const baseText=`${option.letter}. ${option.value}`;
      b.dataset.baseText=baseText;
      b.textContent = baseText;
      b.setAttribute('aria-label', baseText);
      b.addEventListener('click', () => answerQuestion(option, b));
      choices.appendChild(b);
    });
    $('questionPrompt').focus();
    void prefetchSessionDictionary((session?.index || 0) + 1);
  }

  function renderOfficialDefinitions(target) {
    const section=$('officialDefinitions');
    const list=$('officialDefinitionList');
    list.innerHTML='';
    const primary=String(target.answerDefinition || target.definition || '').trim();
    const definitions=[...new Set((target.shortdefs||[]).map(value=>String(value||'').trim()).filter(Boolean))]
      .filter(definition=>definition!==primary)
      .slice(0,2);
    for (const definition of definitions) {
      const li=document.createElement('li');
      li.textContent=definition;
      list.appendChild(li);
    }
    section.classList.toggle('hidden',definitions.length===0);
    if ('open' in section) section.open=false;
  }

  function answerQuestion(option, button) {
    if (!session?.current || session.current.answered) return;
    session.current.answered = true;
    const q = session.current;
    const isCorrect = option.correct === true;
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

    qsa('.answer-button').forEach(answerButton => {
      answerButton.disabled = true;
      const correct = answerButton.dataset.correct === 'true';
      const selected = answerButton === button;
      const labels=[];
      if (correct) labels.push('correct answer');
      if (selected) labels.push('your answer');
      if (selected && !correct) labels.push('not correct');
      answerButton.textContent = `${answerButton.dataset.baseText}${labels.length ? ` — ${labels.join(', ')}` : ''}`;
      answerButton.setAttribute('aria-label', `${answerButton.dataset.baseText}${labels.length ? `. ${labels.join('. ')}.` : ''}`);
      if (correct) answerButton.classList.add('correct-answer');
      if (selected && !correct) answerButton.classList.add('wrong-answer');
    });

    if (!isCorrect && !isPlacement) {
      const repeatExists = session.queue.slice(session.index+1).some(entry => entry.word===q.item.word && entry.repeat);
      if (!repeatExists) {
        const insertAt = Math.min(session.queue.length, session.index + 5);
        session.queue.splice(insertAt, 0, {...q.item, repeat:true});
        showToast(`${q.item.word} will return later for review.`);
      }
    }

    const state = getExistingWordState(q.item.word);
    const panel = $('feedbackPanel');
    const primaryDefinition=q.target.answerDefinition || q.target.definition;
    panel.className = `feedback hidden ${isCorrect ? 'correct' : 'wrong'}`;
    $('feedbackHeading').textContent = isCorrect ? 'Correct' : 'Not quite';
    if (isPlacement) {
      $('feedbackText').textContent = isCorrect
        ? `${q.item.word}: ${primaryDefinition}`
        : `Correct answer: ${q.direction==='word-def' ? primaryDefinition : q.item.word}.`;
    } else {
      $('feedbackText').textContent = isCorrect
        ? `${q.item.word}: ${primaryDefinition}`
        : `Correct answer: ${q.direction==='word-def' ? primaryDefinition : q.item.word}. This word will return later.`;
    }
    $('wordFacts').innerHTML = '';
    if (q.target.partOfSpeech) addFact('Part of speech', q.target.partOfSpeech);
    addFact('Source', "Merriam-Webster Collegiate Dictionary");
    renderOfficialDefinitions(q.target);
    if (isPlacement) {
      addFact('Placement', 'Does not change study progress');
      $('detailsButton').classList.add('hidden');
    } else {
      addFact('Mastery', statusOf(state));
      $('detailsButton').classList.remove('hidden');
      $('luckyGuessButton').classList.toggle('hidden', !isCorrect);
      $('detailsButton').textContent = 'Synonyms and antonyms';
      $('detailsButton').disabled = false;
    }
    $('nextQuestionButton').textContent = 'Next word';
    $('nextQuestionButton').onclick = nextQuestion;
    updateQuestionCounter();
    session.resumeIndex = session.index + 1;
    persistSession();
    $('questionCard').classList.add('hidden');
    panel.classList.remove('hidden');
    requestAnimationFrame(() => $('feedbackHeading').focus());
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
    settings = {...settings, levels:[level], source:'all', collection:'all', novelty:'balanced'};
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


  function createWordListItem(item, extraText='') {
    const state = getExistingWordState(item.word);
    const li=document.createElement('li');
    const h=document.createElement('h3');
    const trigger=document.createElement('button');
    trigger.type='button'; trigger.className='word-trigger'; trigger.setAttribute('aria-expanded','false');
    const name=document.createElement('span'); name.className='word-name'; name.textContent=item.word;
    const brief=document.createElement('span'); brief.className='word-state'; brief.textContent=state.suspended ? 'Suspended' : statusOf(state);
    trigger.append(name,brief); h.appendChild(trigger);
    const p1=document.createElement('p');
    const sourceLabel = item.custom ? 'Personal word' : 'Curriculum word';
    const suspendedLabel = state.suspended ? '; Suspended from practice' : '';
    p1.textContent=`${sourceLabel}; Level ${item.level}: ${LEVEL_NAMES[item.level]} — ${statusOf(state)}${suspendedLabel}`;
    const p2=document.createElement('p');
    if (state.markedKnown && !state.seen) p2.textContent='Marked already known; no quiz answers recorded.';
    else p2.textContent=state.seen ? `${state.correct} correct, ${state.wrong} incorrect; accuracy ${accuracy(state.correct,state.correct+state.wrong)}${state.luckyGuesses ? `; ${state.luckyGuesses} lucky guess${state.luckyGuesses===1?'':'es'}` : ''}` : 'Not encountered yet.';
    const p3=extraText ? document.createElement('p') : null;
    if (p3) { p3.className='help-text'; p3.textContent=extraText; }

    const actions=document.createElement('div'); actions.className='word-actions hidden';
    const row=document.createElement('div'); row.className='action-row';
    const lookup=document.createElement('button'); lookup.type='button'; lookup.textContent='Look up'; lookup.addEventListener('click',()=>openLookupForWord(item.word));
    const practice=document.createElement('button'); practice.type='button'; practice.textContent='Practice now'; practice.addEventListener('click',()=>practiceWordNow(item.word,item.level));
    const known=document.createElement('button'); known.type='button'; known.textContent='Mark as already known'; known.addEventListener('click',()=>markWordKnown(item.word,item.level));
    const suspend=document.createElement('button'); suspend.type='button'; suspend.textContent=state.suspended?'Return to practice':'Suspend from practice'; suspend.addEventListener('click',()=>setWordSuspended(item.word,!state.suspended,item.level));
    row.append(lookup,practice,known,suspend); actions.appendChild(row);
    if (item.collections?.length) {
      const cp=document.createElement('p'); cp.className='help-text';
      cp.textContent=`Collections: ${item.collections.filter(id=>id!=='practical-core').slice(0,3).map(collectionName).join(', ') || collectionName('practical-core')}.`;
      actions.appendChild(cp);
    }
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
      const open=actions.classList.contains('hidden'); actions.classList.toggle('hidden',!open);
      trigger.setAttribute('aria-expanded',String(open)); if(open) actions.querySelector('button,select')?.focus();
    });
    li.append(h,p1,p2); if(p3) li.appendChild(p3); li.appendChild(actions);
    return li;
  }

  function renderCollections() {
    const container=$('collectionList'); if(!container) return;
    container.innerHTML='';
    for (const collection of COLLECTIONS) {
      const items=CURRICULUM.filter(item=>wordMatchesCollection(item,collection.id));
      if (!items.length) continue;
      const section=document.createElement('section'); section.className='collection-card';
      const h=document.createElement('h3'); h.textContent=collection.name;
      const p=document.createElement('p'); p.textContent=collection.description;
      const count=document.createElement('p'); count.textContent=`${items.length.toLocaleString()} curriculum words.`;
      const row=document.createElement('div'); row.className='action-row';
      const practice=document.createElement('button'); practice.type='button'; practice.textContent=`Practice ${collection.name}`;
      practice.addEventListener('click',()=>{
        settings={...settings,source:'starter',collection:collection.id,levels:[1,2,3,4,5]}; saveState(); switchView('practice');
      });
      const browse=document.createElement('button'); browse.type='button'; browse.textContent=`Browse ${collection.name}`;
      browse.addEventListener('click',()=>openLibraryWith({source:'starter',collection:collection.id}));
      row.append(practice,browse); section.append(h,p,count,row); container.appendChild(section);
    }
  }

  function renderHistory() {
    const history=Array.isArray(progress.wordHistory) ? progress.wordHistory : [];
    const shown=history.slice(0,historyLimit);
    $('historySummary').textContent=history.length ? `Showing ${shown.length} of ${history.length} recent words.` : 'No word history yet. Practice or look up a word and it will appear here.';
    const list=$('historyList'); list.innerHTML='';
    for (const entry of shown) {
      const item=studyWordItem(entry.word) || {word:entry.word,level:3,collections:[],custom:false};
      const when=entry.at ? new Date(entry.at).toLocaleString() : 'Earlier';
      const kind={practice:'Practiced',lookup:'Looked up',added:'Added'}[entry.kind] || 'Encountered';
      list.appendChild(createWordListItem(item,`${kind}: ${when}`));
    }
    $('historyMoreButton').classList.toggle('hidden',shown.length>=history.length);
  }

  function renderWords() {
    const search = $('wordSearch')?.value?.trim().toLowerCase() || '';
    const status = $('statusFilter')?.value || 'all';
    const level = $('levelFilter')?.value || 'all';
    const source = $('sourceFilter')?.value || 'all';
    const availability = $('availabilityFilter')?.value || 'all';
    const collection = $('collectionFilter')?.value || 'all';
    const items = allStudyWords().filter(item => {
      const state = getExistingWordState(item.word);
      const sourceMatch = source==='all' || (source==='personal' && item.custom) || (source==='starter' && !item.custom);
      const availabilityMatch = availability==='all' || (availability==='suspended' && state.suspended) || (availability==='active' && !state.suspended);
      return (!search || item.word.includes(search)) && sourceMatch && availabilityMatch && wordMatchesCollection(item,collection)
        && (status==='all' || (status==='in-progress' && state.mastery>0 && state.mastery<4) || statusOf(state)===status) && (level==='all' || String(item.level)===level);
    }).sort((a,b)=>a.word.localeCompare(b.word));
    const pageSize=50; const pages=Math.max(1,Math.ceil(items.length/pageSize));
    wordPage=Math.max(0,Math.min(wordPage,pages-1));
    const start=wordPage*pageSize; const shown=items.slice(start,start+pageSize);
    $('wordListSummary').textContent = items.length
      ? `${items.length.toLocaleString()} words match. Showing ${start+1} through ${start+shown.length}. Activate a word to show its actions.`
      : 'No words match these filters.';
    const list = $('wordList'); list.innerHTML='';
    shown.forEach(item=>list.appendChild(createWordListItem(item)));
    $('wordPrevButton').disabled=wordPage===0;
    $('wordNextButton').disabled=wordPage>=pages-1 || !items.length;
    $('wordPageStatus').textContent=items.length ? `Page ${wordPage+1} of ${pages}` : 'No pages';
  }

  function renderStats() {
    const dl = $('overallStats'); dl.innerHTML='';
    const studyWords = allStudyWords();
    const seenCount = studyWords.filter(({word})=>getExistingWordState(word).seen>0).length;
    const mastered = studyWords.filter(({word})=>getExistingWordState(word).mastery===4).length;
    const personalCount = studyWords.filter(item=>item.custom).length;
    const suspendedCount = studyWords.filter(({word})=>getExistingWordState(word).suspended).length;
    const luckyGuessCount = studyWords.reduce((total,{word})=>total+(Number(getExistingWordState(word).luckyGuesses)||0),0);
    const historyCount=Array.isArray(progress.wordHistory)?progress.wordHistory.length:0;
    const placementText = progress.placement?.recommendedLevel ? `Level ${progress.placement.recommendedLevel}: ${LEVEL_NAMES[progress.placement.recommendedLevel]}` : 'Not completed';
    const stats = [
      ['Curriculum size', CURRICULUM.length.toLocaleString()], ['Personal words', personalCount], ['Total answers', progress.totals.answers],
      ['Correct answers', progress.totals.correct], ['Overall accuracy', accuracy(progress.totals.correct,progress.totals.answers)],
      ['Completed sessions', progress.totals.sessions], ['Words encountered', `${seenCount} of ${studyWords.length}`], ['Words mastered', mastered],
      ['Recent word history', `${historyCount} words`], ['Suspended words', suspendedCount], ['Lucky guesses marked', luckyGuessCount],
      ['Placement recommendation', placementText], ['Current study streak', `${progress.streak?.current || 0} days`], ['Longest study streak', `${progress.streak?.longest || 0} days`]
    ];
    stats.forEach(([k,v])=>{const dt=document.createElement('dt');dt.textContent=k;const dd=document.createElement('dd');dd.textContent=v;dl.append(dt,dd);});
    const levelStats=$('levelStats'); levelStats.innerHTML='';
    for(let level=1;level<=5;level++){
      const words=studyWords.filter(x=>x.level===level); const seen=words.filter(({word})=>getExistingWordState(word).seen>0);
      const masteredN=words.filter(({word})=>getExistingWordState(word).mastery===4).length;
      const c=seen.reduce((n,{word})=>n+getExistingWordState(word).correct,0); const a=seen.reduce((n,{word})=>n+getExistingWordState(word).correct+getExistingWordState(word).wrong,0);
      const div=document.createElement('div');div.className='level-stat'; const h=document.createElement('h4');h.textContent=`Level ${level}: ${LEVEL_NAMES[level]}`;
      const pp=document.createElement('p');pp.textContent=`Encountered ${seen.length} of ${words.length}; mastered ${masteredN}; accuracy ${accuracy(c,a)}.`; div.append(h,pp);levelStats.appendChild(div);
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
      renderHome();renderWords();renderCollections();renderHistory();renderStats();renderSettings();renderRecentLookups();
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
    saveState(); renderHome();renderWords();renderHistory();renderStats();
    showToast('Study progress reset. Personal words were kept.');
  }

  function configureEvents() {
    qsa('#mainMenu button[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $('menuButton').addEventListener('click',()=>{ const open=$('menuButton').getAttribute('aria-expanded')!=='true'; setMenuOpen(open,open); });
    $('resumeSessionButton').addEventListener('click',resumeSavedSession);
    $('startPracticeButton').addEventListener('click',()=>beginQuickSession('quick'));
    $('homeDiscoverButton').addEventListener('click',()=>beginQuickSession('discover'));
    qsa('[data-home-level]').forEach(button=>button.addEventListener('click',()=>beginLevelSession(Number(button.dataset.homeLevel))));
    $('homeCustomButton').addEventListener('click',()=>{ switchView('practice'); renderPracticeSetup(); });
    $('homePlacementButton').addEventListener('click',()=>{switchView('practice'); beginSession('placement');});
    $('homePersonalButton').addEventListener('click',()=>{ settings={...settings,source:'personal',collection:'all',levels:[1,2,3,4,5]}; saveState(); switchView('practice'); });
    $('homeLookupButton').addEventListener('click',()=>switchView('lookup'));
    $('homeCollectionsButton').addEventListener('click',()=>switchView('collections'));
    $('homeHistoryButton').addEventListener('click',()=>switchView('history'));
    $('homeLibraryButton').addEventListener('click',()=>switchView('words'));
    $('homeMasteredStat').addEventListener('click',()=>openLibraryWith({status:'Mastered'}));
    $('homeLearningStat').addEventListener('click',()=>openLibraryWith({status:'in-progress'}));
    $('homeSeenStat').addEventListener('click',()=>switchView('history'));
    $('homePersonalStat').addEventListener('click',()=>openLibraryWith({source:'personal'}));
    $('homeAccuracyStat').addEventListener('click',()=>switchView('stats'));
    $('homeStreakStat').addEventListener('click',()=>switchView('stats'));
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
    const resetLibraryPage=()=>{wordPage=0;renderWords();};
    $('wordSearch').addEventListener('input',resetLibraryPage);
    $('statusFilter').addEventListener('change',resetLibraryPage);
    $('levelFilter').addEventListener('change',resetLibraryPage);
    $('sourceFilter').addEventListener('change',resetLibraryPage);
    $('availabilityFilter').addEventListener('change',resetLibraryPage);
    $('collectionFilter').addEventListener('change',resetLibraryPage);
    $('wordPrevButton').addEventListener('click',()=>{wordPage=Math.max(0,wordPage-1);renderWords();$('wordListSummary').focus?.();});
    $('wordNextButton').addEventListener('click',()=>{wordPage+=1;renderWords();$('wordListSummary').focus?.();});
    $('historyMoreButton').addEventListener('click',()=>{historyLimit+=50;renderHistory();});
    $('appearanceMode').addEventListener('change',e=>{ settings={...settings,appearance:e.target.value}; saveState(); applyAppearance(); });
    $('wordActivation').addEventListener('change',e=>{ settings={...settings,wordActivation:e.target.value}; saveState(); });
    $('showKeys').addEventListener('change',e=>{ const type=e.target.checked?'text':'password';$('dictionaryKey').type=type;$('thesaurusKey').type=type; });
    $('focusedPractice').addEventListener('change',e=>{ settings={...settings, focusedPractice:e.target.checked}; saveState(); showToast(e.target.checked ? 'Focused Practice mode enabled.' : 'Focused Practice mode disabled.'); });
    $('saveKeysButton').addEventListener('click',saveKeysFromForm);
    $('testKeysButton').addEventListener('click',testKeys);
    $('exportProgressButton').addEventListener('click',exportProgress);
    $('importProgressInput').addEventListener('change',e=>{const f=e.target.files?.[0];if(f) importProgress(f);e.target.value='';});
    $('resetProgressButton').addEventListener('click',resetProgress);
    window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); installPrompt=e; updateInstallUI(); });
    window.addEventListener('appinstalled',()=>{ installPrompt=null; updateInstallUI(); showToast('Vocabulary Tracker installed.'); });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{ if ((settings.appearance || 'system') === 'system') applyAppearance(); });
    window.addEventListener('pagehide',()=>{ if(session) persistSession(); });
    $('installButton').addEventListener('click',async()=>{ if(!installPrompt){updateInstallUI();return;} installPrompt.prompt(); await installPrompt.userChoice; installPrompt=null; updateInstallUI(); });
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
    populateCollectionControls();
    configureEvents();
    renderHome(); renderWords(); renderCollections(); renderHistory(); renderStats(); renderSettings(); renderPracticeSetup(); renderRecentLookups();
    initServiceWorker();
    updateInstallUI();
    if (!keys.dictionary || !keys.thesaurus) $('setupNotice').textContent='Before your first practice session, open Settings and enter your two Merriam-Webster API keys.';
    if (settings.lastVersion !== APP_VERSION) {
      $('versionNotice').textContent = `Updated to v0.8: faster batched rounds, concise answer meanings, a Vocabulary Builder-style study layout, quieter TalkBack results, and broader new-word rotation across the 5,000-word curriculum.`;
      $('versionNotice').classList.remove('hidden');
      settings = {...settings, lastVersion:APP_VERSION};
      saveState();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
