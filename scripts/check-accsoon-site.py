from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit,unquote
import json,subprocess,xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]
class Page(HTMLParser):
    def __init__(self,text):
        super().__init__();self.tags=[];self.ld=[];self.current=None;self.feed(text)
    def handle_starttag(self,tag,attrs):
        a=dict(attrs);self.tags.append((tag,a))
        if tag=='script' and a.get('type')=='application/ld+json':self.current=''
    def handle_data(self,data):
        if self.current is not None:self.current+=data
    def handle_endtag(self,tag):
        if tag=='script' and self.current is not None:self.ld.append(json.loads(self.current));self.current=None
files=['index.html','ios/index.html','android/index.html','accsoon/index.html','privacy/index.html','how-to/index.html','tutorial/index.html','share/index.html','portal/index.html']
for name in files:
    p=root/name;data=Page(p.read_text());ids=[a['id'] for t,a in data.tags if 'id' in a]
    assert len(ids)==len(set(ids)),('duplicate IDs',name)
    base=next((root/a['href'].lstrip('/') for t,a in data.tags if t=='base'),p.parent)
    for t,a in data.tags:
        ref=a.get('src') if t in ['img','script','source'] else a.get('href') if t in ['a','link'] else None
        if not ref:continue
        u=urlsplit(ref)
        if u.scheme or u.netloc:continue
        if not u.path:
            if u.fragment:assert unquote(u.fragment) in ids,(name,ref)
            continue
        target=root/u.path.lstrip('/') if u.path.startswith('/') else base/u.path
        if target.is_dir():target=target/'index.html'
        assert target.exists(),(name,ref)
    assert 'ios-1.2_android-1.4' not in p.read_text(),name
accsoon=Page((root/'accsoon/index.html').read_text())
assert not any(t=='meta' and a.get('http-equiv')=='refresh' for t,a in accsoon.tags)
checkout=[a for t,a in accsoon.tags if 'data-polar-checkout' in a]
assert len(checkout)==1
assert checkout[0]['href']=='https://buy.polar.sh/polar_cl_dTt6tjCC72odX8klBDNtfj7HfAJtex0ACnuz120DAT0'
assert any(t=='a' and a.get('href')==checkout[0]['href'] and 'data-polar-checkout' not in a for t,a in accsoon.tags)
assert '/accsoon/announcement.css' in (root/'index.html').read_text()
assert 'id="accsoon-partnership"' in (root/'index.html').read_text()
for name in ['index.html','ios/index.html','android/index.html']:
    assert '/icon-48.png' in (root/name).read_text() or '/parallax-icon-48.png' in (root/name).read_text()
# /ios/ and /android/ are redirect stubs to the single home page: check they still point there.
# So are /share/ and the two per-platform tutorial pages (to the single tutorials page).
for name,target in [('ios/index.html','/'),('android/index.html','/'),('share/index.html','/'),('ios/tutorial/index.html','/tutorial/'),('android/tutorial/index.html','/tutorial/')]:
    stub=Page((root/name).read_text())
    assert any(t=='link' and a.get('rel')=='canonical' and a.get('href')=='https://www.parallaxmonitor.com'+target for t,a in stub.tags),name
    assert any(t=='meta' and a.get('http-equiv')=='refresh' and a.get('content')=='0; url='+target for t,a in stub.tags),name
    assert any(t=='a' and a.get('href')==target for t,a in stub.tags),name
    assert any(t=='meta' and a.get('name')=='robots' and a.get('content','').startswith('noindex') for t,a in stub.tags),name
for anchor in ['ios','android']:
    assert any(a.get('id')==anchor for t,a in Page((root/'index.html').read_text()).tags),anchor
ET.parse(root/'sitemap.xml')
for f in (root/'accsoon/assets').glob('*.svg'):ET.parse(f)
subprocess.run(['git','diff','--check'],check=True)
print('PASS: 9 pages, local assets/links, anchors, unique IDs, structured data, checkout target and fallback, favicon retention, SVG/XML and whitespace.')
