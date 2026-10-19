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
  const REVIEWED_CONTENT = window.VOCAB_REVIEWED_CONTENT_V17 || Object.create(null);
  const COLLECTION_MAP = new Map(COLLECTIONS.map(item => [item.id,item]));

  const APP_VERSION = '2.0-alpha';
  const LEVEL_NAMES = {1:'Core',2:'Intermediate',3:'Advanced',4:'Expert',5:'Challenge'};
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
  let settings = loadJson(SETTINGS_STORAGE, {sessionSize:10, direction:'word-def', levels:[1,2,3,4,5], source:'all', collection:'all', novelty:'balanced', appearance:'system', answerSounds:false, lastVersion:null});
  let session = null;
  let installPrompt = null;
  let currentWordDetail = null;
  let pronunciationAudio = null;
  let toneContext = null;
  let wordPage = 0;
  let historyLimit = 25;
  const transientDictionary = new Map();
  const transientThesaurus = new Map();
  const ANSWER_MAX_CHARS = 96;
  const ANSWER_MAX_WORDS = 16;
  let prefetchToken = 0;
  let currentView = 'home';
  let practicePhase = 'setup';
  let lastCompletedRound = null;
  let suppressDisclosureHistory = false;
  let pendingUpdateReload = false;
  let updateReloading = false;
  const VIEW_TITLES = {
    home:'Vocabulary Builder', practice:'Practice', lookup:'Find a word', word:'Word details', words:'Browse all words',
    collections:'Browse topic groups', history:'Recent words', stats:'Your progress', settings:'App settings', about:'About this app'
  };

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
    // Preserve words the user saved in earlier curriculum versions even if the
    // curated v1.3 bank no longer includes them.
    for (const [word,state] of Object.entries(progress.words || {})) {
      const normalized=String(word || '').trim().toLowerCase();
      if (normalized && state?.saved && !known.has(normalized)) {
        base.push({word:normalized, level:3, collections:[], custom:true, legacySaved:true});
        known.add(normalized);
      }
    }
    return base;
  }

  function studyWordExists(word) {
    const normalized = String(word || '').trim().toLowerCase();
    return allStudyWords().some(item => item.word === normalized);
  }

  function isSavedWord(word) {
    const normalized=String(word || '').trim().toLowerCase();
    if (!normalized) return false;
    const item=studyWordItem(normalized);
    return Boolean(item?.custom || getExistingWordState(normalized).saved);
  }

  function addCustomStudyWord(word, level=3) {
    const normalized = String(word || '').trim().toLowerCase();
    if (!normalized) return false;
    const existing=studyWordItem(normalized);
    if (existing) {
      const state=wordState(normalized);
      const already=isSavedWord(normalized);
      state.saved=true;
      if (!already) recordWordHistory(normalized, 'saved');
      saveState();
      return !already;
    }
    if (!Array.isArray(progress.customWords)) progress.customWords = [];
    progress.customWords.push({
      word: normalized,
      level: Math.max(1, Math.min(5, Number(level) || 3)),
      addedAt: Date.now()
    });
    const state=wordState(normalized);
    state.saved=true;
    recordWordHistory(normalized, 'saved');
    saveState();
    return true;
  }


  function studyWordItem(word) {
    const normalized = String(word || '').trim().toLowerCase();
    const curriculum = CURRICULUM_MAP.get(normalized);
    if (curriculum) return curriculum;
    const custom = Array.isArray(progress.customWords) ? progress.customWords.find(item => String(item.word||'').toLowerCase()===normalized) : null;
    if (custom) return {word:normalized, level:Math.max(1,Math.min(5,Number(custom.level)||3)), collections:[], custom:true, addedAt:custom.addedAt||null};
    if (progress.words?.[normalized]?.saved) return {word:normalized, level:3, collections:[], custom:true, legacySaved:true};
    return null;
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
    return message.startsWith('No exact dictionary entry') || message.startsWith('No usable definition') || message.startsWith('No useful quiz definition');
  }

  function markInvalidSeed(word) {
    const normalized=String(word||'').trim().toLowerCase();
    if (!CURRICULUM_MAP.has(normalized)) return;
    if (!progress.invalidSeeds || typeof progress.invalidSeeds!=='object') progress.invalidSeeds={};
    progress.invalidSeeds[normalized]=Date.now();
    saveState();
  }

  function isInvalidSeed(word) {
    // v1.7 marked some perfectly good curriculum words invalid when external
    // dictionary requests failed. Offline teaching content supersedes that state.
    const normalized=String(word||'').toLowerCase();
    if (REVIEWED_CONTENT[normalized]) return false;
    return Boolean(progress.invalidSeeds && progress.invalidSeeds[normalized]);
  }

  function canPracticeWord(item) {
    const word=String(item?.word || '').toLowerCase();
    // The curated bank requires neither internet nor a dictionary account.
    if (REVIEWED_CONTENT[word]) return true;
    // Custom/legacy words remain optional online additions for now.
    return Boolean(keys.dictionary && navigator.onLine !== false);
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
    const show = Boolean(installPrompt) && !isStandalone() && currentView==='home' && !(practicePhase==='round' && session);
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
      missedWords: Array.isArray(session.missedWords) ? [...new Set(session.missedWords)] : [],
      recentOptionWords: Array.isArray(session.recentOptionWords) ? session.recentOptionWords.slice(-48) : [],
      recentOptionDefinitions: Array.isArray(session.recentOptionDefinitions) ? session.recentOptionDefinitions.slice(-48) : [],
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
      return {...saved, current:null, completed:false, resumeIndex:saved.index, recentOptionWords:Array.isArray(saved.recentOptionWords)?saved.recentOptionWords:[], recentOptionDefinitions:Array.isArray(saved.recentOptionDefinitions)?saved.recentOptionDefinitions:[]};
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
      showToast('No unfinished round is available.');
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
      progress.words[word] = {mastery:0, seen:0, correct:0, wrong:0, nextDue:0, lastSeen:null, suspended:false, markedKnown:false, luckyGuesses:0, saved:false};
    }
    return progress.words[word];
  }

  function getExistingWordState(word) {
    return progress.words[word] || {mastery:0, seen:0, correct:0, wrong:0, nextDue:0, lastSeen:null, suspended:false, markedKnown:false, luckyGuesses:0, saved:false};
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
    document.body.classList.toggle('round-active', Boolean(active));
    updateAppBar();
  }

  function updateQuestionCounter() {
    if (!session) return;
    const total = session.queue.length;
    if (session.mode === 'placement') {
      $('questionCounter').textContent = `Placement question ${session.index+1} of ${total}`;
    } else {
      const recycled = Math.max(0, total - session.plannedCount);
      const current = session.queue[session.index];
      let text = `Question ${session.index+1} of ${total}`;
      if (current?.repeat) text += ' — review';
      else if (recycled) text += ` — ${recycled} review ${recycled===1?'word':'words'} added`;
      $('questionCounter').textContent = text;
    }
    updateAppBar();
  }

  function appHistoryState(view=currentView, overlay=null, extra={}) {
    return {vocabBuilder:true, view, overlay, ...extra};
  }

  function announceScreen(message) {
    const live=$('screenAnnouncer');
    if (!live) return;
    live.textContent='';
    setTimeout(()=>{ live.textContent=String(message || ''); },30);
  }

  function practiceLabel() {
    if (!session) return 'Practice';
    if (session.mode==='level' && session.levels?.length) {
      const level=session.levels[0];
      return `Level ${level}: ${LEVEL_NAMES[level]}`;
    }
    if (session.mode==='placement') return 'Placement check';
    if (session.mode==='discover') return 'Unseen words';
    if (session.mode==='quick') return 'Mixed review';
    if (session.mode==='missed-review') return 'Missed-word review';
    if (session.mode==='single') return 'Practice one word';
    return 'Custom practice';
  }

  function updateAppBar() {
    const title=$('appBarTitle');
    const back=$('backButton');
    const menu=$('menuButton');
    const end=$('endSessionButton');
    if (!title || !back || !menu || !end) return;
    let label=VIEW_TITLES[currentView] || 'Vocabulary Builder';
    if (currentView==='practice') {
      if (practicePhase==='round' && session) {
        const position=Math.min(session.index+1,session.queue.length);
        label=`${practiceLabel()} · ${position} of ${session.queue.length}`;
      } else if (practicePhase==='complete') label='Round complete';
      else label='Build a custom round';
    }
    title.textContent=label;
    back.classList.toggle('hidden', currentView==='home');
    const activeRound=currentView==='practice' && practicePhase==='round' && Boolean(session);
    end.classList.toggle('hidden', !activeRound);
    menu.classList.toggle('hidden', activeRound);
    updateInstallUI();
  }

  function setMenuOpen(open, focusFirst=false, historyMode='auto') {
    const menu = $('mainMenu');
    const button = $('menuButton');
    if (!menu || !button) return;
    const wasOpen = !menu.classList.contains('hidden');
    if (open && !wasOpen && historyMode==='auto') {
      history.pushState(appHistoryState(currentView,'menu'),'',`#${currentView}/menu`);
    } else if (!open && wasOpen && historyMode==='auto' && history.state?.overlay==='menu') {
      history.back();
      return;
    }
    menu.classList.toggle('hidden', !open);
    button.setAttribute('aria-expanded', String(Boolean(open)));
    if ($('main')) $('main').inert=Boolean(open);
    if (open && focusFirst) menu.querySelector('button[data-view]')?.focus();
    if (!open && wasOpen && historyMode==='none' && menu.contains(document.activeElement)) button.focus();
  }

  function switchView(name, focus=true, historyMode='push') {
    const view=$(`view-${name}`);
    if (!view) return;
    if (history.state?.overlay==='menu' && historyMode==='push') history.replaceState(appHistoryState(currentView),'',`#${currentView}`);
    if (historyMode==='push' && name!==currentView) history.pushState(appHistoryState(name),'',`#${name}`);
    if (historyMode==='replace') history.replaceState(appHistoryState(name),'',`#${name}`);
    currentView=name;
    qsa('.view').forEach(v => v.classList.add('hidden'));
    view.classList.remove('hidden');
    qsa('#mainMenu button[data-view]').forEach(b => b.setAttribute('aria-current', b.dataset.view===name ? 'page' : 'false'));
    $('menuSavedWordsButton')?.setAttribute('aria-current','false');
    setMenuOpen(false,false,'none');
    if (name === 'home') { renderHome(); applyPendingUpdateIfSafe(); }
    if (name === 'lookup') renderRecentLookups();
    if (name === 'words') renderWords();
    if (name === 'collections') renderCollections();
    if (name === 'history') renderHistory();
    if (name === 'stats') renderStats();
    if (name === 'settings') renderSettings();
    if (name === 'practice' && !session) renderPracticeSetup();
    if (name === 'practice' && session) { practicePhase='round'; setFocusedPracticeActive(true); }
    else if (name !== 'practice') setFocusedPracticeActive(false);
    updateAppBar();
    if (focus) {
      const heading=view.querySelector('h2');
      requestAnimationFrame(()=> (heading || $('main')).focus?.());
    }
  }

  function navigateBack() {
    if (!$('mainMenu').classList.contains('hidden')) { setMenuOpen(false,false,'auto'); return; }
    const openDisclosure=qs(`#view-${currentView} details[open]`);
    if (openDisclosure) { openDisclosure.open=false; return; }
    if (currentView==='home') {
      announceScreen('Practice by level. Home screen. Use Menu to navigate.');
      showToast('Home — use Menu to navigate.');
      return;
    }
    history.back();
  }

  function restoreHomeGuard() {
    currentView='home';
    switchView('home',false,'none');
    history.pushState(appHistoryState('home'),'','#home');
    requestAnimationFrame(()=> $('homeHeading')?.focus?.());
    announceScreen('Practice by level. Home screen. Use Menu to navigate.');
  }

  function handlePopState(event) {
    if (!event.state?.vocabBuilder || event.state?.guard) {
      restoreHomeGuard();
      return;
    }
    if (!$('mainMenu').classList.contains('hidden') && event.state?.overlay!=='menu') {
      setMenuOpen(false,false,'none');
    }
    const openDisclosure=qs(`#view-${currentView} details[open]`);
    if (openDisclosure && !event.state?.overlay) {
      suppressDisclosureHistory=true;
      openDisclosure.open=false;
      suppressDisclosureHistory=false;
      return;
    }
    if (event.state.overlay==='menu') {
      currentView=event.state.view || currentView;
      setMenuOpen(true,true,'none');
      return;
    }
    if (String(event.state.overlay||'').startsWith('details:')) {
      const token=String(event.state.overlay).slice(8);
      currentView=event.state.view || currentView;
      switchView(currentView,true,'none');
      const details=qsa('details').find(item=>item.dataset.backToken===token);
      if (details) { suppressDisclosureHistory=true; details.open=true; suppressDisclosureHistory=false; }
      return;
    }
    const targetView=event.state.view || 'home';
    if (targetView==='word' && event.state.word) {
      void openWordDetail(event.state.word,{historyMode:'none'});
      return;
    }
    switchView(targetView,true,'none');
  }

  function wireBackAwareDisclosures() {
    qsa('details').forEach((details,index) => {
      const token=`details-${index+1}`;
      details.dataset.backToken=token;
      details.addEventListener('toggle',()=>{
        if (suppressDisclosureHistory) return;
        const overlay=`details:${token}`;
        if (details.open) {
          if (history.state?.overlay!==overlay) history.pushState(appHistoryState(currentView,overlay),'',`#${currentView}/${token}`);
        } else if (history.state?.overlay===overlay) {
          history.back();
        }
      });
    });
  }

  function setDetailsOpen(details, open) {
    if (!details || details.open===open) return;
    suppressDisclosureHistory=true;
    details.open=open;
    suppressDisclosureHistory=false;
  }

  function preferredDirection() {
    return ['word-def','def-word','mixed'].includes(settings.direction) ? settings.direction : 'word-def';
  }

  function selectQuestionDirection(value) {
    if (!['word-def','def-word','mixed'].includes(value)) return;
    settings={...settings,direction:value};
    saveState();
    qsa('input[name="homeDirection"]').forEach(input=>{input.checked=input.value===value;});
    $('questionDirection').value=value;
  }

  function renderHome() {
    qsa('input[name="homeDirection"]').forEach(input=>{input.checked=input.value===preferredDirection();});
    const studyItems = allStudyWords();
    const activeItems = studyItems.filter(item => canPracticeWord(item) && !getExistingWordState(item.word).suspended && !isInvalidSeed(item.word));
    const states = studyItems.map(({word}) => getExistingWordState(word));
    const seen = states.filter(state => state.seen>0);
    const mastered = states.filter(state => state.mastery===4).length;
    const due = activeItems.filter(({word}) => { const state=getExistingWordState(word); return state.nextDue && state.nextDue<=Date.now(); }).length;
    const difficult = activeItems.filter(({word}) => { const state=getExistingWordState(word); return state.wrong>0 && (state.correct+state.wrong) && state.correct/(state.correct+state.wrong)<0.7; }).length;
    const savedCount=studyItems.filter(item=>isSavedWord(item.word)).length;
    const streak=progress.streak?.current || 0;

    $('homeProgressSummary').textContent = seen.length
      ? `${seen.length.toLocaleString()} studied · ${mastered.toLocaleString()} mastered · ${accuracy(progress.totals.correct,progress.totals.answers)} accuracy · ${streak}-day streak`
      : 'No study activity yet. Choose a level to begin.';
    $('homeSavedWordsButton').textContent=`Review saved words (${savedCount.toLocaleString()})`;
    $('reviewDueButton').textContent=`Review due words (${due})`;
    $('reviewMissedButton').textContent=`Practice difficult words (${difficult})`;
    $('reviewDueButton').classList.toggle('hidden', due===0);
    $('reviewMissedButton').classList.toggle('hidden', difficult===0);
    $('homeReviewPanel').classList.toggle('hidden', due===0 && difficult===0);

    // Core practice never requires a key or account.
    $('setupNotice').classList.add('hidden');
    $('resumeSessionButton').classList.toggle('hidden', !hasResumableSession());

    for (let level=1; level<=5; level++) {
      const levelItems=studyItems.filter(item=>item.level===level && !item.custom);
      const studied=levelItems.filter(item=>getExistingWordState(item.word).seen>0).length;
      const masteredLevel=levelItems.filter(item=>getExistingWordState(item.word).mastery===4).length;
      const total=levelItems.length || 1;
      const text=studied ? `${studied.toLocaleString()} studied · ${masteredLevel.toLocaleString()} mastered` : 'Not started';
      const progressEl=$(`homeLevel${level}Progress`);
      const barEl=$(`homeLevel${level}Bar`);
      if (progressEl) progressEl.textContent=text;
      if (barEl) barEl.style.width=`${Math.min(100,Math.round(masteredLevel/total*100))}%`;
      const button=qs(`[data-home-level="${level}"]`);
      if (button) button.setAttribute('aria-label',`Start Level ${level}, ${LEVEL_NAMES[level]}. ${text}.`);
    }
  }

  function renderPracticeSetup() {
    practicePhase='setup';
    $('practiceSetup').classList.remove('hidden');
    $('quizArea').classList.add('hidden');
    $('sessionComplete').classList.add('hidden');
    $('endSessionButton').classList.add('hidden');
    $('placementApplyButton').classList.add('hidden');
    $('nextLevelButton').classList.add('hidden');
    $('anotherSessionButton').classList.remove('hidden');
    $('anotherSessionButton').textContent = 'Continue';
    $('reviewRoundButton').classList.add('hidden');
    $('sessionHomeButton').classList.remove('hidden');
    updateAppBar();
    $('sessionSize').value = String(settings.sessionSize || 10);
    $('questionDirection').value = preferredDirection();
    $('practiceSource').value = settings.source || 'all';
    $('practiceCollection').value = COLLECTION_MAP.has(settings.collection) ? settings.collection : 'all';
    $('newWordMix').value = ['low','balanced','high'].includes(settings.novelty) ? settings.novelty : 'balanced';
    qsa('input[name="level"]').forEach(cb => cb.checked = (settings.levels || [1,2,3,4,5]).includes(Number(cb.value)));
  }

  function buildSession(mode='normal') {
    if (mode === 'placement') {
      const selected = [];
      for (let level=1; level<=5; level++) selected.push(...shuffle(CURRICULUM.filter(item => item.level===level)).slice(0,3));
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

    let pool = allStudyWords().filter(w => levels.includes(w.level) && canPracticeWord(w) && !getExistingWordState(w.word).suspended && !isInvalidSeed(w.word));
    if (source === 'personal') pool = pool.filter(w => isSavedWord(w.word));
    if (source === 'starter') pool = pool.filter(w => !w.custom);
    if (collection !== 'all') pool = pool.filter(w => wordMatchesCollection(w, collection));

    const now = Date.now();
    const prioritizePersonal = items => [...shuffle(items.filter(x=>isSavedWord(x.word))), ...shuffle(items.filter(x=>!isSavedWord(x.word)))];
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
      const sourceMessage = source==='personal' ? 'No saved words with available definitions match these filters. Built-in words work offline; custom words currently need optional online access.' :
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
    const pool=allStudyWords().filter(item=>item.level===level && canPracticeWord(item) && !getExistingWordState(item.word).suspended && !isInvalidSeed(item.word));
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
      direction:preferredDirection(),levels:[level],source:'all',collection:'all',novelty:'high',plannedCount:Math.min(size,selected.length)};
  }

  async function beginLevelSession(level) {
    const built=buildLevelSession(Number(level));
    if (!built) { showToast('No words are available in this level.'); return; }
    switchView('practice',false);
    startBuiltSession(built);
  }

  function buildQuickSession(kind='quick') {
    const size=10;
    const now=Date.now();
    const recent=recentPracticeWords(100);
    const pool=allStudyWords().filter(item => canPracticeWord(item) && !getExistingWordState(item.word).suspended && !isInvalidSeed(item.word));
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
      direction:preferredDirection(), levels:[1,2,3,4,5], source:'all', collection:'all', novelty:kind==='discover'?'high':'balanced', plannedCount:Math.min(size,selected.length)
    };
  }

  async function beginQuickSession(kind='quick') {
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
    const replacing=Boolean(session || loadSavedSession());
    session=null;
    clearSavedSession();
    if (replacing) showToast('Started a new round. Your completed answers were kept.');
    session = {...built, resumeIndex:built.index || 0, missedWords:Array.isArray(built.missedWords)?built.missedWords:[], recentOptionWords:[], recentOptionDefinitions:[]};
    practicePhase='round';
    persistSession();
    setFocusedPracticeActive(true);
    $('practiceSetup').classList.add('hidden');
    $('sessionComplete').classList.add('hidden');
    $('quizArea').classList.remove('hidden');
    $('endSessionButton').classList.remove('hidden');
    presentQuestion();
  }

  async function beginSession(mode='normal') {
    const built = buildSession(mode);
    if (!built) return;
    startBuiltSession(built);
  }

  // Some legacy curriculum IDs omit conventional hyphens or spaces. Keep
  // those stable IDs for existing progress, but ask the dictionary for the
  // conventional spelling so the word is not silently skipped.
  const DICTIONARY_SPELLINGS = Object.freeze({
    fulltime:'full-time', parttime:'part-time', runon:'run-on',
    deescalate:'de-escalate', cashflow:'cash flow'
  });
  function dictionaryLookupSpelling(word) {
    const value=String(word || '').toLowerCase().trim();
    return DICTIONARY_SPELLINGS[value] || value;
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

  const DERIVATIONAL_SUFFIXES = [
    'izations','isations','ization','isation','ational','fulness','ousness','iveness','ability','ibility',
    'ations','itions','tions','sions','ances','ences','ancies','encies','ments','nesses','ships','hoods',
    'ation','ition','tion','sion','ance','ence','ancy','ency','ment','ness','ities','ity','isms','ists',
    'ship','hood','ical','ously','ively','ally','able','ible','ant','ent','ous','ive','ful','less','ism','ist','ize','ise','ify','al','ic','ly','er','or'
  ];

  function wordFamilyStem(value) {
    let word=String(value || '').toLowerCase().replace(/[^a-z]/g,'');
    if (word.length < 5) return word;
    for (const suffix of DERIVATIONAL_SUFFIXES) {
      if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
        word=word.slice(0,-suffix.length);
        break;
      }
    }
    return word;
  }

  function commonPrefixLength(a,b) {
    const max=Math.min(a.length,b.length);
    let i=0;
    while (i<max && a[i]===b[i]) i+=1;
    return i;
  }

  function sameWordFamily(a,b) {
    const left=String(a||'').toLowerCase().replace(/[^a-z]/g,'');
    const right=String(b||'').toLowerCase().replace(/[^a-z]/g,'');
    if (!left || !right) return false;
    if (left===right) return true;
    if (left.length>=5 && right.length>=5) {
      const prefix=commonPrefixLength(left,right);
      if (Math.abs(left.length-right.length)<=4 && prefix>=5 && prefix/Math.min(left.length,right.length)>=0.72) return true;
      const leftStem=wordFamilyStem(left);
      const rightStem=wordFamilyStem(right);
      if (leftStem.length>=4 && leftStem===rightStem) return true;
    }
    return false;
  }

  function isCircularDefinition(definition, word) {
    const head=normalizeWordForMatch(word).replace(/[^a-z]/g,'');
    if (!head) return false;
    const value=String(definition || '').toLowerCase().trim();
    const tokens=value.match(/[a-z]+/g) || [];
    if (tokens.includes(head)) return true;
    const familyTokens=tokens.filter(token => token.length>=4 && sameWordFamily(head,token));
    if (!familyTokens.length) return false;

    // Reject tautologies such as “marked by elegance” for elegant, while allowing
    // useful base-word explanations such as “of or relating to music” for musical.
    if (/\b(?:marked|characterized|denoted|distinguished)\s+by\b/.test(value)) return true;
    if (/\b(?:quality|state|condition)\s+of\s+being\b/.test(value)) return true;

    const independent=definitionTokens(value).filter(token => !sameWordFamily(head,token));
    if (/\b(?:having|showing|possessing)\b/.test(value) && independent.length<=1) return true;
    if (familyTokens.some(token=>token.length>head.length) && independent.length<=2) return true;
    return false;
  }

  // A nested dictionary gloss is not necessarily a complete standalone answer.
  // Never let fragments, dangling exemplifiers, or raw dictionary markup leak
  // into multiple-choice options or into lists of other meanings.
  function isCompleteDefinition(definition) {
    const value=String(definition || '').trim();
    if (value.length < 8 || value.length > 180) return false;
    if (/[,:;–—-]$/.test(value) || /[({]$/.test(value)) return false;
    if (/\b(?:such as|for example|including|especially|e\.g\.|like the|as in|or other|and other)\s*$/i.test(value)) return false;
    if (/\b(?:and|or|with|without|from|because|except for|used to)\s*$/i.test(value)) return false;
    if (/\{[^}]*\}|<[^>]+>/.test(value)) return false;
    if (/^\s*(?:see also|compare with|see )\b/i.test(value)) return false;
    return true;
  }

  function isPedagogicallyUsefulDefinition(definition, word) {
    const value=String(definition || '').trim();
    if (!isCompleteDefinition(value) || isCircularDefinition(value,word)) return false;
    return definitionTokens(value).length >= 1;
  }

  function orderedUsefulDefinitions(shortdefs, word) {
    const defs=[...new Set((shortdefs || []).map(value => String(value || '').trim()).filter(Boolean))];
    return defs.filter(definition => isPedagogicallyUsefulDefinition(definition,word));
  }

  function chooseStudyDefinition(shortdefs, word) {
    // Keep Merriam-Webster sense order, but skip circular/cognate senses that do not teach the word.
    const useful=orderedUsefulDefinitions(shortdefs,word);
    return useful[0] || String((shortdefs || [])[0] || '').trim();
  }

  function chooseQuizDefinition(shortdefs, word) {
    return orderedUsefulDefinitions(shortdefs,word)[0] || '';
  }

  function chooseAnswerDefinition(shortdefs, word) {
    const primaryUseful=chooseQuizDefinition(shortdefs,word);
    return isConciseAnswerDefinition(primaryUseful) ? primaryUseful : '';
  }

  function cleanMwText(text) {
    let value=String(text || '');
    if (!value) return '';
    value=value
      .replace(/\{bc\}/g, ': ')
      .replace(/\{ldquo\}/g, '“').replace(/\{rdquo\}/g, '”')
      .replace(/\{lsquo\}/g, '‘').replace(/\{rsquo\}/g, '’')
      .replace(/\{(?:sx|dxt|a_link|d_link|i_link)\|([^|{}]+)(?:\|[^{}]*)?\}/g, '$1')
      .replace(/\{(?:it|wi|qword|phrase|sc|sup|inf|b|rom|dx|dx_def)\}/g, '')
      .replace(/\{\/(?:it|wi|qword|phrase|sc|sup|inf|b|rom|dx|dx_def)\}/g, '')
      .replace(/\{[^{}]*\}/g, '')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s:;,-]+/, '')
      .trim();
    return value;
  }

  function collectMwDefinitionText(node, out=[]) {
    if (Array.isArray(node)) {
      if (node.length===2 && node[0]==='text' && typeof node[1]==='string') {
        const cleaned=cleanMwText(node[1]);
        if (cleaned) out.push(cleaned);
        return out;
      }
      for (const child of node) collectMwDefinitionText(child,out);
      return out;
    }
    if (node && typeof node==='object') {
      for (const value of Object.values(node)) collectMwDefinitionText(value,out);
    }
    return out;
  }

  function learnerDefinitionsFromEntry(entry, word) {
    const learner=entry?.suppl?.ldq?.def;
    if (!learner) return [];
    const values=collectMwDefinitionText(learner,[]);
    return [...new Set(values)]
      .filter(definition=>isPedagogicallyUsefulDefinition(definition,word))
      .slice(0,4);
  }

  // A verbal illustration belongs to a specific Merriam-Webster sense. Keep it
  // together with that sense rather than mixing examples from unrelated meanings.
  function senseIllustrations(entry) {
    const senses=[];
    function visit(node) {
      if (Array.isArray(node)) {
        if (node.length===2 && (node[0]==='sense' || node[0]==='bs') && node[1]?.dt) {
          const sense=node[1];
          const definitionParts=[];
          const examples=[];
          for (const part of sense.dt) {
            if (!Array.isArray(part)) continue;
            if (part[0]==='text') definitionParts.push(cleanMwText(part[1]));
            if (part[0]==='vis' && Array.isArray(part[1])) {
              for (const illustration of part[1]) {
                const value=cleanMwText(illustration?.t);
                if (value) examples.push(value);
              }
            }
          }
          senses.push({definition:definitionParts.filter(Boolean).join(' '),examples});
          if (sense.sdsense) visit(['sense',sense.sdsense]);
          return;
        }
        for (const child of node) visit(child);
      } else if (node && typeof node==='object') {
        for (const value of Object.values(node)) visit(value);
      }
    }
    visit(entry?.def || []);
    return senses;
  }

  function looksLikeSentence(example) {
    const text=String(example || '').trim();
    // Avoid presenting dictionary fragments as complete sentences.
    if (!/[.!?][”"']?$/.test(text)) return false;
    return text.split(/\s+/).length >= 5;
  }

  function examplesForTeachingSense(entry, definition) {
    const senses=senseIllustrations(entry);
    const target=String(definition || '');
    let chosen=null;
    let score=0;
    for (const sense of senses) {
      const similarity=definitionSimilarity(target,sense.definition);
      if (similarity>score && similarity>=0.50) {
        chosen=sense;
        score=similarity;
      }
    }
    // If that sense has no example, do not steal one from an unrelated sense.
    const direct=chosen?.examples || [];
    const supplemental=Array.isArray(entry?.suppl?.examples) ? entry.suppl.examples.map(item=>cleanMwText(item?.t)).filter(Boolean) : [];
    // Supplemental examples are not sense-linked. Use only when the entry has
    // one dictionary sense, or no sense-linked examples exist in the entry.
    const canUseSupplemental=Boolean(chosen) && (senses.length<=1 || senses.every(sense=>!sense.examples.length));
    const candidates=direct.length ? direct : (canUseSupplemental ? supplemental : []);
    const uniqueExamples=[...new Set(candidates.map(value=>String(value).trim()).filter(Boolean))];
    // Prefer a full sentence when Merriam-Webster supplied one, while retaining
    // accurate shorter usage illustrations rather than fabricating sentences.
    uniqueExamples.sort((a,b)=>Number(looksLikeSentence(b))-Number(looksLikeSentence(a)));
    return uniqueExamples.slice(0,3);
  }

  // Authored study examples used only when the dictionary has no aligned usage illustration.
  // These sentences illustrate a common sense of each word; no fabricated quotes are attributed to MW.
  const CURATED_EXAMPLES = Object.freeze({
    "abrupt": "The meeting ended abruptly when the fire alarm sounded.",
    "adapt": "The team had to adapt its process after the software changed.",
    "adequate": "The inspection found that the existing insulation was adequate for the climate.",
    "ambiguous": "The contract used ambiguous language that both parties interpreted differently.",
    "apparent": "Her frustration became apparent when she stopped responding.",
    "assume": "Do not assume that the quoted price includes installation.",
    "coherent": "He presented a coherent explanation that connected the evidence to his conclusion.",
    "compile": "We need to compile the monthly figures into a single report.",
    "concede": "She was willing to concede that the opposing argument had merit.",
    "conspicuous": "The bright orange notice was conspicuous against the white wall.",
    "crucial": "Accurate measurements are crucial when ordering replacement parts.",
    "derive": "Researchers derive the estimate from several independent data sources.",
    "diminish": "The noise began to diminish as the traffic moved farther away.",
    "dispute": "The neighbors dispute where the property boundary lies.",
    "elaborate": "Could you elaborate on what the inspector meant by that warning?",
    "feasible": "Replacing the roof this month is not feasible without additional funds.",
    "impartial": "The mediator remained impartial throughout the disagreement.",
    "inevitable": "Some disruption was inevitable during the renovation.",
    "notion": "She rejected the notion that a higher price always means better quality.",
    "reluctant": "He was reluctant to sign before reading the full agreement.",
    "alleviate": "Opening the window helped alleviate the stuffy conditions.",
    "anomaly": "A sudden spike in expenses was an anomaly compared with earlier months.",
    "arbitrary": "The cutoff date seemed arbitrary because no one explained why it was chosen.",
    "bolster": "The new evidence helped bolster her original argument.",
    "candid": "During the review, he gave a candid assessment of the project’s weaknesses.",
    "complacent": "The team became complacent after several months without a problem.",
    "conventional": "They chose a conventional refrigerator rather than a smart model.",
    "diligent": "Her diligent recordkeeping made the audit much easier.",
    "disparity": "The report revealed a large disparity between advertised and actual costs.",
    "elusive": "Despite repeated searches, the source of the leak remained elusive.",
    "empirical": "The recommendation was supported by empirical evidence gathered in tests.",
    "exacerbate": "Delaying the repair could exacerbate the water damage.",
    "fluctuate": "Electricity prices fluctuate throughout the year.",
    "frugal": "He made a frugal choice by repairing the appliance instead of replacing it.",
    "inhibit": "Too many notifications can inhibit concentration.",
    "meticulous": "She kept meticulous notes about every change to the plan.",
    "plausible": "The explanation sounded plausible, but it still needed verification.",
    "pragmatic": "They took a pragmatic approach and fixed the most serious problems first.",
    "scrutinize": "The reviewer will scrutinize the contract for unexpected fees.",
    "tenuous": "The connection between the two events was tenuous at best.",
    "aberration": "The unusually high reading appeared to be an aberration rather than a trend.",
    "ameliorate": "The updated procedure should ameliorate the delay experienced by applicants.",
    "antithetical": "The secrecy was antithetical to the organization’s stated commitment to openness.",
    "capricious": "Her capricious decisions made it difficult for the team to plan ahead.",
    "cogent": "He offered a cogent argument supported by several concrete examples.",
    "deleterious": "Prolonged exposure to moisture can have deleterious effects on wooden structures.",
    "didactic": "The novel felt didactic because its characters constantly explained moral lessons.",
    "equivocal": "His equivocal response left everyone unsure whether he agreed.",
    "fastidious": "The editor was fastidious about spelling and punctuation.",
    "iconoclast": "An iconoclast challenged the long-standing practices that others accepted without question.",
    "intransigent": "The negotiator remained intransigent despite several reasonable proposals.",
    "laconic": "His laconic reply consisted of only two words.",
    "magnanimous": "After winning the debate, she was magnanimous toward her opponent.",
    "obfuscate": "The dense technical language seemed designed to obfuscate a simple problem.",
    "parsimonious": "The manager was parsimonious with funds even when repairs were necessary.",
    "perfunctory": "The inspector gave the equipment only a perfunctory glance.",
    "prosaic": "The explanation turned out to be prosaic: someone had unplugged the cable.",
    "sagacious": "Her sagacious advice helped the group avoid an expensive mistake.",
    "ubiquitous": "Smartphones are now ubiquitous in everyday life.",
    "vacillate": "He continued to vacillate between renting and buying.",
    "abstemious": "Her abstemious habits made the expensive celebration seem unusual.",
    "apocryphal": "The story about the inventor may be apocryphal; no reliable source confirms it.",
    "calumny": "The candidate accused the publication of spreading calumny about her record.",
    "circumlocution": "Instead of answering directly, he used circumlocution to avoid the question.",
    "contumacious": "The contumacious witness repeatedly ignored the judge’s instructions.",
    "desultory": "Their desultory conversation jumped from topic to topic without direction.",
    "diaphanous": "Sunlight passed through the diaphanous curtains.",
    "eleemosynary": "The organization relied on eleemosynary contributions to support its programs.",
    "epistemic": "The debate raised an epistemic question about what counts as reliable knowledge.",
    "execrable": "The repairs were so poorly done that the workmanship was execrable.",
    "fulsome": "The speaker offered fulsome praise for the volunteers’ efforts.",
    "impecunious": "The impecunious student searched for scholarships to cover tuition.",
    "inveterate": "An inveterate reader, she rarely left home without a book.",
    "meretricious": "The flashy advertisement made promises that felt meretricious rather than credible.",
    "perspicacious": "The perspicacious analyst noticed a pattern that others had overlooked.",
    "recondite": "The lecture explored recondite questions in medieval philosophy.",
    "sesquipedalian": "His sesquipedalian writing used long words where short ones would do.",
    "supercilious": "Her supercilious tone suggested that she considered the question beneath her.",
    "vicissitude": "The travelers adapted to each vicissitude of the long journey.",
    "abecedarian": "The abecedarian lesson began with the letters A, B, and C.",
    "adumbrate": "The opening chapter began to adumbrate the conflict that would dominate the novel.",
    "anfractuous": "They followed an anfractuous path through the mountain foothills.",
    "antediluvian": "The office still used an antediluvian filing system based entirely on paper.",
    "apothegm": "The teacher opened each lesson with a short apothegm about patience.",
    "ataraxia": "After years of turmoil, she sought the ataraxia described by ancient philosophers.",
    "catachresis": "Calling the base of a table its foot is a familiar example of catachresis.",
    "concinnity": "The editor admired the concinnity of the essay’s carefully balanced sentences.",
    "crepuscular": "Bats are often crepuscular, becoming active around dusk.",
    "defenestration": "The broken window prompted jokes about the defenestration of the old computer.",
    "epigone": "Critics dismissed the artist as an epigone of a more original painter.",
    "farrago": "The presentation was a farrago of unrelated facts and unsupported claims.",
    "ineluctable": "Despite their objections, the deadline was ineluctable.",
    "noisome": "A noisome odor drifted from the neglected drain.",
    "palimpsest": "The manuscript was a palimpsest with traces of an older text beneath the new writing.",
    "panegyric": "The retirement speech became a panegyric celebrating her decades of service.",
    "ratiocinate": "The detective tried to ratiocinate from the available clues.",
    "susurrus": "The susurrus of wind through the leaves was barely audible.",
    "tergiversate": "The official continued to tergiversate rather than state a clear position.",
    "zeugma": "In the sentence “She broke his car and his heart,” the shared verb creates zeugma.",
    "convention": "By convention, formal letters begin with a greeting.",
    "influence": "The early reviews had a strong influence on the committee’s decision.",
    "evident": "It was evident from the photographs that the roof had been damaged.",
    "farther": "The second store was farther away than we expected.",
    "conflict": "A conflict arose when the two departments adopted different schedules.",
    "agreement": "The written agreement specified which repairs the seller would complete.",
    "obvious": "The mistake became obvious when they compared the two totals.",
    "suppose": "Suppose the interest rate rises next year; how would that change the payment?",
    "resolution": "After several meetings, they finally reached a resolution of the dispute.",
    "principle": "The decision was guided by the principle that everyone should have equal access.",
    "solemn": "The witnesses made a solemn promise to tell the truth.",
    "diplomatic": "She gave a diplomatic response that acknowledged both perspectives.",
    "standard": "The software must meet the organization’s accessibility standard.",
    "confidence": "Repeated practice increased her confidence in using the keyboard.",
    "excuse": "A technical difficulty is not always an excuse for missing a deadline.",
    "describe": "Please describe the appearance of the object in the photograph.",
    "continuous": "The machine requires a continuous supply of electricity.",
    "association": "The researchers found an association between exercise and better sleep.",
    "reference": "The manual serves as a reference when unusual problems arise.",
    "claim": "The contractor made a claim that the installation met local codes.",
    "inquiry": "The office received an inquiry about the missing documents.",
    "outcome": "They measured the outcome before changing the policy.",
    "principal": "The principal amount of the loan decreases with each payment toward the balance.",
    "clause": "The lease contained a clause restricting changes to the property.",
    "colon": "A colon can introduce a list of items.",
    "apostrophe": "The apostrophe in “teacher’s” indicates possession.",
    "predicate": "In the sentence “The dog barked,” the predicate is “barked.”",
    "semicolon": "A semicolon can connect two closely related independent clauses.",
    "effect": "The change had an immediate effect on the monthly payment.",
    "evidence": "The photos provided evidence of the damage.",
    "sufficient": "The documents contained sufficient detail to support the decision.",
    "compromise": "Both sides accepted a compromise that met their most important needs.",
    "trenchant": "The review offered a trenchant critique of the proposed policy.",
    "significance": "The findings had particular significance for people who rely on screen readers.",
    "jurisdiction": "The local court had jurisdiction over the dispute.",
    "obligation": "The agreement created an obligation to finish the work by Friday.",
    "composition": "The committee changed its composition after the election.",
    "confirmation": "She requested written confirmation before booking the appointment.",
    "consistent": "His account remained consistent throughout the interview.",
    "courtesy": "The manager called as a courtesy to explain the delay.",
    "deduction": "The accountant identified a deduction that reduced taxable income.",
    "eloquent": "She gave an eloquent speech that persuaded the audience.",
    "eminent": "The panel included an eminent scholar of constitutional law.",
    "mechanism": "The engineer explained the mechanism that keeps the door from slamming.",
    "negotiate": "The parties agreed to negotiate the remaining contract terms.",
    "abstract": "The discussion became so abstract that no one proposed a practical solution.",
    "acknowledge": "The report should acknowledge the limitations of the available evidence.",
    "differentiate": "The instructor asked students to differentiate facts from opinions.",
    "emphasis": "The training placed special emphasis on accessible keyboard navigation.",
    "induction": "The reasoning relied on induction from several observed examples.",
    "interpretation": "Her interpretation of the rule differed from the manager’s.",
    "negotiation": "The negotiation ended when both sides agreed on the price.",
    "transparent": "The agency published a transparent explanation of how applications are reviewed.",
    "attribute": "Researchers attribute the improvement partly to more frequent practice.",
    "deception": "The investigation uncovered deliberate deception in the advertising.",
    "defensive": "He became defensive when the reviewer questioned his calculations.",
    "retention": "Frequent review can improve retention of new vocabulary.",
    "stress": "The speaker placed stress on the final word of the sentence.",
    "conjunction": "The conjunction “although” introduces a contrast.",
    "facilitate": "Clear instructions can facilitate independent use of the application.",
    "identify": "The witness could not identify the person in the photograph.",
    "illustrate": "The instructor used a short story to illustrate the concept.",
    "implication": "One implication of the finding is that the original estimate was too low.",
    "integrity": "The audit raised concerns about the integrity of the underlying data.",
    "memorandum": "The analyst wrote a memorandum explaining the recommended change.",
    "recommendation": "Her recommendation was to repair the existing equipment.",
    "relationship": "The chart showed a relationship between price and demand.",
    "respond": "Please respond to the request before the deadline.",
    "sincerity": "Her sincerity was clear from her willingness to admit mistakes.",
    "acceptance": "Formal acceptance of the proposal required a signed document.",
    "accuracy": "The team checked the accuracy of every number in the report.",
    "alternate": "We planned an alternate route in case the road was closed.",
    "assert": "He continued to assert that the warranty covered the damage.",
    "climax": "The story reaches its climax when the characters finally confront each other.",
    "demonstrate": "She used the keyboard to demonstrate how the feature works.",
    "elective": "The student chose an elective course in public speaking.",
    "exposition": "The novel begins with an exposition of the characters and setting.",
    "insight": "Her comment provided useful insight into why the procedure failed.",
    "reconciliation": "Bank reconciliation revealed a transaction that had been recorded twice.",
    "specialist": "A specialist examined the electrical panel before repairs began.",
    "allusion": "The poem contains an allusion to an ancient Greek myth.",
    "compliment": "The editor gave her a compliment about the clarity of her writing.",
    "concept": "The teacher introduced the concept with a familiar example.",
    "concession": "The seller offered a concession to cover part of the closing costs.",
    "conversion": "The conversion of inches to centimeters was shown in the worksheet.",
    "denote": "A red symbol may denote an urgent item on the chart.",
    "disclose": "The seller must disclose certain known problems with the property.",
    "imminent": "The darkening sky suggested that heavy rain was imminent.",
    "objection": "The attorney raised an objection during the testimony.",
    "pattern": "The analyst noticed a repeating pattern in the monthly figures.",
    "syllable": "The word “window” has two syllables.",
    "analyze": "The team will analyze the survey results before revising the interface.",
    "appropriation": "The legislature approved an appropriation for the new program.",
    "comparable": "The estimate was based on prices for comparable nearby homes.",
    "compatible": "The new software is compatible with the existing screen reader.",
    "confound": "The unexpected result may confound the original explanation.",
    "construct": "Workers will construct a ramp beside the entrance.",
    "deviation": "Any deviation from the approved plan needs documentation.",
    "eloquence": "The audience admired the eloquence of her closing statement.",
    "expenditure": "The repair was the largest unexpected expenditure of the month.",
    "interaction": "The test measured how each interaction affected keyboard focus.",
    "manuscript": "The editor reviewed the manuscript before publication.",
    "reconcile": "The accountant had to reconcile two conflicting totals.",
    "symbol": "The arrow is a symbol indicating the direction of travel.",
    "accommodation": "The employee requested an accommodation to use assistive software.",
    "anecdote": "He told an anecdote about his first day on the job.",
    "autobiography": "She wrote an autobiography describing her early career.",
    "biography": "The biography follows the scientist from childhood to retirement.",
    "coordinate": "The offices must coordinate their schedules for the joint inspection.",
    "disagreement": "Their disagreement centered on which costs were necessary.",
    "enhance": "The update should enhance readability for screen reader users.",
    "explore": "We can explore several solutions before choosing one.",
    "investment": "She regarded continuing education as an investment in her future.",
    "manipulation": "The report warned against manipulation of the survey results.",
    "payable": "The invoice states that the balance is payable within thirty days.",
    "presumption": "The argument rests on the presumption that all applicants have internet access.",
    "satire": "The article used satire to criticize bureaucratic inefficiency.",
    "theoretical": "The proposal is theoretically possible, but nobody has tested it.",
    "veteran": "The veteran employee helped train the new staff member.",
    "accommodate": "The schedule can accommodate a later appointment.",
    "antagonist": "The antagonist opposes the protagonist throughout the story.",
    "anticipate": "The planner tried to anticipate problems before the launch.",
    "compose": "She will compose the letter before the meeting.",
    "concise": "The instructions were concise enough to remember after one reading.",
    "conditional": "The offer was conditional on a satisfactory inspection.",
    "cooperate": "Both teams agreed to cooperate on the investigation.",
    "discreet": "He made a discreet inquiry rather than discussing the issue publicly.",
    "formula": "The spreadsheet uses a formula to calculate the total.",
    "hierarchy": "The chart showed the organization’s management hierarchy.",
    "impact": "The change could have a substantial impact on monthly expenses.",
    "interpret": "The reader may interpret the ending in several ways.",
    "investigate": "An electrician will investigate the cause of the outage.",
    "mediation": "Mediation helped the neighbors settle their dispute.",
    "omission": "The missing signature was an important omission from the form.",
    "protocol": "The laboratory followed a strict protocol for collecting samples.",
    "sarcasm": "Her sarcasm was difficult to recognize from the text alone.",
    "soundness": "The reviewer questioned the soundness of the original calculation.",
    "analogous": "A budget is analogous to a plan for allocating limited resources.",
    "applicant": "The applicant submitted the required documents online.",
    "articulation": "Her careful articulation made the presentation easy to follow.",
    "austere": "The office had an austere appearance, with almost no decoration.",
    "authentic": "The museum confirmed that the letter was authentic.",
    "coercion": "The agreement was invalid because it had been signed under coercion.",
    "competitive": "The company submitted a competitive bid for the contract.",
    "complement": "The new training materials complement the existing course.",
    "concealment": "The inspector found evidence of concealment behind the new wall panel.",
    "configuration": "A different keyboard configuration solved the problem.",
    "consistency": "Consistency in the instructions made the app easier to learn.",
    "context": "The word has a different meaning in this context.",
    "cynical": "His cynical response suggested that he expected every promise to be broken.",
    "depreciation": "The accountant recorded depreciation on the equipment each year.",
    "discrete": "The report divided the problem into several discrete tasks.",
    "dismiss": "The committee voted to dismiss the complaint.",
    "efficacy": "The study examined the efficacy of the new treatment.",
    "entail": "The renovation will entail replacing the damaged wiring.",
    "ethical": "The consultant raised an ethical concern about the proposed plan.",
    "fiction": "The story is a work of fiction rather than a historical account.",
    "insure": "The policy will insure the building against certain types of damage.",
    "monograph": "The researcher published a monograph on medieval trade.",
    "reproduction": "The museum displayed a reproduction of the original painting.",
    "rhetoric": "The speech relied on emotional rhetoric rather than specific evidence.",
    "rhythm": "The poem’s rhythm becomes more pronounced when it is read aloud.",
    "signify": "A blinking light may signify a problem with the device.",
    "summarize": "Please summarize the main findings in one paragraph.",
    "technique": "She developed a technique for locating controls by touch.",
    "understandable": "The instructions were understandable even to someone new to the software.",
    "algebra": "The course introduced algebra using equations with one unknown.",
    "arithmetic": "Mental arithmetic helped her check the total quickly.",
    "assessment": "The assessment identified several areas needing improvement.",
    "assignment": "The instructor posted the assignment before class.",
    "certificate": "She received a certificate after completing the training.",
    "contractor": "The contractor submitted a detailed estimate for the repairs.",
    "curriculum": "The school revised its curriculum to include accessibility testing.",
    "descriptive": "A descriptive label helped the user identify the unlabeled button.",
    "equation": "The equation has the same value on both sides.",
    "florid": "The florid language distracted from the main argument.",
    "fraction": "One quarter is a fraction representing one part out of four.",
    "honesty": "Her honesty made the difficult conversation more productive.",
    "inequality": "The report examined inequality in access to technology.",
    "judgement": "The manager exercised good judgement when prioritizing repairs.",
    "mandatory": "Attendance at the safety meeting is mandatory.",
    "mitigate": "The team installed temporary barriers to mitigate the risk.",
    "option": "She selected the least expensive option that met the requirements.",
    "obsolete": "The software was obsolete and no longer received security updates.",
    "analytical": "His analytical approach helped identify the problem step by step.",
    "narrator": "The narrator describes events from the perspective of a child.",
    "personification": "Calling the wind angry is an example of personification.",
    "vocabulary": "Reading regularly helped expand her vocabulary.",
    "whimsical": "The whimsical illustration made the serious report feel playful.",
    "dialogue": "The dialogue revealed the characters’ conflicting motives.",
    "informal": "They used an informal tone when chatting with colleagues.",
    "monologue": "The actor delivered a long monologue at the end of the play.",
    "poignant": "The final letter was especially poignant because it arrived too late.",
    "sardonic": "He offered a sardonic smile when the plan failed exactly as predicted.",
    "archaic": "The legal form used archaic phrases that most readers no longer understood.",
    "cadence": "The speaker’s steady cadence made the instructions easy to follow.",
    "characterization": "The author’s characterization gave the villain believable motives.",
    "colloquial": "The dialogue used colloquial expressions heard in everyday speech.",
    "diction": "The writer adjusted her diction to suit a professional audience.",
    "earnest": "He made an earnest attempt to correct the mistake.",
    "epigram": "The essay begins with an epigram about the importance of patience.",
    "euphemism": "“Passed away” is a common euphemism for “died.”",
    "evocative": "The description was evocative of a quiet winter morning.",
    "expository": "The chapter’s expository paragraphs explain how the machine works.",
    "figurative": "Her figurative language compared the dispute to a storm.",
    "flashback": "The novel uses a flashback to explain the character’s childhood.",
    "genre": "The book combines elements of the mystery and fantasy genres.",
    "hyperbole": "Saying “I waited a million years” is hyperbole.",
    "idiom": "“Break the ice” is an idiom that means easing social tension.",
    "imagery": "The vivid imagery made the forest seem almost visible.",
    "interpretive": "The museum’s interpretive display explained the historical setting.",
    "irreverent": "The comedian’s irreverent jokes mocked respected traditions.",
    "jargon": "The presentation used jargon that confused people outside the profession.",
    "lexicon": "The new profession introduced terms that were unfamiliar to her lexicon.",
    "litotes": "Saying “not bad” to mean “good” is an example of litotes.",
    "meter": "The poem’s meter follows a regular pattern of stressed syllables.",
    "neologism": "The writer coined a neologism to describe the new phenomenon.",
    "nonfiction": "The memoir was shelved with other works of nonfiction.",
    "nuanced": "Her nuanced answer acknowledged several important exceptions.",
    "ornate": "The ornate frame was covered with detailed carved patterns.",
    "oxymoron": "The phrase “deafening silence” is an oxymoron.",
    "paradox": "The paradox is that the policy designed to save time created more delays.",
    "parody": "The film was a parody of familiar superhero stories.",
    "persuasive": "The proposal was persuasive because it offered evidence and practical steps.",
    "phonetic": "She wrote a phonetic guide to help readers pronounce the name.",
    "polemical": "The polemical essay attacked its opponents with little attempt at balance.",
    "protagonist": "The protagonist confronts the main conflict in the final chapter.",
    "rhetorical": "He asked a rhetorical question that did not require an answer.",
    "simile": "“Her voice was like thunder” is a simile.",
    "soliloquy": "The character speaks alone in a soliloquy revealing his fears.",
    "stanza": "The poem contains four lines in each stanza.",
    "symbolism": "The recurring broken clock carries symbolism throughout the novel.",
    "terminology": "The training introduces terminology used in federal procurement.",
    "trope": "The story uses the familiar trope of a reluctant hero.",
    "understatement": "Calling a severe storm “a bit of rain” is an understatement.",
    "verbose": "The instructions were so verbose that readers missed the main point.",
    "acquiesce": "After lengthy objections, the committee agreed to acquiesce.",
    "adulation": "The celebrity appeared uncomfortable with the crowd’s adulation.",
    "adversary": "The two rivals treated each other as adversaries.",
    "adversity": "She showed resilience in the face of considerable adversity.",
    "aloofness": "His aloofness made it difficult for new colleagues to approach him.",
    "animosity": "Years of animosity made cooperation between the neighbors unlikely.",
    "annihilate": "The fire threatened to annihilate the remaining structures.",
    "appellate": "The appellate court reviewed the ruling from the lower court.",
    "appraise": "An expert will appraise the property before the lender approves the loan.",
    "apprehend": "The police were able to apprehend the suspect after a short search.",
    "arbitrate": "Both sides agreed to arbitrate the dispute rather than go to court.",
    "arrogance": "His arrogance prevented him from listening to useful criticism.",
    "aspiration": "Her aspiration was to become a professional analyst.",
    "assimilation": "The course examined the assimilation of newcomers into local culture.",
    "atrocious": "The hotel received complaints about its atrocious cleanliness.",
    "authoritative": "The agency issued an authoritative explanation of the new rule.",
    "autonomous": "The new system operates as an autonomous unit without constant supervision.",
    "banishment": "The story begins with the hero’s banishment from the kingdom.",
    "benevolence": "Her benevolence was evident in the time she devoted to helping others.",
    "bourgeois": "The novel satirizes the aspirations of a bourgeois family.",
    "cavalier": "His cavalier attitude toward safety angered the inspector.",
    "celerity": "The team responded with unexpected celerity to the urgent request.",
    "celestial": "The telescope revealed several celestial objects.",
    "chivalrous": "He performed a chivalrous act by helping the stranger without expecting thanks.",
    "circumstantial": "The prosecution relied largely on circumstantial evidence.",
    "civility": "Despite their disagreement, both participants maintained civility.",
    "clandestine": "They held a clandestine meeting away from the public eye.",
    "clemency": "The prisoner petitioned the governor for clemency.",
    "coalesce": "Several smaller groups began to coalesce into one organization.",
    "cognizance": "The manager took cognizance of the repeated accessibility complaints.",
    "commendation": "She received a commendation for her careful work.",
    "commensurate": "The salary should be commensurate with the responsibilities of the role.",
    "compassionate": "The nurse offered a compassionate response to the worried family.",
    "complacency": "Complacency made the team overlook a preventable mistake.",
    "compulsion": "He felt a compulsion to check the lock repeatedly.",
    "conciliate": "The mediator tried to conciliate the two angry parties.",
    "conciliatory": "Her conciliatory remarks helped calm the tense meeting.",
    "concurrent": "The project involved two concurrent inspections.",
    "confiscate": "The officer had authority to confiscate the prohibited items.",
    "confluence": "A confluence of factors led to the unexpected result.",
    "congenial": "The small team enjoyed a congenial working atmosphere.",
    "connivance": "The scheme succeeded through the connivance of several insiders.",
    "consolidate": "The department will consolidate reports from several offices.",
    "consummate": "She was a consummate professional even under intense pressure.",
    "contiguous": "The two parcels were contiguous and shared a boundary.",
    "contrive": "The characters contrive an elaborate plan to escape.",
    "conversant": "She was conversant with the relevant regulations.",
    "convoluted": "The convoluted instructions made a simple task seem difficult.",
    "cosmopolitan": "The city’s cosmopolitan population speaks dozens of languages.",
    "cumulative": "The cumulative effect of many small delays became substantial.",
    "deceptive": "The advertisement was deceptive because it omitted key conditions.",
    "decrepit": "The decrepit building required major structural repairs.",
    "degradation": "Years of neglect caused the degradation of the wooden fence.",
    "dejection": "His dejection was apparent after the proposal was rejected.",
    "deplorable": "The inspector found the building in deplorable condition.",
    "deranged": "The deranged character spoke as though he were being pursued.",
    "derogation": "The change was viewed as a derogation of established rights.",
    "designation": "The official designation determines which department handles the matter.",
    "despicable": "The committee condemned the despicable treatment of the workers.",
    "despondent": "She felt despondent after receiving several rejections.",
    "destitute": "The flood left many families destitute.",
    "detriment": "The delay worked to the detriment of the people awaiting help.",
    "dilapidated": "The dilapidated porch needed complete reconstruction.",
    "diligence": "Her diligence helped catch the error before the deadline.",
    "diminutive": "The diminutive cabin was barely large enough for one person.",
    "discernible": "There was no discernible difference between the two recordings.",
    "disconcert": "The sudden silence seemed to disconcert the speaker.",
    "discredit": "The contradictory evidence could discredit the witness.",
    "discriminate": "The test was designed to discriminate between similar sounds.",
    "disdainful": "He made a disdainful remark about the proposal.",
    "disgruntled": "The disgruntled employee submitted a formal complaint.",
    "disreputable": "The article warned readers about a disreputable lender.",
    "disrepute": "The scandal brought the organization into disrepute.",
    "distortion": "The poor microphone caused distortion in the recording.",
    "equitable": "The committee wanted an equitable distribution of resources.",
    "escapade": "The children’s late-night escapade ended when their parents called.",
    "etiquette": "The training covered etiquette for professional correspondence.",
    "extravagant": "The extravagant purchase exceeded the planned budget.",
    "extricate": "The workers had to extricate the vehicle from the mud.",
    "flagrant": "The report documented a flagrant violation of safety procedures.",
    "forestall": "They inspected the roof to forestall more serious water damage.",
    "formulate": "The group met to formulate a practical plan.",
    "fortitude": "She showed fortitude through months of difficult rehabilitation.",
    "grotesque": "The statue had a grotesque face with exaggerated features.",
    "groundless": "The rumor was groundless and unsupported by evidence.",
    "homogeneous": "The sample was too homogeneous to represent the wider population.",
    "illusory": "The apparent savings were illusory after hidden fees were included.",
    "immutable": "The policy was treated as immutable even though conditions had changed.",
    "imperturbable": "The instructor remained imperturbable despite repeated interruptions.",
    "impoverished": "The program provides assistance to impoverished households.",
    "impudence": "Her impudence surprised the normally patient supervisor.",
    "incisive": "The editor offered incisive feedback on the weak reasoning.",
    "incontestable": "The video provided incontestable evidence of the sequence of events.",
    "incumbent": "It is incumbent on supervisors to respond to reported hazards.",
    "infallible": "No measurement system is infallible.",
    "inimical": "The proposal was inimical to the agency’s commitment to open access.",
    "sanguine": "Despite the setbacks, she remained sanguine about the project’s outcome.",
    "obdurate": "The obdurate official refused to consider any exceptions.",
    "recalcitrant": "The recalcitrant student repeatedly ignored the teacher’s instructions.",
    "circumspect": "She was circumspect about sharing information before it was verified.",
    "ennui": "A sense of ennui settled over him during the long, uneventful summer.",
    "abstruse": "The textbook’s abstruse explanation confused even advanced students.",
    "ebullient": "Her ebullient personality lifted the mood of the entire team.",
    "garrulous": "The garrulous passenger talked throughout the long journey.",
    "invective": "The debate deteriorated into invective rather than constructive criticism.",
    "mendacious": "The witness gave a mendacious account that contradicted the video evidence.",
    "acerbic": "His acerbic response made the conversation more hostile.",
    "acolyte": "The political leader was surrounded by loyal acolytes.",
    "aegis": "The program operated under the aegis of the national organization.",
    "alacrity": "She accepted the opportunity with surprising alacrity.",
    "anodyne": "The committee issued an anodyne statement that avoided controversy.",
    "approbation": "Her work earned the approbation of several respected colleagues.",
    "arcane": "The procedure depended on arcane rules that few employees understood.",
    "asperity": "There was a noticeable asperity in his voice during the argument.",
    "assiduous": "Her assiduous preparation helped her pass the difficult examination.",
    "avuncular": "The older mentor had an avuncular manner with new employees.",
    "bellicose": "The bellicose speech raised fears that negotiations would collapse.",
    "bombastic": "The candidate’s bombastic promises lacked practical detail.",
    "bromide": "The speech offered a bromide about hard work instead of a real solution.",
    "cacophony": "A cacophony of horns filled the crowded intersection.",
    "canard": "The article repeated the canard that the new policy had already been approved.",
    "chicanery": "The investigation uncovered financial chicanery in the bidding process.",
    "cogitate": "She needed time to cogitate before making a major decision.",
    "compunction": "He felt no compunction about taking credit for someone else’s work.",
    "cupidity": "His cupidity led him to conceal the fees from customers.",
    "dilatory": "The court criticized the company’s dilatory response to the complaint.",
    "ersatz": "The restaurant served an ersatz cheese made entirely from vegetable oil.",
    "esoteric": "The lecture covered an esoteric branch of ancient philosophy.",
    "expiate": "He volunteered for years in an effort to expiate his earlier wrongdoing.",
    "extirpate": "The campaign aimed to extirpate the invasive plant from the park.",
    "fecund": "The fecund soil supported a remarkably diverse range of crops.",
    "fulminate": "The commentator continued to fulminate against the decision.",
    "heterodox": "Her heterodox ideas challenged the accepted practices of the field.",
    "hirsute": "The hirsute character had a thick beard and shaggy hair.",
    "hubris": "His hubris led him to ignore repeated warnings from experts.",
    "inchoate": "The proposal was still inchoate and lacked specific steps.",
    "ineffable": "The experience inspired an ineffable sense of wonder.",
    "insouciant": "He offered an insouciant shrug when asked about the missed deadline.",
    "jejune": "The critique was jejune and failed to address the substantive issues.",
    "lachrymose": "The film’s lachrymose ending left the audience in tears.",
    "legerdemain": "The magician’s legerdemain made the coin appear to vanish.",
    "lugubrious": "The song’s lugubrious melody suited the funeral scene.",
    "malapropism": "Calling a “pineapple” a “pinnacle” can be a malapropism.",
    "mordant": "Her mordant humor exposed the absurdity of the rule.",
    "munificent": "A munificent donor funded the new public library.",
    "numinous": "The cathedral’s silence gave the visit a numinous quality.",
    "opprobrium": "The fraud brought public opprobrium upon the company.",
    "parsimony": "The board’s parsimony prevented necessary maintenance.",
    "peccadillo": "He treated the minor scheduling error as a peccadillo.",
    "pellucid": "The explanation was pellucid and easy to follow.",
    "perfidious": "The perfidious ally secretly betrayed the group’s plans.",
    "prolix": "The prolix memo buried its main recommendation in unnecessary detail.",
    "quotidian": "Preparing breakfast was part of her quotidian routine.",
    "raconteur": "The charming raconteur entertained everyone with colorful stories.",
    "redolent": "The kitchen was redolent of freshly baked bread.",
    "risible": "The claim was so implausible that it seemed risible.",
    "salubrious": "The cool air and walking trails created a salubrious environment.",
    "saturnine": "His saturnine expression made it difficult to tell whether he approved.",
    "scintilla": "There was not a scintilla of evidence to support the accusation.",
    "simulacrum": "The display used a simulacrum of the original historical artifact.",
    "solipsism": "The essay explores solipsism and the problem of knowing other minds.",
    "somnolent": "The room grew somnolent during the slow afternoon lecture.",
    "synecdoche": "Using “wheels” to refer to a car is an example of synecdoche.",
    "timorous": "The timorous speaker hesitated before addressing the audience.",
    "truculent": "The truculent customer threatened staff over a minor delay.",
    "verisimilitude": "The historical details gave the novel a strong sense of verisimilitude.",
    "vociferous": "A vociferous group of residents protested the proposed road.",
    "winsome": "Her winsome smile helped put the nervous guests at ease.",
    "distribution": "The relief agency coordinated the distribution of water to the flooded neighborhoods.",
    "conclusion": "After reviewing the invoices, the auditor reached a different conclusion.",
    "attain": "She worked for years to attain the certification required for the position.",
    "contrast": "The report contrasts last year's spending with this year's projected costs.",
    "maintain": "The technician will maintain the equipment to prevent unexpected breakdowns.",
    "difference": "A small difference in interest rates can change the total cost of a loan.",
    "obtain": "You must obtain written permission before entering the property.",
    "affect": "The road closure will affect deliveries throughout the neighborhood.",
    "capacity": "The auditorium has a seating capacity of six hundred.",
    "proposal": "The committee approved a proposal to extend library hours.",
    "frame": "He tried to frame the disagreement as a problem they could solve together.",
    "singular": "Her singular achievement was developing a vaccine under difficult conditions.",
    "diplomacy": "Years of diplomacy helped the neighboring countries settle their border dispute.",
    "preserve": "The museum uses special lighting to preserve the fragile manuscripts.",
    "criticism": "The director listened carefully to criticism of the new policy.",
    "distinguish": "The witness could not distinguish the two vehicles in the darkness.",
    "exception": "Everyone must wear a badge, with no exception for temporary staff.",
    "judgment": "The manager used sound judgment when deciding whether to postpone the launch.",
    "recognition": "Her volunteer work earned recognition from the city council.",
    "appropriate": "A quiet conversation would be more appropriate than a public accusation.",
    "argument": "His argument rested on evidence collected from three independent studies.",
    "concern": "The inspector expressed concern about cracks in the foundation.",
    "interval": "The buses arrive at fifteen-minute intervals during rush hour.",
    "passive": "She remained passive during the discussion and offered no suggestions.",
    "responsible": "The contractor is responsible for repairing any damage caused during installation.",
    "assumption": "Their budget relied on the assumption that fuel prices would remain stable.",
    "challenge": "Learning to navigate the unfamiliar building was a demanding challenge.",
    "conceal": "The seller tried to conceal water damage behind a fresh coat of paint.",
    "indicate": "The flashing light will indicate when the battery needs charging.",
    "retain": "Please retain a copy of the receipt for your records.",
    "suitable": "The narrow staircase was not suitable for moving the heavy refrigerator.",
    "dependent": "The project's success is dependent on the permit arriving by Friday.",
    "draft": "The attorney prepared a draft of the agreement for review.",
    "hostile": "The conversation became hostile after several personal accusations.",
    "regulation": "A new safety regulation requires handrails on both sides of the stairway.",
    "uncertain": "The surveyor was uncertain where the original property line ended.",
    "compare": "We compared three insurance quotes before choosing a policy.",
    "consist": "The committee will consist of five employees from different departments.",
    "ownership": "The deed confirms ownership of the property.",
    "reasonable": "The mechanic offered a reasonable estimate for the repairs.",
    "consequence": "One consequence of missing the deadline was a late fee.",
    "boundary": "A wooden fence marked the boundary between the two yards.",
    "description": "The online description omitted the basement's water damage.",
    "effective": "The new reminder system proved effective at reducing missed appointments.",
    "experiment": "The students designed an experiment to measure how temperature affects growth.",
    "probable": "Rain is probable tomorrow, according to the latest forecast.",
    "decline": "Sales began to decline after the store reduced its hours.",
    "exact": "The contractor asked for the exact dimensions of the opening.",
    "irony": "There was irony in the fire station losing power during a safety inspection.",
    "outline": "She wrote an outline before drafting the full report.",
    "finance": "They decided to finance the purchase rather than pay the entire cost upfront.",
    "narrative": "The witness gave a detailed narrative of the events leading up to the collision.",
    "remedy": "Replacing the faulty valve was the simplest remedy for the leak.",
    "signal": "She raised her hand to signal that she needed assistance.",
    "assure": "The supervisor tried to assure the staff that the schedule would not change.",
    "correspondence": "The investigator reviewed correspondence between the supplier and the agency.",
    "subtle": "A subtle change in his tone suggested that he was becoming impatient.",
    "framework": "The team adopted a framework for evaluating risks consistently.",
    "hostility": "Open hostility between the neighbors made negotiation difficult.",
    "respectful": "Even when they disagreed, their discussion remained respectful.",
    "tense": "The atmosphere grew tense as the jury returned to the courtroom.",
    "efficient": "The redesigned process is more efficient because it eliminates duplicate entries.",
    "examine": "The physician will examine the injury before recommending treatment.",
    "sincere": "Her sincere apology acknowledged the harm without making excuses.",
    "logical": "It is logical to inspect the roof before replacing the damaged ceiling.",
    "contradiction": "There was a clear contradiction between his written statement and his testimony.",
    "persist": "If the symptoms persist, the doctor recommended another appointment.",
    "reliable": "The old truck was reliable despite its high mileage.",
    "distinction": "The contract makes a distinction between routine maintenance and emergency repairs.",
    "inquire": "She called the office to inquire about the application deadline.",
    "limitation": "A major limitation of the study was its small sample size.",
    "poetic": "The novel's poetic language gives ordinary scenes an unusual beauty.",
    "protest": "Residents gathered to protest the proposed demolition.",
    "threshold": "The grant is available only to households below the income threshold.",
    "acquire": "The company plans to acquire a smaller competitor next year.",
    "adopt": "The board voted to adopt a revised code of conduct.",
    "expectation": "There was an expectation that all employees would arrive on time.",
    "revision": "The second revision corrected several mistakes in the original plan.",
    "compliance": "The building failed its inspection because it was not in compliance with fire codes.",
    "motive": "Investigators searched for a motive behind the unusual transaction.",
    "parallel": "Two parallel investigations examined the same incident from different angles.",
    "reflect": "The final report should reflect the feedback received from residents.",
    "uncertainty": "Uncertainty about the closing date made planning the move difficult.",
    "accomplish": "The volunteers accomplished more in one weekend than expected.",
    "accurate": "The scale must be accurate to the nearest gram.",
    "confirm": "Please confirm your appointment by replying to the email.",
    "fragment": "A fragment of broken glass was found near the doorway.",
    "justification": "The agency requested a written justification for the unusual expense.",
    "proposition": "The lecturer challenged the proposition that higher prices always mean better quality.",
    "variable": "The researchers changed only one variable at a time.",
    "continual": "The continual ringing of the phone interrupted the meeting.",
    "equivalent": "The two qualifications are considered equivalent by the licensing board.",
    "sustain": "The nonprofit needs steady donations to sustain its services.",
    "warrant": "The evidence did not warrant such a severe disciplinary action.",
    "acquisition": "The company's acquisition of a regional supplier reduced delivery times.",
    "alternative": "Taking the train offered an alternative to driving through traffic.",
    "deduce": "From the muddy footprints, the detective deduced that someone entered through the back door.",
    "ensure": "Double-check the address to ensure the package reaches the right person.",
    "exclude": "The estimate excludes the cost of replacing the damaged flooring.",
    "persuade": "She used inspection photographs to persuade the seller to make repairs.",
    "precision": "The machinist measured the part with enough precision to fit the narrow slot.",
    "resolve": "A brief meeting helped resolve the misunderstanding.",
    "bargain": "They managed to bargain for a lower price on the used equipment.",
    "certainty": "No one could say with certainty when the bridge would reopen.",
    "contradict": "The laboratory results contradict the witness's claim.",
    "deceive": "The advertisement was designed to deceive buyers about the product's age.",
    "define": "The agreement must define who is responsible for each expense.",
    "estimate": "The plumber gave an estimate before beginning the work.",
    "guidance": "New employees received guidance on handling sensitive records.",
    "indirect": "Her indirect response avoided answering the question plainly.",
    "intent": "The memo explained the intent behind the new policy.",
    "model": "The scientists built a model to predict how the storm would move.",
    "obscure": "A dense patch of fog began to obscure the road signs.",
    "output": "The factory increased its weekly output without hiring additional workers.",
    "perception": "His perception of the meeting differed sharply from his colleagues' accounts.",
    "precise": "The instructions specify a precise amount of medicine.",
    "presume": "We should not presume the room is empty merely because the lights are off.",
    "sequence": "Follow the steps in the correct sequence to install the software.",
    "transition": "The transition to a new payment system took several weeks.",
    "antecedent": "In the sentence, the pronoun 'she' refers to its antecedent, Maria.",
    "apologize": "He called to apologize for arriving late.",
    "apology": "Her apology included a promise to correct the mistake.",
    "imply": "The warning seems to imply that the bridge is unsafe in heavy rain.",
    "probability": "The forecast gives a high probability of thunderstorms after noon.",
    "logic": "The engineer explained the logic behind the unusual design.",
    "qualification": "The position requires a specific technical qualification.",
    "vivid": "He gave a vivid description of the sunset over the mountains.",
    "preference": "She expressed a preference for written instructions over phone calls.",
    "valid": "The parking permit remains valid until the end of the month.",
    "constraint": "A strict budget constraint forced the team to simplify its plans.",
    "hypothesis": "Her hypothesis was that plants grow faster under blue light.",
    "verse": "The poet read the final verse aloud to the audience.",
    "achieve": "The team worked together to achieve its yearly goal.",
    "register": "You must register before attending the training session.",
    "scope": "The project's scope includes electrical repairs but not landscaping.",
    "analogy": "The instructor used an analogy between a household budget and a company's cash flow.",
    "assertion": "The witness's assertion was not supported by any documents.",
    "forecast": "The latest forecast predicts colder temperatures next week.",
    "prose": "The author chose straightforward prose rather than elaborate poetic language.",
    "variance": "The analyst investigated the variance between projected and actual spending.",
    "approximate": "The architect gave an approximate cost before the final drawings were complete.",
    "brace": "Workers installed a steel brace to support the damaged beam.",
    "canon": "The professor explained why the novel is considered part of the literary canon.",
    "coherence": "The essay lacked coherence because its paragraphs changed topics abruptly.",
    "explicit": "The lease contains an explicit prohibition against smoking indoors.",
    "maxim": "Her favorite maxim was to measure twice and cut once.",
    "objective": "The committee's objective was to reduce processing delays.",
    "statute": "A state statute determines how much notice landlords must provide.",
    "subjective": "Judging whether a painting is beautiful is largely subjective.",
    "validity": "Researchers questioned the validity of conclusions based on incomplete data.",
    "dependency": "The software upgrade has a dependency on a newer operating system.",
    "infer": "From the lights and voices inside, they inferred that the house was occupied.",
    "perspective": "Traveling abroad gave her a different perspective on everyday customs.",
    "persuasion": "His gentle persuasion convinced the family to reconsider.",
    "relevant": "Only evidence relevant to the dispute was admitted.",
    "requirement": "A background check is a requirement for the position.",
    "solicitation": "The agency published a solicitation inviting companies to submit bids.",
    "accountability": "Clear accountability helps ensure that mistakes are corrected.",
    "ambiguity": "The ambiguity of the instruction caused two teams to interpret it differently.",
    "clarify": "The manager asked her to clarify which deadline applied.",
    "competence": "His competence as a mechanic became obvious when he diagnosed the problem quickly.",
    "correlation": "The study found a correlation between sleep duration and concentration.",
    "criterion": "Price was only one criterion used to evaluate the proposals.",
    "essay": "She wrote an essay comparing two interpretations of the novel.",
    "implicit": "The request carried an implicit expectation of confidentiality.",
    "inference": "Her inference was reasonable, but it still needed confirmation.",
    "lucid": "The teacher gave a lucid explanation of a difficult mathematical concept.",
    "priority": "Repairing the broken stair was the highest priority.",
    "rhyme": "The poet ended each pair of lines with a rhyme.",
    "similarity": "The two paintings share a striking similarity in color and composition.",
    "slash": "A slash separates the two alternatives in the printed instructions.",
    "allocation": "The budget allocation for repairs increased after the inspection.",
    "articulate": "She could articulate her concerns without raising her voice.",
    "assess": "The inspector returned to assess the damage after the storm.",
    "capability": "The new software gives the team the capability to process more records.",
    "collaboration": "Collaboration between the engineers and designers prevented costly mistakes.",
    "consensus": "After hours of debate, the committee finally reached a consensus.",
    "evaluate": "The manager will evaluate each proposal against the same criteria.",
    "incentive": "The store offered a discount as an incentive for customers to sign up.",
    "metaphor": "Calling time a thief is a metaphor for how quickly life passes.",
    "motif": "The repeated image of a locked door became a central motif in the novel.",
    "optional": "The workshop is optional for employees who already completed the training.",
    "paraphrase": "She was asked to paraphrase the paragraph in her own words.",
    "premise": "The argument begins with the premise that every person deserves equal treatment.",
    "quantitative": "The study used quantitative measurements such as weight and temperature.",
    "reliability": "The technicians tested the reliability of the backup generator.",
    "tactic": "Changing the subject was a tactic to avoid the difficult question.",
    "baseline": "The first measurement established a baseline for future comparisons.",
    "benchmark": "The team used last year's performance as a benchmark.",
    "causation": "A correlation alone does not establish causation.",
    "citation": "The student added a citation identifying the source of the quotation.",
    "connotation": "The word 'slim' has a more positive connotation than 'skinny' in some contexts.",
    "coordination": "Careful coordination kept the three construction crews from blocking one another.",
    "criteria": "The review panel published the criteria it would use to select the winner.",
    "deliverable": "The final report was the main deliverable under the contract.",
    "denotation": "The denotation of 'home' is a place where someone lives, though it may suggest much more.",
    "eligibility": "Applicants must demonstrate eligibility before receiving benefits.",
    "empathy": "Her empathy helped the anxious caller feel understood.",
    "escalation": "The argument's escalation prompted the supervisor to intervene.",
    "governance": "The nonprofit revised its governance rules to clarify board responsibilities.",
    "milestone": "Completing the foundation was a major milestone in the project.",
    "procurement": "The agency's procurement process requires competitive bidding.",
    "qualitative": "The interviews yielded qualitative insights into customer experiences.",
    "rationale": "The decision memo explained the rationale for choosing the more expensive option.",
    "stakeholder": "Residents are important stakeholders in the proposed transit project.",
    "syntax": "A misplaced comma changed the syntax of the sentence.",
    "workflow": "The redesigned workflow removed two unnecessary approval steps.",
    "predict": "Meteorologists predict heavy snowfall in the mountains tonight.",
    "productivity": "The quieter workspace improved the team's productivity.",
    "qualify": "Applicants must qualify for the loan before signing a purchase agreement.",
    "quotation": "The article opened with a quotation from the scientist's speech.",
    "revise": "The editor asked her to revise the introduction for clarity.",
    "somber": "The crowd grew somber as the names of the victims were read aloud.",
    "synthesis": "Her thesis offered a synthesis of findings from several smaller studies.",
    "thesis": "The student defended her thesis before a panel of professors.",
    "verify": "The clerk called the bank to verify the account information.",
    "activate": "Press the green button to activate the emergency alarm.",
    "affiliation": "His affiliation with the university allowed him to use its library.",
    "allegory": "The story is an allegory about the dangers of unchecked power.",
    "analyst": "The financial analyst compared revenue projections with actual sales.",
    "authenticity": "Experts questioned the authenticity of the newly discovered letter.",
    "availability": "The website shows the availability of appointments for next week.",
    "bracket": "The editor placed the inserted explanation in square brackets.",
    "calculus": "She studied calculus to better understand changing rates of motion.",
    "candor": "Her candor about the budget shortfall earned the board's respect.",
    "clarification": "The confusing policy prompted a request for clarification.",
    "clarity": "The revised instructions brought much-needed clarity to the process.",
    "classify": "The librarian will classify each book by subject.",
    "commitment": "Finishing the program required a long-term commitment.",
    "comprise": "The orchestra comprises musicians from ten countries.",
    "conceptual": "The team sketched a conceptual design before preparing detailed plans.",
    "corroborate": "Phone records corroborate the witness's account of the call.",
    "credibility": "The journalist's credibility suffered after repeated factual errors.",
    "critique": "The instructor offered a detailed critique of the student's draft.",
    "denouement": "In the novel's denouement, the detective explains how the mystery was solved.",
    "disclosure": "The buyer requested full disclosure of known structural problems.",
    "documentation": "Keep documentation showing when the repairs were completed.",
    "evaluation": "The program's evaluation included both surveys and performance data.",
    "fallacy": "The claim that one event caused another merely because it came first is a fallacy.",
    "feedback": "The testers gave feedback about confusing navigation buttons.",
    "guideline": "The agency issued a guideline for handling sensitive requests.",
    "implementation": "Implementation of the new system began after employee training.",
    "indicator": "Rising attendance was an indicator of growing interest in the program.",
    "literal": "The sign's literal meaning was clear, even though its tone was sarcastic.",
    "mandate": "The new law gives the agency a mandate to inspect the facilities.",
    "manipulate": "The researcher refused to manipulate the data to fit a preferred conclusion.",
    "mediate": "A neutral volunteer offered to mediate the dispute between neighbors.",
    "memoir": "In her memoir, she described growing up in a small coastal town.",
    "methodology": "The paper explains the methodology used to collect the survey responses.",
    "motivation": "Her motivation for learning Spanish was to speak with her grandparents.",
    "operable": "The emergency exit must remain operable during a power outage.",
    "orientation": "New employees attended an orientation on their first day.",
    "oversight": "The committee provides oversight of the program's spending.",
    "polemic": "His book was a fierce polemic against the proposed reforms.",
    "probation": "The employee remained on probation for the first six months.",
    "pronunciation": "The dictionary includes a recording of the word's pronunciation.",
    "questionnaire": "Participants completed a questionnaire about their commuting habits.",
    "redundancy": "Removing unnecessary repetition reduced redundancy in the instructions.",
    "referral": "Her doctor provided a referral to a specialist.",
    "refute": "The scientist used new evidence to refute the old theory.",
    "relevance": "The attorney questioned the relevance of the photograph to the case.",
    "responsive": "The website's responsive layout works on both phones and desktop monitors.",
    "scenario": "The training included a scenario involving a difficult customer.",
    "semantic": "The two sentences are grammatically different but have similar semantic content.",
    "seminar": "She attended a seminar on writing effective grant proposals.",
    "sensitivity": "The test has enough sensitivity to detect very small changes.",
    "skepticism": "His skepticism about the claim grew when the seller refused an inspection.",
    "specification": "The manufacturer listed the motor's electrical specification in the manual.",
    "specify": "Please specify which model you want before placing the order.",
    "abbreviation": "The abbreviation 'Dr.' stands for 'Doctor.'",
    "abductive": "The detective used abductive reasoning to choose the most plausible explanation.",
    "accounting": "The nonprofit's accounting records showed every grant expenditure.",
    "acronym": "NASA is an acronym formed from the agency's name.",
    "amortization": "The loan's amortization schedule shows how each payment reduces the balance.",
    "ampersand": "The company used an ampersand in its name instead of spelling out 'and.'",
    "analytic": "Her analytic approach helped isolate the cause of the production error.",
    "analytics": "The retailer uses analytics to identify which products sell fastest.",
    "annotation": "She added an annotation explaining the unusual phrase in the manuscript.",
    "aphorism": "His favorite aphorism was that actions speak louder than words.",
    "archetype": "The wandering hero is a familiar archetype in mythology.",
    "asterisk": "An asterisk beside the price indicates that restrictions apply.",
    "attribution": "Proper attribution identifies who created the photograph.",
    "auditory": "The interface provides an auditory cue when an error occurs.",
    "backlog": "The office hired temporary staff to clear its backlog of applications.",
    "barrier": "A locked gate created a barrier to wheelchair access.",
    "bibliography": "The book's bibliography lists the sources the author consulted.",
    "bottleneck": "A slow approval step became the bottleneck in the entire process.",
    "briefing": "The team received a briefing on the new security procedures.",
    "capitalization": "The editor corrected the capitalization of the names in the headline.",
    "cashflow": "Uneven cashflow made it difficult for the company to pay suppliers on time.",
    "categorize": "The assistant will categorize the requests by urgency.",
    "certification": "She earned a certification after passing the professional examination.",
    "charter": "The committee's charter describes its purpose and authority.",
    "closeout": "Contract closeout began after the final deliverables were accepted.",
    "cohesion": "Transitions between the paragraphs improved the essay's cohesion.",
    "collaborate": "Engineers and architects must collaborate to complete the design.",
    "competency": "The assessment measures competency in spreadsheet formulas.",
    "concision": "The editor valued concision and removed several unnecessary sentences.",
    "conformance": "The inspection confirmed conformance with the published standard.",
    "connote": "In this context, the word 'frugal' may connote good judgment rather than deprivation.",
    "contest": "The losing bidder decided to contest the award.",
    "contingency": "The budget includes a contingency for unexpected repair costs.",
    "continue": "The roadwork will continue through the end of the month.",
    "contracting": "The agency's contracting team reviewed the vendor's proposal.",
    "counterargument": "She acknowledged the counterargument before explaining why she disagreed.",
    "counterexample": "One counterexample was enough to disprove the claim that all birds can fly.",
    "counteroffer": "The seller rejected the first bid but accepted the buyer's counteroffer.",
    "decimal": "The measurement was rounded to two decimal places.",
    "deescalate": "The supervisor spoke softly to deescalate the confrontation.",
    "defensiveness": "His defensiveness made it hard for him to hear constructive criticism.",
    "deployment": "The software deployment introduced the new features to all users.",
    "determiner": "In the phrase 'those houses,' the word 'those' is a determiner.",
    "discretionary": "The department postponed discretionary travel to protect its budget.",
    "dismissive": "Her dismissive remark made the employee reluctant to raise another concern.",
    "dissertation": "The doctoral candidate spent three years researching her dissertation.",
    "doctoral": "He entered a doctoral program after completing his master's degree.",
    "economics": "The course in economics examined how prices affect consumer behavior.",
    "ellipsis": "The editor inserted an ellipsis to show that some words were omitted.",
    "empathize": "It was easier to empathize with the caller after hearing her experience.",
    "endnote": "The source citation appeared as an endnote at the back of the chapter.",
    "enumerate": "The report will enumerate the steps required for certification.",
    "equivocation": "His equivocation about the deadline made the team suspect he was hiding a delay.",
    "etymology": "Studying the word's etymology revealed its Latin origins.",
    "except": "Everyone attended the meeting except the regional manager.",
    "excepted": "The policy excepted emergency purchases from the usual approval process.",
    "excerpt": "The teacher read an excerpt from the opening chapter.",
    "exemplify": "Her careful recordkeeping exemplifies professional diligence.",
    "expected": "The expected delivery date is next Wednesday.",
    "extrapolate": "The analyst warned against extrapolating the results of a small survey to the entire country.",
    "facilitation": "Her facilitation kept the discussion focused and productive.",
    "feasibility": "The engineers completed a feasibility study before starting construction.",
    "fewer": "There were fewer complaints after the website redesign.",
    "finding": "The inspection's most serious finding concerned exposed electrical wiring.",
    "footnote": "A footnote identified the source of the historical claim.",
    "foreshadowing": "The recurring sound of footsteps was foreshadowing of the later attack.",
    "framing": "The framing of the question influenced how respondents answered.",
    "fulltime": "She accepted a fulltime position after several months of temporary work.",
    "funding": "The library delayed renovations until additional funding became available.",
    "generalize": "You cannot generalize about all drivers from one unpleasant encounter.",
    "hyphen": "A hyphen connects the words in 'well-known author.'",
    "immanent": "The philosopher described divinity as immanent in the natural world.",
    "include": "The rental agreement should include details about maintenance responsibilities.",
    "initialism": "FBI is an initialism because its letters are spoken separately.",
    "interpolate": "The scientist used neighboring measurements to interpolate a missing value.",
    "inventory": "The shop counted its inventory before ordering more supplies.",
    "invoice": "The contractor sent an invoice after completing the installation.",
    "landmark": "The courthouse is a familiar landmark in the town square.",
    "leverage": "The company used its large customer base to leverage a better price.",
    "listening": "Active listening helped her understand why the customer was upset.",
    "mitigation": "Installing drainage channels was part of the flood-risk mitigation plan.",
    "modifier": "In 'extremely cold,' the word 'extremely' is a modifier.",
    "morphology": "The linguist studied the morphology of words formed with prefixes.",
    "notation": "The engineer used a special notation to label the circuit diagram.",
    "nuance": "Her response acknowledged the nuance of a situation with competing priorities.",
    "offeror": "Each offeror must submit a complete price proposal before the deadline.",
    "optimize": "The team adjusted the route to optimize delivery times.",
    "orthography": "The course examines English orthography and its unusual spelling rules.",
    "parallelism": "The editor used parallelism to give the three recommendations a consistent structure.",
    "parentheses": "The author put the explanation in parentheses so it would not interrupt the sentence.",
    "parenthesis": "A parenthesis added extra information about the date of the event.",
    "parttime": "He worked parttime while completing his degree.",
    "patronize": "Please do not patronize experienced employees by explaining things they already know.",
    "patronizing": "The patronizing tone made the audience feel underestimated.",
    "perceivable": "Screen-reader labels make information perceivable to users who cannot see the screen.",
    "pertinent": "The investigator asked only questions pertinent to the complaint.",
    "phonology": "The linguistics class examined the phonology of regional dialects.",
    "plagiarism": "Copying the article without credit was plagiarism.",
    "plausibility": "Investigators questioned the plausibility of an alibi that changed three times.",
    "plural": "The plural of 'mouse' is 'mice.'",
    "possessive": "The apostrophe in 'teacher's desk' marks the possessive form.",
    "predictive": "The hospital tested a predictive model for anticipating patient demand.",
    "preposition": "In 'under the table,' the word 'under' is a preposition.",
    "prerequisite": "College algebra is a prerequisite for the advanced statistics course.",
    "prescriptive": "The style guide gives prescriptive rules for punctuation.",
    "pronoun": "In 'she opened the door,' the word 'she' is a pronoun.",
    "proofread": "She took ten minutes to proofread the email before sending it.",
    "proofreading": "Careful proofreading caught three missing commas in the report.",
    "publisher": "The publisher announced a new edition of the textbook.",
    "qualified": "Only qualified electricians may work on the main panel.",
    "qualifier": "The word 'usually' is a qualifier that makes the statement less absolute.",
    "quantify": "The team tried to quantify the benefits of the training program.",
    "randomize": "Researchers used software to randomize the order of the survey questions.",
    "rapport": "The counselor built rapport by listening without interrupting.",
    "rationalize": "He tried to rationalize his mistake instead of admitting it.",
    "reasoning": "The judge asked the attorney to explain the reasoning behind the request.",
    "rebut": "She used the official records to rebut the accusation.",
    "rebuttal": "His rebuttal addressed each of the opposing claims in turn.",
    "receivable": "The unpaid invoice remained an account receivable until the customer paid.",
    "reframe": "She helped reframe the conflict as a scheduling problem rather than a personal attack.",
    "refutation": "The published study offered a detailed refutation of the earlier theory.",
    "regression": "The analyst used regression to estimate how income relates to spending.",
    "replicate": "The researchers were unable to replicate the surprising result.",
    "replication": "Independent replication strengthened confidence in the findings.",
    "responsiveness": "The reviewers measured the contractor's responsiveness to each requirement.",
    "runon": "The editor divided the runon sentence into two clearer sentences.",
    "sampling": "Random sampling reduced the risk of selecting only satisfied customers.",
    "scholarly": "The paper cited several scholarly articles on the topic.",
    "semantics": "A debate about the semantics of 'fairness' delayed the vote.",
    "simplified": "The simplified instructions helped new users complete the form.",
    "skeptical": "The accountant was skeptical of the unusually large deduction.",
    "spacing": "The editor increased the line spacing to improve readability.",
    "specialize": "The firm decided to specialize in historic-home restoration.",
    "stewardship": "Responsible stewardship of public funds requires careful oversight.",
    "subheading": "A clear subheading introduced the section on repair costs.",
    "subpart": "The lawyer cited a specific subpart of the regulation.",
    "surveillance": "Security cameras provided surveillance of the loading area.",
    "synthesize": "Students must synthesize information from several sources into one argument.",
    "taxonomy": "The biologist developed a taxonomy for classifying the newly discovered organisms.",
    "throughput": "The factory improved throughput by reducing time between production stages.",
    "tradeoff": "The tradeoff for a lower price was a longer delivery time.",
    "transparency": "The agency published its spending records to improve transparency.",
    "unlikely": "It is unlikely that the train will arrive early during the storm.",
    "validate": "The technician will validate the test results with a second instrument.",
    "validation": "Independent validation showed that the calculator produced accurate totals.",
    "verbosity": "The instructions suffered from verbosity that obscured the key steps.",
    "vernacular": "The novelist used the local vernacular to make the dialogue believable.",
    "vignette": "The biography begins with a short vignette about the author's childhood.",
    "workload": "The nurse's workload increased sharply during flu season.",
    "aggression": "The coach warned that aggression toward officials would not be tolerated.",
    "amenable": "The landlord was amenable to repairing the fence before move-in.",
    "attainment": "Her attainment of the highest certification took years of study.",
    "catastrophe": "The earthquake caused a catastrophe across the region.",
    "cautious": "He remained cautious about investing in an unfamiliar company.",
    "clamor": "The clamor outside the courthouse could be heard from the courtroom.",
    "commence": "Construction will commence after the permits are approved.",
    "comparative": "The essay offered a comparative study of two political systems.",
    "competent": "A competent electrician can identify the source of the fault.",
    "comprehend": "The dense legal wording was difficult for new employees to comprehend.",
    "concentration": "She needed complete concentration to solve the complicated puzzle.",
    "contradictory": "The witnesses gave contradictory accounts of the crash.",
    "contribute": "Volunteers contribute hundreds of hours to the food bank each month.",
    "convenience": "Online scheduling offers greater convenience for working parents.",
    "cordial": "The two rivals maintained a cordial relationship despite their disagreement.",
    "corrupt": "The investigation uncovered a corrupt official who accepted bribes.",
    "counsel": "She sought counsel from an attorney before signing the agreement.",
    "courteous": "The clerk remained courteous despite the customer's impatience.",
    "delegate": "The director decided to delegate the scheduling task to an assistant.",
    "desperation": "In desperation, he called every nearby shelter for help.",
    "devise": "The engineers had to devise a way to cool the equipment without fans.",
    "discrimination": "The applicant alleged discrimination after being denied an interview because of age.",
    "disguise": "The thief wore a disguise to avoid recognition.",
    "dominance": "The company's dominance in the market worried smaller competitors.",
    "elegant": "The architect proposed an elegant solution that was both simple and attractive.",
    "embassy": "The traveler contacted the embassy after losing her passport.",
    "entity": "The charity operates as a separate legal entity.",
    "exclusive": "The members received exclusive access to the early exhibition.",
    "exempt": "Small businesses may be exempt from certain filing requirements.",
    "exploit": "The attacker tried to exploit a weakness in the website's security.",
    "facility": "The new sports facility includes a swimming pool and gymnasium.",
    "falsehood": "The article repeated a falsehood that had already been disproved.",
    "fateful": "A fateful decision to leave early saved the family from the storm.",
    "foresight": "Her foresight in keeping emergency supplies proved valuable during the outage.",
    "fugitive": "Police searched the region for a fugitive who escaped custody.",
    "generosity": "Her generosity funded scholarships for students in need.",
    "grandeur": "Visitors admired the grandeur of the cathedral's vaulted ceiling.",
    "hideous": "A hideous smell spread from the overflowing dumpster.",
    "hindrance": "Poor internet service became a hindrance to remote work.",
    "humiliation": "He felt humiliation when the mistake was announced to the entire staff.",
    "implicate": "The records may implicate another employee in the fraud.",
    "inclination": "She had an inclination to postpone the trip until spring.",
    "inherent": "Every investment carries some inherent risk.",
    "injunction": "The judge issued an injunction stopping construction until the dispute was resolved.",
    "inspiration": "The scientist found inspiration in a simple question from her daughter.",
    "intensity": "The intensity of the storm increased after midnight.",
    "intermediate": "He enrolled in an intermediate course after mastering the basics.",
    "intolerable": "The noise became intolerable after three sleepless nights.",
    "intrigue": "The mysterious letter began to intrigue the young historian.",
    "ironic": "It was ironic that the safety inspector forgot his own helmet.",
    "judiciary": "The judiciary must interpret the law independently of the legislature.",
    "luminous": "The luminous dial remained easy to read in the dark.",
    "momentum": "The campaign gained momentum after the first successful fundraiser.",
    "monotonous": "The monotonous hum of the machine made the shift seem endless.",
    "palpable": "The tension in the room was palpable as the verdict approached.",
    "pledge": "The mayor made a pledge to repair the damaged roads.",
    "plunder": "Invaders began to plunder the city after its defenses collapsed.",
    "preservation": "The historical society raised money for preservation of the old theater.",
    "prevail": "After several appeals, the residents finally prevailed in court.",
    "proliferation": "The proliferation of misleading websites made reliable information harder to find.",
    "reassure": "The doctor tried to reassure the worried patient.",
    "resentment": "Years of unequal treatment created resentment among the staff.",
    "resignation": "Her resignation surprised colleagues who expected her to stay for years.",
    "sarcastic": "His sarcastic praise made it clear he disliked the proposal.",
    "scanty": "The expedition struggled with scanty supplies of food and water.",
    "surplus": "The city used its budget surplus to repair sidewalks.",
    "suspicious": "The banker noticed several suspicious transfers from the account.",
    "systematic": "The investigators conducted a systematic review of the records.",
    "unreasonable": "The landlord's demand for payment within an hour seemed unreasonable.",
    "verdict": "The jury returned a verdict of not guilty.",
    "zealous": "The zealous volunteer arrived early for every fundraiser.",
    "insolence": "The employee's open insolence toward customers led to a formal warning.",
    "intangible": "Trust is an intangible asset that cannot be listed as a piece of equipment.",
    "integral": "Regular maintenance is integral to keeping the machines safe.",
    "intemperance": "His intemperance at the banquet embarrassed his colleagues.",
    "intercede": "Her mentor offered to intercede with the director on her behalf.",
    "intermediary": "The broker acted as an intermediary between the buyer and seller.",
    "intrinsic": "The artwork has intrinsic value beyond its potential resale price.",
    "introspective": "After the argument, he grew introspective about his own behavior.",
    "intuition": "Her intuition told her that the seemingly simple explanation was incomplete.",
    "irrefutable": "The video provided irrefutable evidence that the bridge was already damaged.",
    "irresolute": "The irresolute committee postponed its decision for a third time.",
    "irrevocable": "Once signed, the transfer became irrevocable under the agreement.",
    "judicious": "A judicious use of savings kept the family out of debt.",
    "lassitude": "Weeks of illness left him with a heavy sense of lassitude.",
    "loathsome": "The prisoners described the cell's loathsome conditions.",
    "malevolence": "His deliberate efforts to ruin the charity revealed unmistakable malevolence.",
    "malevolent": "The villain's malevolent scheme targeted innocent families.",
    "malicious": "Someone sent malicious messages intended to damage her reputation.",
    "manifold": "The proposed change would have manifold effects on the school system.",
    "multiplicity": "The policy created a multiplicity of confusing exceptions.",
    "mysticism": "Her interest in mysticism led her to study ancient spiritual traditions.",
    "necessitate": "The collapsed ceiling will necessitate extensive structural repairs.",
    "obliterate": "The wildfire threatened to obliterate the small mountain settlement.",
    "opportune": "The unexpected discount arrived at an opportune moment for the buyer.",
    "opulence": "The palace's marble floors and gold chandeliers displayed extraordinary opulence.",
    "ordnance": "The military team safely removed unexploded ordnance from the field.",
    "palliative": "The treatment was palliative, easing pain without curing the disease.",
    "pecuniary": "The court awarded pecuniary damages to compensate for lost wages.",
    "perilous": "The climbers faced a perilous descent during the blizzard.",
    "pernicious": "The pernicious rumor slowly destroyed trust within the organization.",
    "ponderous": "The speaker's ponderous explanation turned a simple point into a long ordeal.",
    "populism": "The candidate's populism appealed to voters who distrusted established elites.",
    "precarious": "The ladder rested in a precarious position against the loose wall.",
    "precursor": "A sudden drop in pressure can be a precursor to severe weather.",
    "predilection": "She has a predilection for historical mysteries over contemporary thrillers.",
    "predisposition": "Family history may indicate a predisposition to certain illnesses.",
    "preposterous": "The suggestion that the entire building moved overnight was preposterous.",
    "profligate": "The profligate spender exhausted his inheritance in less than a year.",
    "profundity": "The professor admired the profundity of the student's question.",
    "profusion": "Wildflowers bloomed in profusion after the spring rains.",
    "prospective": "Prospective tenants toured the apartment on Saturday.",
    "provincialism": "His provincialism made him suspicious of anyone from outside his hometown.",
    "prudence": "Financial prudence led them to establish an emergency savings fund.",
    "querulous": "The querulous passenger complained about every stop along the route.",
    "reciprocity": "Their friendship depended on reciprocity rather than one person doing all the favors.",
    "reprehensible": "The committee condemned the official's reprehensible abuse of power.",
    "reprimand": "The supervisor issued a reprimand after the employee ignored safety rules.",
    "residual": "A residual odor remained after the smoke damage was cleaned.",
    "resonance": "The speech had emotional resonance for people who had experienced similar losses.",
    "retaliate": "The employee feared the manager would retaliate after she reported misconduct.",
    "reticent": "The usually reticent engineer spoke at length about the design flaw.",
    "reverence": "The congregation listened with reverence as the old hymn began.",
    "salutary": "The brief setback had a salutary effect, prompting the team to improve its process.",
    "scarcity": "A scarcity of affordable homes drove rents higher.",
    "scintillating": "Her scintillating conversation kept the dinner guests entertained.",
    "scornful": "He gave a scornful laugh when the proposal was presented.",
    "seclusion": "The writer sought seclusion in a cabin far from the city.",
    "speculative": "The article's claim was speculative and unsupported by direct evidence.",
    "stagnant": "Water in the stagnant pond attracted mosquitoes.",
    "subsidiary": "The corporation created a subsidiary to manage its overseas operations.",
    "subsistence": "The farmers grew barely enough food for their own subsistence.",
    "subversive": "The regime banned the artist's subversive criticism of its leaders.",
    "tenacious": "The tenacious investigator kept searching long after others had given up.",
    "tenacity": "Her tenacity carried her through years of demanding training.",
    "treasonable": "The general was accused of treasonable acts against his country.",
    "trepidation": "He approached the difficult conversation with trepidation.",
    "tyrannical": "The tyrannical ruler imprisoned people for criticizing him.",
    "unabashed": "She was unabashed about celebrating her unconventional fashion choices.",
    "undaunted": "Undaunted by the first rejection, he submitted a stronger application.",
    "unparalleled": "The athlete's record represented unparalleled success in her sport.",
    "unsolicited": "The company sent an unsolicited sales pitch to every office.",
    "upheaval": "The sudden merger caused upheaval among employees.",
    "vanquish": "The defending army finally vanquished the invading force.",
    "vehement": "She made a vehement objection to the proposal.",
    "veneration": "The community's veneration of the retired teacher was evident at her memorial.",
    "veritable": "The small attic contained a veritable treasure trove of forgotten letters.",
    "vexatious": "The repeated, frivolous lawsuits became a vexatious burden on the organization.",
    "vigilance": "Constant vigilance helped the lifeguard spot the struggling swimmer.",
    "vivacity": "Her vivacity enlivened an otherwise quiet gathering.",
    "volatile": "The volatile chemical must be kept away from heat and sparks.",
    "volition": "He left the position of his own volition rather than being dismissed.",
    "adverse": "The medication caused an adverse reaction in a small number of patients.",
    "affinity": "She felt an immediate affinity for the quiet mountain town.",
    "antipathy": "His antipathy toward bureaucracy made routine paperwork frustrating.",
    "ascertain": "The investigators tried to ascertain exactly when the equipment failed.",
    "assent": "The committee gave its assent to the proposed changes.",
    "censure": "The board voted to censure the member for violating its ethics rules.",
    "cession": "The treaty required the cession of disputed territory to the neighboring state.",
    "compel": "The court may compel the witness to produce the documents.",
    "composure": "She maintained her composure even as the audience criticized her.",
    "compulsory": "Attendance at the safety training was compulsory for all employees.",
    "conclusive": "The tests produced conclusive evidence of a manufacturing defect.",
    "confidential": "The attorney kept the client's financial records confidential.",
    "conjecture": "Without access to the records, his explanation remained conjecture.",
    "consequent": "The river flooded, with consequent damage to roads and farmland.",
    "consequential": "The board faced a consequential decision about the hospital's future.",
    "contemplate": "She took several weeks to contemplate the job offer.",
    "contemporary": "The museum exhibited contemporary paintings alongside older works.",
    "contemptible": "His contemptible decision to exploit the elderly drew widespread condemnation.",
    "copious": "The witness kept copious notes throughout the investigation.",
    "corruption": "The inquiry uncovered corruption in the city's purchasing office.",
    "deference": "The apprentice spoke with deference to the experienced carpenter.",
    "defiance": "The protesters continued their march in defiance of the order.",
    "diminution": "A gradual diminution in rainfall threatened the region's crops.",
    "efficacious": "Clinical trials found the treatment efficacious against the infection.",
    "erratic": "The car's erratic movement made other drivers slow down.",
    "faction": "A small faction within the party opposed the agreement.",
    "forfeit": "Players who arrive late must forfeit the match.",
    "imperialism": "The historian examined how imperialism reshaped trade and political borders.",
    "incoherent": "The witness's incoherent account jumped between unrelated events.",
    "indispensable": "Clean drinking water is indispensable to public health.",
    "indulgence": "He allowed himself the occasional indulgence of an expensive dessert.",
    "industrious": "The industrious crew completed the repairs ahead of schedule.",
    "ingenious": "The engineer designed an ingenious mechanism using only two moving parts.",
    "insolent": "The insolent remark offended the entire committee.",
    "jurisprudence": "The legal scholar taught a course on constitutional jurisprudence.",
    "lucrative": "Her small consulting business became lucrative after securing several clients.",
    "negligence": "The lawsuit alleged negligence in maintaining the unsafe stairway.",
    "ominous": "Dark clouds gathered above the harbor in an ominous formation.",
    "oppression": "Generations of oppression shaped the community's struggle for equal rights.",
    "orator": "The gifted orator held the crowd's attention for nearly an hour.",
    "orthodox": "His orthodox interpretation followed the traditional teachings exactly.",
    "partisan": "The openly partisan editorial favored one political party.",
    "patronage": "The museum depended on the patronage of wealthy donors.",
    "predominate": "Pine trees predominate in the northern part of the forest.",
    "prestige": "The award brought international prestige to the small university.",
    "prominence": "Her research gained prominence after the discovery was independently confirmed.",
    "prophecy": "The ancient prophecy warned of a winter that would last for years.",
    "propriety": "The committee questioned the propriety of accepting gifts from bidders.",
    "prosecution": "The prosecution presented its evidence before the defense called any witnesses.",
    "reclamation": "The city's reclamation of abandoned industrial land created a new park.",
    "regime": "The new regime imposed restrictions on independent newspapers.",
    "relentless": "Relentless rain continued for four days without a break.",
    "renounce": "He decided to renounce his claim to the inheritance.",
    "requisite": "Applicants must possess the requisite training before operating the crane.",
    "resultant": "The resultant pressure damaged several joints in the pipeline.",
    "resumption": "The resumption of train service followed repairs to the damaged tracks.",
    "sanction": "The government imposed a sanction on the company for violating trade restrictions.",
    "scrutiny": "The unusual payments came under intense scrutiny from auditors.",
    "servile": "His servile flattery made coworkers uncomfortable.",
    "strife": "Years of civil strife forced families to leave their homes.",
    "submissive": "The usually outspoken employee became submissive around the threatening supervisor.",
    "subordinate": "The captain assigned the routine task to a subordinate officer.",
    "substantial": "The repairs required a substantial investment of money and labor.",
    "superfluous": "The report contained several superfluous paragraphs that repeated earlier points.",
    "superiority": "The team claimed the superiority of its design after the successful trial.",
    "tribunal": "An independent tribunal heard the dispute between the two organizations.",
    "turmoil": "The unexpected resignation threw the company into turmoil.",
    "tyranny": "The citizens revolted after decades of tyranny.",
    "unanimous": "The board's vote was unanimous, with every member supporting the plan.",
    "beatific": "Her beatific smile suggested a serenity untouched by the surrounding chaos.",
    "bilious": "The critic wrote a bilious review full of bitter personal attacks.",
    "cabal": "A small cabal of officials secretly plotted to remove the director.",
    "baleful": "The guard gave the intruder a baleful stare.",
    "bibulous": "His bibulous habits made late-night banquets a regular occurrence.",
    "declivity": "Loose stones rolled down the steep declivity toward the road.",
    "grandiloquent": "The grandiloquent speech promised to transform civilization but offered no practical plan.",
    "interregnum": "During the interregnum, a temporary council governed the kingdom.",
    "soporific": "The speaker's soporific delivery sent several listeners to sleep.",
    "stentorian": "His stentorian voice carried across the crowded auditorium without a microphone.",
    "abjure": "The former extremist publicly abjured his earlier beliefs.",
    "abrogate": "The legislature voted to abrogate the outdated treaty.",
    "abscond": "The treasurer tried to abscond with the charity's donations.",
    "acedia": "The monk struggled with acedia, a spiritual listlessness that drained his devotion.",
    "aleatory": "The composer incorporated aleatory passages whose notes were determined by chance.",
    "anomie": "After the community's institutions collapsed, widespread anomie left people without clear social norms.",
    "aporia": "The philosopher's aporia emerged when neither answer to the dilemma seemed defensible.",
    "apotropaic": "The villagers hung apotropaic charms over their doors to ward off evil.",
    "atavistic": "An atavistic fear of predators stirred when he heard growling in the dark.",
    "autochthonous": "The researchers studied autochthonous species that originated in the isolated valley.",
    "bathos": "The tragedy ended in bathos when the hero interrupted his farewell speech to ask for a snack.",
    "brumal": "A brumal chill settled over the empty fields in December.",
    "caliginous": "Only a weak lantern pierced the caliginous mist.",
    "chthonic": "The ancient myth described chthonic deities dwelling beneath the earth.",
    "coruscate": "The chandelier's crystals seemed to coruscate in the candlelight.",
    "demotic": "The poet preferred demotic speech to the elaborate language of the royal court.",
    "desuetude": "The forgotten ordinance fell into desuetude after decades without enforcement.",
    "disquisition": "The scholar published a lengthy disquisition on medieval trade routes.",
    "effulgent": "The effulgent sunrise flooded the valley with brilliant golden light.",
    "encomium": "The retiring professor received an encomium praising decades of teaching.",
    "epigrammatic": "Her epigrammatic wit compressed sharp observations into memorable single sentences.",
    "eudaimonia": "The philosopher associated eudaimonia with a flourishing life guided by virtue.",
    "fuliginous": "The old furnace left fuliginous soot on the surrounding bricks.",
    "hebetude": "After days without sleep, a sense of hebetude clouded his thinking.",
    "hermetic": "The novel's hermetic symbolism frustrated readers unfamiliar with its private references.",
    "limn": "The artist used delicate lines to limn the dancer's silhouette.",
    "logorrhea": "His logorrhea turned a five-minute update into an hour-long monologue.",
    "magniloquent": "The candidate's magniloquent promises sounded impressive but lacked substance.",
    "metonymy": "Using 'the crown' to mean the monarchy is an example of metonymy.",
    "miasma": "A foul miasma rose from the stagnant marsh at dusk.",
    "noetic": "The essay explored noetic experiences associated with intellectual insight.",
    "nugatory": "The missing signature rendered the supposed agreement nugatory.",
    "peregrination": "Her peregrination across remote villages took most of the summer.",
    "periphrasis": "Instead of saying 'died,' his periphrasis described the man as having departed this world.",
    "phantasmagoria": "The stage lights created a phantasmagoria of shifting shadows and monstrous shapes.",
    "philippic": "The senator delivered a furious philippic against official corruption.",
    "picayune": "They wasted an hour arguing over a picayune difference in formatting.",
    "plenipotentiary": "The president sent a plenipotentiary authorized to negotiate and sign the treaty.",
    "prelapsarian": "The painting imagined a prelapsarian garden untouched by human wrongdoing.",
    "propinquity": "Years of working side by side created a feeling of propinquity between the colleagues.",
    "pusillanimous": "The pusillanimous official refused to defend his staff when they were falsely accused.",
    "rebarbative": "The reviewer's rebarbative manner discouraged students from asking questions.",
    "refulgent": "The mountain peaks were refulgent in the late afternoon sunlight.",
    "sybaritic": "The tycoon's sybaritic lifestyle included lavish meals and extravagant vacations.",
    "thaumaturgy": "The villagers credited the healer's supposed thaumaturgy with miraculous recoveries.",
    "ululate": "Wolves began to ululate beyond the frozen river.",
    "uxorious": "The uxorious king deferred to his wife on almost every decision.",
    "vituperative": "The debate dissolved into vituperative insults rather than reasoned criticism.",
  });

  // A few high-impact polysemous words need explicit meaning-specific examples.
  // The test matches the selected dictionary definition, not merely the headword.
  const MEANING_GUIDES = Object.freeze({
    sanction: [
      {test:/approv|authoriz|permission|consent|official support/i, definition:'Official approval or permission', example:'The committee gave its sanction to the revised plan.'},
      {test:/penalt|punish|restrict|coerc|enforc|measure taken/i, definition:'A penalty or restrictive measure', example:'The agency imposed a sanction on the company for violating trade rules.'}
    ],
    oversight: [
      {test:/supervis|oversee|watch|monitor|administr|manage|direct/i, definition:'Supervision or monitoring', example:'The committee provides oversight of the agency’s spending.'},
      {test:/error|mistake|omission|fail|inadvert/i, definition:'An accidental mistake or omission', example:'The missing signature was an oversight rather than an attempt to deceive.'}
    ],
    qualified: [
      {test:/competent|capab|skill|train|fit|credential/i, definition:'Having the required skills or credentials', example:'Only qualified electricians may work on the main panel.'},
      {test:/limit|reserv|restrict|condition|not absolute/i, definition:'Limited by conditions or reservations', example:'She gave qualified support to the plan but wanted a clearer budget.'}
    ],
    draft: [
      {test:/prelim|early|version|sketch|not final|written|document/i, definition:'A preliminary version of a document', example:'The attorney prepared a draft of the agreement for review.'},
      {test:/current of air|airflow|breeze/i, definition:'A current of air', example:'A cold draft slipped through the gap beneath the door.'}
    ],
    resolution: [
      {test:/settle|solution|decision|resolve|agreement|determination/i, definition:'A decision or settlement', example:'Negotiations finally brought a peaceful resolution to the dispute.'},
      {test:/clarity|detail|pixel|image|screen/i, definition:'The amount of detail in an image', example:'The larger monitor displayed the diagram at a higher resolution.'}
    ],
    effect: [
      {test:/result|consequence|outcome|change produced/i, definition:'A result or consequence', example:'The policy had an immediate effect on delivery times.'},
      {test:/bring about|cause|make happen|accomplish/i, definition:'To bring about a change', example:'The new director hoped to effect lasting improvements.'}
    ],
    principal: [
      {test:/main|chief|most important|leading/i, definition:'Main or most important', example:'Her principal concern was the building’s electrical system.'},
      {test:/amount of money|loan|debt|invest|capital/i, definition:'The original sum borrowed or invested', example:'Extra payments reduced the mortgage principal.'}
    ],
    register: [
      {test:/sign|enroll|record a name|list/i, definition:'To enter a name on an official list', example:'Visitors must register at the front desk.'},
      {test:/style of language|level of formality|tone of speech/i, definition:'A level or style of language', example:'The speaker shifted to a formal register during the ceremony.'}
    ],
    frame: [
      {test:/formulat|present|interpret|describe|phrase/i, definition:'To present or describe in a particular way', example:'She chose to frame the disagreement as a solvable scheduling problem.'},
      {test:/structure|border|support|surround/i, definition:'A supporting structure or border', example:'The carpenter repaired the wooden frame around the window.'}
    ],
    claim: [
      {test:/assert|say|state|maintain|alleg/i, definition:'An assertion that something is true', example:'The witness made a claim that the alarm had been disabled.'},
      {test:/demand|right to|request for payment|insurance/i, definition:'A request for something owed or legally due', example:'She filed an insurance claim after the storm damaged the roof.'}
    ],
    leverage: [
      {test:/influenc|advantage|power|negotia/i, definition:'Influence used to gain an advantage', example:'The buyer used competing quotes as leverage in negotiations.'},
      {test:/borrow|debt|finance|investment/i, definition:'The use of borrowed money', example:'The investor used leverage to purchase a larger property.'}
    ],
    convention: [
      {test:/custom|usual|accepted|practice|tradition/i, definition:'A generally accepted custom', example:'Removing your shoes indoors is a convention in many households.'},
      {test:/meeting|assembly|conference/i, definition:'A large formal gathering', example:'The teachers attended a national convention in Chicago.'}
    ],
    obscure: [
      {test:/unknown|little known|hard to understand|unclear/i, definition:'Not widely known or difficult to understand', example:'The historian uncovered an obscure law that few people remembered.'},
      {test:/hide|block|cover|conceal|darken/i, definition:'To make difficult to see', example:'Heavy fog began to obscure the harbor lights.'}
    ],
    novel: [
      {test:/new|unusual|original/i, definition:'New or unusual', example:'The engineer proposed a novel way to conserve water.'},
      {test:/fiction|book|story/i, definition:'A long work of fictional prose', example:'She finished reading the novel during her vacation.'}
    ]
  });

  function meaningGuide(word, definition) {
    const guides=MEANING_GUIDES[String(word || '').toLowerCase()] || [];
    return guides.find(guide=>guide.test.test(String(definition || ''))) || null;
  }

  function studyIllustrations(word, dictionaryExamples, chosenDefinition) {
    const guide=meaningGuide(word,chosenDefinition);
    if (guide) return {examples:[guide.example],exampleSource:'sense-guide'};
    // A full, matched dictionary sentence is preferable to a generic gloss.
    const fullDictionary=(Array.isArray(dictionaryExamples) ? dictionaryExamples : []).filter(looksLikeSentence);
    if (fullDictionary.length) return {examples:fullDictionary,exampleSource:'dictionary'};
    const curated=CURATED_EXAMPLES[String(word || '').toLowerCase()];
    if (curated && looksLikeSentence(curated)) return {examples:[curated],exampleSource:'app'};
    // Custom words without a reliable sentence are held out of practice until
    // a useful dictionary illustration is available. Never display an empty card.
    return {examples:[],exampleSource:'none'};
  }

  function alternateMeanings(word, primary, studyDefinitions) {
    const selected=String(primary || '').trim();
    const candidates=[];
    const guides=MEANING_GUIDES[String(word || '').toLowerCase()] || [];
    for (const guide of guides) {
      if (guide === meaningGuide(word,selected)) continue;
      candidates.push({definition:guide.definition,example:guide.example});
    }
    for (const definition of studyDefinitions || []) {
      if (!definition || definition.toLowerCase()===selected.toLowerCase()) continue;
      if (!isPedagogicallyUsefulDefinition(definition,word)) continue;
      if (definitionSimilarity(definition,selected) >= .5) continue;
      if (candidates.some(entry=>definitionSimilarity(entry.definition,definition)>.45)) continue;
      const guide=meaningGuide(word,definition);
      if (guide && candidates.some(entry=>entry.example===guide.example)) continue;
      candidates.push({definition,example:guide?.example || ''});
      if (candidates.length>=3) break;
    }
    return candidates.slice(0,3);
  }

  function pronunciationAudioUrl(entry) {
    const pronunciations=[...(Array.isArray(entry?.hwi?.prs) ? entry.hwi.prs : []),...(Array.isArray(entry?.prs) ? entry.prs : [])];
    const file=pronunciations.find(pr=>typeof pr?.sound?.audio==='string')?.sound?.audio || '';
    if (!/^[a-z0-9_-]+$/i.test(file)) return '';
    const folder=file.startsWith('bix') ? 'bix' : file.startsWith('gg') ? 'gg' : /^[^a-z]/i.test(file) ? 'number' : file[0].toLowerCase();
    return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${folder}/${file}.mp3`;
  }

  function wordOrigin(entry) {
    const parts=Array.isArray(entry?.et) ? entry.et : [];
    const text=parts.filter(part=>Array.isArray(part) && part[0]==='text')
      .map(part=>cleanMwText(part[1])).filter(Boolean).join(' ');
    return text.slice(0,450);
  }

  const TECHNICAL_ENTRY_LABELS = /\b(?:anatomy|anatomical|medicine|medical|pathology|pathological|botany|botanical|zoology|zoological|chemistry|chemical|biochemistry|geology|geological|microbiology)\b/i;

  function entryPedagogyScore(entry, word) {
    const shortdefs=Array.isArray(entry?.shortdef) ? entry.shortdef.map(value=>String(value||'').trim()).filter(Boolean) : [];
    const learner=learnerDefinitionsFromEntry(entry,word);
    const usefulShort=orderedUsefulDefinitions(shortdefs,word);
    let score=0;
    if (learner.length) score+=50;
    score+=Math.min(12,usefulShort.length*4);
    if (learner[0] && isConciseAnswerDefinition(learner[0])) score+=6;
    else if (usefulShort[0] && isConciseAnswerDefinition(usefulShort[0])) score+=3;
    const labels=[
      ...(Array.isArray(entry?.sls) ? entry.sls : []),
      ...(Array.isArray(entry?.lbs) ? entry.lbs : [])
    ].join(' ');
    if (TECHNICAL_ENTRY_LABELS.test(labels)) score-=35;
    const source=String(entry?.meta?.src || '');
    if (/medical/i.test(source)) score-=50;
    return score;
  }

  function parseDictionaryData(word, data) {
    if (!Array.isArray(data)) throw new Error('Unexpected dictionary response.');
    if (data.length && typeof data[0] === 'string') throw new Error(`No exact dictionary entry for ${word}.`);
    const entries = data.filter(item => item && typeof item==='object' && (Array.isArray(item.shortdef) || item?.suppl?.ldq?.def));
    if (!entries.length) throw new Error(`No usable definition for ${word}.`);
    const query = normalizeWordForMatch(word);
    const exact = entries.filter(entry => normalizeWordForMatch(entry.hwi?.hw) === query);
    const stemMatches = entries.filter(entry => Array.isArray(entry.meta?.stems) && entry.meta.stems.some(stem => normalizeWordForMatch(stem) === query));
    const pool = exact.length ? exact : (stemMatches.length ? stemMatches : entries);
    const reviewed=REVIEWED_CONTENT[query] || null;
    const preferredPart=String(reviewed?.partOfSpeech || '').toLowerCase();
    const ranked=[...pool].sort((a,b)=>{
      const preferred=entry=>preferredPart && String(entry?.fl || '').toLowerCase()===preferredPart ? 100 : 0;
      return (entryPedagogyScore(b,word)+preferred(b))-(entryPedagogyScore(a,word)+preferred(a));
    });
    const entry=ranked[0];
    const shortdefs=[...new Set((entry.shortdef || []).map(value => String(value || '').trim()).filter(definition=>isPedagogicallyUsefulDefinition(definition,word)))].slice(0,3);
    // Learner supplements may contain incomplete nested phrases. Keep them
    // out of the quiz and its distractors entirely.
    const learnerDefinitions=[];
    const studyDefinitions=[...new Set([...(reviewed ? [reviewed.definition] : []),...shortdefs])];
    const definition=reviewed?.definition || chooseStudyDefinition(studyDefinitions,word);
    const quizDefinition=reviewed?.definition || chooseQuizDefinition(studyDefinitions,word);
    const answerDefinition=reviewed?.definition || chooseAnswerDefinition(studyDefinitions,word);
    const illustrations=reviewed
      ? {examples:[reviewed.example],exampleSource:'reviewed'}
      : studyIllustrations(word,examplesForTeachingSense(entry,answerDefinition),answerDefinition);
    const examples=illustrations.examples;
    if (!definition || !isPedagogicallyUsefulDefinition(quizDefinition,word) || !isConciseAnswerDefinition(answerDefinition)) {
      throw new Error(`No complete, useful quiz definition for ${word}.`);
    }
    return {
      word:String(word || '').toLowerCase(),
      headword: normalizeHeadword(entry.hwi?.hw) || word,
      partOfSpeech: reviewed?.partOfSpeech || entry.fl || '',
      shortdefs,
      learnerDefinitions,
      studyDefinitions,
      definition,
      quizDefinition,
      answerDefinition,
      example:examples[0] || '',
      examples,
      exampleSource:illustrations.exampleSource,
      alternateMeanings:alternateMeanings(word,answerDefinition,studyDefinitions),
      syllables:String(entry.hwi?.hw || '').replace(/\*/g,'·').replace(/\s+/g,' ').trim(),
      audioUrl:pronunciationAudioUrl(entry),
      origin:wordOrigin(entry),
      definitionStyle:reviewed ? 'reviewed-study' : 'collegiate',
      source: reviewed ? 'Vocabulary Builder teaching definition' : 'Merriam-Webster Collegiate Dictionary'
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

  const localDictionaryCache=new Map();
  function localDictionary(word) {
    const normalized=String(word || '').trim().toLowerCase();
    if (localDictionaryCache.has(normalized)) return localDictionaryCache.get(normalized);
    const reviewed=REVIEWED_CONTENT[normalized];
    if (!reviewed || !looksLikeSentence(reviewed.example)) return null;
    const primary=String(reviewed.definition || '').trim();
    if (!isPedagogicallyUsefulDefinition(primary,normalized)) return null;
    const entry={
      word:normalized,
      headword:normalized,
      partOfSpeech:reviewed.partOfSpeech || '',
      shortdefs:[], learnerDefinitions:[], studyDefinitions:[primary],
      definition:primary, quizDefinition:primary, answerDefinition:primary,
      example:reviewed.example, examples:[reviewed.example], exampleSource:'reviewed',
      alternateMeanings:alternateMeanings(normalized,primary,[primary]),
      syllables:'', audioUrl:'', origin:'',
      definitionStyle:'reviewed-study', source:'Vocabulary Builder teaching definition',
      local:true
    };
    localDictionaryCache.set(normalized,entry);
    return entry;
  }

  // Enrich word DETAILS on demand, never the quiz. A failed online request
  // must never remove a locally available definition or example.
  async function getOptionalReference(word, local) {
    if (!keys.dictionary || navigator.onLine === false) return local;
    try {
      const data=await apiLookup('dictionary',dictionaryLookupSpelling(word),keys.dictionary);
      const reference=parseDictionaryData(word,data);
      return {
        ...local,
        headword:reference.headword || local.headword,
        syllables:reference.syllables || local.syllables,
        audioUrl:reference.audioUrl || '',
        origin:reference.origin || '',
        shortdefs:reference.shortdefs || [],
        studyDefinitions:[...new Set([local.definition,...(reference.studyDefinitions || [])])],
        alternateMeanings:reference.alternateMeanings?.length ? reference.alternateMeanings : local.alternateMeanings
      };
    } catch { return local; }
  }

  async function getDictionary(word) {
    const cacheKey=String(word || '').toLowerCase();
    const local=localDictionary(cacheKey);
    if (local) return local;
    if (transientDictionary.has(cacheKey)) return transientDictionary.get(cacheKey);
    if (!keys.dictionary || navigator.onLine === false) {
      throw new Error('This word is not in the offline curriculum. Online dictionary access is optional in Settings.');
    }
    const data=await apiLookup('dictionary',dictionaryLookupSpelling(word),keys.dictionary);
    const result=parseDictionaryData(word,data);
    transientDictionary.set(cacheKey,result);
    return result;
  }

  async function getDictionaryBatch(words) {
    const requested=[...new Set((words || []).map(value=>String(value||'').trim().toLowerCase()).filter(Boolean))];
    const results=new Map();
    const remote=[];
    for (const word of requested) {
      const local=localDictionary(word);
      if (local) results.set(word,{entry:local});
      else if (transientDictionary.has(word)) results.set(word,{entry:transientDictionary.get(word)});
      else remote.push(word);
    }
    if (!remote.length) return results;
    if (!keys.dictionary || navigator.onLine === false) {
      for (const word of remote) results.set(word,{error:new Error('Custom words require optional online dictionary access.')});
      return results;
    }
    for (let i=0;i<remote.length;i+=8) {
      const chunk=remote.slice(i,i+8);
      let rows;
      try { rows=await apiLookupBatch('dictionary',chunk.map(dictionaryLookupSpelling),keys.dictionary); }
      catch (error) { for (const word of chunk) results.set(word,{error}); continue; }
      const rowMap=new Map(rows.map(row=>[String(row.word||'').toLowerCase(),row]));
      for (const word of chunk) {
        const row=rowMap.get(dictionaryLookupSpelling(word));
        if (!row || row.error || Number(row.status)>=400) {
          results.set(word,{error:new Error(row?.error || `Lookup failed (${row?.status || 'unknown'}).`)});
          continue;
        }
        try {
          const entry=parseDictionaryData(word,row.data);
          transientDictionary.set(word,entry);
          results.set(word,{entry});
        } catch (error) { results.set(word,{error}); }
      }
    }
    return results;
  }

  async function prefetchSessionDictionary(fromIndex=0) {
    if (!session?.queue?.length || !keys.dictionary || navigator.onLine === false) return;
    const token=++prefetchToken;
    const words=[];
    for (const item of session.queue.slice(fromIndex)) {
      const word=String(item.word||'').toLowerCase();
      if (word && !REVIEWED_CONTENT[word] && !transientDictionary.has(word) && !words.includes(word)) words.push(word);
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

  function renderWordDetail(entry=null) {
    if (!currentWordDetail) return;
    const word=currentWordDetail.word;
    const item=studyWordItem(word) || currentWordDetail.item || {word,level:3,collections:[],custom:false};
    currentWordDetail.item=item;
    if (entry) currentWordDetail.entry=entry;
    const dictionary=currentWordDetail.entry;
    const state=getExistingWordState(word);
    const saved=isSavedWord(word);

    const detailHeadword=dictionary?.headword || word;
    $('wordDetailWord').textContent=detailHeadword;
    $('wordDetailWord').setAttribute('aria-label',dictionary?.partOfSpeech ? `${detailHeadword}, ${dictionary.partOfSpeech}` : detailHeadword);
    $('wordDetailStatus').textContent=state.suspended ? 'Review paused' : (saved ? `Saved · ${statusOf(state)}` : statusOf(state));
    $('wordDetailPartOfSpeech').textContent=dictionary?.partOfSpeech || '';
    $('wordDetailPartOfSpeech').classList.toggle('hidden', !dictionary?.partOfSpeech);
    $('wordDetailMeaning').textContent=dictionary?.definition || dictionary?.shortdefs?.[0] || 'Definition unavailable.';
    const syllables=String(dictionary?.syllables || '');
    $('wordSyllables').textContent=syllables && syllables !== detailHeadword ? `Syllable breaks: ${syllables}` : '';
    $('wordSyllables').classList.toggle('hidden',!syllables || syllables===detailHeadword);
    const audioAvailable=Boolean(dictionary?.audioUrl);
    const deviceVoiceAvailable=typeof window.speechSynthesis!=='undefined' && typeof window.SpeechSynthesisUtterance==='function';
    const pronounceButton=$('wordPronounceButton');
    pronounceButton.classList.toggle('hidden',!audioAvailable && !deviceVoiceAvailable);
    pronounceButton.textContent=audioAvailable ? `Hear ${detailHeadword} pronounced` : `Hear ${detailHeadword} (device voice)`;
    $('wordPronounceStatus').textContent=audioAvailable ? 'Merriam-Webster recording.' : (deviceVoiceAvailable ? 'Device-generated pronunciation; accuracy may vary.' : 'Audio pronunciation unavailable.');

    const examples=Array.isArray(dictionary?.examples) && dictionary.examples.length ? dictionary.examples : (dictionary?.example ? [dictionary.example] : []);
    const exampleList=$('wordExampleList');
    exampleList.replaceChildren();
    for (const value of examples) {
      const li=document.createElement('li');
      li.textContent=value;
      exampleList.appendChild(li);
    }
    $('wordExamples').classList.toggle('hidden',!examples.length);
    const origin=String(dictionary?.origin || '');
    $('wordOriginText').textContent=origin;
    $('wordOriginDetails').classList.toggle('hidden',!origin);
    if (!origin) setDetailsOpen($('wordOriginDetails'),false);

    $('wordDetailRecord').textContent=state.seen
      ? `${state.correct} correct, ${state.wrong} missed. Accuracy ${accuracy(state.correct,state.correct+state.wrong)}.`
      : (state.markedKnown ? 'Marked as known.' : 'Not studied yet.');

    const definitions=Array.isArray(dictionary?.studyDefinitions)
      ? dictionary.studyDefinitions.filter(definition=>definition && isPedagogicallyUsefulDefinition(definition,word))
      : (Array.isArray(dictionary?.shortdefs) ? dictionary.shortdefs.filter(definition=>definition && isPedagogicallyUsefulDefinition(definition,word)) : []);
    const mainDefinition=String(dictionary?.definition || '').trim();
    const more=definitions.filter(definition=>String(definition).trim()!==mainDefinition).slice(0,3);
    const details=$('wordDefinitionsDetails'); const list=$('wordDefinitionList');
    const altMeanings=Array.isArray(dictionary?.alternateMeanings) ? dictionary.alternateMeanings : [];
    list.innerHTML='';
    const listed=altMeanings.length ? altMeanings : more.map(definition=>({definition,example:''}));
    for (const {definition,example} of listed) {
      const li=document.createElement('li');
      const text=document.createElement('span'); text.textContent=definition; li.appendChild(text);
      if (example) { const p=document.createElement('p'); p.className='other-meaning-example'; p.textContent=example; li.appendChild(p); }
      list.appendChild(li);
    }
    details.classList.toggle('hidden',listed.length===0);
    if (!listed.length) details.open=false;

    $('wordRelatedButton').classList.toggle('hidden',!keys.thesaurus || navigator.onLine === false);
    const save=$('wordSaveButton');
    save.classList.toggle('hidden', saved);
    save.textContent='Save word';
    const unsave=$('wordUnsaveButton');
    if (unsave) unsave.classList.toggle('hidden', !saved);
    const practice=$('wordPracticeButton');
    practice.classList.remove('hidden');
    practice.textContent='Practice word';

    const known=$('wordKnownButton');
    const alreadyKnown=Boolean(state.markedKnown && state.mastery===4);
    known.classList.toggle('hidden', alreadyKnown);
    known.textContent='Mark as known';
    $('wordSuspendButton').textContent=state.suspended ? 'Resume review' : 'Pause review';

    const levelControl=$('wordLevelControl');
    levelControl.classList.toggle('hidden', !item.custom);
    if (item.custom) $('wordLevelSelect').value=String(item.level || 3);
    const names=(item.collections||[]).filter(id=>id!=='practical-core').slice(0,4).map(collectionName);
    $('wordCollections').textContent=names.length ? `Collections: ${names.join(', ')}.` : '';
    $('wordCollections').classList.toggle('hidden', names.length===0);

    $('wordDetailLoading').textContent='';
    $('wordDetailLoading').classList.add('hidden');
    $('wordDetailContent').classList.remove('hidden');
  }

  function stopWordPronunciation() {
    if (pronunciationAudio) {
      pronunciationAudio.pause();
      pronunciationAudio=null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  async function pronounceCurrentWord() {
    const detail=currentWordDetail;
    if (!detail?.entry) return;
    stopWordPronunciation();
    const pronunciation=detail.entry;
    if (pronunciation.audioUrl) {
      const audio=new Audio(pronunciation.audioUrl);
      pronunciationAudio=audio;
      try {
        await audio.play();
        return;
      } catch {
        if (pronunciationAudio===audio) pronunciationAudio=null;
        // Some browsers prevent external audio playback. Try device speech.
      }
    }
    if (typeof window.speechSynthesis!=='undefined' && typeof window.SpeechSynthesisUtterance==='function') {
      const utterance=new SpeechSynthesisUtterance(pronunciation.headword || detail.word);
      utterance.lang='en-US';
      utterance.rate=0.9;
      $('wordPronounceStatus').textContent='Device-generated pronunciation; accuracy may vary.';
      window.speechSynthesis.speak(utterance);
    } else {
      $('wordPronounceStatus').textContent='Pronunciation audio could not be played on this device.';
    }
  }

  async function openWordDetail(word,{entry=null,historyMode='push'}={}) {
    stopWordPronunciation();
    const normalized=String(word||'').trim().toLowerCase();
    if (!normalized) return;
    currentWordDetail={word:normalized,item:studyWordItem(normalized) || {word:normalized,level:3,collections:[],custom:false},entry:entry||null};
    if (historyMode==='push') {
      history.pushState({...appHistoryState('word'),word:normalized},'',`#word/${encodeURIComponent(normalized)}`);
    } else if (historyMode==='replace') {
      history.replaceState({...appHistoryState('word'),word:normalized},'',`#word/${encodeURIComponent(normalized)}`);
    }
    switchView('word',false,'none');
    $('wordDetailWord').textContent=entry?.headword || normalized;
    $('wordRelatedPanel').classList.add('hidden');
    $('wordRelatedPanel').innerHTML='';
    $('wordRelatedButton').textContent='Show synonyms and antonyms';
    $('wordDetailContent').classList.add('hidden');
    $('wordDetailLoading').classList.remove('hidden');
    $('wordDetailLoading').textContent=`Opening ${normalized}…`;
    try {
      // Load local information instantly, even without internet. A configured
      // reference service can enrich the visible details afterward.
      const dictionary=entry || await getDictionary(normalized);
      currentWordDetail.entry=dictionary;
      renderWordDetail(dictionary);
      $('wordDetailWord').focus();
      if (localDictionary(normalized) && keys.dictionary && navigator.onLine !== false) {
        void getOptionalReference(normalized,localDictionary(normalized)).then(enriched=>{
          if (currentWordDetail?.word!==normalized) return;
          currentWordDetail.entry=enriched;
          renderWordDetail(enriched);
        });
      }
    } catch(error) {
      $('wordDetailLoading').textContent=`Could not load ${normalized}: ${error.message}`;
      $('wordDetailContent').classList.add('hidden');
      $('wordDetailLoading').classList.remove('hidden');
      $('wordDetailLoading').focus?.();
    }
  }

  function saveCurrentWord() {
    if (!currentWordDetail) return;
    const level=currentWordDetail.item?.level || 3;
    if (addCustomStudyWord(currentWordDetail.word,level)) showToast(`${currentWordDetail.word} saved.`);
    currentWordDetail.item=studyWordItem(currentWordDetail.word) || currentWordDetail.item;
    renderWordDetail(); renderHome();
  }

  function removeCurrentWordFromSaved() {
    if (!currentWordDetail) return;
    const word=currentWordDetail.word;
    const item=studyWordItem(word);
    const state=wordState(word);
    if (item?.custom) {
      progress.customWords=(Array.isArray(progress.customWords) ? progress.customWords : [])
        .filter(entry=>String(entry?.word||'').toLowerCase()!==word);
      currentWordDetail.item={word,level:item.level || 3,collections:[],custom:false};
    }
    state.saved=false;
    saveState();
    renderWordDetail();
    renderHome();
    showToast(`${word} removed from saved words.`);
  }

  async function showCurrentWordRelated() {
    if (!currentWordDetail) return;
    const panel=$('wordRelatedPanel'); const button=$('wordRelatedButton');
    if (!keys.thesaurus || navigator.onLine === false) {
      panel.textContent='Synonyms and antonyms are optional online features. Core practice works offline.';
      panel.classList.remove('hidden'); return;
    }
    button.classList.add('hidden');
    panel.classList.remove('hidden'); panel.textContent='Loading synonyms and antonyms…';
    try {
      const thesaurus=await getThesaurus(currentWordDetail.word);
      renderThesaurusWithAdd(panel,thesaurus);
      button.classList.add('hidden');
    } catch(error) {
      panel.textContent=`Synonyms and antonyms unavailable: ${error.message}`;
      button.classList.remove('hidden'); button.textContent='Try synonyms and antonyms again';
    }
  }

  function markCurrentWordKnown() {
    if (!currentWordDetail) return;
    markWordKnown(currentWordDetail.word,currentWordDetail.item?.level||3);
    currentWordDetail.item=studyWordItem(currentWordDetail.word) || currentWordDetail.item;
    renderWordDetail();
  }

  function toggleCurrentWordSuspended() {
    if (!currentWordDetail) return;
    const state=getExistingWordState(currentWordDetail.word);
    setWordSuspended(currentWordDetail.word,!state.suspended,currentWordDetail.item?.level||3);
    renderWordDetail();
  }

  function practiceWordNow(word, level=3) {
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
      source:isSavedWord(item.word) ? 'personal' : 'starter',
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
      button.addEventListener('click', () => openWordDetail(word));
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

  function appendThesaurusWordGroup(panel, label, words) {
    if (!words?.length) return;
    const section=document.createElement('section');
    section.className='thesaurus-group';
    const h=document.createElement('h4'); h.textContent=label;
    const ul=document.createElement('ul'); ul.className='related-word-list';
    words.forEach(word=>{
      const li=document.createElement('li');
      const button=document.createElement('button');
      button.type='button';
      button.className='related-word-button';
      button.textContent=word;
      button.setAttribute('aria-label', `${word}${isSavedWord(word) ? ', saved word' : ''}`);
      button.addEventListener('click',()=>openWordDetail(word));
      li.appendChild(button); ul.appendChild(li);
    });
    section.append(h,ul); panel.appendChild(section);
  }

  function renderThesaurusWithAdd(panel, thesaurus) {
    panel.innerHTML = '';
    appendThesaurusWordGroup(panel, 'Synonyms', thesaurus.synonyms);
    appendThesaurusWordGroup(panel, 'Antonyms', thesaurus.antonyms);
    if (!thesaurus.synonyms.length && !thesaurus.antonyms.length) {
      const p=document.createElement('p');
      p.textContent='No related words were returned for this entry.';
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

  async function lookupWord(overrideWord=null) {
    const input=$('lookupWord');
    const raw=String(overrideWord ?? input.value).trim();
    const word=raw.toLowerCase();
    const status=$('lookupStatus');
    renderLookupSuggestions([]);
    if (!word) { status.textContent='Enter a word to look up.'; input.focus(); return; }
    const builtIn=localDictionary(word);
    if (builtIn) {
      rememberLookup(word);
      status.textContent='';
      await openWordDetail(word,{entry:builtIn});
      return;
    }
    if (!keys.dictionary || navigator.onLine === false) {
      status.textContent='This word is outside the built-in curriculum. An optional dictionary key and internet connection are needed to look it up.';
      return;
    }
    status.textContent=`Looking up ${raw}…`;
    $('lookupButton').classList.add('hidden');
    try {
      const data=await apiLookup('dictionary',word,keys.dictionary);
      if (!Array.isArray(data)) throw new Error('Unexpected dictionary response.');
      if (!data.some(item=>item && typeof item==='object')) {
        const suggestions=data.filter(item=>typeof item==='string');
        status.textContent=suggestions.length
          ? `No exact entry for ${raw}. Choose a suggested spelling.`
          : `No dictionary entry was returned for ${raw}.`;
        renderLookupSuggestions(suggestions);
        return;
      }
      const dictionary=parseDictionaryData(word,data);
      const storedWord=String(dictionary.headword || word).toLowerCase();
      dictionary.word=storedWord;
      transientDictionary.set(storedWord,dictionary);
      transientDictionary.set(word,dictionary);
      rememberLookup(storedWord);
      status.textContent='';
      await openWordDetail(storedWord,{entry:dictionary});
    } catch(error) {
      status.textContent=`Lookup failed: ${error.message}`;
    } finally {
      $('lookupButton').classList.remove('hidden');
    }
  }

  function sharedCollectionCount(a, b) {
    const left=new Set(Array.isArray(a?.collections) ? a.collections : []);
    return (Array.isArray(b?.collections) ? b.collections : []).filter(value => left.has(value)).length;
  }

  // A small, intentionally conservative list of near-equivalent words.
  // These are useful to study together, but unfair as unqualified multiple-choice
  // answers: the same short definition could reasonably fit either word.
  const NEAR_EQUIVALENT_GROUPS = [
    ['adequate','sufficient'], ['assume','presume'], ['infer','deduce'],
    ['alleviate','ameliorate'], ['obvious','apparent','evident'],
    ['inevitable','ineluctable'], ['meticulous','fastidious','scrupulous'],
    ['candid','frank'], ['ambiguous','equivocal'], ['plausible','credible'],
    ['perfunctory','cursory'], ['reluctant','hesitant'], ['laconic','succinct','concise'],
    ['reticent','taciturn'], ['diminish','reduce','decrease'],
    ['abrogate','repeal','rescind'], ['encomium','panegyric'],
    ['capricious','fickle'], ['disparity','inequality'],
    ['obdurate','intransigent'], ['articulate','eloquent'],
    ['impecunious','destitute'], ['tranquil','serene'],
    ['obfuscate','obscure'], ['superfluous','unnecessary'],
    ['ostentatious','pretentious'], ['insidious','subtle'],
    ['pragmatic','practical'], ['assiduous','diligent'],
    ['lucid','clear'], ['dogmatic','inflexible'],
    ['defer','postpone'], ['bolster','reinforce']
  ];
  const NEAR_EQUIVALENT = new Map();
  for (const group of NEAR_EQUIVALENT_GROUPS) {
    for (const word of group) {
      if (!NEAR_EQUIVALENT.has(word)) NEAR_EQUIVALENT.set(word,new Set());
      for (const other of group) if (other!==word) NEAR_EQUIVALENT.get(word).add(other);
    }
  }
  function nearEquivalentWords(left,right) {
    const a=normalizeWordForMatch(left), b=normalizeWordForMatch(right);
    return a===b || sameWordFamily(a,b) || Boolean(NEAR_EQUIVALENT.get(a)?.has(b));
  }

  // A conservative grammatical-form hint inferred from the teaching definition.
  // An uncertain hint stays unknown; never display it as a claimed part of speech.
  function answerKind(entry) {
    const part=String(entry?.partOfSpeech || '').toLowerCase();
    if (/^(?:noun|verb|adjective|adverb)$/.test(part)) return part;
    const def=String(entry?.answerDefinition || entry?.quizDefinition || '').trim();
    if (/^to\s+[a-z]+\b/i.test(def)) return 'verb';
    if (/^(?:a|an|the)\s+(?:act|process|state|quality|condition|person|individual|thing|amount|ability|practice|belief|idea|feeling|form|period|system|method|event|place|situation|agreement|statement|expression|group|study|field|attitude|word|type|kind|result|difference|relationship|reason|purpose|action|change|tendency|position)\b/i.test(def)) return 'noun';
    if (/^(?:characterized by|marked by|having|showing|being|able to|capable of|likely to|relating to|based on|free from|lacking|inclined to)\b/i.test(def)) return 'adjective';
    return '';
  }

  function clashesWithAnotherMeaning(target, candidate, direction) {
    // Reject a candidate that would fit any explicitly supplied alternate
    // meaning of the question word, or whose alternate meaning fits the prompt.
    const targetMeanings=(target.alternateMeanings || []).map(x=>x.definition);
    const candidateMeanings=(candidate.alternateMeanings || []).map(x=>x.definition);
    const candidateMain=candidate.answerDefinition || candidate.quizDefinition;
    const targetMain=target.answerDefinition || target.quizDefinition;
    if (targetMeanings.some(other=>definitionSimilarity(other,candidateMain)>=0.34)) return true;
    if (direction==='def-word' && candidateMeanings.some(other=>definitionSimilarity(other,targetMain)>=0.34)) return true;
    return false;
  }

  function definitionShape(entry) {
    const text=String(entry?.answerDefinition || entry?.quizDefinition || '').trim();
    if (/^to\s+/i.test(text)) return 'action';
    if (/^(?:a|an|the|someone|something|one who)\s+/i.test(text)) return 'thing';
    if (/^(?:in a|in an|in the|with a)\s+/i.test(text)) return 'manner';
    return 'description';
  }

  function candidateScore(targetItem, targetEntry, candidateItem, candidateEntry, similarity, direction) {
    let score=0;
    const targetKind=answerKind(targetEntry), candidateKind=answerKind(candidateEntry);
    if (targetKind && candidateKind) score += targetKind===candidateKind ? 10 : -10;
    if (direction==='word-def') {
      score += definitionShape(targetEntry)===definitionShape(candidateEntry) ? 11 : -9;
    }
    const levelDifference=Math.abs((targetItem.level||3)-(candidateItem.level||3));
    score += levelDifference===0 ? 5 : levelDifference===1 ? 3 : 0;
    const sharedCollections=sharedCollectionCount(targetItem,candidateItem);
    score += Math.min(2,sharedCollections)*2;
    // Moderate conceptual overlap makes questions less trivial; near-duplicates
    // were rejected separately as unsafe rather than rewarded here.
    if (similarity>0 && similarity<0.32) score+=2.5+(0.32-Math.abs(similarity-0.14))*2;
    const answerLength=String(targetEntry.answerDefinition || '').length;
    const otherLength=String(candidateEntry.answerDefinition || '').length;
    if (direction==='word-def') {
      score+=Math.max(0,5-Math.abs(answerLength-otherLength)/12);
    } else {
      score+=Math.max(0,4-Math.abs(targetItem.word.length-candidateItem.word.length));
    }
    return score;
  }

  function chooseBalancedDistractors(candidates, direction) {
    const selected=[];
    for (const candidate of candidates) {
      if (selected.length===3) break;
      // Prevent nearly duplicate wrong choices and repeated word families.
      if (selected.some(other=>nearEquivalentWords(other.item.word,candidate.item.word))) continue;
      if (direction==='word-def' && selected.some(other =>
          definitionSimilarity(other.entry.answerDefinition,candidate.entry.answerDefinition)>=0.45)) continue;
      selected.push(candidate);
    }
    return selected;
  }

  function recentlyUsedDefinition(definition) {
    const recent=Array.isArray(session?.recentOptionDefinitions) ? session.recentOptionDefinitions : [];
    return recent.some(previous => {
      const left=String(definition||'').toLowerCase().trim();
      const right=String(previous||'').toLowerCase().trim();
      return left===right || definitionSimilarity(left,right)>=0.72;
    });
  }

  function rememberQuestionOptions(direction,target,rawOptions,chosen) {
    if (!session) return;
    const words=rawOptions.map(option=>String(option.word||'').toLowerCase()).filter(Boolean);
    const definitions=direction==='word-def'
      ? rawOptions.map(option=>String(option.value||'').trim()).filter(Boolean)
      : [target.quizDefinition,...chosen.map(({entry})=>entry.quizDefinition)].map(value=>String(value||'').trim()).filter(Boolean);
    session.recentOptionWords=[...(session.recentOptionWords||[]),...words].slice(-48);
    session.recentOptionDefinitions=[...(session.recentOptionDefinitions||[]),...definitions].slice(-48);
  }

  async function makeQuestion(item) {
    const questionPool = session?.mode === 'placement'
      ? CURRICULUM
      : allStudyWords().filter(word => (canPracticeWord(word) && !getExistingWordState(word.word).suspended && !isInvalidSeed(word.word)) || word.word===item.word);

    const recentOptionWords=new Set((session?.recentOptionWords || []).map(word=>String(word).toLowerCase()));
    const queuedUnique=[];
    if (Array.isArray(session?.queue)) {
      for (const queued of shuffle(session.queue.filter(entry=>entry.word!==item.word))) {
        if (!queuedUnique.some(existing=>existing.word===queued.word)) queuedUnique.push(queued);
      }
    }
    const sessionFresh=queuedUnique.filter(candidate=>!recentOptionWords.has(String(candidate.word).toLowerCase()));
    const sessionRecent=queuedUnique.filter(candidate=>recentOptionWords.has(String(candidate.word).toLowerCase()));
    const backupBase=questionPool.filter(candidate=>candidate.word!==item.word && !queuedUnique.some(existing=>existing.word===candidate.word));
    const backupFresh=backupBase.filter(candidate=>!recentOptionWords.has(String(candidate.word).toLowerCase()));
    const backupRecent=backupBase.filter(candidate=>recentOptionWords.has(String(candidate.word).toLowerCase()));
    const sameLevel=items=>shuffle(items.filter(candidate=>(candidate.level||3)===(item.level||3)));
    const nearLevel=items=>shuffle(items.filter(candidate=>Math.abs((candidate.level||3)-(item.level||3))===1));
    const otherLevel=items=>shuffle(items.filter(candidate=>Math.abs((candidate.level||3)-(item.level||3))>1));
    // Prefer words outside the current round so a distractor never previews a future target's definition.
    // Draw from more than a dozen words. Balance the level buckets so easy
    // same-level answers do not crowd out more convincing alternatives.
    const candidateItems=[
      ...sameLevel(backupFresh).slice(0,70),
      ...nearLevel(backupFresh).slice(0,36),
      ...otherLevel(backupFresh).slice(0,12),
      ...sameLevel(backupRecent).slice(0,12),
      ...nearLevel(backupRecent).slice(0,8),
      ...sessionFresh.slice(0,16),...sessionRecent.slice(0,8)
    ].slice(0,155);
    const batchWords=[item.word,...candidateItems.map(candidate=>candidate.word)];
    const loaded=await getDictionaryBatch(batchWords);
    const targetResult=loaded.get(String(item.word).toLowerCase());
    if (!targetResult?.entry) throw targetResult?.error || new Error(`No usable definition for ${item.word}.`);
    const target=targetResult.entry;
    if (!target.quizDefinition) throw new Error(`No useful quiz definition for ${item.word}.`);
    if (!looksLikeSentence(target.example)) {
      const error=new Error(`No accurate sentence is available for ${item.word} in this meaning.`);
      error.code='UNUSABLE_QUESTION';
      throw error;
    }

    let direction=session.direction;
    if (direction==='mixed') direction=Math.random()<0.7 ? 'word-def' : 'def-word';
    if (direction==='word-def' && !target.answerDefinition) {
      const error=new Error('No concise meaning-choice prompt is available.');
      error.code='UNUSABLE_QUESTION';
      throw error;
    }
    const candidates=[];
    const seenDefinitions=new Set([String(target.quizDefinition||'').toLowerCase().trim()]);
    for (const candidate of candidateItems) {
      const result=loaded.get(String(candidate.word).toLowerCase());
      if (!result?.entry) {
        if (result?.error && isUnusableDictionaryError(result.error) && CURRICULUM_MAP.has(candidate.word)) markInvalidSeed(candidate.word);
        continue;
      }
      const entry=result.entry;
      if (!entry.quizDefinition) continue;
      if (normalizeWordForMatch(entry.headword)===normalizeWordForMatch(target.headword)) continue;
      if (nearEquivalentWords(item.word,candidate.word)) continue;
      const normalizedDefinition=String(entry.quizDefinition||'').toLowerCase().trim();
      if (!normalizedDefinition || seenDefinitions.has(normalizedDefinition)) continue;
      const similarity=definitionSimilarity(target.quizDefinition,entry.quizDefinition);
      if (similarity>=0.32) continue;
      if (sharedCollectionCount(item,candidate)>=2 && similarity>0.12) continue;
      if (clashesWithAnotherMeaning(target,entry,direction)) continue;
      seenDefinitions.add(normalizedDefinition);
      const recentWord=recentOptionWords.has(String(candidate.word).toLowerCase());
      const recentDefinition=recentlyUsedDefinition(entry.quizDefinition);
      let score=candidateScore(item,target,candidate,entry,similarity,direction);
      if (recentWord) score-=10;
      if (recentDefinition) score-=12;
      candidates.push({item:candidate,entry,similarity,score,recentWord,recentDefinition});
    }
    candidates.sort((a,b)=>b.score-a.score);

    const chosen=chooseBalancedDistractors(
      direction==='word-def' ? candidates.filter(candidate=>candidate.entry.answerDefinition) : candidates,
      direction
    );
    if (chosen.length<3) {
      const error=new Error('Not enough distinct answer choices were available in the selected format.');
      error.code='UNUSABLE_QUESTION';
      throw error;
    }

    const rawOptions = direction === 'word-def'
      ? [{value:target.answerDefinition, correct:true, word:item.word, source:target.source}, ...chosen.map(({item:candidate,entry})=>({value:entry.answerDefinition,correct:false,word:candidate.word,source:entry.source}))]
      : [{value:item.word, correct:true, word:item.word}, ...chosen.map(({item:candidate})=>({value:candidate.word,correct:false,word:candidate.word}))];
    rememberQuestionOptions(direction,target,rawOptions,chosen);
    persistSession();
    const options=shuffle(rawOptions).map((option,index)=>({...option,letter:'ABCD'[index]}));
    return {item,target,distractors:chosen.map(value=>value.entry),direction,options,screened:true};
  }

  async function presentQuestion() {
    if (!session || session.index >= session.queue.length) { finishSession(); return; }
    $('feedbackPanel').classList.add('hidden');
    $('detailsPanel').classList.add('hidden');
    $('luckyGuessButton').classList.add('hidden');
    $('luckyGuessButton').textContent = 'Lucky guess — review sooner';
    $('confidenceStatus').classList.add('hidden');
    $('confidenceStatus').textContent = '';
    session.resumeIndex = session.index;
    persistSession();
    $('questionCard').classList.add('hidden');
    $('loadingQuestion').classList.remove('hidden');
    updateQuestionCounter();
    const item = session.queue[session.index];
    // An unfinished older round may contain custom online words. When offline,
    // skip those without losing existing progress or the rest of the round.
    if (!canPracticeWord(item)) {
      session.queue.splice(session.index,1);
      session.plannedCount=Math.max(0,session.plannedCount-1);
      persistSession();
      showToast(`Skipped ${item.word}: this custom word requires optional online access.`);
      await presentQuestion();
      return;
    }
    try {
      session.current = await makeQuestion(item);
      recordWordHistory(item.word, 'practice');
      saveState();
      renderQuestion(session.current);
    } catch (error) {
      // Keep question formats predictable: skip a word that cannot make a good
      // question in the chosen format rather than silently changing formats.
      if (error?.code==='UNUSABLE_QUESTION') {
        session.queue.splice(session.index,1);
        session.plannedCount=Math.max(0,session.plannedCount-1);
        persistSession();
        await presentQuestion();
        return;
      }
      if (session?.mode!=='placement' && isUnusableDictionaryError(error) && CURRICULUM_MAP.has(item.word)) {
        markInvalidSeed(item.word);
        session.queue.splice(session.index,1);
        session.plannedCount=Math.max(0,session.plannedCount-1);
        persistSession();
        showToast(`${item.word} was skipped because no usable teaching entry was available.`);
        await presentQuestion();
        return;
      }
      $('loadingQuestion').classList.add('hidden');
      const panel = $('feedbackPanel');
      panel.className = 'feedback';
      $('feedbackPart').classList.add('hidden');
      $('feedbackReviewNote').classList.add('hidden');
      panel.classList.remove('hidden');
      $('feedbackHeading').textContent = 'Could not load this question';
      $('feedbackWordText').textContent = 'Question unavailable';
      $('feedbackWord').setAttribute('aria-label','Question unavailable');
      $('feedbackDefinitionText').textContent = error.message || 'This question is currently unavailable.';
      $('feedbackDefinition').setAttribute('aria-label',`Meaning. ${$('feedbackDefinitionText').textContent}`);
      $('feedbackExampleLabel').textContent = 'Example';
      $('feedbackExampleText').textContent = 'Question unavailable.';
      $('feedbackExample').setAttribute('aria-label','Example. Question unavailable.');
      $('feedbackOtherMeanings').classList.add('hidden');
      $('wordFacts').innerHTML = '';
      $('detailsButton').classList.add('hidden');
      $('feedbackSaveButton').classList.add('hidden');
      $('feedbackOpenWordButton').classList.add('hidden');
      $('luckyGuessButton').classList.add('hidden');
      $('nextQuestionButton').textContent = 'Skip this word';
      $('nextQuestionButton').onclick = () => { session.index += 1; session.resumeIndex = session.index; persistSession(); presentQuestion(); };
      requestAnimationFrame(() => $('feedbackHeading').focus());
    }
  }

  function renderQuestion(q) {
    $('loadingQuestion').classList.add('hidden');
    $('questionCard').classList.remove('hidden');
    $('questionCard').removeAttribute('aria-hidden');
    $('questionCard').inert=false;
    const feedback=$('feedbackPanel');
    feedback.className='feedback hidden';
    $('feedbackHeading').textContent='';
    $('feedbackWordText').textContent='';
    $('feedbackPart').textContent='';
    $('feedbackPart').classList.add('hidden');
    $('feedbackDefinitionText').textContent='';
    $('feedbackExampleText').textContent='';
    $('feedbackExample').removeAttribute('aria-label');
    $('feedbackDefinition').removeAttribute('aria-label');
    $('feedbackWord').removeAttribute('aria-label');
    $('feedbackExampleLabel').textContent='Example sentence';
    $('feedbackOtherMeanings').classList.add('hidden');
    $('feedbackOtherMeanings').open=false;
    $('feedbackOtherMeaningList').replaceChildren();
    $('feedbackReviewNote').textContent='';
    $('feedbackReviewNote').classList.add('hidden');
    $('wordFacts').innerHTML='';
    setDetailsOpen($('feedbackMore'),false);
    setDetailsOpen($('officialDefinitions'),false);
    $('officialDefinitions').classList.add('hidden');
    $('officialDefinitionList').innerHTML='';
    $('detailsPanel').classList.add('hidden');
    $('detailsPanel').innerHTML='';
    $('feedbackSaveButton').classList.add('hidden');
    $('feedbackOpenWordButton').classList.add('hidden');
    const prompt = q.direction==='word-def' ? q.item.word : q.target.quizDefinition;
    $('questionType').textContent = q.direction==='word-def' ? 'Choose the meaning' : 'Choose the word';
    $('questionContext').textContent = q.target.partOfSpeech || '';
    $('questionPrompt').textContent = prompt;
    $('questionPrompt').setAttribute('aria-label', q.target.partOfSpeech ? `${prompt}, ${q.target.partOfSpeech}` : prompt);
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

  function renderAlternateMeanings(target) {
    const section=$('feedbackOtherMeanings');
    const list=$('feedbackOtherMeaningList');
    list.replaceChildren();
    const meanings=Array.isArray(target.alternateMeanings) ? target.alternateMeanings : [];
    for (const meaning of meanings) {
      const li=document.createElement('li');
      const definition=document.createElement('p');
      definition.className='other-meaning-definition';
      definition.textContent=meaning.definition;
      li.appendChild(definition);
      if (meaning.example) {
        const example=document.createElement('p');
        example.className='other-meaning-example';
        example.textContent=meaning.example;
        li.appendChild(example);
      }
      list.appendChild(li);
    }
    section.classList.toggle('hidden',!meanings.length);
    section.open=false;
    const distinct=Boolean(MEANING_GUIDES[String(target.word || '').toLowerCase()]?.length);
    $('feedbackOtherMeaningsLabel').textContent=distinct
      ? (meanings.length===1 ? 'This word also has another meaning — explore' : `This word has ${meanings.length} other meanings — explore`)
      : `Other dictionary definitions (${meanings.length}) — explore`;
  }

  function renderOfficialDefinitions(target) {
    const section=$('officialDefinitions');
    const list=$('officialDefinitionList');
    list.innerHTML='';
    const primary=String(target.answerDefinition || target.definition || '').trim();
    const sourceDefinitions=Array.isArray(target.studyDefinitions) ? target.studyDefinitions : (target.shortdefs || []);
    const definitions=[...new Set(sourceDefinitions.map(value=>String(value||'').trim()).filter(Boolean))]
      .filter(definition=>definition!==primary && isPedagogicallyUsefulDefinition(definition,target.word))
      .slice(0,2);
    for (const definition of definitions) {
      const li=document.createElement('li');
      li.textContent=definition;
      list.appendChild(li);
    }
    section.classList.toggle('hidden',definitions.length===0);
    if ('open' in section) setDetailsOpen(section,false);
  }

  // Native Web Audio tones are short and optional. Don't autoplay speech or
  // compete with TalkBack unless the user specifically enables this setting.
  function playAnswerSound(correct) {
    if (!settings.answerSounds) return;
    try {
      const Context=window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      if (!toneContext) toneContext=new Context();
      if (toneContext.state==='suspended') void toneContext.resume();
      const now=toneContext.currentTime;
      const notes=correct ? [523.25,659.25] : [246.94,196];
      notes.forEach((hz,index)=>{
        const oscillator=toneContext.createOscillator();
        const gain=toneContext.createGain();
        const start=now+index*.105;
        oscillator.type='sine';
        oscillator.frequency.value=hz;
        gain.gain.setValueAtTime(.0001,start);
        gain.gain.exponentialRampToValueAtTime(.035,start+.018);
        gain.gain.exponentialRampToValueAtTime(.0001,start+.11);
        oscillator.connect(gain); gain.connect(toneContext.destination);
        oscillator.start(start); oscillator.stop(start+.115);
      });
    } catch { /* Audio permission or hardware failure must not block studying. */ }
  }

  function answerQuestion(option, button) {
    if (!session?.current || session.current.answered) return;
    session.current.answered=true;
    const q=session.current;
    const isCorrect=option.correct===true;
    const isPlacement=session.mode==='placement';

    // Replace the question immediately. Hidden answer controls cannot leak stale labels to TalkBack.
    $('questionCard').classList.add('hidden');
    $('questionCard').setAttribute('aria-hidden','true');
    $('questionCard').inert=true;
    $('answerChoices').replaceChildren();
    // An old answer choice must not stay as TalkBack's active element.
    if (button && typeof button.blur==='function') button.blur();
    // Clear unrelated previous announcements before moving TalkBack focus.
    $('screenAnnouncer').textContent='';

    session.answered+=1;
    if (isCorrect) session.correct+=1;
    if (isPlacement) {
      const levelResult=session.placementResults[q.item.level];
      levelResult.answered+=1;
      if (isCorrect) levelResult.correct+=1;
    } else {
      q.progressBefore={...getExistingWordState(q.item.word)};
      q.wasCorrect=isCorrect;
      updateWordProgress(q.item.word,isCorrect);
    }

    if (!isCorrect && !isPlacement) {
      if (!Array.isArray(session.missedWords)) session.missedWords=[];
      if (!session.missedWords.includes(q.item.word)) session.missedWords.push(q.item.word);
      const repeatExists=session.queue.slice(session.index+1).some(entry=>entry.word===q.item.word && entry.repeat);
      if (!repeatExists) {
        const insertAt=Math.min(session.queue.length,session.index+4);
        session.queue.splice(insertAt,0,{...q.item,repeat:true});
      }
    }

    const state=getExistingWordState(q.item.word);
    const panel=$('feedbackPanel');
    const primaryDefinition=q.target.answerDefinition || q.target.quizDefinition || q.target.definition;
    panel.className=`feedback hidden ${isCorrect ? 'correct' : 'wrong'}`;
    $('feedbackHeading').textContent=isCorrect ? 'Correct answer' : 'Answer to review';
    $('feedbackWordText').textContent=q.item.word;
    $('feedbackWord').setAttribute('aria-label',q.target.partOfSpeech ? `${q.item.word}, ${q.target.partOfSpeech}` : q.item.word);
    $('feedbackPart').textContent=q.target.partOfSpeech || '';
    $('feedbackPart').classList.toggle('hidden', !q.target.partOfSpeech);
    $('feedbackDefinitionText').textContent=primaryDefinition;
    $('feedbackDefinition').setAttribute('aria-label',`Meaning. ${primaryDefinition}`);
    const illustration=String(q.target.example || q.target.examples?.[0] || '').trim();
    const hasSentence=looksLikeSentence(illustration);
    $('feedbackExampleLabel').textContent=illustration
      ? (hasSentence ? 'Example sentence' : 'Usage example')
      : 'Example';
    $('feedbackExampleText').textContent=illustration || 'This question was skipped because no suitable example was available.';
    $('feedbackExample').setAttribute('aria-label',`${hasSentence ? 'Example sentence' : 'Usage example'}. ${illustration || 'Not available'}`);
    renderAlternateMeanings(q.target);
    $('feedbackReviewNote').textContent=!isCorrect && !isPlacement ? 'This word will return later for review.' : '';
    $('feedbackReviewNote').classList.toggle('hidden',isCorrect || isPlacement);
    playAnswerSound(isCorrect);
    $('wordFacts').innerHTML='';
    addFact('Definition source', q.target.source || 'Merriam-Webster Collegiate Dictionary');
    // Alternate meanings have a dedicated disclosure in the main reading path.
    $('officialDefinitions').classList.add('hidden');
    if (isPlacement) {
      addFact('Placement','Does not change study progress');
      $('detailsButton').classList.add('hidden');
      $('feedbackSaveButton').classList.add('hidden');
      $('feedbackOpenWordButton').classList.add('hidden');
      $('luckyGuessButton').classList.add('hidden');
    } else {
      addFact('Mastery',statusOf(state));
      $('detailsButton').classList.toggle('hidden',!keys.thesaurus || navigator.onLine === false);
      $('luckyGuessButton').classList.toggle('hidden',!isCorrect);
      $('detailsButton').textContent='Show synonyms and antonyms';
      $('feedbackSaveButton').classList.toggle('hidden',isSavedWord(q.item.word));
      $('feedbackSaveButton').textContent='Save word';
      $('feedbackOpenWordButton').classList.remove('hidden');
    }
    $('nextQuestionButton').textContent='Next word';
    $('nextQuestionButton').setAttribute('aria-label','Next word');
    $('nextQuestionButton').onclick=nextQuestion;
    updateQuestionCounter();
    session.resumeIndex=session.index+1;
    persistSession();
    panel.classList.remove('hidden');
    requestAnimationFrame(()=> {
      // The clicked answer is now hidden/inert. Focus only the new result heading,
      // preventing the previous answer's virtual button from retaining focus.
      if (!$('feedbackPanel').classList.contains('hidden')) $('feedbackHeading').focus({preventScroll:true});
    });
    if (!isPlacement) renderHome();
  }

  function saveFeedbackWord() {
    const q=session?.current;
    if (!q || session?.mode==='placement') return;
    if (addCustomStudyWord(q.item.word,q.item.level||3)) showToast(`${q.item.word} saved.`);
    $('feedbackSaveButton').classList.add('hidden');
    renderHome();
  }

  function openFeedbackWord() {
    const q=session?.current;
    if (!q || session?.mode==='placement') return;
    void openWordDetail(q.item.word,{entry:q.target});
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
    $('luckyGuessButton').classList.add('hidden');
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
    button.classList.add('hidden');
    const panel = $('detailsPanel');
    panel.classList.remove('hidden');
    panel.textContent = 'Loading optional thesaurus information…';
    try {
      const t = await getThesaurus(q.item.word);
      panel.innerHTML = '';
      const h = document.createElement('h4'); h.textContent = `Thesaurus for ${q.item.word}`; panel.appendChild(h);
      appendThesaurusWordGroup(panel, 'Synonyms', t.synonyms, () => q.item.level || 3);
      appendThesaurusWordGroup(panel, 'Antonyms', t.antonyms, () => q.item.level || 3);
      if (!t.synonyms.length && !t.antonyms.length) panel.append('No synonym or antonym list was returned for this word.');
      button.classList.add('hidden');
    } catch (e) {
      panel.textContent = `Thesaurus lookup failed: ${e.message}`;
      button.classList.remove('hidden');
      button.textContent = 'Try synonyms and antonyms again';
    }
  }

  function nextQuestion() {
    if (!session) return;
    if (history.state?.overlay) history.replaceState(appHistoryState('practice'),'','#practice');
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
    practicePhase='complete';
    $('anotherSessionButton').classList.add('hidden');
    $('nextLevelButton').classList.add('hidden');
    $('reviewRoundButton').classList.add('hidden');
    $('sessionHomeButton').classList.remove('hidden');
    $('placementApplyButton').classList.remove('hidden');
    setFocusedPracticeActive(false);
    updateAppBar();
    $('sessionComplete').focus();
    session = null;
    clearSavedSession();
    renderHome();
    renderStats();
  }

  function applyPlacementRecommendation() {
    const level=Number(progress.placement?.recommendedLevel);
    if (!level) return;
    beginLevelSession(level);
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
    lastCompletedRound = {
      mode:summary.mode, levels:[...(summary.levels||[])], source:summary.source||'all', collection:summary.collection||'all',
      novelty:summary.novelty||'balanced', direction:summary.direction||'word-def', missedWords:[...new Set(summary.missedWords||[])]
    };
    practicePhase='complete';
    $('quizArea').classList.add('hidden');
    $('endSessionButton').classList.add('hidden');
    $('sessionComplete').classList.remove('hidden');
    $('placementApplyButton').classList.add('hidden');
    $('anotherSessionButton').classList.remove('hidden');
    const completedLevel=summary.mode==='level' && summary.levels?.length ? summary.levels[0] : null;
    $('anotherSessionButton').textContent=completedLevel ? `Practice Level ${completedLevel} again` : 'Another round like this';
    const nextLevel=$('nextLevelButton');
    if (nextLevel) {
      const showNext=Boolean(completedLevel && completedLevel<5);
      nextLevel.classList.toggle('hidden',!showNext);
      if (showNext) nextLevel.textContent=`Practice Level ${completedLevel+1}: ${LEVEL_NAMES[completedLevel+1]}`;
      nextLevel.dataset.level=showNext ? String(completedLevel+1) : '';
    }
    $('reviewRoundButton').classList.toggle('hidden', lastCompletedRound.missedWords.length===0);
    $('sessionHomeButton').classList.remove('hidden');
    const recycled = Math.max(0, summary.queue.length - summary.plannedCount);
    const composition = recycled
      ? `${summary.plannedCount} planned plus ${recycled} recycled review${recycled===1?'':'s'}`
      : `${summary.plannedCount} planned questions`;
    $('sessionSummary').textContent = `You answered ${summary.answered} questions (${composition}) with ${summary.correct} correct (${accuracy(summary.correct,summary.answered)}).`;
    setFocusedPracticeActive(false);
    updateAppBar();
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
      : 'End this round now? Answers already completed will remain in your progress.');
    if (!ok) return;
    session = null;
    clearSavedSession();
    practicePhase='setup';
    setFocusedPracticeActive(false);
    renderHome();
    if (currentView==='practice' && history.state?.vocabBuilder) history.back();
    else switchView('home',true,'replace');
  }

  function buildMissedReviewRound(words) {
    const unique=[...new Set(words||[])].map(studyWordItem).filter(Boolean);
    if (!unique.length) return null;
    return {mode:'missed-review',queue:shuffle(unique).map(item=>({...item,repeat:false})),index:0,answered:0,correct:0,current:null,completed:false,
      direction:'word-def',levels:[1,2,3,4,5],source:'all',collection:'all',novelty:'low',plannedCount:unique.length,missedWords:[]};
  }

  function continueLastRound() {
    const previous=lastCompletedRound;
    if (!previous) { renderPracticeSetup(); updateAppBar(); return; }
    let built=null;
    if (previous.mode==='quick') built=buildQuickSession('quick');
    else if (previous.mode==='discover') built=buildQuickSession('discover');
    else if (previous.mode==='level' && previous.levels?.length) built=buildLevelSession(previous.levels[0]);
    else if (previous.mode==='normal') { renderPracticeSetup(); built=buildSession('normal'); }
    else if (previous.mode==='due') { renderPracticeSetup(); built=buildSession('due'); }
    else if (previous.mode==='difficult') { renderPracticeSetup(); built=buildSession('difficult'); }
    else if (previous.mode==='missed-review') built=buildMissedReviewRound(previous.missedWords);
    if (!built) { renderPracticeSetup(); updateAppBar(); return; }
    startBuiltSession(built);
  }

  function reviewLastMissed() {
    const built=buildMissedReviewRound(lastCompletedRound?.missedWords);
    if (!built) { showToast('No missed words from the last round.'); return; }
    startBuiltSession(built);
  }

  function practiceNextLevel() {
    const level=Number($('nextLevelButton')?.dataset.level || 0);
    if (level>=1 && level<=5) beginLevelSession(level);
  }

  function goHomeFromComplete() {
    switchView('home',true,'replace');
  }


  function createWordListItem(item, extraText='') {
    const state=getExistingWordState(item.word);
    const li=document.createElement('li');
    li.className='word-list-row';
    const button=document.createElement('button');
    button.type='button'; button.className='word-list-button';
    const top=document.createElement('span'); top.className='word-list-top';
    const name=document.createElement('span'); name.className='word-name'; name.textContent=item.word;
    const status=document.createElement('span'); status.className='word-state';
    status.textContent=state.suspended ? 'Paused' : (isSavedWord(item.word) ? `Saved — ${statusOf(state)}` : statusOf(state));
    top.append(name,status);
    const meta=document.createElement('span'); meta.className='word-list-meta';
    const bits=[`Level ${item.level}: ${LEVEL_NAMES[item.level]}`];
    if (extraText) bits.push(extraText);
    meta.textContent=bits.join(' · ');
    button.append(top,meta);
    button.setAttribute('aria-label', `${item.word}. ${state.suspended ? 'Review paused' : (isSavedWord(item.word) ? `Saved. ${statusOf(state)}` : statusOf(state))}. Level ${item.level}: ${LEVEL_NAMES[item.level]}${extraText ? `. ${extraText}` : ''}.`);
    button.addEventListener('click',()=>openWordDetail(item.word));
    li.appendChild(button);
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
        settings={...settings,source:'starter',collection:collection.id,levels:[1,2,3,4,5],sessionSize:10}; saveState(); switchView('practice'); beginSession('normal');
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
      const kind={practice:'Practiced',lookup:'Looked up',added:'Saved',saved:'Saved'}[entry.kind] || 'Encountered';
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
    if (currentView==='words') {
      const title = source==='personal' ? 'Review saved words' : (collection!=='all' ? `Browse ${collectionName(collection)}` : 'Browse all words');
      $('wordsHeading').textContent=title;
      $('appBarTitle').textContent=title;
      $('menuSavedWordsButton')?.setAttribute('aria-current', source==='personal' ? 'page' : 'false');
      const libraryMenu=qsa('#mainMenu button[data-view]').find(button=>button.dataset.view==='words');
      if (libraryMenu) libraryMenu.setAttribute('aria-current', source==='personal' ? 'false' : 'page');
    }
    const items = allStudyWords().filter(item => {
      const state = getExistingWordState(item.word);
      const sourceMatch = source==='all' || (source==='personal' && isSavedWord(item.word)) || (source==='starter' && !item.custom);
      const availabilityMatch = availability==='all' || (availability==='suspended' && state.suspended) || (availability==='active' && !state.suspended);
      return (!search || item.word.includes(search)) && sourceMatch && availabilityMatch && wordMatchesCollection(item,collection)
        && (status==='all' || (status==='in-progress' && state.mastery>0 && state.mastery<4) || statusOf(state)===status) && (level==='all' || String(item.level)===level);
    }).sort((a,b)=>a.word.localeCompare(b.word));
    const pageSize=25; const pages=Math.max(1,Math.ceil(items.length/pageSize));
    wordPage=Math.max(0,Math.min(wordPage,pages-1));
    const start=wordPage*pageSize; const shown=items.slice(start,start+pageSize);
    $('wordListSummary').textContent = items.length
      ? `${items.length.toLocaleString()} words match. Showing ${start+1} through ${start+shown.length}. Activate a word to open it.`
      : 'No words match these filters.';
    $('libraryPracticeButton').classList.toggle('hidden', source!=='personal' || items.length===0);
    const list = $('wordList'); list.innerHTML='';
    shown.forEach(item=>list.appendChild(createWordListItem(item)));
    $('wordPrevButton').classList.toggle('hidden',wordPage===0 || !items.length);
    $('wordNextButton').classList.toggle('hidden',wordPage>=pages-1 || !items.length);
    $('wordPageStatus').textContent=items.length ? `Page ${wordPage+1} of ${pages}` : 'No pages';
  }

  function renderStats() {
    const dl = $('overallStats'); dl.innerHTML='';
    const studyWords = allStudyWords();
    const seenCount = studyWords.filter(({word})=>getExistingWordState(word).seen>0).length;
    const mastered = studyWords.filter(({word})=>getExistingWordState(word).mastery===4).length;
    const personalCount = studyWords.filter(item=>isSavedWord(item.word)).length;
    const suspendedCount = studyWords.filter(({word})=>getExistingWordState(word).suspended).length;
    const luckyGuessCount = studyWords.reduce((total,{word})=>total+(Number(getExistingWordState(word).luckyGuesses)||0),0);
    const historyCount=Array.isArray(progress.wordHistory)?progress.wordHistory.length:0;
    const placementText = progress.placement?.recommendedLevel ? `Level ${progress.placement.recommendedLevel}: ${LEVEL_NAMES[progress.placement.recommendedLevel]}` : 'Not completed';
    const stats = [
      ['Curriculum size', CURRICULUM.length.toLocaleString()], ['Saved words', personalCount], ['Total answers', progress.totals.answers],
      ['Correct answers', progress.totals.correct], ['Overall accuracy', accuracy(progress.totals.correct,progress.totals.answers)],
      ['Completed rounds', progress.totals.sessions], ['Words encountered', `${seenCount} of ${studyWords.length}`], ['Words mastered', mastered],
      ['Recent word history', `${historyCount} words`], ['Suspended words', suspendedCount], ['Lucky guesses marked', luckyGuessCount],
      ['Placement recommendation', placementText], ['Current study streak', `${progress.streak?.current || 0} days`], ['Longest study streak', `${progress.streak?.longest || 0} days`]
    ];
    stats.forEach(([k,v])=>{const li=document.createElement('li');li.textContent=`${k}: ${v}`;dl.appendChild(li);});
    const levelStats=$('levelStats'); levelStats.innerHTML='';
    for(let level=1;level<=5;level++){
      const words=studyWords.filter(x=>x.level===level); const seen=words.filter(({word})=>getExistingWordState(word).seen>0);
      const masteredN=words.filter(({word})=>getExistingWordState(word).mastery===4).length;
      const c=seen.reduce((n,{word})=>n+getExistingWordState(word).correct,0); const a=seen.reduce((n,{word})=>n+getExistingWordState(word).correct+getExistingWordState(word).wrong,0);
      const div=document.createElement('div');div.className='level-stat'; const h=document.createElement('h4');h.textContent=`Level ${level}: ${LEVEL_NAMES[level]}`;
      const pp=document.createElement('p');pp.textContent=`Encountered ${seen.length} of ${words.length}; mastered ${masteredN}; accuracy ${accuracy(c,a)}.`; div.append(h,pp);levelStats.appendChild(div);
    }
  }

  async function updateOfflinePackStatus() {
    const indicator=$('offlinePackStatus');
    if (!indicator) return;
    if (!('serviceWorker' in navigator) || !('caches' in window)) {
      indicator.textContent='Offline installation is unavailable in this browser.';
      return;
    }
    const resources=['/index.html','/styles.css','/curriculum.js','/study-content.js','/app.js'];
    try {
      const cache=await caches.open('vocab-builder-static-v18');
      const available=await Promise.all(resources.map(path=>cache.match(path)));
      indicator.textContent=available.every(Boolean)
        ? 'Offline study pack ready: all five levels are stored on this device.'
        : 'Offline pack is preparing. Open the app while connected, then check again.';
    } catch { indicator.textContent='Could not verify the offline study pack on this device.'; }
  }

  function renderSettings() {
    $('dictionaryKey').value = keys.dictionary || '';
    $('thesaurusKey').value = keys.thesaurus || '';
    $('showKeys').checked = false;
    $('appearanceMode').value = settings.appearance || 'system';
    $('answerSounds').checked=Boolean(settings.answerSounds);
    $('dictionaryKey').type='password'; $('thesaurusKey').type='password';
    const dictionaryReady=Boolean(keys.dictionary);
    const thesaurusReady=Boolean(keys.thesaurus);
    $('keyStatus').textContent = dictionaryReady
      ? (thesaurusReady ? 'Optional dictionary and thesaurus keys saved.' : 'Optional dictionary key saved; thesaurus is not configured.')
      : 'No keys needed for the 1,155 built-in words. Keys are optional for additional reference lookups.';
    setDetailsOpen($('referenceSettings'),false);
    void updateOfflinePackStatus();
  }

  function saveKeysFromForm() {
    keys = {dictionary:$('dictionaryKey').value.trim(), thesaurus:$('thesaurusKey').value.trim()};
    saveKeys();
    transientDictionary.clear(); transientThesaurus.clear();
    $('keyStatus').textContent = keys.dictionary
      ? (keys.thesaurus ? 'Dictionary and thesaurus are ready.' : 'Dictionary is ready. Thesaurus is optional.')
      : 'Built-in study works offline without an API key.';
    renderHome();
  }

  async function testKeys() {
    saveKeysFromForm();
    if (!keys.dictionary) return;
    const button=$('testKeysButton');button.classList.add('hidden');
    $('keyStatus').textContent=keys.thesaurus ? 'Checking dictionary and thesaurus…' : 'Checking dictionary…';
    try {
      const d=await apiLookup('dictionary','voluminous',keys.dictionary);
      const dictOK=Array.isArray(d)&&d.some(x=>x&&typeof x==='object'&&x.shortdef?.length);
      if(!dictOK) throw new Error('The dictionary key returned an unexpected result.');
      if (keys.thesaurus) {
        const t=await apiLookup('thesaurus','umpire',keys.thesaurus);
        const thesOK=Array.isArray(t)&&t.some(x=>x&&typeof x==='object');
        if(!thesOK) throw new Error('The thesaurus key returned an unexpected result.');
        $('keyStatus').textContent='Success. Dictionary and thesaurus are working.';
      } else {
        $('keyStatus').textContent='Success. Dictionary is working. Thesaurus is optional.';
      }
    } catch(e) {
      $('keyStatus').textContent=`Connection check failed: ${e.message}`;
    } finally { button.classList.remove('hidden'); }
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
    if(!confirm('Reset all vocabulary progress and statistics? Your API keys and saved words will be kept.')) return;
    const customWords = Array.isArray(progress.customWords) ? [...progress.customWords] : [];
    const recentLookups = Array.isArray(progress.recentLookups) ? [...progress.recentLookups] : [];
    const savedCurriculum = Object.entries(progress.words || {}).filter(([word,state])=>state?.saved && CURRICULUM_MAP.has(word)).map(([word])=>word);
    progress=defaultProgress();
    progress.customWords = customWords;
    progress.recentLookups = recentLookups;
    for (const word of savedCurriculum) progress.words[word]={...getExistingWordState(word),saved:true};
    for (const item of customWords) progress.words[String(item.word).toLowerCase()]={...getExistingWordState(String(item.word).toLowerCase()),saved:true};
    clearSavedSession();
    saveState(); renderHome();renderWords();renderHistory();renderStats();
    showToast('Study progress reset. Saved words were kept.');
  }

  function practiceSavedWords() {
    settings={...settings,source:'personal',collection:'all',levels:[1,2,3,4,5],sessionSize:10};
    saveState();
    switchView('practice');
    renderPracticeSetup();
    $('practiceSource').value='personal';
    $('practiceCollection').value='all';
    qsa('input[name="level"]').forEach(cb=>cb.checked=true);
    beginSession('normal');
  }

  function configureEvents() {
    qsa('#mainMenu button[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $('backButton').addEventListener('click',navigateBack);
    $('menuButton').addEventListener('click',()=>{ const open=$('menuButton').getAttribute('aria-expanded')!=='true'; setMenuOpen(open,open,'auto'); });
    $('menuSavedWordsButton').addEventListener('click',()=>openLibraryWith({source:'personal'}));
    $('setupButton').addEventListener('click',()=>switchView('settings'));
    $('resumeSessionButton').addEventListener('click',resumeSavedSession);
    $('startPracticeButton').addEventListener('click',()=>beginQuickSession('quick'));
    $('homeDiscoverButton').addEventListener('click',()=>beginQuickSession('discover'));
    qsa('[data-home-level]').forEach(button=>button.addEventListener('click',()=>beginLevelSession(Number(button.dataset.homeLevel))));
    $('homeCustomButton').addEventListener('click',()=>{ switchView('practice'); renderPracticeSetup(); });
    $('homeLookupButton').addEventListener('click',()=>switchView('lookup'));
    $('homeSavedWordsButton').addEventListener('click',()=>openLibraryWith({source:'personal'}));
    $('homeCollectionsButton').addEventListener('click',()=>switchView('collections'));
    $('homeProgressButton').addEventListener('click',()=>switchView('stats'));
    qsa('input[name="homeDirection"]').forEach(input=>input.addEventListener('change',()=>{
      if (input.checked) selectQuestionDirection(input.value);
    }));
    $('questionDirection').addEventListener('change',e=>selectQuestionDirection(e.target.value));
    $('lookupForm').addEventListener('submit',e=>{e.preventDefault();lookupWord();});
    $('clearRecentLookupsButton').addEventListener('click',clearRecentLookups);
    $('reviewDueButton').addEventListener('click',()=>{switchView('practice'); beginSession('due');});
    $('reviewMissedButton').addEventListener('click',()=>{switchView('practice'); beginSession('difficult');});
    $('placementButton').addEventListener('click',()=>beginSession('placement'));
    $('beginSessionButton').addEventListener('click',()=>beginSession('normal'));
    $('endSessionButton').addEventListener('click',endSession);
    $('anotherSessionButton').addEventListener('click',continueLastRound);
    $('nextLevelButton').addEventListener('click',practiceNextLevel);
    $('reviewRoundButton').addEventListener('click',reviewLastMissed);
    $('sessionHomeButton').addEventListener('click',goHomeFromComplete);
    $('placementApplyButton').addEventListener('click',applyPlacementRecommendation);
    $('detailsButton').addEventListener('click',showDetails);
    $('luckyGuessButton').addEventListener('click',markLuckyGuess);
    $('feedbackSaveButton').addEventListener('click',saveFeedbackWord);
    $('feedbackOpenWordButton').addEventListener('click',openFeedbackWord);
    $('wordSaveButton').addEventListener('click',saveCurrentWord);
    $('wordUnsaveButton').addEventListener('click',removeCurrentWordFromSaved);
    $('wordPracticeButton').addEventListener('click',()=>{ if(currentWordDetail) practiceWordNow(currentWordDetail.word,currentWordDetail.item?.level||3); });
    $('wordRelatedButton').addEventListener('click',showCurrentWordRelated);
    $('wordPronounceButton').addEventListener('click',pronounceCurrentWord);
    $('wordKnownButton').addEventListener('click',markCurrentWordKnown);
    $('wordSuspendButton').addEventListener('click',toggleCurrentWordSuspended);
    $('wordLevelSelect').addEventListener('change',e=>{
      if (!currentWordDetail) return;
      updatePersonalWordLevel(currentWordDetail.word,e.target.value);
      currentWordDetail.item=studyWordItem(currentWordDetail.word) || currentWordDetail.item;
      renderWordDetail();
    });
    const resetLibraryPage=()=>{wordPage=0;renderWords();};
    $('wordSearch').addEventListener('input',resetLibraryPage);
    $('statusFilter').addEventListener('change',resetLibraryPage);
    $('levelFilter').addEventListener('change',resetLibraryPage);
    $('sourceFilter').addEventListener('change',resetLibraryPage);
    $('availabilityFilter').addEventListener('change',resetLibraryPage);
    $('collectionFilter').addEventListener('change',resetLibraryPage);
    $('wordPrevButton').addEventListener('click',()=>{wordPage=Math.max(0,wordPage-1);renderWords();$('wordListSummary').focus?.();});
    $('wordNextButton').addEventListener('click',()=>{wordPage+=1;renderWords();$('wordListSummary').focus?.();});
    $('historyMoreButton').addEventListener('click',()=>{historyLimit+=25;renderHistory();});
    $('libraryPracticeButton').addEventListener('click',practiceSavedWords);
    $('appearanceMode').addEventListener('change',e=>{ settings={...settings,appearance:e.target.value}; saveState(); applyAppearance(); });
    $('answerSounds').addEventListener('change',e=>{ settings={...settings,answerSounds:Boolean(e.target.checked)}; saveState(); });
    $('showKeys').addEventListener('change',e=>{ const type=e.target.checked?'text':'password';$('dictionaryKey').type=type;$('thesaurusKey').type=type; });
    $('saveKeysButton').addEventListener('click',saveKeysFromForm);
    $('testKeysButton').addEventListener('click',testKeys);
    $('exportProgressButton').addEventListener('click',exportProgress);
    $('importProgressInput').addEventListener('change',e=>{const f=e.target.files?.[0];if(f) importProgress(f);e.target.value='';});
    $('resetProgressButton').addEventListener('click',resetProgress);
    window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); installPrompt=e; updateInstallUI(); });
    window.addEventListener('appinstalled',()=>{ installPrompt=null; updateInstallUI(); showToast('Vocabulary Builder installed.'); });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{ if ((settings.appearance || 'system') === 'system') applyAppearance(); });
    window.addEventListener('popstate',handlePopState);
    window.addEventListener('pagehide',()=>{ stopWordPronunciation(); if(session) persistSession(); });
    $('installButton').addEventListener('click',async()=>{ if(!installPrompt){updateInstallUI();return;} installPrompt.prompt(); await installPrompt.userChoice; installPrompt=null; updateInstallUI(); });
  }

  function applyPendingUpdateIfSafe() {
    if (!pendingUpdateReload || updateReloading || currentView!=='home' || session) return;
    updateReloading=true;
    location.reload();
  }

  function initServiceWorker() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost','127.0.0.1'].includes(location.hostname))) {
      const hadController=Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange',()=>{
        if (currentView==='settings') void updateOfflinePackStatus();
        if (!hadController || updateReloading) return;
        if (currentView==='home' && !session) {
          updateReloading=true;
          location.reload();
          return;
        }
        pendingUpdateReload=true;
        showToast('App update ready. It will apply when you return Home.');
      });
      navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'})
        .then(registration => registration.update())
        .catch(()=>{});
    }
  }

  function init() {
    applyAppearance();
    populateCollectionControls();
    configureEvents();
    wireBackAwareDisclosures();
    currentView='home';
    practicePhase='setup';
    history.replaceState(appHistoryState('home',null,{guard:true}),'','#home-guard');
    history.pushState(appHistoryState('home'),'','#home');
    renderHome();
    updateAppBar();
    initServiceWorker();
    updateInstallUI();
    if (settings.lastVersion !== APP_VERSION) {
      settings = {...settings, lastVersion:APP_VERSION};
      saveState();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
