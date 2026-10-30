/* Additive fields: producerNotes, communityNotes, referenceSources.
   notes/flavors/rating remain exclusively the user's personal record. */
let formReferenceSources = [];
let lookupSequence = 0;
let lookupController = null;
const lookupFilledBasics = new Map();
const wineLookupCache = new Map();
function getSearchApiKey() {
  try {
    const local = localStorage.getItem('wine_serper_key');
    if (local) return local;
  } catch (_) {}
  return typeof SERPER_API_KEY === 'undefined' ? '' : SERPER_API_KEY;
}

function saveSearchApiKey() {
  const input = document.getElementById('searchApiKeyInput');
  const status = document.getElementById('searchKeyStatus');
  const value = input.value.trim();
  if (!value) { status.textContent = '請先輸入 Serper API key。'; return; }
  try {
    localStorage.setItem('wine_serper_key', value);
    input.value = '';
    wineLookupCache.clear();
    status.textContent = '已儲存於此瀏覽器。尚未驗證，請用酒名搜尋測試。';
  } catch (_) {
    status.textContent = '此瀏覽器不允許儲存設定，請直接開啟 GitHub Pages 網址再試。';
  }
}

function safeReferenceUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch (_) { return ''; }
}

function referenceSourcesHtml(sources) {
  const valid = (Array.isArray(sources) ? sources : []).filter(s => s && safeReferenceUrl(s.url));
  if (!valid.length) return '<p class="reference-help">未附來源；自行輸入的描述請自行核對。</p>';
  return '<p class="reference-help">以下為原始搜尋摘錄來源；修改上面文字不會改寫原始摘錄。</p><ul>' +
    valid.map(s => `<li><a href="${escHtml(safeReferenceUrl(s.url)).replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${escHtml(s.title || new URL(s.url).hostname)}</a>
      <div>${s.kind === 'producer' ? '酒廠網站' : '第三方網站'} · 搜尋摘錄 · ${escHtml(s.retrievedAt || '日期未記錄')}</div>
      <details><summary>原始摘錄</summary><div>${escHtml(s.snippet || '')}</div></details></li>`).join('') + '</ul>';
}

function referenceDetailHtml(entry) {
  if (!entry.producerNotes && !entry.communityNotes && !entry.referenceSources?.length) return '';
  return `<section class="reference-panel">
    <h3>酒廠／第三方資料</h3>
    <p class="reference-help">外部參考，並非我的感想；搜尋摘錄未核對全文，亦不代表大眾共識。</p>
    ${entry.producerNotes ? `<div class="detail-field"><div class="detail-label">酒廠介紹／品飲描述</div><div class="detail-value">${escHtml(entry.producerNotes)}</div></div>` : ''}
    ${entry.communityNotes ? `<div class="detail-field"><div class="detail-label">第三方評價／大眾感想參考</div><div class="detail-value">${escHtml(entry.communityNotes)}</div></div>` : ''}
    <div class="reference-sources">${referenceSourcesHtml(entry.referenceSources)}</div>
  </section>`;
}

function cancelWineLookup() {
  lookupSequence++;
  if (lookupController) lookupController.abort();
  lookupController = null;
  const button = document.getElementById('lookupWineBtn');
  if (button) { button.disabled = false; button.textContent = '自動填資料'; }
}

// Only these recognized brand-owned hosts are labelled as producer sites.
// All unrecognized hosts remain third-party, even if a title says "official".
const PRODUCER_HOSTS = [
  'bunnahabhain.com', 'ardbeg.com', 'laphroaig.com', 'themacallan.com',
  'glenfiddich.com', 'theglenlivet.com', 'glenmorangie.com', 'thebalvenie.com',
  'highlandparkwhisky.com', 'bruichladdich.com', 'kavalanwhisky.com',
  'veuve-clicquot.com', 'veuveclicquot.com', 'moet.com', 'domperignon.com',
  'krug.com', 'champagne-bollinger.com', 'ruinart.com', 'penfolds.com',
  'johnniewalker.com', 'jamesonwhiskey.com', 'nikka.com', 'suntory.com'
];
function isProducerUrl(url) {
  const safe = safeReferenceUrl(url);
  if (!safe) return false;
  const host = new URL(safe).hostname.toLowerCase();
  return PRODUCER_HOSTS.some(domain => host === domain || host.endsWith('.' + domain));
}

function lookupTokens(name) {
  return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/(\d+)\s*(?:years?\s*old|years?|yo|yr)\b/g, '$1')
    .replace(/\b(?:whisky|whiskey|wine|bottle|review|tasting|notes|old|year|years|yo|ml)\b/g, ' ')
    .match(/[a-z0-9]+|[\u3400-\u9fff]+/g) || [];
}

function resultMatchesWine(name, result) {
  const query = lookupTokens(name);
  const title = lookupTokens(result.title || '');
  if (!query.length || !title.length) return false;
  // Numeric product identifiers must match in the title, not a comparison snippet.
  if (query.some(t => /^\d+$/.test(t) && !title.includes(t))) return false;
  const words = query.filter(t => !/^\d+$/.test(t));
  return words.length > 0 && words.every(t => title.includes(t));
}

function fillKnownWineBasics(name) {
  const detected = smartAnalyzeText(name);
  // Existing local brand rules are suggestions, not web-verified bottle data.
  const knownBrand = BRAND_DATABASE.find(b => b.brand && b.names.some(n => {
    const tokens = lookupTokens(n);
    const input = lookupTokens(name);
    return tokens.length && tokens.every(t => input.includes(t));
  }));
  const fields = {
    fType: knownBrand?.type || detected.type,
    fBrand: knownBrand?.brand,
    fRegion: knownBrand?.region,
    fYear: detected.year
  };
  const filled = [];
  Object.entries(fields).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (value && !el.value.trim()) { el.value = value; lookupFilledBasics.set(id, value); filled.push(id); }
  });
  renderFlavorChips();
  return filled.length;
}

function sanitizeLookupResults(data) {
  return (Array.isArray(data.organic) ? data.organic : []).filter(r =>
    r && typeof r.title === 'string' && typeof r.snippet === 'string' && safeReferenceUrl(r.link)
  ).slice(0, 10).map(r => ({
    title: r.title.slice(0, 240), snippet: r.snippet.slice(0, 800),
    url: safeReferenceUrl(r.link), kind: isProducerUrl(r.link) ? 'producer' : 'third-party',
    retrievedAt: new Date().toISOString()
  }));
}

function applyWineReferences(results, name) {
  let filled = 0;
  for (const [kind, fieldId] of [['producer', 'fProducerNotes'], ['third-party', 'fCommunityNotes']]) {
    const field = document.getElementById(fieldId);
    if (field.value.trim()) continue; // Never replace text already entered by the user.
    const selected = results.filter(r => r.kind === kind).slice(0, 2);
    if (!selected.length) continue;
    field.value = selected.map(s => `${s.title}\n${s.snippet}`).join('\n\n');
    selected.forEach(s => {
      if (!formReferenceSources.some(old => old.url === s.url)) formReferenceSources.push({...s, query: name});
    });
    filled++;
  }
  document.getElementById('formReferenceSources').innerHTML = referenceSourcesHtml(formReferenceSources);
  document.getElementById('referencePanel').open = true;
  return filled;
}

async function lookupWineByName() {
  const name = document.getElementById('fName').value.trim();
  const status = document.getElementById('lookupStatus');
  const choices = document.getElementById('lookupChoices');
  if (name.length < 3) { status.textContent = '請先輸入完整酒名（至少三個字元），最好包括酒齡或年份。'; return; }
  cancelWineLookup();
  const seq = lookupSequence;
  const active = () => seq === lookupSequence &&
    document.getElementById('fName').value.trim() === name &&
    document.getElementById('formModal').classList.contains('active');
  choices.replaceChildren();
  const basicCount = fillKnownWineBasics(name);
  const basicMessage = basicCount ? '已用本機規則補上空白基本資料，請核對。' : '已保留現有基本資料。';
  status.textContent = basicMessage + ' 正在搜尋外部描述…';
  const button = document.getElementById('lookupWineBtn');
  button.disabled = true;
  button.textContent = '搜尋中…';
  lookupController = new AbortController();
  const controller = lookupController;
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    let results = wineLookupCache.get(name.toLowerCase());
    if (!results) {
      const apiKey = getSearchApiKey();
      if (!apiKey) throw new Error('搜尋服務未設定，請到「工具 → 搜尋服務設定」輸入 Serper API key。');
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-API-KEY': apiKey},
        body: JSON.stringify({q: `${name} tasting notes review`, num: 10}),
        signal: controller.signal
      });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) throw new Error('搜尋憑證無效或未獲授權；請到「工具 → 搜尋服務設定」更新 Serper API key。');
        if (response.status === 429) throw new Error('搜尋配額用完或請求太頻密，請稍後再試。');
        throw new Error(`搜尋服務暫時未能使用（${response.status}）。`);
      }
      results = sanitizeLookupResults(await response.json());
      // One optional producer-focused request. Keep useful third-party results if it fails.
      if (!results.some(r => r.kind === 'producer' && resultMatchesWine(name, r))) {
        const joinedName = lookupTokens(name).join('');
        const producer = PRODUCER_HOSTS.find(host => {
          const label = host.split('.')[0].replace(/^(the|champagne)/, '').replace(/[^a-z0-9]/g, '');
          return label.length > 3 && joinedName.includes(label);
        });
        if (producer) {
          try {
            const officialResponse = await fetch('https://google.serper.dev/search', {
              method: 'POST',
              headers: {'Content-Type': 'application/json', 'X-API-KEY': apiKey},
              body: JSON.stringify({q: `${name} ${producer} official tasting notes`, num: 10}),
              signal: controller.signal
            });
            if (officialResponse.ok) {
              const officialResults = sanitizeLookupResults(await officialResponse.json())
                .filter(r => r.kind === 'producer' && !results.some(existing => existing.url === r.url));
              results.push(...officialResults);
            }
          } catch (_) { /* The first request still has useful sourced results. */ }
        }
      }
      wineLookupCache.set(name.toLowerCase(), results);
    }
    if (!active()) return;
    const matching = results.filter(r => resultMatchesWine(name, r));
    const tokens = lookupTokens(name);
    const specific = tokens.some(t => /^\d+$/.test(t)) || tokens.length >= 3;
    if (matching.length && specific) {
      const filled = applyWineReferences(matching, name);
      const missing = matching.some(r => r.kind === 'producer') ? '' : ' 未找到可辨認的酒廠來源，官方欄留白。';
      status.textContent = basicMessage + (filled ? ' 已補上外部搜尋摘錄，請核對款式及來源。' : ' 已有外部描述，沒有覆蓋。') + missing + ' 個人記錄完全保留。';
    } else if (matching.length) {
      status.textContent = basicMessage + ' 酒名可能有多個版本，請選擇正確結果或補充年份／酒齡後重搜。';
      matching.slice(0, 4).forEach(result => {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'btn btn-secondary lookup-choice';
        choice.textContent = result.title;
        choice.addEventListener('click', () => {
          if (!active()) return;
          applyWineReferences([result], name);
          fillKnownWineBasics(result.title);
          choices.replaceChildren();
          status.textContent = '已帶入你選擇的搜尋摘錄；請核對酒名及版本後儲存。個人記錄完全保留。';
        });
        choices.appendChild(choice);
      });
    } else {
      status.textContent = basicMessage + ' 找不到酒名／版本相符的結果；外部欄位沒有更改，請補充酒名後重試。';
    }
  } catch (error) {
    if (active()) status.textContent = basicMessage + ' ' + (error.name === 'AbortError' ? '搜尋逾時，請重試。' : error.message) + ' 外部資料沒有更改，你仍可手動輸入及儲存。';
  } finally {
    clearTimeout(timer);
    if (seq === lookupSequence) {
      lookupController = null;
      button.disabled = false;
      button.textContent = '自動填資料';
    }
  }
}

document.getElementById('fName').addEventListener('input', () => {
  cancelWineLookup();
  lookupFilledBasics.forEach((value, id) => {
    const field = document.getElementById(id);
    if (field.value === value) field.value = '';
  });
  lookupFilledBasics.clear();
  renderFlavorChips();
  document.getElementById('lookupChoices').replaceChildren();
  document.getElementById('lookupStatus').textContent = formReferenceSources.length
    ? '酒名已改動；現有外部描述仍屬原搜尋，請核對或清空後重搜。' : '';
});
document.getElementById('fName').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); lookupWineByName(); }
});
document.getElementById('formModal').addEventListener('click', event => {
  if (event.target === event.currentTarget) cancelWineLookup();
});
