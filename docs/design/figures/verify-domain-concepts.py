"""Run from the repository root; compare with pre-layout commit 502dcdd."""
from pathlib import Path
import re,subprocess,collections,xml.etree.ElementTree as ET
before=subprocess.check_output(['git','show','502dcdd:docs/design/domain-data-model.md'],text=True)
b=re.search(r'```mermaid\n(.*?)```',before,re.S).group(1)
a=Path('docs/design/figures/domain-concepts.mmd').read_text()
def data(s):
 return (collections.Counter(re.findall(r'^\s+(\w+)\[([^\]]+)\]$',s,re.M)),collections.Counter(re.findall(r'^\s+(\w+) -->\|([^|]+)\| (\w+)$',s,re.M)))
bn,be=data(b);an,ae=data(a)
assert bn==an and be==ae
assert len(an)==15 and len(ae)==49 and max(an.values())==max(ae.values())==1
r=ET.parse('docs/design/figures/domain-concepts.svg').getroot()
nodes=[x for x in r.iter() if x.tag.endswith('g') and 'node' in x.get('class','').split()]
paths=[x for x in r.iter() if x.tag.endswith('path') and x.get('data-edge')=='true']
labels=[x for x in r.iter() if x.tag.endswith('g') and x.get('class')=='edgeLabel']
assert (len(nodes),len(paths),len(labels))==(15,49,49)
assert collections.Counter(''.join(n.itertext()) for n in nodes)==collections.Counter(name for _,name in an)
assert collections.Counter(''.join(n.itertext()) for n in labels)==collections.Counter(l for _,l,_ in ae)
assert collections.Counter(tuple(p.attrib['data-id'].split('_')[1:3]) for p in paths)==collections.Counter((src,dst) for src,_,dst in ae)
assert all(p.get('marker-end') for p in paths)
label_by_id={child.attrib['data-id']: ''.join(label.itertext()) for label in labels for child in label if child.get('data-id')}
assert collections.Counter((p.attrib['data-id'].split('_')[1], label_by_id[p.attrib['data-id']], p.attrib['data-id'].split('_')[2]) for p in paths)==ae
print('PASS: before/after 15 nodes and 49 directed labeled relations identical; SVG contains all 15 names, 49 labels, 49 directed paths with arrowheads.')
print('PASS: additions 0; deletions 0; duplicate nodes/relations 0; direction/label changes 0.')
for path in [Path('docs/design/domain-data-model.md'),Path('docs/design/figures/README.md')]:
 for target in re.findall(r'\]\(([^)]+)\)',path.read_text()):
  if re.match(r'^[a-z]+://',target) or target.startswith('#'):continue
  assert (path.parent/target.split('#')[0]).exists(),target
print('PASS: local document links resolve.')
