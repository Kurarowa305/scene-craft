"""Orient Mermaid SVG groups left to right without changing reference arrows.

Usage: python3 layout-domain-concepts.py raw.svg domain-concepts.svg
Render domain-concepts.mmd with mermaid-cli 12.0.0 (Mermaid 12.2.0) before this step.
"""
import sys
from pathlib import Path
import xml.etree.ElementTree as ET
ET.register_namespace('','http://www.w3.org/2000/svg')
ET.register_namespace('xhtml','http://www.w3.org/1999/xhtml')
p=Path(sys.argv[1]);root=ET.fromstring(p.read_text());ns='{http://www.w3.org/2000/svg}'
x,y,w,h=map(float,root.attrib['viewBox'].split())
for el in root.iter(ns+'g'):
 if el.get('class')=='edgeLabel' and ''.join(el.itertext())=='親実行':
  import re
  tx,ty=map(float,re.findall(r'[-\d.]+',el.get('transform')))
  el.set('transform',f'translate({tx+65},{ty})')
for f in root.iter(ns+'foreignObject'):
 fx=float(f.get('x',0));fw=float(f.get('width'))
 f.set('transform',f'translate({2*fx+fw},0) scale(-1,1)')
wrap=ET.Element(ns+'g',{'transform':f'translate({2*x+w},0) scale(-1,1)'})
for child in list(root):
 if child.tag not in [ns+'style',ns+'defs',ns+'title',ns+'desc']:
  root.remove(child);wrap.append(child)
root.append(wrap)
Path(sys.argv[2]).write_text(ET.tostring(root,encoding='unicode'))
