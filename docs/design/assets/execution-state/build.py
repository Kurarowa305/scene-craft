"""Regenerate static SVG state diagrams from the recorded transition contracts.
Run: python docs/design/assets/execution-state/build.py
Requires Graphviz (dot). No browser JavaScript or remote rendering is used.
"""
from pathlib import Path
import html,json,re,subprocess,textwrap,math

ROOT=Path(__file__).resolve().parent

def build():
    data=json.loads((ROOT/'transitions.json').read_text())
    edges={item['id']:item for item in data['transitions']}
    included=[i for diagram in data['diagrams'] for i in diagram['transitions']]
    if sorted(included)!=sorted(edges):raise ValueError('Each transition must appear exactly once')
    for diagram in data['diagrams']:
        selection=[edges[i] for i in diagram['transitions']]
        def target(e):
            # Repeat the stop-waiting node below reconciliation to keep this cycle downward.
            if diagram['id']=='reconciliation' and e['from']=='状態確認が必要' and e['to']=='停止待ち':return '停止待ち（照合後）'
            return e['to']
        nodes=list(dict.fromkeys(v for e in selection for v in (e['from'],target(e))))
        names={v:'state'+str(i) for i,v in enumerate(nodes)}
        lines=['digraph G {',
            '  graph [rankdir=TB, bgcolor="transparent", pad="0.35", nodesep="0.4", ranksep="0.65", splines=spline, outputorder=edgesfirst];',
            '  node [shape=box, style="rounded,filled", color="#9fb7ae", fillcolor="#edf2eb", fontname="Noto Sans CJK JP", fontsize=16, margin="0.22,0.16"];',
            '  edge [color="#48716b", fontcolor="#233b37", fontname="Noto Sans CJK JP", fontsize=15, arrowsize=0.8, penwidth=1.4];']
        for name in nodes:
            extra=''
            if name=='開始':extra=', shape=oval, fillcolor="#ffffff"'
            if name=='完了':extra=', peripheries=2'
            if name=='状態確認が必要':extra=', fillcolor="#fff3df", color="#b79b6a"'
            lines.append('  '+names[name]+' [label='+json.dumps(name.removesuffix('（照合後）'),ensure_ascii=False)+extra+'];')
        for edge in selection:
            width=math.ceil(len(edge['condition'])/math.ceil(len(edge['condition'])/14))
            label='\\n'.join(textwrap.wrap(edge['condition'],width=width))
            lines.append('  '+names[edge['from']]+' -> '+names[target(edge)]+' [id="transition-'+str(edge['id'])+'", label="'+label+'"];')
        lines.append('}')
        path=ROOT/diagram['id'];path.with_suffix('.dot').write_text('\n'.join(lines)+'\n')
        result=subprocess.run(['dot','-Tsvg',str(path.with_suffix('.dot'))],check=True,capture_output=True,text=True).stdout
        result=re.sub(r'<\?xml.*?\?>\s*|<!DOCTYPE.*?>\s*|<!--.*?-->\s*','',result,flags=re.S)
        title='依頼の状態遷移：'+diagram['title']
        description='。'.join(e['from']+'から'+e['to']+'へ：'+e['condition'] for e in selection)+'。'
        result=result.replace('<svg ','<svg role="img" aria-labelledby="diagram-title diagram-description" ',1)
        result=re.sub(r'(<svg\b[^>]*>)',lambda m:m[1]+'\n<title id="diagram-title">'+html.escape(title)+'</title>\n<desc id="diagram-description">'+html.escape(description)+'</desc>',result,count=1,flags=re.S)
        result=result.replace('<title>G</title>','')
        width,height=map(float,re.search(r'viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"',result).groups())
        diagram['width']=round(width);diagram['height']=round(height)
        path.with_suffix('.svg').write_text(result)
        print(diagram['id'],diagram['width'],diagram['height'])
    (ROOT/'transitions.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    page=ROOT.parents[1]/'execution-lifecycle.html'
    if page.exists():
        dimensions={d['id']:d for d in data['diagrams']}
        def sync(match):
            block=match.group();key=re.search(r'execution-state/([\w-]+)\.svg',block)[1];d=dimensions[key]
            block=re.sub(r'width="\d+"','width="'+str(d['width'])+'"',block)
            block=re.sub(r'height="\d+"','height="'+str(d['height'])+'"',block)
            return re.sub(r'--diagram-width: \d+px','--diagram-width: '+str(d['width'])+'px',block)
        page.write_text(re.sub(r'<img\b[^>]*class="state-transition-image"[^>]*>',sync,page.read_text(),flags=re.S))


if __name__=='__main__':build()
