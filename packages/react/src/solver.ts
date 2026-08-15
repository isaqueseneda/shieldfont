/**
 * The browser half of the time-lock plain-text path.
 *
 * `@shieldfont/core/puzzle` seals a block at build time; this file generates the
 * script that opens it in the reader's browser. The two must agree byte for byte
 * on the key derivation (fixed-width lowercase hex of the puzzle answer, SHA-256
 * over its UTF-8 bytes) or the AES-GCM auth tag rejects and the reader gets an
 * error where their words should be. `puzzle.test.ts` in @shieldfont/core pins
 * that agreement with a solver written out longhand from WebCrypto primitives.
 *
 * ## Why the emitted script is a string
 *
 * Same reason as the font guard beside it in Shield.tsx: it has to run without
 * React, without hydration, and on a static export with no bundler in the
 * picture.
 *
 * ## Why the emitted source carries no comments
 *
 * Every byte here ships on every page that uses the mode, and — the reason that
 * actually matters — prose about decoys and shielding is precisely the
 * signature `setCamouflage` exists to erase. A project that picked its own hash
 * so its HTML shares no fingerprint with any other ShieldFont site would have
 * that undone by one explanatory comment surviving into the page. The font
 * guard has always been written this way; so is this. The explanations live in
 * this file, in comments that stop at the compiler.
 *
 * Annotated tour of the emitted source, in the order it appears:
 *
 * - `CAPABLE` gates on `BigInt` and `crypto.subtle`. The latter is also absent
 *   on insecure origins (plain http, not localhost), which is a real deployment
 *   mistake rather than an old browser, so the two get different messages.
 * - `human()` rounds the estimate to something a person would say. Precision
 *   would be false comfort: the number comes from a 75 ms sample.
 * - The calibration squarings inside the worker are real work toward the
 *   answer, so the main loop resumes from where they stopped rather than
 *   restarting from 2. Calibration is free, not overhead.
 * - `reveal()` hides the encoded block once the words are on screen. It is
 *   already `aria-hidden`, so that only changes what sighted readers see:
 *   identical words, set in the page's own face rather than through the
 *   substituted one, and selectable. It then moves focus to the output, because
 *   announcing "done" and leaving someone to hunt for what changed is the
 *   classic half-implementation of this pattern.
 * - The busy state is `aria-disabled`, NEVER the `disabled` property. Setting
 *   `disabled` on the element that currently HAS focus makes the browser move
 *   focus to <body>, and measured here it stayed there for the whole grind —
 *   the seconds in which a keyboard user has lost their place and a
 *   screen-reader user on Windows has had their virtual cursor reset to the top
 *   of the document. The polite "working" message then arrives with nothing to
 *   attach it to. `aria-disabled` announces the same state, keeps the control
 *   focusable, and requires the click handler to return early — which it now
 *   does. `fail()` also returns focus to the button, since its own message
 *   tells the reader to try again and they need somewhere to try it from. The
 *   drawn wrapper learned this first; this is that fix ported to the path that
 *   ships by default.
 * - The button ships `hidden` and is revealed only once `CAPABLE` passes. A
 *   control that cannot work is worse than no control, and worst of all for a
 *   reader who cannot see that pressing it did nothing.
 * - The revealed output becomes `tabindex="0"` — a real Tab stop — the moment
 *   it has content. It ships at `-1` so an empty element is not a stop. This
 *   exists because of one sentence from a real VoiceOver session: "I kept
 *   pushing tab, and I couldn't re-read the text." Tab moves between controls,
 *   and the words were not one, so after the announcement finished there was no
 *   way back to them without switching navigation modes. Now Tab returns to the
 *   text as often as the reader wants.
 * - Announcement density is planned from the MEASURED duration, not fixed.
 *   Quarters on a four-second decode meant each update cut off the one before
 *   it — a real VoiceOver session read the estimate back as "working this"
 *   before 25 percent killed it. Under six seconds now gets no interim updates
 *   at all, under twenty gets halfway only, and quarters are kept for waits
 *   long enough to need them. The estimate was shortened for the same reason.
 * - The first status update ("Measuring how long this will take") is gone. It
 *   was replaced ~80 ms later by the estimate, and VoiceOver read the pair as
 *   "working this" before being cut off. Two polite updates inside one breath
 *   is one update the reader never hears.
 * - localStorage is a fast path only. Every failure around it is swallowed:
 *   storage can be disabled, full, or partitioned, and none of that is a reason
 * - NO aria-busy. It was set on the wrapper for the whole grind — the same
 *   wrapper that CONTAINS the polite live region. Per the ARIA spec aria-busy
 *   tells assistive technology it may ignore changes until busy goes false and
 *   then treat them as one update, which is a request to suppress exactly the
 *   announcements this feature depends on. Support is inconsistent, and that
 *   inconsistency is the only reason the estimate and the milestones were heard
 *   at all. It bought nothing either way: nothing announces "busy" for a
 *   generic container, aria-disabled on the button already carries the state,
 *   and the live region already tells assistive technology about every status
 *   change.
 * - localStorage is a fast path only. It is read AFTER the button is shown and
 *   wired, which is load-bearing: the read used to sit above them and return
 *   early, so a cached value that failed to open removed itself and left the
 *   block with no button, no listener and no status for the rest of the page
 *   view. 0.3.1 stored the PLAINTEXT under this identical key, so every
 *   returning reader of an upgraded site hit exactly that on their first visit
 *   — a paragraph they could not read and nothing to press. A fast path must
 *   never be able to remove the slow one.
 * - THE CACHE IS BOUNDED BY AGE. Every value carries the time it was last used,
 *   base-36 after a dot, and `tidy()` drops anything under the store prefix
 *   untouched for thirty days. Nothing used to remove these at all, and a fresh
 *   `sealText` call per build re-mints every ciphertext, so every deploy orphaned
 *   every key the previous one had produced. Do NOT replace this with "drop the
 *   keys this page does not need": the prefix is per-site, so that would delete
 *   the reader's cache for every OTHER page of the same site on every
 *   navigation. The full argument, the two rejected bounds and what a reader can
 *   still lose are in the header of notice.ts, which carries the identical three
 *   helpers — a page mixing both tiers runs both scripts over one store, so the
 *   value format has to be the same on both sides or each would read the other's
 *   entries as unstamped and delete them.
 * - The page-wide broadcast SKIPS ANY BUTTON CARRYING the solve attribute, and
 *   sets its own aria-disabled BEFORE it fans out. The clipped button now
 *   renders through the same <ActionButton> as the drawn one, so it carries
 *   both marks — and the broadcast loop over the drawn ones therefore matched
 *   the pressed button itself and re-entered its own handler. One real click
 *   started two Workers on the same chain: the whole grind budget, twice, on
 *   the reader's device. Only HTMLElement.click()'s in-progress flag stopped it
 *   recursing further, and a .click()-driven test cannot see it at all — it
 *   needs a real pointer event.
 * - THE BROADCAST TO THE DRAWN TIER IS MARKED, not a bare .click(). It was
 *   bare, and notice.ts's document handler could not tell a synthetic press
 *   from a reader's — so it treated every broadcast as owned and moved focus.
 *   On a page carrying both tiers, pressing the clipped control landed the
 *   reader inside a DIFFERENT block's revealed text a few seconds later, with
 *   the virtual cursor moved out from under them. The fix this file already
 *   applied to its own peers (`ev.__all`) simply never crossed the tier
 *   boundary. Falls back to .click() where MouseEvent construction fails.
 * - ONLY THE BLOCK THE READER PRESSED TAKES FOCUS. Every block finishes at its
 *   own time and each one used to call out.focus() unconditionally, so a
 *   three-block page yanked the reader's place three times and left them on
 *   whichever block finished last — not the one they asked for. On a virtual
 *   cursor each move also cuts off the speech already in flight. The pressed
 *   button marks itself; the ones started by the broadcast reveal silently, and
 *   the reader can Tab to them because the revealed text is a real Tab stop.
 *
 * ## Why a Worker, and why a fallback
 *
 * Twenty seconds of `x = (x * x) % n` on the main thread freezes the tab: no
 * scrolling, no focus movement, no screen-reader interaction. That is not a slow
 * experience, it is a broken one, and it would be inflicted specifically on the
 * readers this feature exists for. So the grind goes in a Worker built from a
 * blob URL — no separate file, so a static export still works.
 *
 * A strict Content-Security-Policy can forbid `blob:` workers. Rather than
 * failing there, the script falls back to running on the main thread in ~20 ms
 * slices with a yield between them, which keeps the page interactive at some
 * cost in total time. Slower and correct beats faster and frozen.
 *
 * ## Announcement discipline
 *
 * Fine-grained progress goes on a `<progress>` element, which assistive
 * technology can query on demand but does not announce. The live region gets
 * four updates for the whole run — start, and each quarter — because a polite
 * live region updated at 60 Hz makes a screen reader unusable for the duration.
 * The asymmetry is deliberate: sighted users get a smooth bar, screen-reader
 * users get milestones they can listen through.
 */

/**
 * Names the emitted script needs, all derived from the camouflage state.
 *
 * `attr` is the BASE attribute and every DOM hook is derived from it here, in
 * one place — `-solve` for the button, `-group` for the wrapper, `-status`,
 * `-bar`, `-out`, `-data` for the parts. That is deliberate. The first cut took
 * the button's full attribute (`data-typeface-solve`) as its base and derived
 * the rest from THAT, so it hunted for `data-typeface-solve-status` while the
 * component rendered `data-typeface-status`. Both halves were individually
 * correct and every markup test passed; the button simply never appeared on a
 * real page. One base, derived identically on both sides, is what makes that
 * class of bug unrepresentable.
 */
export interface SolverNames {
  /** The camouflage base attribute, e.g. `data-typeface`. */
  attr: string;
  /** Window-level idempotency flag, so N blocks emit one wiring pass. */
  flag: string;
  /** Console prefix for errors. */
  logPrefix: string;
  /** localStorage key prefix for solved blocks. */
  storePrefix: string;
}

/**
 * The Worker body: calibrate, then grind, reporting progress.
 *
 * Calibration runs INSIDE the worker so the main thread never blocks, and its
 * result is posted straight back so the UI can promise a number measured on
 * this device rather than one baked in at build time on someone else's laptop.
 * Safari and Firefox trail V8 on BigInt and a phone trails a laptop, so a
 * build-time estimate would be wrong by a factor of several in both directions
 * — and an estimate that overruns reads as a hang.
 *
 * The 8,000-step WARM-UP before the timed window is not padding. V8 does not
 * reach steady-state on a BigInt loop for the first several thousand
 * iterations, so timing from the very first squaring measures the cold
 * interpreter and understates the device by roughly 2.5x. Measured in Chrome:
 * a run that announced "about 5 seconds" finished in 1.9 s. Erring early is the
 * safe direction, but not by that much — the number is a promise made to
 * someone who is waiting, and being wrong by a factor of two teaches them to
 * distrust it.
 *
 * Both windows count toward the answer (the loop resumes at W+C rather than
 * restarting), so calibration costs nothing but the ~30 ms it takes.
 */
const WORKER_BODY = `var W=8000,C=25000;
onmessage=function(e){
var n=BigInt(e.data.n),t=e.data.t,x=2n,i;
for(i=0;i<W;i++)x=(x*x)%n;
var c0=Date.now();
for(i=W;i<W+C;i++)x=(x*x)%n;
var el=Math.max(1,Date.now()-c0),rate=C/(el/1000);
postMessage({rate:rate,seconds:(t-W-C)/rate});
var step=Math.max(1,Math.floor(t/200));
for(i=W+C;i<t;i++){x=(x*x)%n;if(i%step===0)postMessage({p:i/t});}
postMessage({done:x.toString(16)});
};`;

/**
 * Build the solver script for one page.
 *
 * Emitted once per render pass (see the PassRegistry note in Shield.tsx), then
 * wires every sealed block on the page. Blocks that stream in later are picked
 * up by a MutationObserver, so a Suspense boundary resolving after this ran
 * still gets a working button.
 */
/**
 * A string literal safe inside `<script>`. See the twin in solver.ts: an HTML
 * parser ends a script at the first literal `</`, whatever JavaScript quoting
 * says, so `JSON.stringify` alone is not enough for a value that lands there.
 * Duplicated rather than shared because Shield.tsx imports this module, and an
 * import back would be a cycle.
 */
function js(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function solverScript(names: SolverNames): string {
  const { attr, flag, logPrefix, storePrefix } = names;

  return `(function(){
if (typeof window === 'undefined' || typeof document === 'undefined') return;
if (window[${js(flag)}]) return;
window[${js(flag)}] = 1;
var ATTR = ${js(attr)};
var SOLVE = ATTR + '-solve';
var PFX = ${js(logPrefix)};
var STORE = ${js(storePrefix)};
var LIFE = 2592000000;
var BODY = ${js(WORKER_BODY)};
var CAPABLE = typeof BigInt === 'function' && typeof window.crypto === 'object' &&
              window.crypto && typeof window.crypto.subtle === 'object';
function fromB64(s){
  var bin = atob(s), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function keep(k, v){
  try { window.localStorage.setItem(k, v + '.' + Date.now().toString(36)); } catch (e) {}
}
function held(k){
  var v = null, i;
  try { v = window.localStorage.getItem(k); } catch (e) {}
  i = v ? v.indexOf('.') : -1;
  if (i < 0) return null;
  v = v.slice(0, i);
  keep(k, v);
  return v;
}
function tidy(){
  try {
    var s = window.localStorage, now = Date.now(), dead = [], i, k, v, j;
    for (i = 0; i < s.length; i++){
      k = s.key(i);
      if (!k || k.slice(0, STORE.length) !== STORE) continue;
      v = s.getItem(k);
      j = v ? v.indexOf('.') : -1;
      if (!(now - (j < 0 ? 0 : parseInt(v.slice(j + 1), 36)) < LIFE)) dead.push(k);
    }
    for (i = 0; i < dead.length; i++) s.removeItem(dead[i]);
  } catch (e) {}
}
function show(el){ if (el) { el.hidden = false; el.style.removeProperty('display'); } }
function hide(el){ if (el) { el.hidden = true; el.style.setProperty('display', 'none', 'important'); } }
function text(el, s){ if (el) el.textContent = s; }
function plural(n, one, many){ return n + ' ' + (n === 1 ? one : many); }
function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
function human(seconds){
  if (seconds < 45) return 'about ' + plural(Math.max(5, Math.round(seconds / 5) * 5), 'second', 'seconds');
  var mins = seconds / 60;
  if (mins < 1.5) return 'about a minute';
  return 'about ' + plural(Math.round(mins), 'minute', 'minutes');
}
function open(hex, data, hexLen){
  var canon = hex.length >= hexLen ? hex : new Array(hexLen - hex.length + 1).join('0') + hex;
  return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon))
    .then(function(d){ return window.crypto.subtle.importKey('raw', d, 'AES-GCM', false, ['decrypt']); })
    .then(function(k){
      return window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(data.iv) }, k, fromB64(data.ct));
    })
    .then(function(buf){ return new TextDecoder().decode(buf).replace(/\\u0000+$/, ''); });
}
function pick(list, key){
  var h = 5381, i;
  for (i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}
function wire(btn){
  if (btn.getAttribute(SOLVE + '-wired')) return;
  var wrap = btn.closest('[' + ATTR + '-group]');
  if (!wrap) return;
  var status = wrap.querySelector('[' + ATTR + '-status]');
  var bar    = wrap.querySelector('[' + ATTR + '-bar]');
  var out    = wrap.querySelector('[' + ATTR + '-out]');
  var holder = wrap.querySelector('[' + ATTR + '-data]');
  if (!status || !out || !holder) return;
  btn.setAttribute(SOLVE + '-wired', '1');
  function targetBlock(){ return document.getElementById(btn.getAttribute(SOLVE + '-for')); }
  var data = null;
  try {
    var all = JSON.parse(holder.textContent);
    var d = all && all.length ? pick(all, btn.getAttribute(SOLVE + '-for') || '') : all;
    if (d && typeof d.ct === 'string' && d.n && d.t) data = d;
  }
  catch (err) { console.error(PFX + ' sealed payload is not valid JSON.', err); }
  if (!data){ console.error(PFX + ' sealed payload is missing required fields.'); return; }
  var storeKey = STORE + data.ct.slice(0, 40);
  function reveal(plain, cached){
    var onScreen = out.getAttribute(ATTR + '-out') !== 'hidden';
    if (onScreen) hide(targetBlock());
    hide(btn);
    hide(bar);
    text(status, cached ? 'The text is ready.' : (onScreen ? 'Done. The text is shown below.' : 'Done.'));
    var note = wrap.querySelector('[' + ATTR + '-open-note]');
    if (note){
      var opened = note.getAttribute(ATTR + '-open-note');
      if (opened) note.textContent = opened;
    }
    out.textContent = plain;
    out.setAttribute('tabindex', '0');
    show(out);
    if (!cached && btn.__own) { try { out.focus(); } catch (e) {} }
  }
  if (!CAPABLE) {
    text(status, window.isSecureContext === false
      ? 'This needs a secure (https) connection.'
      : 'This browser can’t show the full text.');
    return;
  }
  show(btn);
  try {
    var hit = held(storeKey);
    if (hit !== null) {
      var hexLen0 = BigInt(data.n).toString(16).length;
      open(hit, data, hexLen0).then(function(plain){ reveal(plain, true); },
        function(){ try { window.localStorage.removeItem(storeKey); } catch (e) {} });
    }
  } catch (e) {}
  btn.addEventListener('click', function(ev){
    if (btn.getAttribute('aria-disabled') === 'true') return;
    btn.setAttribute('aria-disabled', 'true');
    btn.__own = !ev || !ev.__all;
    if (btn.__own) out.setAttribute('aria-live', 'polite');
    else { out.removeAttribute('aria-live'); if (status) status.setAttribute('aria-live', 'off'); }
    if (!ev || !ev.__all){
      var peers = document.querySelectorAll('[' + SOLVE + ']');
      for (var pi = 0; pi < peers.length; pi++){
        var pb = peers[pi];
        if (pb === btn || pb.hidden || pb.getAttribute('aria-disabled') === 'true') continue;
        try { var e2 = new MouseEvent('click'); e2.__all = 1; pb.dispatchEvent(e2); } catch (e) {}
      }
      var drawn = document.querySelectorAll('[' + ATTR + '-act="show"]');
      for (var di = 0; di < drawn.length; di++){
        var db = drawn[di];
        if (db === btn || db.hasAttribute(SOLVE)) continue;
        if (db.hidden || db.getAttribute('aria-disabled') === 'true') continue;
        try { var e3 = new MouseEvent('click', {bubbles: true}); e3.__all = 1; db.dispatchEvent(e3); }
        catch (e) { try { db.click(); } catch (e2) {} }
      }
    }
    show(bar);
    if (bar) bar.value = 0;
    var hexLen = BigInt(data.n).toString(16).length;
    var marks = [0.25, 0.5, 0.75];
    var spoken = 0;
    function planMarks(sec){
      if (sec < 6) marks = [];
      else if (sec < 20) marks = [0.5];
      else marks = [0.25, 0.5, 0.75];
    }
    function progress(p){
      if (bar) bar.value = Math.round(p * 100);
      while (spoken < marks.length && p >= marks[spoken]) {
        text(status, Math.round(marks[spoken] * 100) + ' percent.');
        spoken++;
      }
    }
    function finish(hex){
      open(hex, data, hexLen).then(function(plain){
        keep(storeKey, hex);
        reveal(plain, false);
      }).catch(function(err){
        console.error(PFX + ' could not open the sealed text.', err);
        fail('Something went wrong.');
      });
    }
    function fail(msg){
        hide(bar);
      btn.removeAttribute('aria-disabled');
      show(btn);
      text(status, msg + ' You can try again.');
      try { btn.focus(); } catch (e) {}
    }
    function chunked(){
      var n = BigInt(data.n), t = data.t, x = 2n, i = 0, SLICE = 4000;
      var started = Date.now(), measured = false;
      text(status, 'Working. This will take a little while. You can keep reading the page.');
      (function run(){
        var end = Math.min(t, i + SLICE);
        for (; i < end; i++) x = (x * x) % n;
        if (!measured && i >= SLICE) {
          measured = true;
          var rate = i / Math.max(0.001, (Date.now() - started) / 1000);
          planMarks(t / rate);
          text(status, cap(human(t / rate)) + '.');
        }
        progress(i / t);
        if (i < t) setTimeout(run, 0); else finish(x.toString(16));
      })();
    }
    var worker = null;
    try {
      var url = URL.createObjectURL(new Blob([BODY], { type: 'text/javascript' }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
    } catch (e) { worker = null; }
    if (!worker) { chunked(); return; }
    worker.onmessage = function(ev){
      var m = ev.data;
      if (m.seconds !== undefined) {
        planMarks(m.seconds);
        text(status, m.seconds < 20
          ? cap(human(m.seconds)) + '.'
          : cap(human(m.seconds)) + '. You can keep reading.');
      } else if (m.p !== undefined) {
        progress(m.p);
      } else if (m.done !== undefined) {
        worker.terminate();
        progress(1);
        finish(m.done);
      }
    };
    worker.onerror = function(){ worker.terminate(); chunked(); };
    worker.postMessage({ n: data.n, t: data.t });
  });
}
function sweep(){
  var els = document.querySelectorAll('[' + SOLVE + ']');
  for (var i = 0; i < els.length; i++){
    try { wire(els[i]); }
    catch (e) { console.error(PFX + ' one control could not be prepared.', e); }
  }
}
tidy();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sweep);
else sweep();
try {
  new MutationObserver(function(){ if (document.readyState !== 'loading') sweep(); })
    .observe(document.documentElement, { childList: true, subtree: true });
} catch (e) {}
})();`;
}
