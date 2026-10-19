#!/usr/bin/env node
/* Vocabulary Builder 2.0 alpha: dependency-free offline curriculum + question QA.
   Run: npm test.  Tests intentionally disable network requests. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = __dirname;
const file = name => fs.readFileSync(path.join(root,name),'utf8');

(async () => {
  let networkRequests=0;
  const stored = new Map();
  const initialProgress = {
    words:{candid:{mastery:2,seen:5,correct:4,wrong:1,nextDue:0,lastSeen:123,suspended:false,markedKnown:false,luckyGuesses:0,saved:false}},
    customWords:[], totals:{answers:5,correct:4,sessions:1},
    streak:{current:1,longest:1,lastStudyDate:'2026-10-17'},
    placement:null,recentLookups:[],wordHistory:[],invalidSeeds:{}
  };
  stored.set('vocabTrackerProgressV01',JSON.stringify(initialProgress));
  const context = {
    window:{}, navigator:{onLine:false}, document:{addEventListener(){}},
    localStorage:{getItem:k=>stored.get(k) || null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
    fetch:()=>{networkRequests++;throw new Error('Unexpected network request while testing offline practice')},
    console,setTimeout,clearTimeout,Date,Math,JSON,Map,Set
  };
  context.window.window=context.window;
  vm.createContext(context);
  for(const name of ['curriculum.js','study-content.js']) vm.runInContext(file(name),context,{filename:name});
  const source=file('app.js');
  assert(source.includes("const APP_VERSION = '2.0-alpha'"));
  assert(source.includes("const PROGRESS_STORAGE = 'vocabTrackerProgressV01'"));
  assert(source.includes("const ACTIVE_SESSION_STORAGE = 'vocabTrackerActiveSessionV01'"));
  const marker="  document.addEventListener('DOMContentLoaded', init);";
  assert(source.includes(marker),'Unable to instrument app for tests');
  const exposed=source.replace(marker,`  window.__qa={localDictionary,makeQuestion,definitionSimilarity,nearEquivalentWords,clashesWithAnotherMeaning,
    setSession:s=>{session=s},allStudyWords,canPracticeWord,looksLikeSentence,updateWordProgress,
    getExistingWordState};\n${marker}`);
  vm.runInContext(exposed,context,{filename:'app.js'});
  const api=context.window.__qa;
  const words=api.allStudyWords();
  const reviewed=context.window.VOCAB_REVIEWED_CONTENT_V17;
  assert.equal(words.length,1155,'Unexpected curriculum count');
  assert.equal(Object.keys(reviewed).length,1155,'Reviewed teaching bank should have one entry per curriculum word');
  const tracked=new Set();
  let checked=0;
  const repeatedDefinitions=new Map();
  for(const item of words) {
    assert(!tracked.has(item.word),`Duplicate curriculum word: ${item.word}`);
    tracked.add(item.word);
    const entry=api.localDictionary(item.word);
    assert(entry,`No offline entry: ${item.word}`);
    assert(entry.local && entry.source==='Vocabulary Builder teaching definition',item.word);
    assert(entry.definition && entry.answerDefinition===entry.quizDefinition,`Definition mismatch: ${item.word}`);
    assert(entry.definition.length<=96,`Too-long answer definition: ${item.word}`);
    assert(entry.definition.split(/\s+/).length<=16,`Too-many-word answer definition: ${item.word}`);
    assert(api.looksLikeSentence(entry.example),`No full teaching sentence: ${item.word}`);
    assert(api.canPracticeWord(item),`Not eligible for local practice: ${item.word}`);
    assert(!/\b(?:such as|for example|including|especially|e\.g\.)\s*$/i.test(entry.definition),`Incomplete ending: ${item.word}`);
    const key=entry.definition.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    if(!repeatedDefinitions.has(key))repeatedDefinitions.set(key,[]);
    repeatedDefinitions.get(key).push(item.word);
    checked++;
  }
  assert.equal(checked,1155);
  const collisions=[...repeatedDefinitions.values()].filter(w=>w.length>1);
  console.log(`CURRICULUM: ${checked} unique words; all have complete, concise teaching definitions and example sentences.`);
  console.log(`REVIEW FLAGS: ${collisions.length} duplicate teaching-definition groups (may be intentional synonyms/spelling variants).`);

  let count=0;
  for(const direction of ['word-def','def-word']) {
    let passed=0;
    for(const item of words) {
      api.setSession({queue:[item],mode:'level',direction,index:0,answered:0,correct:0,plannedCount:1,
        recentOptionDefinitions:[],recentOptionWords:[]});
      const q=await api.makeQuestion(item);
      assert.equal(q.direction,direction);
      assert.equal(q.options.length,4,`${item.word}: not four choices`);
      assert.equal(q.options.filter(o=>o.correct).length,1,`${item.word}: not one correct choice`);
      assert.equal(new Set(q.options.map(o=>o.value.trim().toLowerCase())).size,4,`${item.word}: duplicate options`);
      const wrong=q.options.filter(o=>!o.correct);
      for(const option of wrong) {
        assert(!api.nearEquivalentWords(item.word,option.word),`${item.word}: near equivalent ${option.word}`);
        const entry=api.localDictionary(option.word);
        if(entry) {
          assert(api.definitionSimilarity(q.target.quizDefinition,entry.quizDefinition)<0.32,
            `${item.word}: competing meaning ${option.word}`);
          assert(!api.clashesWithAnotherMeaning(q.target,entry,direction),
            `${item.word}: competing alternate meaning ${option.word}`);
        }
      }
      for(let i=0;i<wrong.length;i++) for(let j=i+1;j<wrong.length;j++) {
        assert(!api.nearEquivalentWords(wrong[i].word,wrong[j].word),`${item.word}: duplicate wrong-word family`);
      }
      passed++;count++;
    }
    console.log(`${direction}: ${passed}/${words.length} four-choice questions validated`);
  }
  // Words with substantially overlapping meanings must never be distractors
  // for each other in either direction, even though they are valid study words.
  for(const [a,b] of [['adequate','sufficient'],['assume','presume'],['infer','deduce'],['ambiguous','equivocal']]) {
    assert(api.nearEquivalentWords(a,b),`Synonym safety regression: ${a}/${b}`);
  }
  assert.equal(networkRequests,0,'Offline quiz unexpectedly requested network access');
  assert.equal(api.getExistingWordState('candid').seen,5,'Previous progress did not load');
  api.updateWordProgress('candid',true);
  const saved=JSON.parse(stored.get('vocabTrackerProgressV01'));
  assert.equal(saved.words.candid.seen,6,'Progress not persisted');
  assert.equal(saved.words.candid.correct,5,'Correct-answer tracking damaged');
  assert.equal(saved.words.candid.mastery,3,'Review scheduling behavior unexpectedly changed');
  assert.equal(saved.totals.answers,6,'Totals not persisted');
  const sw=file('sw.js');
  assert(sw.includes('vocab-builder-static-v20a'),'Service worker cache not bumped');
  for(const required of ['index.html','styles.css','curriculum.js','study-content.js','app.js','manifest.webmanifest','icon-192.png','icon-512.png']) {
    assert(sw.includes(`'/${required}'`),`Not cached offline: ${required}`);
  }
  assert(sw.includes("url.pathname.startsWith('/api/')"),'API responses must not be cached');
  const html=file('index.html');
  for(const id of ['answerChoices','feedbackWord','feedbackDefinition','feedbackExample','nextQuestionButton']) {
    assert(html.includes(`id="${id}"`),`Missing touch-exploration element ${id}`);
  }
  console.log(`OFFLINE: ${networkRequests} network requests across ${count} questions; previous progress restored and updated.`);
  console.log('ACCESSIBILITY + CACHE: v1.9 reading controls preserved; all offline assets listed.');
  console.log('PASS: Version 2.0 alpha quality tests.');
})().catch(error=>{console.error('FAIL:',error.stack || error);process.exitCode=1;});
