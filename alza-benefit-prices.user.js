// ==UserScript==
// @name         Alza Benefit Prices
// @icon         https://www.alza.cz/favicon-alza.ico
// @author       FejbyK
// @namespace    alza-benefit-prices
// @version      1.4.0
// @updateURL    https://github.com/FejbyK/Alza-Benefit-Prices/raw/refs/heads/main/alza-benefit-prices.user.js
// @downloadURL  https://github.com/FejbyK/Alza-Benefit-Prices/raw/refs/heads/main/alza-benefit-prices.user.js
// @description  Userscript pro Alza.cz, který zobrazuje ceny ceníků Gold, Silver, ISIC, Bronze, B2B a Basic
// @compatible   chrome
// @compatible   edge
// @compatible   firefox
// @compatible   opera
// @compatible   safari
// @match        https://www.alza.cz/*-d*.htm*
// @match        https://www.alza.cz/*?*dq=*
// @match        https://alza.cz/*-d*.htm*
// @match        https://alza.cz/*?*dq=*
// @match        https://m.alza.cz/*-d*.htm*
// @match        https://m.alza.cz/*?*dq=*
// @connect      webapi.alza.cz
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.xmlHttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @inject-into  content
// @run-at       document-idle
// @noframes
// ==/UserScript==

(async () => {
  'use strict';

  // Do not initialize settings, requests or observers outside product pages.
  if (!productId(location.pathname, location.search)) return;

  // Hide Hlídač shopů footer globally via CSS.
  const globalStyle = document.createElement('style');
  globalStyle.textContent = '#hlidacShopu .hs-footer, [data-hs] .hs-footer { display: none !important; }';
  document.head.append(globalStyle);

  const country = 'CZ';
  const locale = 'cs-CZ';
  const discountFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const priceFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const mobile = /^m\.alza\.cz$/i.test(location.hostname);

  const T = {
    others: 'OSTATNÍ',
    pricesWith: 'Ceny s ',
    priceWith: 'Cena s ',
    prices: 'Ceny ',
    price: 'Cena ',
    withWord: 'S ',
    withCode: 'S kódem {code}',
    promoDefault: 'Akční cena',
    tableLabel: 'Ceny ceníků: ',
    thTier: 'Ceník',
    thPrice: 'Cena',
    thDiscount: 'Sleva',
    originalPrice: 'Původní cena',
    settingsTitle: 'Nastavení ceníků',
    copyOffer: 'Kopírovat nabídku',
    equalNotice: 'Všechny ceníky mají stejnou cenu',
    loadError: 'Ceny se nepodařilo načíst.',
    retry: 'Zkusit znovu',
    productFallback: 'Produkt Alza',
    originalColon: 'Původní cena: ',
    link: 'Odkaz ➤ ',
    copied: 'Zkopírováno',
    copyFailedTitle: 'Kopírování selhalo — zkus to znovu',
    groupTiers: 'Ceníky',
    groupPromos: 'Akce',
    tradeIn: 'Výkup',
    groupView: 'Zobrazení',
    helpAbout: 'Co dělá volba: ',
    optAlways: 'Vždy zobrazit ceníky',
    optAlwaysHint: 'Zobrazí zapnuté ceníky i bez slevy nebo při shodných cenách.',
    loading: 'Načítání…',
    pricesLoaded: 'Ceny načteny: ',
  };

  // Console messages.
  const LOG = {
    noStorage: 'The extension does not provide settings storage. Check the script permissions.',
    noStorageWrite: 'The extension does not provide settings storage.',
    logSetting: 'Setting ',
    saveFailed: 'The setting could not be saved: ',
    logVersion: 'Version: ',
    logSettings: 'Settings:',
    cancelled: 'Loading cancelled.',
    requestError: 'The extension could not load the API. Check access to webapi.alza.cz.',
    timeout: 'Alza did not respond within 20 seconds.',
    noRequest: 'The extension does not provide API requests. Check the script permissions.',
    noClipboard: 'Clipboard API is not available.',
    placed: 'Panel placed ',
    placedModule: 'before the alternative pricing module',
    placedPrice: 'below the main price',
    pageChanged: 'The page changed in the meantime.',
    nothingToCopy: 'No price to copy.',
    copiedLog: 'Copied: ',
    copyFailedLog: 'Copying failed: ',
    staleCache: ': older cache used (',
    tooLarge: 'The API response is too large.',
    blocked: 'HTTP 403: access blocked.',
    apiHttp: 'The API returned HTTP ',
    redirect: 'The API redirected to an unexpected origin.',
    noPrice: 'Price not found in the response.',
    logNoTier: 'Failed: ',
    logLoaded: 'Loaded: ',
    logRendered: 'Rendered: ',
    logLoading: 'Loading prices for ItemID: ',
    logRender: 'Render:',
    isicEstimate: 'ISIC: with cashback the API returns the same price as for Basic, price worked out (ISIC price − cashback): ',
  };

  const CACHE_TTL = 5 * 60 * 1000;
  const CACHE_LIMIT = 60;
  const cache = new Map();
  const parsedResponses = new WeakMap();

  const LOG_PREFIX = 'Alza Benefit Prices – ';
  const SCRIPT_VERSION = '1.4.0';
  const log = (message, ...details) => console.log('%s', LOG_PREFIX + message, ...details);
  const debug = (message, ...details) => console.debug('%s', LOG_PREFIX + message, ...details);
  const warn = (message, ...details) => console.warn('%s', LOG_PREFIX + message, ...details);

  function scriptVersion() {
    return (typeof GM_info !== 'undefined' && GM_info?.script?.version)
      || (typeof GM !== 'undefined' && GM.info?.script?.version) || SCRIPT_VERSION;
  }

  async function getSetting(key, fallback) {
    if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') return GM.getValue(key, fallback);
    if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    throw new Error(LOG.noStorage);
  }

  async function setSetting(key, value) {
    if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') return GM.setValue(key, value);
    if (typeof GM_setValue === 'function') return GM_setValue(key, value);
    throw new Error(LOG.noStorageWrite);
  }

  const TIERS = [
    { name: 'Gold', pgrik: 'p_pg4_e6c95' },
    { name: 'Silver', pgrik: 'p_pg3_36eef' },
    { name: 'ISIC', pgrik: 'p_pg3is1_2b2fc' },
    { name: 'Bronze', pgrik: 'p_pg5_44266' },
    { name: 'B2B', pgrik: 'p_pg6_6ce49' },
    { name: 'Basic', pgrik: 'p__26752', reference: true, badge: 'regular' },
  ];

  const savedSettings = await getSetting('settings', {});
  const storedSettings = savedSettings && typeof savedSettings === 'object' && !Array.isArray(savedSettings)
    ? savedSettings : {};
  const savedTiers = storedSettings['enabled-price-tiers'] || {};
  const enabled = Object.fromEntries(TIERS.map(tier => [tier.name, savedTiers[tier.name] !== false]));
  let alzaPlusPromos = storedSettings['alza-plus-promos'] !== false;
  let cashbackPromos = storedSettings['cashback-price-promos'] !== false;
  let tradeInPromos = storedSettings['trade-in-promos'] !== false;
  let alwaysShow = storedSettings['always-show-tiers'] === true;

  let settingWrites = null;
  let pendingSettings = null;
  function saveSetting(key, value) {
    storedSettings[key] = value;
    log(LOG.logSetting + key + ' = ' + JSON.stringify(value));
    pendingSettings = { ...storedSettings, 'enabled-price-tiers': { ...storedSettings['enabled-price-tiers'] } };
    if (!settingWrites) settingWrites = Promise.resolve().then(async () => {
      while (pendingSettings) {
        const snapshot = pendingSettings;
        pendingSettings = null;
        try { await setSetting('settings', snapshot); }
        catch (error) { warn(LOG.saveFailed + error.message); }
      }
      settingWrites = null;
    });
  }

  log(LOG.logVersion + scriptVersion());
  debug('Environment:', { hostname: location.hostname, country, language: 'cs', mobile });
  debug(LOG.logSettings, {
    'enabled-price-tiers': { ...enabled }, 'alza-plus-promos': alzaPlusPromos, 'cashback-price-promos': cashbackPromos,
    'trade-in-promos': tradeInPromos, 'always-show-tiers': alwaysShow,
  });

  let activeId = null;
  let generation = 0;
  let panel = null;
  const pending = new Set();
  const inFlight = new Map();

  function productId(pathname, search = '') {
    const variant = new URLSearchParams(search).get('dq');
    if (/^\d+$/.test(variant || '')) return variant;
    return pathname.match(/-d(\d+)(?:\.htm|\/|$)/i)?.[1] || null;
  }

  function apiUrl(id, tier) {
    const url = new URL(`https://webapi.alza.cz/api/commodity/v1/${id}/detailPriceInfoV3`);
    url.search = new URLSearchParams({ country, pgrik: tier.pgrik, ucik: 'null' });
    return url.href;
  }

  const priceMemo = new WeakMap();
  function extractPrice(data, reference = false, promos = { plus: alzaPlusPromos, cashback: cashbackPromos, tradeIn: tradeInPromos }) {
    if (!data || typeof data !== 'object') return computePrice(data, reference, promos);
    let byKey = priceMemo.get(data);
    if (!byKey) priceMemo.set(data, byKey = new Map());
    const key = (reference ? 8 : 0) | (promos.plus ? 4 : 0) | (promos.cashback ? 2 : 0) | (promos.tradeIn ? 1 : 0);
    if (!byKey.has(key)) byKey.set(key, computePrice(data, reference, promos));
    return byKey.get(key);
  }

  const pricingMemo = new WeakMap();
  function findPricing(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 15) return null;
    if (value.mainPriceTag || Array.isArray(value.promoPrices)) return value;
    for (const child of Object.values(value)) {
      const result = findPricing(child, depth + 1);
      if (result) return result;
    }
    return null;
  }

  function computePrice(data, reference, promos) {
    if (!data || typeof data !== 'object') return null;
    if (!pricingMemo.has(data)) {
      pricingMemo.set(data, (data.data && (data.data.mainPriceTag || Array.isArray(data.data.promoPrices)))
        ? data.data : findPricing(data));
    }
    const pricing = pricingMemo.get(data);
    if (!pricing) return null;
    const main = pricing.mainPriceTag;
    if (!reference && main?.priceGroupType === 0 && main.priceType !== 7) return { hidden: true };
    function candidate(value, promo = false) {
      if (!value || !['string', 'number'].includes(typeof value.primaryPrice)) return null;
      const price = String(value.primaryPrice).trim();
      let numeric = price.replace(/\s/g, '').replace(/(?:Kč|CZK)$/i, '').replace(/[,.][-–—]$/, '');
      if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(numeric)) numeric = numeric.replace(/\./g, '');
      if (!/^\d+(?:[,.]\d{1,2})?$/.test(numeric)) return null;
      const amount = Number(numeric.replace(',', '.'));
      if (!Number.isFinite(amount)) return null;
      return {
        price, amount, promo, priceType: value.priceType,
        name: promo && typeof value.name === 'string' ? value.name.trim() : '',
        coupon: promo && typeof value.discountCouponCode === 'string' ? value.discountCouponCode.trim() : '',
      };
    }
    const mainCandidate = candidate(main);
    let selected = mainCandidate;
    for (const promo of Array.isArray(pricing.promoPrices) ? pricing.promoPrices : []) {
      if (!promos.plus && promo?.priceType === 4) continue;
      if (!promos.cashback && promo?.priceType === 1) continue;
      if (!promos.tradeIn && promo?.priceType === 2) continue;
      const next = candidate(promo, true);
      if (next && (!selected || next.amount < selected.amount)) selected = next;
    }
    const compare = candidate({ primaryPrice: main?.comparePrice });
    const discountBase = compare || (selected?.promo ? mainCandidate : null);
    if (!reference && (main?.priceType === 7 || main?.priceType === 4)) {
      if (!selected || !discountBase || selected.amount === discountBase.amount) return { hidden: true };
    }
    if (selected) {
      selected.discountPercent = discountBase && discountBase.amount > 0 && discountBase.amount > selected.amount
        ? (discountBase.amount - selected.amount) / discountBase.amount * 100 : null;
      selected.discountBaseAmount = discountBase?.amount ?? null;
      selected.mainAmount = mainCandidate?.amount ?? null;
    }
    return selected;
  }

  function request(url, track = true) {
    const existing = inFlight.get(url);
    if (existing) {
      if (!track) existing.keepAlive = true;
      return existing.promise;
    }
    const tracked = { keepAlive: !track };
    let settled = false;
    const promise = new Promise((resolve, reject) => {
      let handle;
      const finish = callback => value => {
        if (settled) return;
        settled = true;
        pending.delete(tracked);
        inFlight.delete(url);
        callback(value);
      };
      const fail = finish(reject);
      tracked.abort = () => {
        if (tracked.keepAlive) return;
        fail(new Error(LOG.cancelled));
        try { handle?.abort?.(); } catch { /* The request may already be finished. */ }
      };
      if (track) pending.add(tracked);
      const succeed = finish(response => resolve({
        status: response.status,
        responseText: typeof response.responseText === 'string' ? response.responseText : String(response.response ?? ''),
        finalUrl: response.finalUrl || response.responseURL || url,
      }));
      const details = {
        method: 'GET', url, timeout: 20000, responseType: 'text',
        headers: { Accept: 'application/json, text/html;q=0.9' },
        onload: succeed,
        onerror: () => fail(new Error(LOG.requestError)),
        ontimeout: () => fail(new Error(LOG.timeout)),
        onabort: () => fail(new Error(LOG.cancelled)),
      };
      try {
        if (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function') {
          handle = GM.xmlHttpRequest(details);
        } else if (typeof GM_xmlhttpRequest === 'function') {
          handle = GM_xmlhttpRequest(details);
        } else {
          throw new Error(LOG.noRequest);
        }
        if (typeof handle?.then === 'function') handle.then(succeed, fail);
      } catch (error) { fail(error); }
    });
    tracked.promise = promise;
    if (!settled) inFlight.set(url, tracked);
    return promise;
  }

  function cancel() {
    generation++;
    for (const handle of pending) handle.abort();
    pending.clear();
  }

  function node(tag, text, parent) {
    const item = document.createElement(tag);
    if (text != null) item.textContent = text;
    if (parent) parent.append(item);
    return item;
  }

  function formatPrice(amount) {
    return priceFormat.format(amount) + ' Kč';
  }

  function formatPanelPrice(amount) {
    return priceFormat.format(amount) + ',-';
  }

  function formatDiscount(percent) {
    return percent > 0 ? '−' + discountFormat.format(percent) + ' %' : '';
  }

  function estimateIsicCashback(isic, basic) {
    const cashback = result => result?.promo && result.priceType === 1;
    if (!cashback(isic) || !cashback(basic) || isic.amount !== basic.amount) return isic;
    if (!(isic.mainAmount > 0 && basic.mainAmount > 0 && isic.mainAmount < basic.mainAmount)) return isic;
    const cashbackAmount = basic.mainAmount - basic.amount;
    const raw = isic.mainAmount - cashbackAmount;
    if (!(cashbackAmount > 0 && raw > 0)) return isic;
    const amount = Math.round(raw);
    const base = isic.discountBaseAmount;
    const percent = base > amount ? (base - amount) / base * 100 : null;
    debug(LOG.isicEstimate + formatPrice(amount) + (percent ? ' (' + formatDiscount(percent) + ')' : ''));
    return { ...isic, amount, price: formatPanelPrice(amount), discountPercent: percent, estimated: true };
  }

  function resolveTierPrice(data, tier, promos, includeStandard = false) {
    const selected = extractPrice(data, tier.reference, promos);
    if (!selected) return null;
    const comparison = selected.hidden ? extractPrice(data, true, promos) : selected;
    if (!comparison) return null;
    return { result: selected.hidden ? (includeStandard ? comparison : null) : selected, comparison };
  }

  function correctIsicPrices(items) {
    const basic = items.find(item => item?.tier.reference);
    const isic = items.find(item => item?.tier.name === 'ISIC');
    if (isic?.result && basic?.result) {
      isic.result = estimateIsicCashback(isic.result, basic.result);
      isic.comparison = isic.result;
    }
  }

  function compareWithBasic(result, basic) {
    if (!basic) return 'basic-unavailable';
    return result.amount < basic.amount ? null
      : result.amount === basic.amount ? 'same-as-basic' : 'higher-than-basic';
  }

  function originalPrice(results, basic, useBasicAmount = false) {
    let base = basic?.discountBaseAmount ?? (useBasicAmount ? basic?.amount : null);
    if (base == null) {
      const bases = results.map(result => result.discountBaseAmount).filter(amount => amount != null);
      base = bases.length && bases.every(amount => amount === bases[0]) ? bases[0] : null;
    }
    return base != null && results.some(result => result.amount < base) ? base : null;
  }

  function samePromotion(left, right) {
    if (Boolean(left.promo) !== Boolean(right.promo)) return false;
    return !left.promo || (left.priceType === right.priceType
      && (left.coupon || '') === (right.coupon || '') && (left.name || '') === (right.name || ''));
  }

  const TIER_PAIRS = [['ISIC', 'Silver'], ['B2B', 'Bronze']];
  function foldPairs(items, merge) {
    for (const [name, into] of TIER_PAIRS) {
      const source = items.find(item => item.tier.name === name);
      const target = items.find(item => item.tier.name === into);
      if (source && target && source.amount === target.amount && samePromotion(source.result, target.result)) merge(target, source);
    }
  }

  function onlyDifferent(basicAmount, others, amountOf) {
    if (basicAmount == null || others.length < 2) return null;
    let distinct = null;
    for (const item of others) {
      const amount = amountOf(item);
      if (amount == null) return null;
      if (amount !== basicAmount) {
        if (distinct) return null;
        distinct = item;
      }
    }
    return distinct;
  }

  function visibleRows(rows) {
    return rows.filter(row => row.valid && !row.tr.hidden).sort((a, b) => a.amount - b.amount);
  }

  async function writeClipboard(textPromise) {
    textPromise.catch(() => {});
    const clipboard = navigator.clipboard;
    if (!clipboard) throw new Error(LOG.noClipboard);
    if (typeof ClipboardItem === 'function' && typeof clipboard.write === 'function') {
      const blobPromise = textPromise.then(text => new Blob([text], { type: 'text/plain' }));
      blobPromise.catch(() => {});
      try {
        await clipboard.write([new ClipboardItem({ 'text/plain': blobPromise })]);
        return;
      } catch { /* Older ClipboardItem without promises: fall back to writeText below. */ }
    }
    if (typeof clipboard.writeText !== 'function') throw new Error(LOG.noClipboard);
    await clipboard.writeText(await textPromise);
  }

  function pricesLabel(label, single = false) {
    if (label.startsWith(T.withWord)) label = (single ? T.priceWith : T.pricesWith) + label.slice(T.withWord.length);
    return label.replace(/^Cena s /, single ? T.priceWith : T.pricesWith).replace(/^Cena /, single ? T.price : T.prices);
  }

  function logCopiedOffer(id, text) {
    log(LOG.copiedLog + id, text.split('\n'));
  }

  function promoLogLabel(result) {
    if (!result.promo) return '';
    return result.priceType === 4 ? 'AlzaPlus+' : result.coupon ? 'code ' + result.coupon : result.name || 'promotion';
  }

  function promoLabel(result) {
    if (!result.promo) return '';
    return result.priceType === 4 ? T.withWord + 'AlzaPlus+' : result.coupon
      ? T.withCode.replace('{code}', () => result.coupon) : result.name || T.promoDefault;
  }

  function svgIcon(path, withCenter = false) {
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(namespace, 'svg');
    for (const [key, value] of Object.entries({
      viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none',
      stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linejoin': 'round',
      'aria-hidden': 'true', focusable: 'false',
    })) icon.setAttribute(key, value);
    const outline = document.createElementNS(namespace, 'path');
    outline.setAttribute('d', path);
    icon.append(outline);
    if (withCenter) {
      const center = document.createElementNS(namespace, 'circle');
      center.setAttribute('cx', '12');
      center.setAttribute('cy', '12');
      center.setAttribute('r', '3');
      icon.append(center);
    }
    return icon;
  }

  function photoStrip() {
    return document.querySelector('#detailPicture');
  }

  // Move Hlídač shopů below the product photo in the left column and remove its footer.
  function moveTracker() {
    const tracker = document.querySelector('#hlidacShopu, [data-hs]');
    if (!tracker) return false;
    tracker.querySelector('.hs-footer')?.remove();
    tracker.shadowRoot?.querySelector('.hs-footer')?.remove();
    if (mobile) return true;
    const strip = photoStrip();
    if (!strip) return false;
    const gift = document.querySelector('[data-react-client-component="promoListModule"]');
    const anchor = gift && gift.parentNode?.contains(strip) && !gift.contains(strip)
      && strip.compareDocumentPosition(gift) & Node.DOCUMENT_POSITION_FOLLOWING ? gift : strip;
    if (anchor.nextElementSibling !== tracker) {
      tracker.style.margin = '12px 0';
      tracker.style.order = '';
      anchor.after(tracker);
    }
    return true;
  }

  let mountFrame = 0;
  const mountObserver = new MutationObserver(() => {
    if (mountFrame) return;
    mountFrame = requestAnimationFrame(() => {
      mountFrame = 0;
      if (panel) mount(panel.host);
    });
  });

  let trackerRetries = 0;
  let trackerTimer = 0;
  let observedParent = null;

  function mount(host) {
    moveTracker();
    place(host);
    clearTimeout(trackerTimer);
    if (!mobile && (!photoStrip() || !document.querySelector('#hlidacShopu, [data-hs]')) && trackerRetries++ < 25) {
      trackerTimer = setTimeout(() => { if (panel) mount(panel.host); }, 250);
    }
    if (host.parentNode !== observedParent) {
      mountObserver.disconnect();
      observedParent = host.parentNode;
      if (observedParent) mountObserver.observe(observedParent, { childList: true });
      if (observedParent?.parentNode) mountObserver.observe(observedParent.parentNode, { childList: true });
    }
  }

  let lastPlacement = '';
  function placed(where) {
    if (where === lastPlacement) return;
    lastPlacement = where;
    debug(LOG.placed + where + '.');
  }

  function place(host) {
    host.style.margin = mobile ? '0' : '0 0 12px';
    const before = document.querySelector('[data-react-client-component="alternativePricingModule"]');
    if (before) {
      host.style.order = before.style.order || '';
      if (before.previousElementSibling !== host) before.before(host);
      placed(LOG.placedModule);
      return;
    }
    const price = document.querySelector('.js-price-detail__main-price-box-wrapper, [data-testid="price-primary"]');
    const after = price?.closest('.price-detail__row') || price;
    if (after && after.nextElementSibling !== host) after.after(host);
    if (after)
