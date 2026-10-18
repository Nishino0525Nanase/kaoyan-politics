'use strict';
(() => {
  const KEY = 'zhizheng-politics-v1';
  const TYPES = { single: '单项选择', multiple: '多项选择', analysis: '分析题' };
  const SUBJECTS = [
    ['all', '全部学科', '从知识点出发', '全'], ['马原', '马克思主义基本原理', '原理与方法', '理'],
    ['毛中特', '毛泽东思想和中特理论', '理论与实践', '论'], ['新思想', '习近平新时代中国特色社会主义思想', '新时代 · 新思想', '新'],
    ['史纲', '中国近现代史纲要', '历史与选择', '史'], ['思法', '思想道德与法治', '修养与法治', '法'],
    ['时政', '形势与政策及当代世界', '时代与世界', '时'], ['综合', '综合专题', '跨学科思考', '综']
  ];
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt !== undefined) n.textContent = txt; return n; };
  let data = { questions: [], years: [], metadata: {} }, questions = [], queue = [], index = 0, selected = [], revealed = false;
  let filter = { view: 'all', subject: 'all', year: 'all', type: 'all', topic: 'all', keyword: '' };
  let state = { records: {}, favorites: [], drafts: {}, lastQuestionId: null }, retrying = false, toastTimer;
  let storageAvailable = true;

  function subjectKey(value) {
    const s = String(value || '综合');
    if (/新思想|习近平/.test(s)) return '新思想';
    if (/马原|马克思主义基本/.test(s)) return '马原';
    if (/毛中特|毛泽东|中国特色社会主义理论/.test(s)) return '毛中特';
    if (/史纲|近现代史/.test(s)) return '史纲';
    if (/思法|思修|思想道德|法律基础|道德修养/.test(s)) return '思法';
    if (/时政|形势|政策|当代世界/.test(s)) return '时政';
    return '综合';
  }
  function normalizeQuestion(q) {
    const answer = Array.isArray(q.answer) ? q.answer.map(String).map(x => x.trim().toUpperCase()).filter(x => /^[A-D]$/.test(x)) : typeof q.answer === 'string' ? (q.answer.match(/[A-D]/gi) || []).map(x => x.toUpperCase()) : [];
    return { ...q, id: String(q.id), year: Number(q.year), number: Number(q.number), subjectKey: subjectKey(q.subject), tags: Array.isArray(q.tags) ? q.tags.map(String) : [], type: TYPES[q.type] ? q.type : 'analysis', answer: [...new Set(answer)], topic: String(q.topic || '未细分专题'), stem: String(q.stem || ''), options: q.options && typeof q.options === 'object' ? q.options : null };
  }
  function readState() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved === 'object') {
        state.records = saved.records && typeof saved.records === 'object' && !Array.isArray(saved.records) ? saved.records : {};
        state.favorites = Array.isArray(saved.favorites) ? saved.favorites.filter(x => typeof x === 'string') : [];
        state.drafts = saved.drafts && typeof saved.drafts === 'object' && !Array.isArray(saved.drafts) ? saved.drafts : {};
        state.lastQuestionId = typeof saved.lastQuestionId === 'string' ? saved.lastQuestionId : null;
      }
    } catch (_) { storageAvailable = false; }
  }
  function saveState() {
    try { localStorage.setItem(KEY, JSON.stringify({ ...state, version: 1 })); }
    catch (_) { if (storageAvailable) toast('当前浏览器无法保存进度，请及时导出备份。'); storageAvailable = false; }
  }
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600); }
  function isWrong(q) { return state.records[q.id]?.correct === false; }
  function knownAnswer(q) { return q.type !== 'analysis' && q.answer.length > 0 && q.answer.every(k => q.options && Object.prototype.hasOwnProperty.call(q.options, k)); }
  function hasReference(q) { return q.type === 'analysis' ? !!(q.referenceAnswer || q.explanation) : knownAnswer(q); }
  function safeLink(url, title) { const a = el('a', '', title || '查看原始资料'); try { const u = new URL(url, location.href); if (!['https:', 'http:'].includes(u.protocol)) throw new Error(); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; } catch (_) { return el('span', '', '来源链接暂缺'); } }

  function updateStats() {
    const valid = questions.filter(q => state.records[q.id]);
    const graded = valid.filter(q => q.type !== 'analysis' && typeof state.records[q.id].correct === 'boolean' && state.records[q.id].method !== 'self');
    const right = graded.filter(q => state.records[q.id].correct).length;
    const wrong = questions.filter(isWrong).length;
    const favorites = questions.filter(q => state.favorites.includes(q.id)).length;
    $('practiced-value').textContent = valid.length;
    $('total-value').textContent = ` / ${questions.length}`;
    $('progress-bar').style.width = questions.length ? `${valid.length / questions.length * 100}%` : '0%';
    $('accuracy-value').textContent = graded.length ? `${Math.round(right / graded.length * 100)}%` : '—';
    $('accuracy-caption').textContent = graded.length ? `${graded.length} 道已判分 · ${right} 道答对` : '提交答案后开始统计';
    $('review-value').textContent = wrong;
    $('wrong-count').textContent = wrong;
    $('favorite-count').textContent = favorites;
    $('resume-button').hidden = !state.lastQuestionId || !questions.some(q => q.id === state.lastQuestionId);
    if (!storageAvailable) document.querySelector('.backup-title').textContent = '当前浏览器暂时无法保存';
  }
  function renderSubjects() {
    $('subject-list').replaceChildren();
    for (const [key, name, desc, symbol] of SUBJECTS) {
      const count = key === 'all' ? questions.length : questions.filter(q => q.subjectKey === key).length;
      if (!count && key !== 'all') continue;
      const button = el('button', `subject-button${filter.subject === key ? ' active' : ''}`);
      button.type = 'button'; button.setAttribute('aria-pressed', String(filter.subject === key));
      button.append(el('span', 'subject-symbol', symbol));
      const title = el('span', 'subject-text', key === 'all' ? name : key === '毛中特' ? '毛中特' : key === '新思想' ? '新思想' : key === '时政' ? '时政与当代' : name);
      title.append(el('small', '', desc)); button.append(title, el('span', 'subject-number', count));
      button.addEventListener('click', () => { filter.subject = key; filter.topic = 'all'; applyFilters(); });
      $('subject-list').append(button);
    }
  }
  function baseMatches(q, omitTopic = false) {
    if (filter.view === 'wrong' && !isWrong(q)) return false;
    if (filter.view === 'favorite' && !state.favorites.includes(q.id)) return false;
    if (filter.subject !== 'all' && q.subjectKey !== filter.subject) return false;
    if (filter.year !== 'all' && q.year !== Number(filter.year)) return false;
    if (filter.type !== 'all' && q.type !== filter.type) return false;
    if (!omitTopic && filter.topic !== 'all' && q.topic !== filter.topic && !q.tags.includes(filter.topic)) return false;
    const needle = filter.keyword.trim().toLocaleLowerCase();
    if (needle && ![q.stem, q.topic, q.subject, ...q.tags, ...Object.values(q.options || {})].join(' ').toLocaleLowerCase().includes(needle)) return false;
    return true;
  }
  function renderTopics() {
    const base = questions.filter(q => baseMatches(q, true)), counts = new Map();
    base.forEach(q => { const names = new Set([q.topic]); names.forEach(name => { if (name && name !== '未细分专题') counts.set(name, (counts.get(name) || 0) + 1); }); });
    const topics = [...counts.entries()].sort((a,b) => b[1] - a[1]);
    $('topic-chips').replaceChildren();
    const make = (name, count) => {
      const b = el('button', `topic-chip${filter.topic === name ? ' active' : ''}`, name === 'all' ? '全部专题' : name);
      b.setAttribute('aria-pressed', String(filter.topic === name)); if (count !== null) b.append(el('small', '', count));
      b.addEventListener('click', () => { filter.topic = name; applyFilters(); }); $('topic-chips').append(b);
    };
    make('all', base.length); topics.forEach(([name, count]) => make(name,count));
    if (filter.topic !== 'all' && !counts.has(filter.topic)) make(filter.topic,0);
  }
  function applyFilters(preferredId) {
    queue = questions.filter(q => baseMatches(q)).sort((a,b) => b.year - a.year || a.number - b.number);
    index = Math.max(0, queue.findIndex(q => q.id === preferredId));
    $('year-filter').value = filter.year; $('type-filter').value = filter.type; $('keyword-filter').value = filter.keyword;
    const titles = { all: '专题练习', paper: '整卷练习', wrong: '错题巩固', favorite: '我的收藏' };
    $('practice-heading').textContent = titles[filter.view];
    $('result-count').textContent = `${queue.length} 道真题`;
    $('paper-note').hidden = filter.view !== 'paper';
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === filter.view));
    renderSubjects(); renderTopics(); renderQuestion(); updateStats();
  }
  function viewChange(view) {
    filter = { view, subject:'all', year: view === 'paper' ? String(Math.max(...questions.map(q => q.year))) : 'all', type:'all', topic:'all', keyword:'' };
    applyFilters();
  }
  function emptyState() {
    $('question-card').hidden = true; $('pagination').hidden = true; $('empty-state').hidden = false;
    $('queue-position').textContent = '没有符合条件的题目';
    const noFilter = filter.subject === 'all' && filter.year === 'all' && filter.type === 'all' && filter.topic === 'all' && !filter.keyword;
    $('empty-title').textContent = filter.view === 'wrong' && noFilter ? '这里还没有待巩固题目' : filter.view === 'favorite' && noFilter ? '把值得再想一遍的题收在这里' : '暂时没有找到这类题目';
    $('empty-description').textContent = filter.view === 'wrong' && noFilter ? '提交答案后，做错的选择题和标记“继续巩固”的分析题会自动出现在这里。' : filter.view === 'favorite' && noFilter ? '点击题目右上角的收藏按钮，就能随时回来复习。' : '试着减少一个筛选条件，或换一个关键词。';
    $('empty-reset').hidden = false;
  }
  function renderQuestion() {
    if (!queue.length) { emptyState(); return; }
    $('question-card').hidden = false; $('pagination').hidden = false; $('empty-state').hidden = true;
    const q = queue[index], record = state.records[q.id];
    retrying = false; selected = [];
    revealed = !!record;
    if (record && Array.isArray(record.selected)) selected = record.selected.filter(x => /^[A-D]$/.test(x));
    else if (Array.isArray(state.drafts[q.id]?.selected)) selected = state.drafts[q.id].selected.filter(x => /^[A-D]$/.test(x));
    $('queue-position').textContent = `${filter.view === 'paper' ? q.year + ' 年试卷 · ' : ''}第 ${index + 1} / ${queue.length} 题`;
    $('previous-question').disabled = index === 0; $('next-question').disabled = index === queue.length - 1;
    $('question-badges').replaceChildren(el('span','badge type',TYPES[q.type]), el('span','badge',`${q.year} 年真题`), el('span','badge divider','/'), el('span','badge',`第 ${q.number} 题`));
    $('question-topic').textContent = `${q.subjectKey}  ·  ${q.topic}${q.knowledgePoint && q.knowledgePoint !== q.topic ? '  /  ' + q.knowledgePoint : ''}`;
    $('question-stem').textContent = q.stem;
    renderImages(q);
    $('analysis-input').hidden = q.type !== 'analysis'; $('question-options').hidden = q.type === 'analysis';
    $('analysis-answer').value = typeof state.drafts[q.id]?.text === 'string' ? state.drafts[q.id].text : typeof record?.text === 'string' ? record.text : '';
    $('analysis-answer').disabled = revealed;
    $('submit-answer').textContent = q.type === 'analysis' ? '查看参考答案 →' : '提交答案 →';
    $('answer-hint').textContent = q.type === 'analysis' ? '先独立思考，再对照参考答案' : q.type === 'multiple' ? '多项选择 · 请选择所有正确选项' : '单项选择 · 请选择一个答案';
    $('question-actions').hidden = revealed;
    updateFavorite(); renderOptions(); renderAnswer();
    state.lastQuestionId = q.id; saveState();
    $('data-notice').textContent = '资料按原题年份整理；历史时政与政策请结合现行考纲。答案暂缺的题目不自动判分。';
  }
  function updateFavorite() {
    const q = queue[index]; if (!q) return;
    const fav = state.favorites.includes(q.id); $('favorite-button').setAttribute('aria-pressed', String(fav));
    $('favorite-icon').textContent = fav ? '★' : '☆'; $('favorite-label').textContent = fav ? '已收藏' : '收藏';
  }
  function renderImages(q) {
    $('question-images').replaceChildren();
    if (q.figureNote || q.missingImage) $('question-images').append(el('p','figure-note',String(q.figureNote || '此题包含原卷配图，目前暂未收录。请先查看原始资料中的图示再作答。')));
    if (!Array.isArray(q.imageUrls)) return;
    q.imageUrls.forEach((url, i) => {
      if (typeof url !== 'string') return;
      let resolved;
      try { resolved = new URL(url, location.href); if (!['https:', 'http:'].includes(resolved.protocol)) return; } catch (_) { return; }
      const box = el('figure','question-figure'), link = safeLink(resolved.href,'');
      const img = el('img'); img.src = resolved.href; img.alt = `${q.year} 年第 ${q.number} 题配图 ${i + 1}`; img.loading = 'lazy';
      img.addEventListener('error', () => { img.remove(); link.textContent = '配图暂无法显示，打开原图查看 ↗'; box.classList.add('image-failed'); });
      link.append(img); box.append(link,el('figcaption','',`题目配图 ${i + 1} · 点击查看原图`)); $('question-images').append(box);
    });
  }
  function renderOptions() {
    const q = queue[index]; $('question-options').replaceChildren();
    if (!q || q.type === 'analysis') return;
    const canGrade = knownAnswer(q);
    for (const [letter, value] of Object.entries(q.options || {})) {
      if (!/^[A-D]$/.test(letter)) continue;
      const chosen = selected.includes(letter), correct = revealed && canGrade && q.answer.includes(letter), wrong = revealed && canGrade && chosen && !q.answer.includes(letter);
      const b = el('button', `option${q.type === 'multiple' ? ' multiple' : ''}${chosen ? ' selected' : ''}${correct ? ' correct' : ''}${wrong ? ' incorrect' : ''}`);
      b.type = 'button'; b.setAttribute('role', q.type === 'single' ? 'radio' : 'checkbox'); b.setAttribute('aria-checked', String(chosen)); b.disabled = revealed;
      b.append(el('span','option-letter',letter),el('span','option-label',String(value)));
      if (correct) b.append(el('span','option-status','✓')); if (wrong) b.append(el('span','option-status','×'));
      b.addEventListener('click', () => {
        selected = q.type === 'single' ? [letter] : chosen ? selected.filter(x => x !== letter) : [...selected,letter];
        state.drafts[q.id] = { ...state.drafts[q.id], selected }; saveState(); renderOptions();
      });
      $('question-options').append(b);
    }
    if (!Object.keys(q.options || {}).length) $('question-options').append(el('p','answer-note','此题的选项暂未完整收录，请查看原始资料。'));
  }
  function section(title, text) { const box = el('div','reference-section'); box.append(el('h4','',title),el('p','',text)); return box; }
  function renderAnswer() {
    $('answer-panel').hidden = !revealed; if (!revealed) return;
    const q = queue[index], record = state.records[q.id];
    $('answer-result').replaceChildren(); $('answer-result').className = 'answer-result'; $('reference-content').replaceChildren();
    $('self-rate').hidden = q.type !== 'analysis';
    if (q.type === 'analysis') {
      $('answer-result').classList.add('neutral'); $('answer-result').append(el('span','',record?.correct === true ? '✓ 已标记掌握' : record?.correct === false ? '↻ 已加入待巩固' : '对照参考，自主评估'));
      const ref = q.referenceAnswer || q.explanation;
      $('reference-content').append(section(ref ? '参考作答要点' : '参考答案暂缺', ref || '此题尚未收录可核验的参考答案。请打开下方原始资料，结合教材核对后再标记掌握情况。'));
      if (q.referenceAnswer && q.explanation && q.referenceAnswer !== q.explanation) $('reference-content').append(section('知识点提示',q.explanation));
      document.querySelectorAll('[data-self-rate]').forEach(b => { const active = typeof record?.correct === 'boolean' && String(record.correct) === b.dataset.selfRate; b.classList.toggle('active',active); b.setAttribute('aria-pressed',String(active)); });
    } else if (knownAnswer(q)) {
      const right = [...selected].sort().join('') === [...q.answer].sort().join('');
      $('answer-result').classList.toggle('wrong',!right);
      $('answer-result').append(el('span','',right ? '✓ 回答正确，继续保持' : '↻ 再想一遍这个知识点'));
      $('answer-result').append(el('span','answer-summary',`正确答案 ${q.answer.join('、')}  ·  你的答案 ${selected.join('、') || '未作答'}`));
      $('reference-content').append(section(q.explanation ? '知识点提示' : '知识点提示暂缺', q.explanation || '已收录参考答案，知识点提示暂缺。可通过下方来源查看原始资料。'));
    } else {
      $('answer-result').classList.add('neutral'); $('answer-result').textContent = '答案暂缺，本题不自动判分';
      $('reference-content').append(section('核对提示', q.explanation || '尚未收录可核验的参考答案。你的作答已保存；请打开原始资料核对，本题不会计入正确率或错题统计。'));
    }
    $('question-source').replaceChildren(el('span','','资料来源：'),safeLink(q.sourceUrl,q.sourceTitle || '查看原题与答案 ↗'));
    const sourceUrls = new Set([q.sourceUrl]);
    for (const source of Array.isArray(q.sourceLinks) ? q.sourceLinks : []) {
      if (source?.url && !sourceUrls.has(source.url)) {
        $('question-source').append(safeLink(source.url,source.title || '补充来源 ↗'));
        sourceUrls.add(source.url);
      }
    }
    if (q.sourceNote) $('question-source').append(el('span','source-note',String(q.sourceNote)));
    if (q.verified === false) $('question-source').append(el('span','','· 公开资料转录'));
  }
  function submit() {
    const q = queue[index]; if (!q) return;
    if (q.type !== 'analysis' && !selected.length && q.options && Object.keys(q.options).length) { toast('先选择你的答案，再提交。'); return; }
    const correct = q.type === 'analysis' ? null : knownAnswer(q) ? [...selected].sort().join('') === [...q.answer].sort().join('') : null;
    state.records[q.id] = { selected: [...selected], correct, at: new Date().toISOString(), method: q.type === 'analysis' ? 'self' : 'answer', text: q.type === 'analysis' ? $('analysis-answer').value : '' };
    revealed = true; retrying = false; saveState(); $('question-actions').hidden = true; $('analysis-answer').disabled = true; renderOptions(); renderAnswer(); updateStats();
  }
  function selfRate(correct) {
    const q = queue[index]; if (!q || q.type !== 'analysis' || !revealed) return;
    state.records[q.id] = { ...state.records[q.id], correct, method:'self', at:new Date().toISOString(), text:$('analysis-answer').value };
    saveState(); renderAnswer(); updateStats(); toast(correct ? '已记录：掌握了这道题。' : '已加入错题本，留给下一次巩固。');
  }
  function next(delta) { if (index + delta < 0 || index + delta >= queue.length) return; index += delta; renderQuestion(); $('question-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function showData() {
    const answers = questions.filter(hasReference).length;
    const covered = new Set(questions.map(q => q.year));
    $('data-summary').textContent = `当前收录 ${covered.size} 个年份、${questions.length} 道真题，${answers} 道已提供答案或参考作答要点。资料来自公开原卷及机构参考答案；部分来源的选项顺序可能不同，以本题库题干选项与配套答案为准。各年覆盖情况如下。`;
    $('coverage-body').replaceChildren();
    for (let year = 2026; year >= 2007; year--) {
      const qs = questions.filter(q => q.year === year), tr = el('tr');
      tr.append(el('td','',`${year}`), ...['single','multiple','analysis'].map(t => el('td',qs.length ? '' : 'coverage-missing',qs.filter(q => q.type === t).length)));
      tr.append(el('td', qs.some(q => !hasReference(q)) ? 'coverage-missing' : '',`${qs.filter(hasReference).length} / ${qs.length}`));
      const td = el('td'), first = qs.find(q => q.sourceUrl); if (first) td.append(safeLink(first.sourceUrl,'查看来源 ↗')); else td.textContent = '暂未收录'; tr.append(td); $('coverage-body').append(tr);
    }
    $('metadata-notes').replaceChildren();
    const notes = ['note','notes','description','answerNote','contextNote','verificationNote'].map(key => data.metadata?.[key]).filter(Boolean);
    notes.forEach(note => $('metadata-notes').append(el('p','metadata-note',Array.isArray(note) ? note.join('\n') : String(note))));
    if (typeof $('data-dialog').showModal === 'function') $('data-dialog').showModal(); else $('data-dialog').setAttribute('open','');
  }
  function exportBackup() {
    const out = { app:'知政考研政治真题', version:1, exportedAt:new Date().toISOString(), ...state };
    const blob = new Blob([JSON.stringify(out,null,2)],{type:'application/json'}), url = URL.createObjectURL(blob), a = el('a');
    a.href = url; a.download = `知政学习记录_${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('学习记录已导出。');
  }
  async function importBackup(file) {
    if (!file) return;
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('文件过大');
      const incoming = JSON.parse(await file.text());
      if (!incoming || typeof incoming !== 'object' || !incoming.records || typeof incoming.records !== 'object' || !Array.isArray(incoming.favorites)) throw new Error('格式不正确');
      const ids = new Set(questions.map(q => q.id)); let count = 0;
      for (const [id,r] of Object.entries(incoming.records)) {
        if (!ids.has(id) || !r || typeof r !== 'object') continue;
        const clean = { selected:Array.isArray(r.selected) ? r.selected.filter(x => typeof x === 'string' && /^[A-D]$/.test(x)) : [], correct: typeof r.correct === 'boolean' ? r.correct : null, method:r.method === 'self' ? 'self' : 'answer', at:typeof r.at === 'string' ? r.at : new Date().toISOString(), text:typeof r.text === 'string' ? r.text.slice(0,100000) : '' };
        if (!state.records[id] || new Date(clean.at).getTime() >= new Date(state.records[id].at || 0).getTime()) state.records[id] = clean;
        count++;
      }
      state.favorites = [...new Set([...state.favorites,...incoming.favorites.filter(x => typeof x === 'string' && ids.has(x))])];
      if (incoming.drafts && typeof incoming.drafts === 'object') for (const [id,d] of Object.entries(incoming.drafts)) { if (ids.has(id) && d && typeof d === 'object' && !state.drafts[id]) state.drafts[id] = { selected:Array.isArray(d.selected) ? d.selected.filter(x => /^[A-D]$/.test(x)) : [], text:typeof d.text === 'string' ? d.text.slice(0,100000) : '' }; }
      if (ids.has(incoming.lastQuestionId)) state.lastQuestionId = incoming.lastQuestionId;
      saveState(); applyFilters(); toast(`已合并 ${count} 道题的作答记录与收藏。`);
    } catch (_) { toast('无法导入：请选择从本站导出的 JSON 学习记录。'); }
    $('backup-file').value = '';
  }
  function bindEvents() {
    document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click',() => viewChange(b.dataset.view)));
    $('review-link').addEventListener('click',() => viewChange('wrong'));
    $('year-filter').addEventListener('change',e => { filter.year = e.target.value; filter.topic='all'; applyFilters(); });
    $('type-filter').addEventListener('change',e => { filter.type = e.target.value; filter.topic='all'; applyFilters(); });
    let keywordTimer; $('keyword-filter').addEventListener('input',e => { clearTimeout(keywordTimer); keywordTimer = setTimeout(() => { filter.keyword = e.target.value; applyFilters(); },220); });
    $('reset-filters').addEventListener('click',() => { const view = filter.view; filter = { view,subject:'all',year:view === 'paper' ? String(Math.max(...questions.map(q => q.year))) : 'all',type:'all',topic:'all',keyword:'' }; applyFilters(); });
    $('empty-reset').addEventListener('click',() => viewChange('all'));
    $('previous-question').addEventListener('click',() => next(-1)); $('next-question').addEventListener('click',() => next(1));
    $('submit-answer').addEventListener('click',submit);
    $('favorite-button').addEventListener('click',() => { const q = queue[index]; if (!q) return; const found = state.favorites.includes(q.id); state.favorites = found ? state.favorites.filter(id => id !== q.id) : [...state.favorites,q.id]; saveState(); updateFavorite(); updateStats(); toast(found ? '已取消收藏。' : '已加入收藏夹。'); });
    $('retry-answer').addEventListener('click',() => { const q = queue[index]; retrying = true; revealed = false; selected = []; $('question-actions').hidden = false; $('analysis-answer').disabled = false; state.drafts[q.id] = {text:$('analysis-answer').value,selected:[]}; saveState(); renderOptions(); renderAnswer(); toast('可以重新作答，提交后会更新记录。'); });
    $('analysis-answer').addEventListener('input',e => { const q = queue[index]; if (!q) return; state.drafts[q.id] = {...state.drafts[q.id],text:e.target.value}; saveState(); });
    document.querySelectorAll('[data-self-rate]').forEach(b => b.addEventListener('click',() => selfRate(b.dataset.selfRate === 'true')));
    $('shuffle-button').addEventListener('click',() => { if (!queue.length) return; for(let i=queue.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[queue[i],queue[j]]=[queue[j],queue[i]];} index=0; renderQuestion(); toast('已打乱当前筛选结果的顺序。'); });
    $('resume-button').addEventListener('click',() => { const id = state.lastQuestionId; filter = {view:'all',subject:'all',year:'all',type:'all',topic:'all',keyword:''}; applyFilters(id); });
    $('open-data').addEventListener('click',showData); $('open-data-secondary').addEventListener('click',showData);
    $('close-data').addEventListener('click',() => $('data-dialog').close()); $('data-dialog').addEventListener('click',e => { if (e.target === $('data-dialog')) { const r=e.target.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) e.target.close(); } });
    $('export-backup').addEventListener('click',exportBackup); $('import-backup').addEventListener('click',() => $('backup-file').click()); $('backup-file').addEventListener('change',e => importBackup(e.target.files[0]));
  }
  async function init() {
    document.body.classList.add('loading'); readState(); bindEvents();
    for(let year=2026;year>=2007;year--){ const o=el('option','',`${year} 年`);o.value=String(year);$('year-filter').append(o); }
    try {
      const response = await fetch('./questions.json'); if(!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json(); if(!Array.isArray(data.questions)) throw new Error('题库格式不正确');
      questions = data.questions.filter(q => q && q.id && q.stem).map(normalizeQuestion);
      document.body.classList.remove('loading');
      if(!questions.length) throw new Error('题库为空');
      const resume = state.lastQuestionId; applyFilters(resume);
    } catch(error) {
      document.body.classList.remove('loading'); $('question-card').hidden=true; $('pagination').hidden=true; $('empty-state').hidden=false;
      $('empty-title').textContent='题库暂时没有载入成功'; $('empty-description').textContent='请刷新页面重试。如果直接打开下载文件，请通过网站链接访问。'; $('queue-position').textContent='连接题库失败'; $('result-count').textContent='暂未载入'; $('data-notice').textContent='学习记录仍保存在当前浏览器中。';
      console.error('Question data could not be loaded:',error);
    }
  }
  init();
})();
