// Miruro.cx for ShiroX (experimental v0.1.0)
// Standalone implementation; no tracking, analytics, or credentials.
// Uses Miruro's secure pipe and pako for gzip decompression.
const MIRURO_BASE = 'https://miruro.cx';
const MIRURO_PIPE = MIRURO_BASE + '/api/secure/pipe';
const MIRURO_KEY = '71951034f8fbcf53d89db52ceb3dc22c';
const MIRURO_PAKO = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js';

function mrB64Encode(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '', i = 0;
  while (i < str.length) {
    const a = str.charCodeAt(i++), b = i < str.length ? str.charCodeAt(i++) : -1;
    const c = i < str.length ? str.charCodeAt(i++) : -1;
    out += chars[a >> 2] + chars[((a & 3) << 4) | (b < 0 ? 0 : b >> 4)];
    out += b < 0 ? '=' : chars[((b & 15) << 2) | (c < 0 ? 0 : c >> 6)];
    out += c < 0 ? '=' : chars[c & 63];
  }
  return out;
}
function mrB64Decode(input) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const s = String(input).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '').replace(/=+$/, '');
  let acc = 0, bits = 0, out = [];
  for (const ch of s) {
    const v = chars.indexOf(ch);
    if (v < 0) throw new Error('Invalid Base64 response');
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
  }
  return out;
}
function mrUtf8(str) { return unescape(encodeURIComponent(str)); }
function mrBytesUtf8(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  try { return decodeURIComponent(escape(s)); } catch (_) { return s; }
}
async function mrFetch(url, options) {
  const o = options || {};
  if (typeof fetchv2 === 'function') {
    try { return await fetchv2(url, o.headers || {}, o.method || 'GET', o.body || null); }
    catch (_) { /* Try standard fetch */ }
  }
  if (typeof fetch !== 'function') throw new Error('No HTTP fetch available');
  return await fetch(url, o);
}
async function mrText(res) {
  if (!res) throw new Error('No network response');
  if (res.status && Number(res.status) >= 400) throw new Error('HTTP ' + res.status);
  if (typeof res.text === 'function') return await res.text();
  if (typeof res.data === 'string') return res.data;
  if (typeof res.body === 'string') return res.body;
  throw new Error('Unsupported HTTP response format');
}
let mrPakoReady = false;
async function mrGetPako() {
  if (typeof pako !== 'undefined' && pako && typeof pako.ungzip === 'function') return pako;
  if (typeof globalThis !== 'undefined' && globalThis.pako) return globalThis.pako;
  // Some ShiroX runtimes disallow runtime JS evaluation. In those environments
  // a bundled decompressor or a different API is required.
  if (!mrPakoReady) {
    const src = await mrText(await mrFetch(MIRURO_PAKO));
    if (typeof Function !== 'function') throw new Error('Runtime cannot load gzip decoder');
    const root = (typeof globalThis !== 'undefined') ? globalThis : {};
    new Function('window', 'global', src)(root, root);
    mrPakoReady = true;
  }
  if (typeof globalThis !== 'undefined' && globalThis.pako) return globalThis.pako;
  throw new Error('Gzip decoder unavailable');
}
async function mrPipe(path, query) {
  const payload = {path, method:'GET', query: query || {}, body:null, version:'0.2.0'};
  const enc = mrB64Encode(mrUtf8(JSON.stringify(payload))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await mrFetch(MIRURO_PIPE + '?e=' + enc, {
    method:'GET', headers:{'Accept':'*/*','Origin':MIRURO_BASE,'Referer':MIRURO_BASE + '/'}
  });
  const text = (await mrText(res)).trim();
  if (!text || /^</.test(text)) throw new Error('Miruro returned an HTML challenge or empty reply');
  if (text.startsWith('{')) {
    const obj = JSON.parse(text);
    if (obj.error) throw new Error(String(obj.error));
    return obj;
  }
  const original = mrB64Decode(text);
  const key = [];
  for (let i = 0; i < MIRURO_KEY.length; i += 2) key.push(parseInt(MIRURO_KEY.slice(i, i+2), 16));
  const xor = original.map((b,i) => b ^ key[i % key.length]);
  const zip = await mrGetPako();
  for (const bytes of [xor, original]) {
    try { return JSON.parse(zip.ungzip(new Uint8Array(bytes), {to:'string'})); } catch (_) {}
    try { return JSON.parse(zip.inflate(new Uint8Array(bytes), {to:'string'})); } catch (_) {}
  }
  try { return JSON.parse(mrBytesUtf8(original)); } catch (_) {}
  throw new Error('Could not decode Miruro pipe response');
}
function mrId(href) {
  const m = String(href).match(/(?:miruro:\/\/|miruro-play:\/\/)(\d+)/);
  if (!m) throw new Error('Invalid Miruro anime URL');
  return Number(m[1]);
}
function mrLang(cat) { return /dub/i.test(cat) ? 'DUB' : 'SUB'; }
function mrProviderEpisodes(data) {
  const entries = [];
  if (!data || !data.providers) return entries;
  for (const provider of Object.keys(data.providers)) {
    const groups = data.providers[provider] && data.providers[provider].episodes;
    if (!groups) continue;
    for (const category of Object.keys(groups)) {
      const items = groups[category];
      if (!Array.isArray(items)) continue;
      for (const ep of items) {
        const num = Number(ep.number);
        if (Number.isFinite(num) && num > 0 && ep.id != null) entries.push({provider,category,ep,num});
      }
    }
  }
  return entries;
}
async function searchResults(query) {
  const data = await mrPipe('search', {q:String(query),limit:30,offset:0,sort:'POPULARITY_DESC',type:'ANIME',isAdult:false});
  const items = Array.isArray(data) ? data : (data.results || []);
  return JSON.stringify(items.filter(x=>x && x.id && !x.isAdult).map(x=>({
    title:(x.title && (x.title.english || x.title.romaji || x.title.native)) || 'Untitled',
    image:(x.coverImage && (x.coverImage.large || x.coverImage.medium)) || '',
    href:'miruro://' + x.id
  })));
}
async function extractDetails(href) {
  const id = mrId(href);
  const x = await mrPipe('info/anilist/' + id, {});
  return JSON.stringify([{
    description:String(x.description || '').replace(/<[^>]*>/g,''),
    aliases:x.title ? Object.values(x.title).filter(Boolean).join(' / ') : '',
    airdate:x.seasonYear ? String(x.seasonYear) : ''
  }]);
}
async function extractEpisodes(href) {
  const id = mrId(href);
  const data = await mrPipe('episodes', {anilistId:id});
  const episodes = new Map();
  for (const item of mrProviderEpisodes(data)) {
    if (!episodes.has(item.num)) episodes.set(item.num, {
      href:'miruro-play://' + id + '/' + item.num,
      number:item.num, season:1, title:item.ep.title || 'Episode ' + item.num
    });
  }
  return JSON.stringify([...episodes.values()].sort((a,b)=>a.number-b.number));
}
async function extractStreamUrl(href) {
  const id = mrId(href);
  const m = String(href).match(/miruro-play:\/\/\d+\/(\d+)/);
  const number = m ? Number(m[1]) : 1;
  const eps = await mrPipe('episodes', {anilistId:id});
  const items = mrProviderEpisodes(eps).filter(x=>x.num===number)
    .sort((a,b)=>Number(mrLang(a.category)==='DUB')-Number(mrLang(b.category)==='DUB'));
  const streams = [], allSubtitles = [], seen = new Set();
  for (const item of items) {
    const query = {episodeId:item.ep.id,provider:item.provider.toLowerCase(),category:item.category.toLowerCase(),ttl:86400,anilistId:id};
    let result;
    try { result = await mrPipe('sources', query); } catch (err) { console.log('[Miruro] ' + item.provider + ': ' + err.message); continue; }
    const section = result[item.category] || result;
    const sources = section.sources || section.streams || result.sources || result.streams || [];
    for (const source of (Array.isArray(sources) ? sources : [])) {
      const url = source.url || source.file;
      if (typeof url !== 'string' || !/^https?:\/\//.test(url) || seen.has(url)) continue;
      if (!/\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(url) && String(source.type).toLowerCase() !== 'hls') continue;
      seen.add(url);
      streams.push({
        title:item.provider + ' ' + (source.quality || 'Auto') + ' ' + mrLang(item.category),
        streamUrl:url,
        headers:{Referer:source.referer || MIRURO_BASE + '/'}
      });
    }
    const subtitles = section.subtitles || result.subtitles || [];
    for (const sub of (Array.isArray(subtitles) ? subtitles : [])) {
      const url = sub.url || sub.file;
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) continue;
      if (!allSubtitles.some(s=>s.url===url)) allSubtitles.push({
        url,label:sub.label || sub.language || sub.lang || 'Unknown',kind:sub.kind || 'captions'
      });
    }
  }
  if (!streams.length) return JSON.stringify({type:'none'});
  const english = allSubtitles.find(s=>/eng|english/i.test(s.label));
  return JSON.stringify({type:'servers',streams,subtitle:english ? english.url : '',
    subtitles:english ? english.url : '',allSubtitles});
}
