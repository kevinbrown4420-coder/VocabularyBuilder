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

  const LEVEL_NAMES = {1:'Common',2:'Intermediate',3:'Advanced',4:'Expert',5:'Obscure'};
  const STATUS_NAMES = ['New','Learning','Familiar','Strong','Mastered'];
  const DUE_MS = [0, 86400000, 3*86400000, 10*86400000, 30*86400000];
  const KEY_STORAGE = 'vocabTrackerKeysV01';
  const PROGRESS_STORAGE = 'vocabTrackerProgressV01';
  const SETTINGS_STORAGE = 'vocabTrackerSettingsV01';

  const $ = id => document.getElementById(id);
  const qs = sel => document.querySelector(sel);
  const qsa = sel => [...document.querySelectorAll(sel)];

  let keys = loadJson(KEY_STORAGE, {dictionary:'', thesaurus:''});
  let progress = loadJson(PROGRESS_STORAGE, defaultProgress());
  let settings = loadJson(SETTINGS_STORAGE, {sessionSize:10, direction:'word-def', levels:[1,2,3], focusedPractice:false});
  let session = null;
  let installPrompt = null;
  const transientDictionary = new Map();
  const transientThesaurus = new Map();

  function defaultProgress() {
    return {
      words: {},
      totals: {answers:0, correct:0, sessions:0},
      streak: {current:0, longest:0, lastStudyDate:null}
    };
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

  function wordState(word) {
    if (!progress.words[word]) {
      progress.words[word] = {mastery:0, seen:0, correct:0, wrong:0, nextDue:0, lastSeen:null};
    }
    return progress.words[word];
  }

  function getExistingWordState(word) {
    return progress.words[word] || {mastery:0, seen:0, correct:0, wrong:0, nextDue:0, lastSeen:null};
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
    const recycled = Math.max(0, total - session.plannedCount);
    const current = session.queue[session.index];
    let text = `Question ${session.index+1} of ${total}`;
    if (current?.repeat) text += ' — recycled review of a missed word';
    else if (recycled) text += ` — ${recycled} recycled review${recycled===1?'':'s'} added`;
    $('questionCounter').textContent = text;
  }

  function switchView(name, focus=true) {
    qsa('.view').forEach(v => v.classList.add('hidden'));
    $(`view-${name}`).classList.remove('hidden');
    qsa('.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.view===name ? 'page' : 'false'));
    if (name === 'home') renderHome();
    if (name === 'words') renderWords();
    if (name === 'stats') renderStats();
    if (name === 'settings') renderSettings();
    if (name === 'practice' && !session) renderPracticeSetup();
    if (name !== 'practice' && !session) setFocusedPracticeActive(false);
    if (focus) $('main').focus();
  }

  function renderHome() {
    const states = WORDS.map(({word}) => getExistingWordState(word));
    const seen = states.filter(s => s.seen>0);
    const mastered = seen.filter(s => s.mastery===4).length;
    const learning = seen.filter(s => s.mastery>0 && s.mastery<4).length;
    const due = seen.filter(s => s.nextDue && s.nextDue <= Date.now()).length;
    $('homeMastered').textContent = mastered;
    $('homeLearning').textContent = learning;
    $('homeDue').textContent = due;
    $('homeAccuracy').textContent = accuracy(progress.totals.correct, progress.totals.answers);
    $('homeStreak').textContent = progress.streak?.current || 0;
    $('homeSeen').textContent = seen.length;
    const ready = Boolean(keys.dictionary && keys.thesaurus);
    $('setupNotice').textContent = ready
      ? 'Reference keys are configured on this device. Practice is ready.'
      : 'Before your first practice session, open Settings and enter your two Merriam-Webster API keys.';
    $('startPracticeButton').disabled = !ready;
    $('reviewDueButton').disabled = !ready || due===0;
    const difficult = seen.filter(s => s.wrong>0 && (s.correct+s.wrong) && s.correct/(s.correct+s.wrong)<0.7).length;
    $('reviewMissedButton').disabled = !ready || difficult===0;
  }

  function renderPracticeSetup() {
    $('practiceSetup').classList.remove('hidden');
    $('quizArea').classList.add('hidden');
    $('sessionComplete').classList.add('hidden');
    $('endSessionButton').classList.add('hidden');
    $('sessionSize').value = String(settings.sessionSize || 10);
    $('questionDirection').value = settings.direction || 'word-def';
    qsa('input[name="level"]').forEach(cb => cb.checked = (settings.levels || [1,2,3]).includes(Number(cb.value)));
  }

  function buildSession(mode='normal') {
    const levels = qsa('input[name="level"]:checked').map(cb => Number(cb.value));
    if (!levels.length) {
      showToast('Select at least one difficulty level.');
      return null;
    }
    const size = Number($('sessionSize').value);
    const direction = $('questionDirection').value;
    settings = {...settings, sessionSize:size, direction, levels};
    saveState();

    const pool = WORDS.filter(w => levels.includes(w.level));
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
      candidates = [...shuffle(due), ...shuffle(fresh), ...shuffle(continuing), ...shuffle(mastered)];
    }
    const unique = [];
    const seenWords = new Set();
    for (const item of candidates) {
      if (!seenWords.has(item.word)) { unique.push(item); seenWords.add(item.word); }
    }
    const selected = unique.slice(0, Math.min(size, unique.length));
    if (!selected.length) {
      showToast(mode==='due' ? 'No words are due in the selected levels.' : 'No matching words are available.');
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
      plannedCount:selected.length
    };
  }

  async function beginSession(mode='normal') {
    if (!keys.dictionary) { switchView('settings'); $('dictionaryKey').focus(); return; }
    const built = buildSession(mode);
    if (!built) return;
    session = built;
    setFocusedPracticeActive(true);
    $('practiceSetup').classList.add('hidden');
    $('sessionComplete').classList.add('hidden');
    $('quizArea').classList.remove('hidden');
    $('endSessionButton').classList.remove('hidden');
    await presentQuestion();
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

  async function makeQuestion(item) {
    const levelPool = WORDS.filter(w => w.word!==item.word && (w.level===item.level || Math.abs(w.level-item.level)<=1));
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
      $('nextQuestionButton').onclick = () => { session.index += 1; presentQuestion(); };
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
    session.answered += 1;
    if (isCorrect) session.correct += 1;
    updateWordProgress(q.item.word, isCorrect);

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
      const repeatExists = session.queue.slice(session.index+1).some(x => x.word===q.item.word && x.repeat);
      if (!repeatExists) {
        const insertAt = Math.min(session.queue.length, session.index + 5);
        session.queue.splice(insertAt, 0, {...q.item, repeat:true});
        showToast(`${q.item.word} will return later for review.`);
      }
    }

    const state = getExistingWordState(q.item.word);
    const panel = $('feedbackPanel');
    panel.className = `feedback ${isCorrect ? 'correct' : 'incorrect'}`;
    panel.classList.remove('hidden');
    $('feedbackHeading').textContent = isCorrect ? 'Correct' : 'Incorrect';
    $('feedbackText').textContent = isCorrect
      ? `${q.item.word}: ${q.target.definition}`
      : `The correct answer is ${q.direction==='word-def' ? q.target.definition : q.item.word}. This word will return later in this session.`;
    $('wordFacts').innerHTML = '';
    addFact('Word', q.target.headword || q.item.word);
    if (q.target.partOfSpeech) addFact('Part of speech', q.target.partOfSpeech);
    addFact('Mastery', statusOf(state));
    addFact('Record', `${state.correct} correct, ${state.wrong} incorrect`);
    $('detailsButton').classList.remove('hidden');
    $('detailsButton').textContent = 'Show synonyms and antonyms';
    $('detailsButton').disabled = false;
    $('nextQuestionButton').textContent = 'Next question';
    $('nextQuestionButton').onclick = nextQuestion;
    updateQuestionCounter();
    panel.focus();
    renderHome();
  }

  function addFact(term, value) {
    const dl = $('wordFacts');
    const dt = document.createElement('dt'); dt.textContent = term;
    const dd = document.createElement('dd'); dd.textContent = value;
    dl.append(dt,dd);
  }

  async function showDetails() {
    if (!session?.current) return;
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
      if (t.synonyms.length) {
        const p = document.createElement('p'); p.innerHTML = '<strong>Synonyms:</strong> ';
        p.append(document.createTextNode(t.synonyms.join(', '))); panel.appendChild(p);
      }
      if (t.antonyms.length) {
        const p = document.createElement('p'); p.innerHTML = '<strong>Antonyms:</strong> ';
        p.append(document.createTextNode(t.antonyms.join(', '))); panel.appendChild(p);
      }
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
    presentQuestion();
  }

  function finishSession() {
    if (!session) return;
    const summary = session;
    progress.totals.sessions += 1;
    saveState();
    session.completed = true;
    $('quizArea').classList.add('hidden');
    $('endSessionButton').classList.add('hidden');
    $('sessionComplete').classList.remove('hidden');
    const recycled = Math.max(0, summary.queue.length - summary.plannedCount);
    const composition = recycled
      ? `${summary.plannedCount} planned plus ${recycled} recycled review${recycled===1?'':'s'}`
      : `${summary.plannedCount} planned questions`;
    $('sessionSummary').textContent = `You answered ${summary.answered} questions (${composition}) with ${summary.correct} correct (${accuracy(summary.correct,summary.answered)}).`;
    setFocusedPracticeActive(false);
    $('sessionComplete').focus();
    session = null;
    renderHome();
    renderStats();
  }

  function endSession() {
    if (!session) return;
    const ok = confirm('End this session now? Answers already completed will remain in your progress.');
    if (!ok) return;
    session = null;
    setFocusedPracticeActive(false);
    renderPracticeSetup();
  }

  function renderWords() {
    const search = $('wordSearch')?.value?.trim().toLowerCase() || '';
    const status = $('statusFilter')?.value || 'all';
    const level = $('levelFilter')?.value || 'all';
    const items = WORDS.filter(item => {
      const s = getExistingWordState(item.word);
      return (!search || item.word.includes(search)) && (status==='all' || statusOf(s)===status) && (level==='all' || String(item.level)===level);
    }).sort((a,b)=>a.word.localeCompare(b.word));
    $('wordListSummary').textContent = `${items.length} words shown.`;
    const list = $('wordList'); list.innerHTML='';
    items.forEach(item => {
      const s = getExistingWordState(item.word);
      const li=document.createElement('li');
      const h=document.createElement('h3'); h.textContent=item.word;
      const p1=document.createElement('p'); p1.textContent=`Level ${item.level}: ${LEVEL_NAMES[item.level]} — ${statusOf(s)}`;
      const p2=document.createElement('p'); p2.textContent=s.seen ? `${s.correct} correct, ${s.wrong} incorrect; accuracy ${accuracy(s.correct,s.correct+s.wrong)}` : 'Not encountered yet.';
      li.append(h,p1,p2); list.appendChild(li);
    });
  }

  function renderStats() {
    const dl = $('overallStats'); dl.innerHTML='';
    const seenCount = WORDS.filter(({word})=>getExistingWordState(word).seen>0).length;
    const mastered = WORDS.filter(({word})=>getExistingWordState(word).mastery===4).length;
    const stats = [
      ['Total answers', progress.totals.answers],
      ['Correct answers', progress.totals.correct],
      ['Overall accuracy', accuracy(progress.totals.correct,progress.totals.answers)],
      ['Completed sessions', progress.totals.sessions],
      ['Words encountered', `${seenCount} of ${WORDS.length}`],
      ['Words mastered', mastered],
      ['Current study streak', `${progress.streak?.current || 0} days`],
      ['Longest study streak', `${progress.streak?.longest || 0} days`]
    ];
    stats.forEach(([k,v])=>{const dt=document.createElement('dt');dt.textContent=k;const dd=document.createElement('dd');dd.textContent=v;dl.append(dt,dd);});
    const levelStats=$('levelStats'); levelStats.innerHTML='';
    for(let level=1;level<=5;level++){
      const words=WORDS.filter(x=>x.level===level);
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
      saveState();
      renderHome();renderWords();renderStats();
      showToast('Progress backup imported.');
    } catch(e) { showToast(`Import failed: ${e.message}`); }
  }

  function resetProgress() {
    if(!confirm('Reset all vocabulary progress and statistics? Your API keys will be kept.')) return;
    progress=defaultProgress(); saveState(); renderHome();renderWords();renderStats();
    showToast('Study progress reset.');
  }

  function configureEvents() {
    qsa('.tabs button').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $('startPracticeButton').addEventListener('click',()=>{switchView('practice'); beginSession('normal');});
    $('reviewDueButton').addEventListener('click',()=>{switchView('practice'); beginSession('due');});
    $('reviewMissedButton').addEventListener('click',()=>{switchView('practice'); beginSession('difficult');});
    $('beginSessionButton').addEventListener('click',()=>beginSession('normal'));
    $('endSessionButton').addEventListener('click',endSession);
    $('anotherSessionButton').addEventListener('click',()=>renderPracticeSetup());
    $('detailsButton').addEventListener('click',showDetails);
    $('wordSearch').addEventListener('input',renderWords);
    $('statusFilter').addEventListener('change',renderWords);
    $('levelFilter').addEventListener('change',renderWords);
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
      e.preventDefault(); installPrompt=e; $('installButton').classList.remove('hidden');
    });
    $('installButton').addEventListener('click',async()=>{
      if(!installPrompt){showToast('Use your browser menu and choose Install app or Add to Home screen.');return;}
      installPrompt.prompt(); await installPrompt.userChoice; installPrompt=null; $('installButton').classList.add('hidden');
    });
  }

  function initServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js').catch(()=>{});
    }
  }

  function init() {
    configureEvents();
    renderHome(); renderWords(); renderStats(); renderSettings(); renderPracticeSetup();
    initServiceWorker();
    if (!keys.dictionary || !keys.thesaurus) {
      $('setupNotice').textContent='Before your first practice session, open Settings and enter your two Merriam-Webster API keys.';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
