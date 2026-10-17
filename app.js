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

  const APP_VERSION = '1.4';
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
  let settings = loadJson(SETTINGS_STORAGE, {sessionSize:10, direction:'word-def', levels:[1,2,3,4,5], source:'all', collection:'all', novelty:'balanced', appearance:'system', lastVersion:null});
  let session = null;
  let installPrompt = null;
  let currentWordDetail = null;
  let pronunciationAudio = null;
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

  function renderHome() {
    const studyItems = allStudyWords();
    const activeItems = studyItems.filter(({word}) => !getExistingWordState(word).suspended && !isInvalidSeed(word));
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

    const ready=Boolean(keys.dictionary);
    $('setupNotice').classList.toggle('hidden', ready);
    if (!ready) $('setupNoticeText').textContent='Dictionary setup is needed before practice.';
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
    $('questionDirection').value = settings.direction || 'word-def';
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

    let pool = allStudyWords().filter(w => levels.includes(w.level) && !getExistingWordState(w.word).suspended && !isInvalidSeed(w.word));
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
      const sourceMessage = source==='personal' ? 'No saved words match these filters.' :
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
    if (!keys.dictionary) { switchView('settings'); $('dictionaryKey').focus(); return; }
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

  function isPedagogicallyUsefulDefinition(definition, word) {
    const value=String(definition || '').trim();
    if (!value || isCircularDefinition(value,word)) return false;
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
    let chosen=senses[0] || null;
    let score=0;
    for (const sense of senses) {
      const similarity=definitionSimilarity(target,sense.definition);
      if (similarity>score && similarity>=0.40) {
        chosen=sense;
        score=similarity;
      }
    }
    // If that sense has no example, do not steal one from an unrelated sense.
    const direct=chosen?.examples || [];
    const supplemental=Array.isArray(entry?.suppl?.examples) ? entry.suppl.examples.map(item=>cleanMwText(item?.t)).filter(Boolean) : [];
    // Supplemental examples are not sense-linked. Use only when the entry has
    // one dictionary sense, or no sense-linked examples exist in the entry.
    const canUseSupplemental=senses.length<=1 || senses.every(sense=>!sense.examples.length);
    const candidates=direct.length ? direct : (canUseSupplemental ? supplemental : []);
    const uniqueExamples=[...new Set(candidates.map(value=>String(value).trim()).filter(Boolean))];
    // Prefer a full sentence when Merriam-Webster supplied one, while retaining
    // accurate shorter usage illustrations rather than fabricating sentences.
    uniqueExamples.sort((a,b)=>Number(looksLikeSentence(b))-Number(looksLikeSentence(a)));
    return uniqueExamples.slice(0,3);
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
    const entry = [...pool].sort((a,b)=>entryPedagogyScore(b,word)-entryPedagogyScore(a,word))[0];
    const shortdefs = [...new Set((entry.shortdef || []).map(value => String(value || '').trim()).filter(Boolean))].slice(0,3);
    const learnerDefinitions=learnerDefinitionsFromEntry(entry,word);
    const studyDefinitions=[...new Set([...learnerDefinitions,...shortdefs])];
    const definition = chooseStudyDefinition(studyDefinitions, word);
    const quizDefinition = chooseQuizDefinition(studyDefinitions, word);
    const answerDefinition = chooseAnswerDefinition(studyDefinitions, word);
    const examples=examplesForTeachingSense(entry,definition);
    if (!definition || !quizDefinition) throw new Error(`No useful quiz definition for ${word}.`);
    return {
      word:String(word || '').toLowerCase(),
      headword: normalizeHeadword(entry.hwi?.hw) || word,
      partOfSpeech: entry.suppl?.ldq?.fl || entry.fl || '',
      shortdefs,
      learnerDefinitions,
      studyDefinitions,
      definition,
      quizDefinition,
      answerDefinition,
      example:examples[0] || '',
      examples,
      syllables:String(entry.hwi?.hw || '').replace(/\*/g,'·').replace(/\s+/g,' ').trim(),
      audioUrl:pronunciationAudioUrl(entry),
      origin:wordOrigin(entry),
      definitionStyle:learnerDefinitions.length ? 'learner' : 'collegiate',
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
    list.innerHTML='';
    for (const def of more) { const li=document.createElement('li'); li.textContent=def; list.appendChild(li); }
    details.classList.toggle('hidden', more.length===0);
    if (!more.length) details.open=false;

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
    $('wordDetailLoading').textContent=`Loading ${normalized}…`;
    try {
      const dictionary=entry || await getDictionary(normalized);
      currentWordDetail.entry=dictionary;
      renderWordDetail(dictionary);
      $('wordDetailWord').focus();
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
    if (!keys.thesaurus) {
      panel.textContent='Related-word access is not configured. Add the Merriam-Webster Thesaurus key in Settings.';
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
    if (!keys.dictionary) { switchView('settings'); $('dictionaryKey').focus(); return; }
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
    if (!keys.dictionary) { status.textContent='Dictionary access is not configured. Open Settings first.'; return; }
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

  function candidateScore(targetItem, targetEntry, candidateItem, candidateEntry, similarity) {
    let score=0;
    if (targetEntry.partOfSpeech && candidateEntry.partOfSpeech && targetEntry.partOfSpeech===candidateEntry.partOfSpeech) score += 5;
    const levelDifference=Math.abs((targetItem.level||3)-(candidateItem.level||3));
    if (levelDifference===0) score += 3;
    else if (levelDifference===1) score += 2;
    const sharedCollections=sharedCollectionCount(targetItem,candidateItem);
    if (sharedCollections===1) score += 2;
    else if (sharedCollections>=2) score += 1;
    score += Math.max(0, 2 - similarity*4);
    return score;
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
      : allStudyWords().filter(word => (!getExistingWordState(word.word).suspended && !isInvalidSeed(word.word)) || word.word===item.word);

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
    const candidateItems=[
      ...sameLevel(backupFresh),...nearLevel(backupFresh),...otherLevel(backupFresh),
      ...sameLevel(backupRecent),...nearLevel(backupRecent),...otherLevel(backupRecent),
      ...sessionFresh,...sessionRecent
    ].slice(0,7);
    const batchWords=[item.word,...candidateItems.map(candidate=>candidate.word)];
    const loaded=await getDictionaryBatch(batchWords);
    const targetResult=loaded.get(String(item.word).toLowerCase());
    if (!targetResult?.entry) throw targetResult?.error || new Error(`No usable definition for ${item.word}.`);
    const target=targetResult.entry;
    if (!target.quizDefinition) throw new Error(`No useful quiz definition for ${item.word}.`);

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
      const normalizedDefinition=String(entry.quizDefinition||'').toLowerCase().trim();
      if (!normalizedDefinition || seenDefinitions.has(normalizedDefinition)) continue;
      const similarity=definitionSimilarity(target.quizDefinition,entry.quizDefinition);
      if (similarity>0.32) continue;
      if (sharedCollectionCount(item,candidate)>=2 && similarity>0.12) continue;
      seenDefinitions.add(normalizedDefinition);
      const recentWord=recentOptionWords.has(String(candidate.word).toLowerCase());
      const recentDefinition=recentlyUsedDefinition(entry.quizDefinition);
      let score=candidateScore(item,target,candidate,entry,similarity);
      if (recentWord) score-=8;
      if (recentDefinition) score-=10;
      candidates.push({item:candidate,entry,similarity,score,recentWord,recentDefinition});
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
    const feedback=$('feedbackPanel');
    feedback.className='feedback hidden';
    $('feedbackHeading').textContent='';
    $('feedbackText').textContent='';
    $('feedbackExample').textContent='';
    $('feedbackExample').classList.add('hidden');
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

  function answerQuestion(option, button) {
    if (!session?.current || session.current.answered) return;
    session.current.answered=true;
    const q=session.current;
    const isCorrect=option.correct===true;
    const isPlacement=session.mode==='placement';

    // Replace the question immediately. Hidden answer controls cannot leak stale labels to TalkBack.
    $('questionCard').classList.add('hidden');
    $('questionCard').setAttribute('aria-hidden','true');

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
    $('feedbackHeading').textContent=isCorrect ? 'Correct' : 'Not quite';
    const wordAndPart=q.target.partOfSpeech ? `${q.item.word}, ${q.target.partOfSpeech}` : q.item.word;
    $('feedbackText').textContent=isCorrect
      ? `${wordAndPart}. ${primaryDefinition}`
      : `${wordAndPart}. ${primaryDefinition}${isPlacement ? '' : ' This word will return later.'}`;
    const illustration=String(q.target.example || q.target.examples?.[0] || '').trim();
    $('feedbackExample').textContent=illustration ? `${looksLikeSentence(illustration) ? 'Example sentence' : 'Usage example'}: ${illustration}` : '';
    $('feedbackExample').classList.toggle('hidden',!illustration);
    $('wordFacts').innerHTML='';
    addFact('Source','Merriam-Webster Collegiate Dictionary');
    renderOfficialDefinitions(q.target);
    if (isPlacement) {
      addFact('Placement','Does not change study progress');
      $('detailsButton').classList.add('hidden');
      $('feedbackSaveButton').classList.add('hidden');
      $('feedbackOpenWordButton').classList.add('hidden');
      $('luckyGuessButton').classList.add('hidden');
    } else {
      addFact('Mastery',statusOf(state));
      $('detailsButton').classList.remove('hidden');
      $('luckyGuessButton').classList.toggle('hidden',!isCorrect);
      $('detailsButton').textContent='Show synonyms and antonyms';
      $('feedbackSaveButton').classList.toggle('hidden',isSavedWord(q.item.word));
      $('feedbackSaveButton').textContent='Save word';
      $('feedbackOpenWordButton').classList.remove('hidden');
    }
    $('nextQuestionButton').textContent='Next word';
    $('nextQuestionButton').onclick=nextQuestion;
    updateQuestionCounter();
    session.resumeIndex=session.index+1;
    persistSession();
    panel.classList.remove('hidden');
    requestAnimationFrame(()=> $('feedbackHeading').focus());
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
    panel.textContent = 'Loading official thesaurus information…';
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

  function renderSettings() {
    $('dictionaryKey').value = keys.dictionary || '';
    $('thesaurusKey').value = keys.thesaurus || '';
    $('showKeys').checked = false;
    $('appearanceMode').value = settings.appearance || 'system';
    $('dictionaryKey').type='password'; $('thesaurusKey').type='password';
    const dictionaryReady=Boolean(keys.dictionary);
    const thesaurusReady=Boolean(keys.thesaurus);
    $('keyStatus').textContent = dictionaryReady
      ? (thesaurusReady ? 'Dictionary and thesaurus are ready.' : 'Dictionary is ready. Add a thesaurus key only for synonyms and antonyms.')
      : 'Add a dictionary API key before practice.';
    setDetailsOpen($('referenceSettings'),!dictionaryReady);
  }

  function saveKeysFromForm() {
    keys = {dictionary:$('dictionaryKey').value.trim(), thesaurus:$('thesaurusKey').value.trim()};
    saveKeys();
    transientDictionary.clear(); transientThesaurus.clear();
    $('keyStatus').textContent = keys.dictionary
      ? (keys.thesaurus ? 'Dictionary and thesaurus are ready.' : 'Dictionary is ready. Thesaurus is optional.')
      : 'Add a dictionary API key before practice.';
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
    if (!keys.dictionary) { switchView('settings'); return; }
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
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      const hadController=Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange',()=>{
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
