// ==UserScript==
// @name         Alza Benefit Prices
// @icon         https://www.alza.cz/favicon-alza.ico
// @author       FejbyK
// @namespace    alza-benefit-prices
// @version      1.3.1
// @updateURL    https://github.com/FejbyK/Alza-Benefit-Prices/raw/refs/heads/main/alza-benefit-prices.user.js
// @downloadURL  https://github.com/FejbyK/Alza-Benefit-Prices/raw/refs/heads/main/alza-benefit-prices.user.js
// @description  Userscript pro Alza.cz, který zobrazuje ceny ceníků Gold, Silver, ISIC, Bronze, B2B a Basic
// @compatible   chrome
// @compatible   edge
// @compatible   firefox
// @compatible   opera
// @compatible   safari
// @match        https://*.alza.cz/*-d*.htm*
// @match        https://*.alza.cz/*?*dq=*
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
    withCode: 'S kódem ',
    promoDefault: 'Akční cena',
    tableLabel: 'Ceny ceníků: ',
    thTier: 'Ceník',
    thPrice: 'Cena',
    thDiscount: 'Sleva',
    originalPrice: 'Původní cena',
    settingsTitle: 'Nastavení ceníků',
    copyOffer: 'Kopírovat nabídku',
    equalNotice: 'Všechny ceníky mají stejnou cenu',
    loadError: 'Ceny se nepodařilo načíst. Zkus obnovit stránku.',
    createdBy: 'Vytvořil ',
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
    optAlwaysHint: 'Zobrazí Vaše zapnuté ceníky vždycky, i když není u ceníku sleva nebo jsou všechny ceníky se stejnou cenou.',
    optLeft: 'Přesunout ceník doleva',
    optLeftHint: 'Přesune ceník z pravého sloupce pod miniatury fotek vlevo.',
    loading: 'Načítání…',
    pricesLoaded: 'Ceny načteny: ',
  };

  // Console messages.
  const LOG = {
    noStorage: 'The extension does not provide settings storage. Check the script permissions.',
    noStorageWrite: 'The extension does not provide settings storage.',
    logSetting: 'Setting ',
    saveFailed: 'The setting could not be saved: ',
    logVersion: 'Version ',
    logMobile: ' (mobile version)',
    logCountry: ', country ',
    logSettings: 'Settings',
    cancelled: 'Loading cancelled.',
    requestError: 'The extension could not load the API. Check access to webapi.alza.cz.',
    timeout: 'Alza did not respond within 20 seconds.',
    noRequest: 'The extension does not provide API requests. Check the script permissions.',
    noClipboard: 'Clipboard API is not available.',
    placed: 'Panel placed ',
    placedGift: 'below the gift block',
    placedPhoto: 'below the product photo',
    placedTracker: 'before Hlídač shopů',
    placedModule: 'before the alternative pricing module',
    placedPrice: 'below the main price',
    pageChanged: 'The page changed in the meantime.',
    nothingToCopy: 'No price to copy.',
    copiedLog: 'Offer copied to the clipboard:',
    copyFailedLog: 'Copying failed: ',
    staleCache: ': older cache used (',
    tooLarge: 'The API response is too large.',
    blocked: 'HTTP 403: access blocked.',
    apiHttp: 'The API returned HTTP ',
    redirect: 'The API redirected to another domain.',
    noPrice: 'Price not found in the response.',
    noOwnPrice: ': no price of its own',
    standard: ' (standard ',
    product: 'Product ',
    logNoTier: ': no price list was loaded, the API is blocked or unavailable.',
    logEqual: ': all price lists have the same price',
    logNothing: 'no price list to show',
    colTier: 'price list',
    colPrice: 'price',
    colDiscount: 'discount',
    colPromo: 'promotion',
    logOriginal: 'Original price: ',
    logAlways: ' | mode: always show price lists',
    logLoading: ': loading price lists.',
    isicEstimate: 'ISIC: with cashback the API returns the same price as for Basic, price worked out (ISIC price − cashback): ',
  };

  const CACHE_TTL = 5 * 60 * 1000;
  const CACHE_LIMIT = 60;
  const cache = new Map();
  const inFlight = new Map();

  const LOG_STYLE = 'background:#545fef;color:#fff;border-radius:3px;padding:1px 6px;font-weight:600';
  const logHead = ['%cAlza Benefit Prices%c', LOG_STYLE, ''];
  const log = (message, ...details) => console.info(...logHead, message, ...details);
  const debug = (message, ...details) => console.debug(...logHead, message, ...details);
  const warn = (message, ...details) => console.warn(...logHead, message, ...details);

  function scriptVersion() {
    return (typeof GM_info !== 'undefined' && GM_info?.script?.version)
      || (typeof GM !== 'undefined' && GM.info?.script?.version) || '';
  }

  async function getSetting(key, fallback) {
    if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') return await GM.getValue(key, fallback);
    if (typeof GM_getValue === 'function') return await GM_getValue(key, fallback);
    throw new Error(LOG.noStorage);
  }

  async function setSetting(key, value) {
    if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') return await GM.setValue(key, value);
    if (typeof GM_setValue === 'function') return await GM_setValue(key, value);
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

  async function loadSettings() {
    const unified = await getSetting('settings', null);
    if (unified && typeof unified === 'object') return unified;
    const [tiers, plus, cashback, tradeIn, always, belowPhoto] = await Promise.all([
      getSetting('enabled-price-tiers', {}),
      getSetting('alza-plus-promos', true),
      getSetting('cashback-price-promos', true),
      getSetting('trade-in-promos', true),
      getSetting('always-show-tiers', false),
      getSetting('panel-below-photo', false),
    ]);
    const migrated = {
      'enabled-price-tiers': tiers && typeof tiers === 'object' ? tiers : {},
      'alza-plus-promos': plus !== false,
      'cashback-price-promos': cashback !== false,
      'trade-in-promos': tradeIn !== false,
      'always-show-tiers': always === true,
      'panel-below-photo': belowPhoto === true,
    };
    setSetting('settings', migrated).catch(() => {});
    return migrated;
  }

  const storedSettings = await loadSettings();
  const savedTiers = storedSettings['enabled-price-tiers'] || {};
  const enabled = Object.fromEntries(TIERS.map(tier => [tier.name, savedTiers[tier.name] !== false]));
  let alzaPlusPromos = storedSettings['alza-plus-promos'] !== false;
  let cashbackPromos = storedSettings['cashback-price-promos'] !== false;
  let tradeInPromos = storedSettings['trade-in-promos'] !== false;
  let alwaysShow = storedSettings['always-show-tiers'] === true;
  let belowPhoto = storedSettings['panel-below-photo'] === true;
  let belowPhotoOption = null;

  let settingWrites = Promise.resolve();
  function saveSetting(key, value) {
    storedSettings[key] = value;
    log(LOG.logSetting + key + ' = ' + JSON.stringify(value));
    const snapshot = { ...storedSettings, 'enabled-price-tiers': { ...storedSettings['enabled-price-tiers'] } };
    settingWrites = settingWrites.then(() => setSetting('settings', snapshot))
      .catch(error => warn(LOG.saveFailed + error.message));
  }

  log(LOG.logVersion + (scriptVersion() || '?') + ' — ' + location.hostname + (mobile ? LOG.logMobile : '') + LOG.logCountry + country);
  debug(LOG.logSettings, {
    'enabled-price-tiers': { ...enabled }, 'alza-plus-promos': alzaPlusPromos, 'cashback-price-promos': cashbackPromos,
    'trade-in-promos': tradeInPromos, 'always-show-tiers': alwaysShow, 'panel-below-photo': belowPhoto,
  });

  let activeId = null;
  let generation = 0;
  let panel = null;
  let pending = [];

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
    const key = [reference, promos.plus, promos.cashback, promos.tradeIn].map(Number).join('');
    if (!byKey.has(key)) byKey.set(key, computePrice(data, reference, promos));
    return byKey.get(key);
  }

  function computePrice(data, reference, promos) {
    function findPricing(value, depth = 0) {
      if (!value || typeof value !== 'object' || depth > 15) return null;
      if (value.mainPriceTag || Array.isArray(value.promoPrices)) return value;
      if (Array.isArray(value)) return null;
      for (const child of Object.values(value)) {
        const result = findPricing(child, depth + 1);
        if (result) return result;
      }
      return null;
    }
    const pricing = (data?.data && (data.data.mainPriceTag || Array.isArray(data.data.promoPrices)))
      ? data.data : findPricing(data);
    if (!pricing) return null;
    const main = pricing.mainPriceTag;
    if (!reference && main?.priceGroupType === 0 && main.priceType !== 7) return { hidden: true };
    function candidate(value, promo = false) {
      if (!value || !['string', 'number'].includes(typeof value.primaryPrice)) return null;
      const price = String(value.primaryPrice).trim();
      let numeric = price.replace(/\s/g, '').replace(/(?:Kč|CZK)$/i, '').replace(/[,.][-–—]$/, '');
      if (numeric.includes(',') || /^\d{1,3}(?:\.\d{3})+$/.test(numeric)) {
        numeric = numeric.replace(/\./g, '');
      }
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
    return new Promise((resolve, reject) => {
      let handle;
      let settled = false;
      const finish = callback => value => {
        if (settled) return;
        settled = true;
        pending = pending.filter(item => item !== tracked);
        callback(value);
      };
      const fail = finish(reject);
      const tracked = { abort() {
        fail(new Error(LOG.cancelled));
        try { handle?.abort?.(); } catch { /* The request may already be finished. */ }
      } };
      if (track) pending.push(tracked);
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
  }

  function cancel() {
    generation++;
    const requests = pending;
    pending = [];
    requests.forEach(handle => handle.abort());
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
    log(LOG.isicEstimate + formatPrice(amount) + (percent ? ' (' + formatDiscount(percent) + ')' : ''));
    return { ...isic, amount, price: formatPanelPrice(amount), discountPercent: percent, estimated: true };
  }

  const TIER_PAIRS = [['ISIC', 'Silver'], ['B2B', 'Bronze']];
  function foldPairs(items, merge) {
    for (const [name, into] of TIER_PAIRS) {
      const source = items.find(item => item.tier.name === name);
      const target = items.find(item => item.tier.name === into);
      if (source && target && source.amount === target.amount) merge(target, source);
    }
  }

  function onlyDifferent(basicAmount, others, amountOf) {
    if (basicAmount == null || others.length < 2) return null;
    const amounts = others.map(amountOf);
    if (amounts.some(amount => amount == null)) return null;
    const distinct = others.filter((item, index) => amounts[index] !== basicAmount);
    return distinct.length === 1 ? distinct[0] : null;
  }

  function visibleRows(rows) {
    return rows.filter(row => row.valid && !row.tr.hidden).sort((a, b) => a.amount - b.amount);
  }

  async function writeClipboard(textPromise) {
    const clipboard = navigator.clipboard;
    if (!clipboard) throw new Error(LOG.noClipboard);
    if (typeof ClipboardItem === 'function' && typeof clipboard.write === 'function') {
      try {
        await clipboard.write([new ClipboardItem({ 'text/plain': textPromise.then(text => new Blob([text], { type: 'text/plain' })) })]);
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

  function promoLogLabel(result) {
    if (!result.promo) return '';
    return result.priceType === 4 ? 'AlzaPlus+' : result.coupon ? 'code ' + result.coupon : result.name || 'promotion';
  }

  function promoLabel(result) {
    if (!result.promo) return '';
    return result.priceType === 4 ? T.withWord + 'AlzaPlus+' : result.coupon
      ? T.withCode + result.coupon : result.name || T.promoDefault;
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

  let mountFrame = 0;
  const mountObserver = new MutationObserver(() => {
    if (mountFrame) return;
    mountFrame = requestAnimationFrame(() => { mountFrame = 0; if (panel) mount(panel.host); });
  });

  let stripRetries = 0;
  let stripTimer = 0;
  let observedParent = null;

  function mount(host) {
    place(host);
    clearTimeout(stripTimer);
    if (belowPhoto && !mobile && !photoStrip() && stripRetries++ < 12) {
      stripTimer = setTimeout(() => { if (panel) mount(panel.host); }, 250);
    }
    if (host.parentNode !== observedParent) {
      mountObserver.disconnect();
      observedParent = host.parentNode;
      if (observedParent) mountObserver.observe(observedParent, { childList: true });
      if (observedParent?.parentNode) mountObserver.observe(observedParent.parentNode, { childList: true });
    }
  }

  function photoStrip() {
    return document.querySelector('#detailPicture');
  }

  let lastPlacement = '';
  function placed(where) {
    if (where === lastPlacement) return;
    lastPlacement = where;
    log(LOG.placed + where + '.');
  }

  function place(host) {
    const tracker = document.querySelector('[data-hs], #hlidacShopu');
    const strip = mobile ? null : photoStrip();
    if (belowPhotoOption) belowPhotoOption.hidden = !strip;
    if (strip && belowPhoto) {
      host.style.margin = '12px 0';
      host.style.order = '';
      const gift = document.querySelector('[data-react-client-component="promoListModule"]');
      const anchor = gift && gift.parentNode.contains(strip) && !gift.contains(strip)
        && strip.compareDocumentPosition(gift) & Node.DOCUMENT_POSITION_FOLLOWING ? gift : strip;
      if (anchor.nextElementSibling !== host) anchor.after(host);
      placed(anchor === gift ? LOG.placedGift : LOG.placedPhoto);
      return;
    }
    host.style.margin = mobile ? '0' : '0 0 12px';
    const before = tracker || document.querySelector('[data-react-client-component="alternativePricingModule"]');
    if (before) {
      host.style.order = before.style.order || '';
      if (before.previousElementSibling !== host) before.before(host);
      placed(tracker ? LOG.placedTracker : LOG.placedModule);
      return;
    }
    const price = document.querySelector('.js-price-detail__main-price-box-wrapper, [data-testid="price-primary"]');
    const after = price?.closest('.price-detail__row') || price;
    if (after && after.nextElementSibling !== host) after.after(host);
    if (after) placed(LOG.placedPrice);
  }

  const PANEL_CSS = `
  :host{--row-h:28px;text-align:left;display:block;clear:both;font:13px "IBM Plex Sans Var",system-ui,sans-serif;color:#000;line-height:1.4;font-kerning:normal;font-variant-numeric:lining-nums;-webkit-text-size-adjust:100%;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:geometricPrecision}
  :host([hidden]),[hidden]{display:none!important}
  *{box-sizing:border-box;font-family:inherit}
  .sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
  section{position:relative;background:#fff;border:1px solid #e8e8e8;border-radius:14px;padding:8px}

  /* Table */
  table{border-collapse:collapse;table-layout:fixed;width:100%;margin:0}
  th:first-child{width:38%}th:nth-child(2){width:36%}th:last-child{width:26%}
  th,td{text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid #e8e8e8}
  th{font-size:14px;font-weight:500;color:#6b6b6b}
  thead th{padding-top:4px}
  td:nth-child(2){font-size:16px;font-weight:700;color:#ca0505;overflow-wrap:anywhere}
  tbody tr:last-child td{border-bottom:0}
  tbody td:nth-child(2){line-height:var(--row-h)}
  tfoot td{vertical-align:baseline;border-bottom:0;border-top:1px solid #e8e8e8;padding-top:14px;padding-bottom:8px;color:#6b6b6b;font-size:14px}
  tfoot td:nth-child(2){color:#6b6b6b;font-size:16px;font-weight:700}
  .discount{white-space:nowrap}
  .discount-value{display:inline-flex;align-items:center;justify-content:center;height:var(--row-h);min-width:5.6em;font-variant-numeric:tabular-nums;padding:0 8px;border-radius:4px;background:#5dbd2f;color:#fff;font-size:15px;font-weight:700}
  .th-note{display:block;margin-top:2px;font-size:12px;font-weight:400}
  .shared-promo .promo-label{display:none}
  .promo-label{display:block;margin-top:5px;font-size:12px;font-weight:400;color:#6b6b6b;line-height:1.4}

  /* Tier badges */
  .badges{display:flex;flex-wrap:wrap;gap:6px}
  .tier-badge{display:inline-flex;align-items:center;height:var(--row-h);padding:0 10px;border-radius:4px;font-size:14px;font-weight:600;line-height:1.2;text-transform:uppercase;background:#c2c2c2;color:#171717}
  .tier-gold{background:#ffd500;color:#171717}
  .tier-bronze{background:#d2822d;color:#fff}
  .tier-isic{background:#3cba9c;color:#fff}
  .tier-b2b{background:#3a349f;color:#fff}
  .tier-regular{background:#f0f0f0;color:#606060}

  /* Footer and buttons */
  .credit{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:10px;padding:0 8px 2px;font-size:12px;color:#6b6b6b}
  section:has(table:not([hidden]) tfoot tr:not([hidden])) .credit{margin-top:2px}
  .footer-buttons{display:flex;gap:6px;flex-shrink:0}
  .gear{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #e8e8e8;border-radius:8px;background:#fff;color:#6b6b6b;cursor:pointer}
  .gear:hover,.gear[aria-expanded="true"]{background:#f5f5f5;color:#000}
  .gear.done{background:#e9f7e1;border-color:#5dbd2f;color:#2f7a12}
  .gear.failed{border-color:#ca0505;color:#ca0505}
  .gear:focus-visible,input:focus-visible,.credit a:focus-visible{outline:2px solid #545fef;outline-offset:2px}
  .price-notice{flex:1;color:#606060;font-size:13px}
  .footer-message .credit{margin-top:0;padding:0 4px;justify-content:flex-start}
  .footer-message .gear{flex-shrink:0}
  .load-error{color:#ca0505}
  .credit a{color:inherit;text-decoration:underline;text-underline-offset:2px}

  /* Settings */
  .settings{display:grid;gap:16px;padding:0 8px 12px;margin-top:8px}
  .settings label{display:flex;gap:7px;align-items:center;min-height:30px;cursor:pointer}
  .settings input{accent-color:#545fef;width:16px;height:16px;margin:0}
  .settings fieldset{width:100%;min-width:0;margin:0;padding:0;border:0}
  .settings legend{padding:0;margin-bottom:4px;color:#606060;font-size:12px;font-weight:600}
  .settings-options{display:grid;width:100%;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 16px}
  .view-options{display:flex;flex-wrap:wrap;gap:4px 20px}
  .view-options .option{display:contents}
  .option-row{display:flex;align-items:center;gap:8px}
  .help{flex-shrink:0;width:22px;height:22px;padding:0;border:1px solid #e8e8e8;border-radius:50%;background:#fff;color:#6b6b6b;font-size:12px;font-weight:600;line-height:1;cursor:pointer}
  .help:hover{background:#f5f5f5;color:#000}
  .help:focus-visible{outline:2px solid #545fef;outline-offset:2px}
  .tip{position:absolute;z-index:10;padding:8px 12px;border:1px solid #e8e8e8;border-radius:8px;background:#f5f5f5;color:#000;font-size:12px;line-height:1.5;pointer-events:none;text-wrap:pretty;box-shadow:0 4px 16px rgba(0,0,0,.12)}
  .settings-group{padding-top:12px!important;border-top:1px solid #e8e8e8!important}
  .settings-only{border:0;padding:0}
  .settings-only .credit{margin-top:0;justify-content:flex-end}

  @media(max-width:420px){
    section{padding:6px}
    th,td{padding:10px 6px}
    th{font-size:13px}
    .gear{width:40px;height:40px}
    :host{--row-h:26px}
    .tier-badge{padding:0 7px;font-size:12px}
    .discount-value{padding:0 6px;font-size:13px}
    .promo-label{font-size:11px;overflow-wrap:anywhere}
    .settings-options{column-gap:8px}
    .settings label{gap:5px;font-size:12px}
    .settings input{flex-shrink:0}
  }
  `;

  function createPanel(id) {
    const host = node('div');
    host.id = 'local-alza-price-tiers';
    host.hidden = true;
    Object.assign(host.style, {
      position: 'relative', width: '100%', minWidth: '0',
      margin: mobile ? '0' : '0 0 12px', padding: mobile ? '4px 0 8px' : '0',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    node('style', PANEL_CSS, shadow);
    const section = node('section', null, shadow);
    section.id = 'price-table';
    section.setAttribute('aria-label', T.tableLabel + TIERS.map(tier => tier.name).join(', '));
    const status = node('div', null, section);
    status.className = 'sr-only';
    status.setAttribute('role', 'status');
    const table = node('table', null, section);
    const heading = node('tr', null, node('thead', null, table));
    node('th', T.thTier, heading).scope = 'col';
    const priceHeader = node('th', T.thPrice, heading);
    priceHeader.scope = 'col';
    const priceNote = node('span', null, priceHeader);
    priceNote.className = 'th-note';
    priceNote.hidden = true;
    node('th', T.thDiscount, heading).scope = 'col';
    const tbody = node('tbody', null, table);
    const rows = TIERS.map(tier => {
      const tr = node('tr', null, tbody);
      const label = node('td', null, tr);
      const badges = node('div', null, label);
      badges.className = 'badges';
      const badge = node('div', tier.name.toUpperCase(), badges);
      badge.className = 'tier-badge tier-' + (tier.badge || tier.name.toLowerCase());
      const price = node('td', '—', tr);
      const discount = node('td', '—', tr);
      discount.className = 'discount';
      return { tier, price, discount, tr, badge, displayName: tier.name.toUpperCase() };
    });
    const originalRow = node('tr', null, node('tfoot', null, table));
    originalRow.hidden = true;
    node('td', T.originalPrice, originalRow);
    const originalPrice = node('s', null, node('td', null, originalRow));
    node('td', '', originalRow);
    const footer = node('footer', null, section);
    footer.className = 'credit';
    const buttons = node('div', null, footer);
    buttons.className = 'footer-buttons';
    const gear = node('button', null, buttons);
    gear.append(svgIcon('M19.42 9.59L21.85 10.26L21.85 13.74L19.42 14.41L18.95 15.54L20.19 17.74L17.74 20.19L15.54 18.95L14.41 19.42L13.74 21.85L10.26 21.85L9.59 19.42L8.46 18.95L6.26 20.19L3.81 17.74L5.05 15.54L4.58 14.41L2.15 13.74L2.15 10.26L4.58 9.59L5.05 8.46L3.81 6.26L6.26 3.81L8.46 5.05L9.59 4.58L10.26 2.15L13.74 2.15L14.41 4.58L15.54 5.05L17.74 3.81L20.19 6.26L18.95 8.46Z', true));
    gear.className = 'gear';
    gear.type = 'button';
    gear.title = T.settingsTitle;
    gear.setAttribute('aria-label', T.settingsTitle);
    gear.setAttribute('aria-expanded', 'false');
    const copy = node('button', null, buttons);
    copy.className = 'gear';
    copy.type = 'button';
    copy.title = T.copyOffer;
    copy.setAttribute('aria-label', T.copyOffer);
    copy.hidden = true;
    copy.append(svgIcon('M8 8H20V21H8Z M16 8V3H3V16H8'));
    const notice = node('span', T.equalNotice, footer);
    notice.className = 'price-notice';
    notice.hidden = true;
    const loadError = node('span', T.loadError, footer);
    loadError.className = 'price-notice load-error';
    loadError.hidden = true;
    const credit = node('span', T.createdBy, footer);
    const creditLink = node('a', 'FejbyK', credit);
    creditLink.href = 'https://github.com/FejbyK';
    creditLink.target = '_blank';
    creditLink.rel = 'noopener noreferrer';
    const settings = node('div', null, section);
    const tip = node('div', null, section);
    tip.className = 'tip';
    tip.id = 'help-tip';
    tip.hidden = true;
    tip.setAttribute('role', 'tooltip');
    const touchOnly = () => mobile || matchMedia('(hover: none)').matches;
    let tipText = '';
    let tipButton = null;
    function hideTip() {
      tip.hidden = true;
      tipText = '';
      tipButton?.removeAttribute('aria-describedby');
      tipButton = null;
    }
    function showTip(button, text) {
      tipButton?.removeAttribute('aria-describedby');
      tipButton = button;
      button.setAttribute('aria-describedby', tip.id);
      tipText = text;
      tip.textContent = text;
      tip.hidden = false;
      const box = section.getBoundingClientRect();
      const target = button.getBoundingClientRect();
      const width = Math.min(260, box.width - 16);
      tip.style.width = width + 'px';
      const left = target.left - box.left + target.width / 2 - width / 2;
      tip.style.left = Math.max(8, Math.min(left, box.width - width - 8)) + 'px';
      const above = target.top - box.top - tip.offsetHeight - 8;
      tip.style.top = (above >= 0 ? above : target.bottom - box.top + 8) + 'px';
    }
    function attachHelp(button, text) {
      button.addEventListener('mouseenter', () => { if (!touchOnly()) showTip(button, text); });
      button.addEventListener('mouseleave', () => { if (!touchOnly()) hideTip(); });
      button.addEventListener('focus', () => { if (!touchOnly()) showTip(button, text); });
      button.addEventListener('blur', () => { if (!touchOnly()) hideTip(); });
      button.addEventListener('click', () => {
        if (touchOnly() && !tip.hidden && tipText === text) hideTip();
        else showTip(button, text);
      });
    }
    const outside = new AbortController();
    document.addEventListener('pointerdown', event => {
      if (!event.composedPath().some(element => element.classList?.contains('help'))) hideTip();
    }, { signal: outside.signal, capture: true });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !tip.hidden) hideTip();
    }, { signal: outside.signal, capture: true });
    settings.className = 'settings';
    settings.id = 'price-tier-settings';
    settings.hidden = true;
    gear.setAttribute('aria-controls', settings.id);
    const state = { dispose: () => outside.abort(), host, rows, table, section, status, priceNote, credit, notice, loadError, settings, copy, originalRow, originalPrice, loaded: false };
    let copyReset = 0;
    function setCopyState(label, className) {
      copy.className = className ? 'gear ' + className : 'gear';
      copy.title = label;
      copy.setAttribute('aria-label', label);
    }
    function resetCopy() {
      clearTimeout(copyReset);
      setCopyState(T.copyOffer);
    }
    function showCopyState(label, className) {
      clearTimeout(copyReset);
      setCopyState(label, className);
      copyReset = setTimeout(resetCopy, 2000);
    }
    state.resetCopy = resetCopy;

    async function offerText() {
      const offer = await buildOffer(id, true);
      if (id !== activeId) throw new Error(LOG.pageChanged);
      if (!offer) throw new Error(LOG.nothingToCopy);
      const title = document.querySelector('h1')?.textContent.trim() || T.productFallback;
      const lines = ['## ' + title, ''];
      const original = offer.original !== null ? T.originalColon + '~~' + formatPrice(offer.original) + '~~' : '';
      const priceText = entry => formatPrice(entry.amount)
        + (formatDiscount(entry.result.discountPercent) ? ' (' + formatDiscount(entry.result.discountPercent) + ')' : '');
      if (offer.single) {
        lines.push('- ' + formatPrice(offer.entries[0].amount));
      } else {
        const groups = [];
        for (const entry of offer.entries) {
          const label = promoLabel(entry.result);
          let group = groups.find(item => item.label === label);
          if (!group) groups.push(group = { label, entries: [] });
          group.entries.push(entry);
        }
        groups.sort((a, b) => Boolean(a.label) - Boolean(b.label));
        const blocks = groups.map((group, index) => {
          const block = [];
          let header = index === 0 ? original : '';
          if (group.label) {
            const arrow = index > 0 || header ? '➔ ' : '';
            const promo = '**' + arrow + pricesLabel(group.label, group.entries.length === 1) + ':**';
            header = header ? header + ' ' + promo : promo;
          }
          if (header) block.push(header);
          const bare = Boolean(group.label) && group.entries.length === 1
            && [T.others, 'BASIC'].includes(group.entries[0].names[0]);
          for (const entry of group.entries) {
            block.push('- ' + (entry.names.length && !bare ? '**' + entry.names.join('/') + '**: ' : '') + priceText(entry));
          }
          return block.join('\n');
        });
        lines.push(blocks.join('\n'));
      }
      const url = new URL(location.href);
      url.hostname = url.hostname.replace(/^(?:m\.|www\.)?(alza\.cz)$/i, 'www.$1');
      url.pathname = url.pathname.replace(/^\/en(?=\/)/i, '');
      const variant = url.searchParams.get('dq');
      url.search = '';
      if (variant !== null) url.searchParams.set('dq', variant);
      url.hash = '';
      lines.push('', T.link + url.href);
      return lines.join('\n');
    }
    copy.onclick = async () => {
      try {
        const text = offerText();
        await writeClipboard(text);
        showCopyState(T.copied, 'done');
        log(LOG.copiedLog, '\n' + await text);
      } catch (error) {
        showCopyState(T.copyFailedTitle, 'failed');
        warn(LOG.copyFailedLog + error.message);
      } finally { copy.focus({ preventScroll: true }); }
    };
    gear.onclick = () => {
      settings.hidden = !settings.hidden;
      gear.setAttribute('aria-expanded', String(!settings.hidden));
      section.classList.toggle('settings-only', table.hidden && settings.hidden && notice.hidden && loadError.hidden);
    };
    function addCheckbox(parent, text, checked, onChange) {
      const label = node('label', null, parent);
      const box = node('input', null, label);
      box.type = 'checkbox';
      box.checked = checked;
      box.onchange = () => onChange(box.checked);
      node('span', text, label);
      return label;
    }
    function change(key, value) {
      saveSetting(key, value);
      scheduleLoad(id, state);
    }
    function addGroup(title, optionsClass) {
      const group = node('fieldset', null, settings);
      group.className = 'settings-group';
      node('legend', title, group);
      const options = node('div', null, group);
      options.className = optionsClass;
      return options;
    }
    const tierOptions = addGroup(T.groupTiers, 'settings-options');
    for (const tier of TIERS) {
      addCheckbox(tierOptions, tier.name, enabled[tier.name], value => {
        enabled[tier.name] = value;
        change('enabled-price-tiers', { ...savedTiers, ...enabled });
      });
    }
    const actionOptions = addGroup(T.groupPromos, 'settings-options');
    addCheckbox(actionOptions, 'AlzaPlus+', alzaPlusPromos, value => { alzaPlusPromos = value; change('alza-plus-promos', value); });
    addCheckbox(actionOptions, 'Cashback', cashbackPromos, value => { cashbackPromos = value; change('cashback-price-promos', value); });
    addCheckbox(actionOptions, T.tradeIn, tradeInPromos, value => { tradeInPromos = value; change('trade-in-promos', value); });
    const viewOptions = addGroup(T.groupView, 'settings-options view-options');
    function viewOption(text, hint, checked, update) {
      const option = node('div', null, viewOptions);
      option.className = 'option';
      const row = node('div', null, option);
      row.className = 'option-row';
      addCheckbox(row, text, checked, update);
      const help = node('button', '?', row);
      help.className = 'help';
      help.type = 'button';
      help.setAttribute('aria-label', T.helpAbout + text);
      attachHelp(help, hint);
      return option;
    }
    viewOption(T.optAlways,
      T.optAlwaysHint,
      alwaysShow, value => { alwaysShow = value; change('always-show-tiers', value); });
    belowPhotoOption = viewOption(T.optLeft,
      T.optLeftHint,
      belowPhoto, value => {
        belowPhoto = value;
        saveSetting('panel-below-photo', value);
        mount(host);
      });
    belowPhotoOption.hidden = true;
    mount(host);
    return state;
  }

  async function tierData(id, tier, run, allowStale = false) {
    const url = apiUrl(id, tier);
    const cached = cache.get(url);
    if (cached && (allowStale || Date.now() - cached.time < CACHE_TTL)) {
      if (Date.now() - cached.time >= CACHE_TTL) debug(tier.name + LOG.staleCache + Math.round((Date.now() - cached.time) / 1000) + ' s)');
      return cached.data;
    }
    if (inFlight.has(url)) {
      const data = await inFlight.get(url);
      return run !== null && run !== generation ? null : data;
    }
    const fetchPromise = (async () => {
      try {
        debug(tier.name + ': GET ' + url);
        const response = await request(url, run !== null);
        debug(tier.name + ': HTTP ' + response.status + ', ' + response.responseText.length + ' B');
        if (response.responseText.length > 2 * 1024 * 1024) throw new Error(LOG.tooLarge);
        if (response.status === 403) throw new Error(LOG.blocked);
        if (response.status < 200 || response.status >= 300) throw new Error(LOG.apiHttp + response.status + '.');
        if (response.finalUrl && new URL(response.finalUrl).hostname !== 'webapi.alza.cz') throw new Error(LOG.redirect);
        let data;
        try { data = JSON.parse(response.responseText); }
        catch { throw new Error(LOG.noPrice); }
        cache.set(url, { data, time: Date.now() });
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
        return data;
      } finally {
        inFlight.delete(url);
      }
    })();
    inFlight.set(url, fetchPromise);
    const data = await fetchPromise;
    return run !== null && run !== generation ? null : data;
  }

  async function buildOffer(id, allowStale = false) {
    const all = { plus: true, cashback: true, tradeIn: true };
    const found = await Promise.all(TIERS.map(async tier => {
      try {
        const data = await tierData(id, tier, null, allowStale);
        const result = extractPrice(data, tier.reference, all);
        if (!result) return null;
        if (result.hidden) return { tier, result: null, comparison: extractPrice(data, true, all) };
        return { tier, result, comparison: result };
      } catch (error) {
        debug(tier.name + ': ' + error.message);
        return null;
      }
    }));
    const basic = found.find(item => item?.tier.reference);
    const isicItem = found.find(item => item?.tier.name === 'ISIC');
    if (isicItem?.result && basic?.result) {
      const corrected = estimateIsicCashback(isicItem.result, basic.result);
      if (corrected !== isicItem.result) { isicItem.result = corrected; isicItem.comparison = corrected; }
    }
    const discounted = item => item?.result?.discountPercent > 0;
    const tiers = found.filter(item => item && !item.tier.reference && discounted(item)
      && (!basic || item.result.amount < basic.result.amount));
    const toEntry = (item, result = item.result) => (
      { tier: item.tier, names: [item.tier.name.toUpperCase()], amount: result.amount, result });
    const fold = list => {
      foldPairs(list, (target, source) => { target.names.push(...source.names); source.folded = true; });
      return list.filter(entry => !entry.folded);
    };
    let entries = fold(tiers.sort((a, b) => a.result.amount - b.result.amount).map(item => toEntry(item)));
    const others = TIERS.filter(tier => !tier.reference)
      .map(tier => found.find(item => item?.tier === tier) || { tier, comparison: null });
    const lone = basic ? onlyDifferent(basic.result.amount, others, item => item.comparison?.amount ?? null) : null;
    const stands = Boolean(lone) && tiers.includes(lone);
    if (entries.length && discounted(basic)) {
      entries.push({ tier: basic.tier, names: [stands ? T.others : 'BASIC'], amount: basic.result.amount, result: basic.result });
    } else if (!entries.length && discounted(basic)) {
      entries = [{ names: [], amount: basic.result.amount, result: basic.result }];
    }
    if (!entries.length) {
      const priced = found.filter(item => item?.result).sort((a, b) => a.result.amount - b.result.amount);
      if (!priced.length) return null;
      const plain = fold(priced.map(item => toEntry(item, { ...item.result, discountPercent: null })));
      const single = priced.every(item => item.result.amount === priced[0].result.amount);
      return { entries: single ? [{ names: [T.thPrice], amount: priced[0].result.amount, result: { ...priced[0].result, discountPercent: null } }] : plain,
        original: null, plain: true, single };
    }
    const bases = entries.map(entry => entry.result.discountBaseAmount).filter(amount => amount !== null);
    const original = basic?.result.discountBaseAmount ?? (bases.length && bases.every(a => a === bases[0]) ? bases[0] : null);
    const lowest = Math.min(...entries.map(entry => entry.amount));
    return { entries, original: original !== null && lowest < original ? original : null };
  }

  let reloadTimer = 0;
  function scheduleLoad(id, state) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { if (state === panel) void load(id, state); }, 250);
  }

  async function load(id, state) {
    cancel();
    const run = generation;
    state.host.hidden = !state.loaded;
    state.table.hidden = true;
    state.copy.hidden = true;
    state.resetCopy();
    state.status.textContent = '';
    state.section.setAttribute('aria-busy', 'true');
    state.originalRow.hidden = true;
    state.loadError.hidden = true;
    let failed = 0;
    state.rows.forEach(row => { row.tr.hidden = true; row.valid = false; row.result = null; row.amount = null; row.comparisonAmount = null; row.discount.textContent = '—'; row.price.textContent = T.loading; });
    function renderResult(row, result) {
      row.price.textContent = result.price;
      row.discount.textContent = '—';
      if (result.discountPercent !== null) {
        row.discount.textContent = '';
        node('span', formatDiscount(result.discountPercent), row.discount).className = 'discount-value';
      }
      if (result.promo) {
        const label = node('span', promoLabel(result), row.price);
        label.className = 'promo-label';
      }
      row.amount = result.amount;
      row.result = result;
      row.valid = true;
      row.tr.hidden = false;
    }
    async function loadRow(row) {
      try {
        const data = await tierData(id, row.tier, run);
        if (run !== generation || data === null) return;
        let result = extractPrice(data, row.tier.reference);
        if (!result) throw new Error(LOG.noPrice);
        const comparison = result.hidden ? extractPrice(data, true) : result;
        row.comparisonAmount = comparison?.amount ?? null;
        if (result.hidden && alwaysShow && comparison) result = comparison;
        if (result.hidden) {
          debug(row.tier.name + LOG.noOwnPrice + (comparison ? LOG.standard + comparison.price + ')' : ''));
          row.tr.hidden = true;
          return;
        }
        debug(row.tier.name + ': ' + result.price + (result.promo ? ' ' + promoLogLabel(result) : '')
          + (result.discountPercent ? ' (' + formatDiscount(result.discountPercent) + ')' : ''));
        renderResult(row, result);
      } catch (error) {
        if (run !== generation) return;
        failed++;
        row.tr.hidden = true;
        warn(row.tier.name + ': ' + error.message);
      }
    }
    await Promise.all(state.rows.filter(row => !row.tier.reference && enabled[row.tier.name]).map(loadRow));
    if (run !== generation) return;
    const basic = state.rows.find(row => row.tier.reference);
    if (basic && (enabled[basic.tier.name] || state.rows.some(row => !row.tier.reference && row.comparisonAmount !== null))) {
      await loadRow(basic);
    }
    if (run !== generation) return;
    const isicRow = state.rows.find(row => row.tier.name === 'ISIC');
    if (isicRow?.valid && basic?.valid) {
      const corrected = estimateIsicCashback(isicRow.result, basic.result);
      if (corrected !== isicRow.result) {
        renderResult(isicRow, corrected);
        isicRow.comparisonAmount = corrected.amount;
      }
    }
    if (run === generation) {
      filterRows(state.rows);
      const sorted = visibleRows(state.rows);
      for (const row of sorted) row.tr.parentNode.append(row.tr);
      const compared = state.rows.filter(row => row.tier.reference || enabled[row.tier.name]);
      const equalPrices = compared.length > 1 && compared.every(row =>
        row.comparisonAmount !== null && row.comparisonAmount === compared[0].comparisonAmount);
      const showNotice = equalPrices && !alwaysShow;
      const hasPrices = !showNotice && sorted.length > 0;
      const commonPrice = showNotice && basic?.valid ? basic.result : null;
      const bases = sorted.map(row => row.result.discountBaseAmount).filter(amount => amount !== null);
      const originalAmount = basic?.valid ? basic.result.discountBaseAmount ?? basic.amount
        : bases.length && bases.every(amount => amount === bases[0]) ? bases[0] : null;
      const shownOriginal = (hasPrices || commonPrice) && originalAmount !== null
        && (commonPrice ? commonPrice.amount < originalAmount : sorted.some(row => row.amount < originalAmount))
        ? originalAmount : null;
      state.originalRow.hidden = shownOriginal === null;
      state.originalPrice.textContent = shownOriginal === null ? '' : formatPanelPrice(shownOriginal);
      const labels = sorted.map(row => promoLabel(row.result));
      const sharedPromo = hasPrices && labels.length > 1 && labels[0] && labels.every(label => label === labels[0]) ? labels[0] : '';
      state.priceNote.textContent = sharedPromo;
      state.priceNote.hidden = !sharedPromo;
      state.section.classList.toggle('shared-promo', Boolean(sharedPromo));
      state.table.hidden = !hasPrices;
      state.credit.hidden = !hasPrices;
      const anyValidOrCompared = state.rows.some(row => row.valid || row.comparisonAmount !== null);
      const loadFailed = failed > 0 && !anyValidOrCompared;
      state.notice.hidden = !showNotice;
      state.loadError.hidden = !loadFailed;
      state.section.classList.toggle('footer-message', showNotice || loadFailed);
      state.section.classList.toggle('settings-only', !hasPrices && !showNotice && !loadFailed && state.settings.hidden);
      if (loadFailed) {
        warn(LOG.product + id + LOG.logNoTier);
      } else if (showNotice) {
        log(LOG.product + id + LOG.logEqual + (commonPrice ? ' ' + formatPrice(commonPrice.amount) : '') + '.');
      } else {
        console.groupCollapsed(...logHead, LOG.product + id + ': '
          + (sorted.map(row => row.displayName + ' ' + formatPrice(row.amount)).join(', ') || LOG.logNothing));
        if (sorted.length) {
          console.table(sorted.map(row => ({
            [LOG.colTier]: row.displayName, [LOG.colPrice]: formatPrice(row.amount),
            [LOG.colDiscount]: formatDiscount(row.result.discountPercent) || '—', [LOG.colPromo]: promoLogLabel(row.result) || '—',
          })));
        }
        console.log(LOG.logOriginal + (shownOriginal === null ? '—' : formatPrice(shownOriginal)) + (alwaysShow ? LOG.logAlways : ''));
        console.groupEnd();
      }
      state.status.textContent = loadFailed ? state.loadError.textContent : showNotice ? state.notice.textContent
        : hasPrices ? T.pricesLoaded + sorted.map(row => row.displayName + ' ' + formatPrice(row.amount)).join(', ') : '';
      state.section.setAttribute('aria-busy', 'false');
      state.loaded = true;
      state.host.hidden = false;
      state.copy.hidden = !anyValidOrCompared;
    }
  }

  function filterRows(rows) {
    const basic = rows.find(row => row.tier.reference);
    for (const row of rows) {
      row.displayName = row.tier.name.toUpperCase();
      if (row.badge) row.badge.textContent = row.displayName;
      row.extraBadges?.forEach(badge => badge.remove());
      row.extraBadges = [];
      if (alwaysShow) { row.tr.hidden = !(row.valid && enabled[row.tier.name]); continue; }
      let visible = row.valid && enabled[row.tier.name];
      if (['Gold', 'Silver', 'Bronze', 'ISIC'].includes(row.tier.name)) {
        visible = visible && basic?.valid && row.amount < basic.amount;
      }
      if (row.tier.reference) visible = visible && row.result?.discountPercent > 0;
      row.tr.hidden = !visible;
    }
    function mergeRow(target, source) {
      source.tr.hidden = true;
      target.displayName += ' + ' + source.displayName;
      const extra = node('div', source.displayName, target.badge.parentNode);
      extra.className = 'tier-badge tier-' + (source.tier.badge || source.tier.name.toLowerCase());
      target.extraBadges.push(extra);
    }
    foldPairs(rows.filter(row => row.valid && !row.tr.hidden), mergeRow);
    if (alwaysShow) return;
    const compared = rows.filter(row => !row.tier.reference && enabled[row.tier.name]);
    const lone = basic?.valid ? onlyDifferent(basic.amount, compared, row => row.comparisonAmount) : null;
    if (lone && !lone.tr.hidden) {
      basic.displayName = T.others;
      if (basic.badge) basic.badge.textContent = basic.displayName;
      basic.tr.hidden = !(basic.result?.discountPercent > 0);
      for (const row of compared) if (row.valid && row.amount === basic.amount) row.tr.hidden = true;
    }
    if (basic && !rows.some(row => !row.tier.reference && !row.tr.hidden)) basic.tr.hidden = true;
  }

  function sync() {
    const id = productId(location.pathname, location.search);
    if (id !== activeId) {
      cancel();
      clearTimeout(reloadTimer);
      mountObserver.disconnect();
      observedParent = null;
      panel?.dispose();
      panel?.host.remove(); panel = null; activeId = id;
      stripRetries = 0;
      clearTimeout(stripTimer);
      lastPlacement = '';
      if (id) {
        log(LOG.product + id + LOG.logLoading);
        panel = createPanel(id);
        void load(id, panel);
      }
    } else if (panel) {
      mount(panel.host);
    }
  }

  sync();

  const hasNavigationApi = typeof window.navigation?.addEventListener === 'function';
  if (hasNavigationApi) {
    window.navigation.addEventListener('currententrychange', sync);
  }
  window.addEventListener('popstate', sync);

  let timer = 0;
  function startFallbackTimer() {
    if (!hasNavigationApi && !timer) {
      timer = setInterval(() => { if (!document.hidden) sync(); }, 2000);
    }
  }
  function stopFallbackTimer() {
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
  }

  startFallbackTimer();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.addEventListener('pagehide', () => {
    stopFallbackTimer();
    cancel();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      startFallbackTimer();
      sync();
    }
  });
})().catch(error => console.error('[Alza Benefit Prices] Startup failed: ' + error.message));
