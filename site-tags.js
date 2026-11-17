/* Parallax Monitor site tags.
   Sets no cookies and stores nothing in the browser.

   1. Page views: Cloudflare Web Analytics, loaded only when CLOUDFLARE_TOKEN is filled in.
      It counts page views, referrers and paths. It cannot count clicks and it ignores query strings.
   2. Store links: every App Store and Google Play link is tagged with where the click came from,
      so App Store Connect and Play Console report store visits and sales by source.
      A visitor who lands with ?utm_source=meta&utm_campaign=song1 carries those values to the store. */
(function () {
  'use strict';

  var CLOUDFLARE_TOKEN = '';   // Cloudflare dashboard > Web Analytics > Manage site > JS snippet
  var APPLE_PROVIDER_ID = '';  // App Store Connect > App Analytics > campaign link generator ("pt" value)

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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tagStoreLinks);
  else tagStoreLinks();
})();
