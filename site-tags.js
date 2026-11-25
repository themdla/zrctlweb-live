/* Parallax Monitor site tags.
   Sets no cookies and stores nothing in the browser.

   1. Page views: Cloudflare Web Analytics, loaded only when CLOUDFLARE_TOKEN is filled in.
      It counts page views, referrers and paths. It cannot count clicks and it ignores query strings.
   2. Store links: every App Store and Google Play link is tagged with where the click came from,
      so App Store Connect and Play Console report store visits and sales by source.
      A visitor who lands with ?utm_source=meta&utm_campaign=song1 carries those values to the store.
   3. Links to other pages of this site keep the visitor's campaign values in the address,
      so a visitor from an ad is still counted for that ad after opening a second page. */
(function () {
  'use strict';

  var CLOUDFLARE_TOKEN = '25193517e664424c8500778682429eaf';   // Cloudflare dashboard > Web Analytics > Manage site > JS snippet
  var APPLE_PROVIDER_ID = '128765263';  // App Store Connect > App Analytics > campaign link generator ("pt" value)

  if (CLOUDFLARE_TOKEN) {
    var beacon = document.createElement('script');
    beacon.defer = true;
    beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    beacon.setAttribute('data-cf-beacon', JSON.stringify({ token: CLOUDFLARE_TOKEN }));
    document.head.appendChild(beacon);
  }

  function clean(value, max) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
  }

  var query = new URLSearchParams(window.location.search);
  var page = clean(window.location.pathname.replace(/^\/|\/$/g, '').replace(/\//g, '-'), 24) || 'home';
  var source = clean(query.get('utm_source'), 20) || 'website';
  var medium = clean(query.get('utm_medium'), 20) || 'site';
  var campaign = clean(query.get('utm_campaign'), 30) || page;
  var content = clean(query.get('utm_content'), 30);

  function tagPlay(link) {
    var url = new URL(link.href);
    if (url.searchParams.has('referrer')) return;
    var referrer = 'utm_source=' + source + '&utm_medium=' + medium + '&utm_campaign=' + campaign;
    if (content) referrer += '&utm_content=' + content;
    url.searchParams.set('referrer', referrer);
    link.href = url.toString();
  }

  function tagApple(link) {
    if (!APPLE_PROVIDER_ID) return;
    var url = new URL(link.href);
    if (url.searchParams.has('ct') || url.searchParams.has('see-all')) return;
    url.searchParams.set('pt', APPLE_PROVIDER_ID);
    url.searchParams.set('ct', (source + '-' + campaign).slice(0, 40));
    url.searchParams.set('mt', '8');
    link.href = url.toString();
  }

  function tagStoreLinks() {
    document.querySelectorAll('a[href^="https://play.google.com/store/apps/details"]').forEach(tagPlay);
    document.querySelectorAll('a[href^="https://apps.apple.com/"]').forEach(tagApple);
  }

  var CAMPAIGN_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];

  function carryCampaign() {
    if (!query.get('utm_source') && !query.get('utm_campaign')) return;
    document.querySelectorAll('a[href]').forEach(function (link) {
      var raw = link.getAttribute('href');
      if (!raw || raw.charAt(0) === '#') return;
      var url;
      try { url = new URL(raw, window.location.href); } catch (error) { return; }
      if (url.origin !== window.location.origin) return;
      if (/\.[a-z0-9]{2,5}$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname)) return;
      CAMPAIGN_KEYS.forEach(function (key) {
        var value = query.get(key);
        if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
      });
      link.href = url.toString();
    });
  }

  function tagLinks() {
    tagStoreLinks();
    carryCampaign();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tagLinks);
  else tagLinks();
})();
