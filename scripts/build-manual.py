#!/usr/bin/env python3
"""Build the user manual pages under /manual/ from the fragments in manual/src/.

Each fragment is an HTML file named <slug>.html that starts with a small
front-matter block:

    <!--
    title: Exposure tools
    description: One sentence for search engines and link previews.
    kicker: Chapter 05
    -->
    ...article body (h1, p, h2 ...)...

Output: manual/index.html (for the "index" slug) or manual/<slug>/index.html,
plus manual/search-index.json used by the sidebar search.

Run from the repo root:  python3 scripts/build-manual.py
"""
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "manual", "src")
OUT = os.path.join(ROOT, "manual")
SITE = "https://www.parallaxmonitor.com"

BANNER_VERSION = "parallax-rename_ios-2.0_android-2.1.14"

TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title} | Parallax Monitor User Manual</title>
  <meta name="description" content="{description}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta name="theme-color" content="#09090b">
  <link rel="canonical" href="{canonical}">

  <meta property="og:title" content="{title} | Parallax Monitor User Manual">
  <meta property="og:description" content="{description}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="{canonical}">
  <meta property="og:site_name" content="Parallax Monitor">
  <meta property="og:image" content="{site}/parallax-icon-512.png">
  <meta property="og:locale" content="en_US">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{title} | Parallax Monitor User Manual">
  <meta name="twitter:description" content="{description}">
  <meta name="twitter:image" content="{site}/parallax-icon-512.png">

  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="48x48" href="/parallax-icon-48.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/parallax-icon-192.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/parallax-apple-touch-icon.png">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/manual/manual.css">

  <script>
    window.ZRCTL_UPDATE_BANNER_STORAGE_KEY = 'zrctl-update-banner-dismissed';
    window.ZRCTL_UPDATE_BANNER_VERSION = '{banner_version}';
    try {{
      if (localStorage.getItem(window.ZRCTL_UPDATE_BANNER_STORAGE_KEY) === window.ZRCTL_UPDATE_BANNER_VERSION) {{
        document.documentElement.classList.add('update-dismissed');
      }}
    }} catch (_) {{}}
  </script>
</head>
<body>
  <aside class="update-banner" aria-label="Parallax Monitor announcement">
    <div class="container update-banner-inner">
      <span class="update-copy"><strong>ZR Ctl is now Parallax Monitor.</strong> Same app, same developer, nothing to buy again.</span>
      <a href="https://apps.apple.com/us/app/parallax-monitor/id6762336561" target="_blank" rel="noopener" class="update-link">App Store</a>
      <a href="https://play.google.com/store/apps/details?id=com.zrctl.android&amp;pcampaignid=web_share" target="_blank" rel="noopener" class="update-link">Google Play</a>
      <button class="update-close" type="button" aria-label="Dismiss update notice">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  </aside>

  <nav class="site-nav">
    <div class="container">
      <a href="/" class="logo" aria-label="Parallax Monitor home">
        <img src="/parallax-icon-192.png" alt="" class="logo-img">
        <span>Parallax Monitor</span>
      </a>
      <ul class="nav-links" id="navLinks">
        <li><a href="/">Main Page</a></li>
        <li><a href="/#features">Features</a></li>
        <li><a href="/how-to/">How-to</a></li>
        <li><a href="/manual/" aria-current="page">Manual</a></li>
        <li><a href="/tutorial/">Tutorials</a></li>
        <li><a href="/#videos">Reviews</a></li>
        <li><a href="/#download" class="nav-cta">Download</a></li>
      </ul>
      <button class="hamburger" id="hamburger" type="button" aria-label="Menu" aria-expanded="false">
        <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
      </button>
    </div>
  </nav>

  <div class="container manual-shell">
    <button class="sidebar-toggle" id="sidebarToggle" type="button" aria-expanded="false" aria-controls="manualSidebar">
      <span>Manual contents</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <aside class="manual-sidebar" id="manualSidebar" aria-label="Manual navigation">
      <p class="sidebar-title">User Manual</p>
      <div class="sidebar-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="manualSearch" placeholder="Search the manual" aria-label="Search the manual" autocomplete="off">
      </div>
      <div class="search-results" id="searchResults" aria-live="polite"></div>
      <ul class="chapter-list" id="chapterList"></ul>
      <div>
        <p class="sidebar-title">On this page</p>
        <ul class="page-toc" id="pageToc"></ul>
      </div>
    </aside>

    <main class="manual-article" id="main">
{body}
      <nav class="chapter-nav" id="chapterNav" aria-label="Previous and next chapter"></nav>
      <p class="feedback-strip">Something missing or wrong on this page? Email <a href="mailto:mike@itsmadcreative.com?subject=Manual%20feedback%3A%20{subject}">mike@itsmadcreative.com</a> with the page name and what you expected to find.</p>
    </main>
  </div>

  <footer class="site-footer">
    <div class="container">
      <div class="footer-inner">
        <div class="footer-left">&copy; 2026 Parallax Monitor. All rights reserved.</div>
        <ul class="footer-links">
          <li><a href="/">Main Page</a></li>
          <li><a href="/#ios">iPhone &amp; iPad</a></li>
          <li><a href="/#android">Android</a></li>
          <li><a href="/how-to/">How-to</a></li>
          <li><a href="/manual/">Manual</a></li>
          <li><a href="/tutorial/">Tutorials</a></li>
          <li><a href="/privacy/">Privacy Policy</a></li>
          <li><a href="/compliance/">Compliance</a></li>
          <li><a href="mailto:mike@itsmadcreative.com">Support</a></li>
        </ul>
        <p class="footer-legal">
          Parallax Monitor is an independent project and is not affiliated, associated, authorized, endorsed by, or in any way officially connected with Nikon Corporation, Nikon Inc., or RED Digital Cinema. Accsoon integrations are developed in partnership with Accsoon. Nikon, Z, and related marks are trademarks of Nikon Corporation. RED, KOMODO, V-RAPTOR, R3D and IPP2 are trademarks of RED Digital Cinema. Other names and marks belong to their respective owners.
        </p>
      </div>
    </div>
  </footer>

  <script src="/manual/manual.js"></script>
</body>
</html>
"""

FRONT = re.compile(r"^\s*<!--(.*?)-->", re.S)
TAG = re.compile(r"<[^>]+>")
HEADING = re.compile(r"<(h2|h3)\b[^>]*\bid=\"([^\"]+)\"[^>]*>(.*?)</\1>", re.S)


def parse(path):
    raw = open(path, encoding="utf-8").read()
    m = FRONT.match(raw)
    if not m:
        sys.exit(f"{path}: missing front-matter comment")
    meta = {}
    for line in m.group(1).strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    body = raw[m.end():].strip("\n")
    for key in ("title", "description"):
        if key not in meta:
            sys.exit(f"{path}: front-matter needs '{key}'")
    return meta, body


def text_of(fragment):
    return html.unescape(re.sub(r"\s+", " ", TAG.sub(" ", fragment))).strip()


def index_entries(slug, title, body, url):
    """One search entry per h2/h3 with the text up to the next heading."""
    entries = []
    pos = 0
    matches = list(HEADING.finditer(body))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        section_text = text_of(body[m.end():end])[:400]
        entries.append({
            "chapter": title,
            "title": text_of(m.group(3)),
            "text": section_text,
            "url": f"{url}#{m.group(2)}",
        })
    # The chapter itself
    entries.insert(0, {"chapter": title, "title": title, "text": text_of(body)[:400], "url": url})
    return entries


def main():
    if not os.path.isdir(SRC):
        sys.exit(f"no fragments in {SRC}")
    search = []
    built = []
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".html"):
            continue
        slug = name[:-5]
        meta, body = parse(os.path.join(SRC, name))
        url = "/manual/" if slug == "index" else f"/manual/{slug}/"
        out_dir = OUT if slug == "index" else os.path.join(OUT, slug)
        os.makedirs(out_dir, exist_ok=True)
        page = TEMPLATE.format(
            title=html.escape(meta["title"], quote=True),
            description=html.escape(meta["description"], quote=True),
            canonical=SITE + url,
            site=SITE,
            banner_version=BANNER_VERSION,
            body=body,
            subject=html.escape(meta["title"].replace(" ", "%20"), quote=True),
        )
        with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as f:
            f.write(page)
        search.extend(index_entries(slug, meta["title"], body, url))
        built.append(url)
    with open(os.path.join(OUT, "search-index.json"), "w", encoding="utf-8") as f:
        json.dump(search, f, ensure_ascii=False, separators=(",", ":"))
    print(f"built {len(built)} pages, {len(search)} search entries")
    for u in built:
        print("  ", u)


if __name__ == "__main__":
    main()
