"""Assemble manually reviewed year batches; refuse incomplete or invalid papers."""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BATCH = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT/'data'
questions = []
for name in ('early', 'middle', 'recent', 'latest'):
    data = json.loads((BATCH / f'{name}.json').read_text())
    questions.extend(data['questions'] if isinstance(data, dict) else data)
questions.sort(key=lambda q: (int(q['year']), int(q['number'])))
taxonomy = json.loads((ROOT/'scripts/taxonomy.json').read_text())
categories = {}
for name in ('early','middle','latest'):
    category_file = BATCH / f'{name}-categories.json'
    if category_file.exists():
        categories.update(json.loads(category_file.read_text()))
hint_file = BATCH / 'early-hints.json'
hints = json.loads(hint_file.read_text()) if hint_file.exists() else {}
figure_overrides = {
    '2008-17': ('2008-q17-original.png', '原卷漫画：地球忍无可忍。可点击图片查看。'),
    '2009-35': ('2009-q35-original.png', '原卷图：我国2007年4月—2008年11月CPI及PPI增长趋势。'),
    '2010-03': ('2010-q3-original.png', '原卷照片：北极熊无冰可依。'),
}
figure_sources = {
    '2008-17':'https://www.yeyulingfeng.com/wendang/325217.html',
    '2009-35':'https://www.yeyulingfeng.com/wendang/374276.html',
    '2010-03':'https://www.yeyulingfeng.com/wendang/325221.html',
}
for q in questions:
    q['knowledgePoint'] = q['topic']
    if q['id'] in categories:
        assert categories[q['id']] in taxonomy[q['subject']], (q['id'],categories[q['id']])
        q['topic'] = categories[q['id']]
        q['tags'] = list(dict.fromkeys([q['knowledgePoint'], *q.get('tags',[])]))
    if not q.get('explanation') and q['id'] in hints:
        q['explanation'] = hints[q['id']]
    if q['id'] == '2007-22' and not q.get('explanation'):
        q['explanation'] = '提高剩余价值率、加快资本周转、节约不变资本均有助于提高利润率。提高资本有机构成并不是一般意义上提高利润率的途径。本题采用研招网公布的参考答案ACD，来源差异见下方说明。'
    if q['id'] == '2012-04':
        q['missingImage'] = True
        q['figureNote'] = '原卷财富分布漫画暂未取得清晰配图；题干保留了“我们是99%”及财富两极分化的文字信息，可据此作答并查看来源。'
    if q['id'] in figure_overrides:
        file, note = figure_overrides[q['id']]
        if (ROOT / 'dist/assets' / file).exists():
            q['imageUrls'] = ['./assets/' + file]
            q['figureNote'] = note
            q.pop('missingImage', None)
            q.setdefault('sourceLinks', []).append({'title':'原卷配图来源','url':figure_sources[q['id']]})
assert len({q['id'] for q in questions}) == len(questions), 'Duplicate question ID'
assert len({(q['year'],q['number']) for q in questions}) == len(questions)
allowed_subjects = {'马原','毛中特','史纲','思法','新思想','时政','综合'}
warnings = []
for q in questions:
    assert 2007 <= q['year'] <= 2026, q['id']
    assert q['subject'] in allowed_subjects, (q['id'],q['subject'])
    assert q.get('topic'), q['id']
    assert len(q['stem']) >= 4, q['id']
    assert q.get('sourceUrl','').startswith(('https://','http://')), q['id']
    q.setdefault('tags', [])
    q.setdefault('explanation', None)
    q.setdefault('referenceAnswer', None)
    if q['type'] != 'analysis':
        assert set(q['options']) == {'A','B','C','D'}, q['id']
        assert all(isinstance(v,str) and v.strip() for v in q['options'].values()), q['id']
        answer = q.get('answer')
        if answer:
            assert isinstance(answer,list) and set(answer) <= set('ABCD'), q['id']
            assert len(answer) == len(set(answer)), q['id']
            assert len(answer) == 1 if q['type']=='single' else 2 <= len(answer) <= 4, q['id']
        else:
            warnings.append(f"{q['id']}: no answer")
    else:
        if len(q['stem']) < 180:
            warnings.append(f"{q['id']}: short material ({len(q['stem'])})")
        if not q.get('referenceAnswer'):
            warnings.append(f"{q['id']}: no reference answer")
    if any(s in q['stem'] for s in ('\\u', '\ufffd', '<script', '<p>')):
        warnings.append(f"{q['id']}: possible encoding/markup")

years = []
for year in range(2007,2027):
    paper = [q for q in questions if q['year']==year]
    counts=Counter(q['type'] for q in paper)
    assert {q['number'] for q in paper}==set(range(1,39)), (year,counts)
    assert counts=={'single':16,'multiple':17,'analysis':5}, (year,counts)
    years.append({'year':year,'total':len(paper),'single':16,'multiple':17,'analysis':5,
                  'answered':sum(bool(q.get('answer')) for q in paper),
                  'references':sum(bool(q.get('referenceAnswer')) for q in paper),
                  'sources':list(dict.fromkeys(q['sourceUrl'] for q in paper))})

result = {'metadata':{'title':'2007—2026 考研政治专题真题库','updatedAt':'2026-10-18',
    'total':len(questions),'coverage':'2007—2026，20年，每年38题',
    'answerNote':'选择题答案为公开参考答案；选项顺序以本题库为准。分析题提供参考作答要点，采用自评。',
    'contextNote':'旧题保留考试当年语境，历史时政与旧表述用于真题训练，复习时结合现行教材。',
    'progressNote':'作答、错题、收藏与笔记保存在当前浏览器，可导出备份后在其他设备导入。',
    'verificationNote':'题干选项按公开试卷整理，知识点标签和简短学习提示为本题库编写；来源链接逐题保留。'},
    'years':years,'questions':questions}
(ROOT/'dist/questions.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
(ROOT/'scripts/data-audit.json').write_text(json.dumps({'total':len(questions),'years':years,'warnings':warnings},ensure_ascii=False,indent=2))
print(json.dumps({'total':len(questions),'years':len(years),'types':Counter(q['type'] for q in questions),'subjects':Counter(q['subject'] for q in questions),'warnings':warnings},ensure_ascii=False,indent=2))
