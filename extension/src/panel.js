import { ABOUT } from "./about.js";
import { openCalendar } from "./calendar.js";

/**
 * The panel's stylesheet, scoped to its shadow root. `all: initial` on the host resets every
 * inherited property at the shadow boundary, so Discord's styles never reach the panel.
 */
const PANEL_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: "Inter", "Segoe UI", sans-serif; }
  .card { position: fixed; right: 24px; bottom: 24px; z-index: 2147483646; width: 320px; perspective: 1200px; }
  .flip { display: grid; transform-style: preserve-3d; transition: transform .45s ease; }
  .flip.flipped { transform: rotateY(180deg); }
  .face {
    padding: 16px; border-radius: 12px;
    background: #1a1b26; color: #c0caf5;
    box-shadow: 0 14px 44px rgba(0,0,0,.6);
    border: 1px solid #2f334d;
    grid-area: 1 / 1; backface-visibility: hidden; -webkit-backface-visibility: hidden;
  }
  .back { display: flex; flex-direction: column; transform: rotateY(180deg); }
  @media (prefers-reduced-motion: reduce) { .flip { transition: none; } }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .title { font-size: 15px; font-weight: 700; letter-spacing: .04em; color: #7aa2f7; }
  .head-end { display: flex; align-items: center; gap: 8px; }
  .info {
    width: 18px; height: 18px; padding: 0; border-radius: 50%;
    border: 1px solid #3b4261; background: none; color: #565f89;
    font-size: 11px; font-weight: 700; line-height: 16px; cursor: pointer;
  }
  .info:hover, .info[aria-expanded="true"] { border-color: #7aa2f7; color: #7aa2f7; }
  .info:focus-visible { outline: none; border-color: #c0caf5; color: #c0caf5; }
  .close { background: none; border: none; color: #565f89; font-size: 18px; cursor: pointer; line-height: 1; }
  .close:hover { color: #c0caf5; }
  .channel { font-size: 12px; color: #9aa5ce; margin-bottom: 12px; word-break: break-all; }
  label { display: block; font-size: 11px; color: #565f89; margin: 8px 0 3px; letter-spacing: .05em; text-transform: uppercase; }
  input, select {
    width: 100%; padding: 7px 9px; border-radius: 7px; font-size: 13px;
    background: #16161e; color: #c0caf5; border: 1px solid #2f334d; outline: none;
  }
  input:focus, select:focus { border-color: #7aa2f7; }
  .fieldrow { display: flex; gap: 6px; align-items: stretch; margin-bottom: 2px; }
  .fieldrow input { flex: 1; min-width: 0; }
  .pick {
    width: 34px; flex: none; border: 1px solid #2f334d; border-radius: 7px;
    background: #16161e; color: #9aa5ce; font-size: 14px; cursor: pointer; line-height: 1;
  }
  .pick:hover { border-color: #7aa2f7; color: #7aa2f7; }
  .row { display: flex; gap: 8px; }
  .row > div { flex: 1; }
  button.go {
    width: 100%; margin-top: 14px; padding: 9px 0; border: none; border-radius: 8px;
    background: #7aa2f7; color: #1a1b26; font-size: 13px; font-weight: 700; cursor: pointer;
  }
  button.go:hover { background: #89ddff; }
  button.go[disabled] { opacity: .45; cursor: default; }
  button.cancel {
    width: 100%; margin-top: 8px; padding: 8px 0; display: none;
    border: 1px solid #f7768e; border-radius: 8px; background: none;
    color: #f7768e; font-size: 12px; cursor: pointer;
  }
  .status { margin-top: 10px; font-size: 12px; line-height: 1.45; color: #9aa5ce; white-space: pre-line; }
  .status:empty { display: none; }
  .status.err { color: #f7768e; }
  .status.done { color: #9ece6a; }
  .note { margin: auto 0 0; padding-top: 10px; font-size: 10px; line-height: 1.45; color: #565f89; }
  .about { padding: 10px 12px; border: 1px solid #2f334d; border-radius: 8px; background: #16161e; }
  .about-heading { margin: 0 0 4px; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #565f89; }
  .about-credit { margin: 0 0 8px; font-size: 12px; color: #9aa5ce; }
  .about-links { display: flex; flex-wrap: wrap; gap: 6px; }
  .about-link {
    padding: 3px 8px; border: 1px solid #2f334d; border-radius: 999px;
    font-size: 11px; color: #9aa5ce; text-decoration: none;
  }
  .about-link:hover { border-color: #7aa2f7; color: #c0caf5; }
  .about-link--support { border-color: #7aa2f7; color: #7aa2f7; }
`;

/**
 * The About card on the back of the panel, rendered from `ABOUT`. Links open in a new tab without
 * sending a referrer.
 */
function aboutCard() {
  const card = document.createElement("section");
  card.className = "about";
  const heading = document.createElement("h2");
  heading.className = "about-heading";
  heading.textContent = ABOUT.heading;
  const credit = document.createElement("p");
  credit.className = "about-credit";
  credit.textContent = ABOUT.credit;
  const links = document.createElement("div");
  links.className = "about-links";
  ABOUT.links.forEach((link, index) => {
    const a = document.createElement("a");
    a.className = index === ABOUT.links.length - 1 ? "about-link about-link--support" : "about-link";
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = link.label;
    links.appendChild(a);
  });
  card.append(heading, credit, links);
  return card;
}

/**
 * Builds the panel inside `shadowRoot` and wires its controls to the content script.
 * @param {ShadowRoot} shadowRoot The panel's own root on the page.
 * @param {{onExport: Function, onCancel: Function, onClose: Function}} handlers `onExport` receives
 *   the From and To values, the format and three callbacks that report progress, a saved file or a
 *   failure back into the panel; each of the last two re-enables Export.
 * @returns {{onKeydown: Function, setChannel: Function, setRangeDefaults: Function, setFormat: Function, setStatus: Function}}
 */
export function mountPanel(shadowRoot, handlers) {
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  shadowRoot.appendChild(style);

  const head = `
    <div class="head">
      <span class="title">LEDGER</span>
      <span class="head-end">
        <button class="info" type="button" aria-label="About" aria-expanded="false">i</button>
        <button class="close" title="Close">x</button>
      </span>
    </div>`;
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="flip">
      <div class="face front">${head}
        <div class="channel"></div>
        <label>From</label>
        <div class="fieldrow">
          <input class="from" type="datetime-local" step="1">
          <button class="pick pick-from" title="Open the calendar">📅</button>
        </div>
        <label>To</label>
        <div class="fieldrow">
          <input class="to" type="datetime-local" step="1">
          <button class="pick pick-to" title="Open the calendar">📅</button>
        </div>
        <label>Format</label>
        <select class="format">
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
          <option value="md">Markdown</option>
        </select>
        <button class="go">Export</button>
        <button class="cancel">Cancel</button>
        <div class="status"></div>
      </div>
      <div class="face back" inert>${head}</div>
    </div>
  `;
  const flip = card.querySelector(".flip");
  const front = card.querySelector(".front");
  const back = card.querySelector(".back");
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = "Reads only messages you can already see. Stops at a hard ceiling of 5000 pages.";
  back.append(aboutCard(), note);
  shadowRoot.appendChild(card);

  const $ = (sel) => front.querySelector(sel);
  const channelEl = $(".channel");
  const fromEl = $(".from");
  const toEl = $(".to");
  const formatEl = $(".format");
  const goEl = $(".go");
  const cancelEl = $(".cancel");
  const statusEl = $(".status");

  function setStatus(text, kind = "") {
    statusEl.textContent = text;
    statusEl.className = `status ${kind}`;
  }

  for (const el of card.querySelectorAll(".close")) el.addEventListener("click", handlers.onClose);

  // The info button turns the panel over to the About card and back. Both faces share one grid
  // cell, so the panel keeps the height of the taller face. The face turned away is inert, so
  // neither Tab nor a screen reader reaches its controls. An export keeps running while the About
  // side shows.
  const setFlipped = (flipped) => {
    calendar?.close();
    flip.classList.toggle("flipped", flipped);
    front.inert = flipped;
    back.inert = !flipped;
    for (const el of card.querySelectorAll(".info")) el.setAttribute("aria-expanded", String(flipped));
    (flipped ? back : front).querySelector(".info").focus();
  };
  for (const el of card.querySelectorAll(".info")) {
    el.addEventListener("click", () => setFlipped(!flip.classList.contains("flipped")));
  }

  // One calendar at a time. The calendar reports its own closing when a day is picked, so the next
  // press on either button opens a grid straight away.
  let calendar = null;
  const toggleCalendar = (button, input) => {
    const openHere = calendar?.input === input;
    calendar?.close();
    if (openHere) return;
    const opened = { input, close: null };
    opened.close = openCalendar({
      container: shadowRoot,
      anchor: button,
      input,
      onClose: () => {
        if (calendar === opened) calendar = null;
      },
    });
    calendar = opened;
  };
  $(".pick-from").addEventListener("click", () => toggleCalendar($(".pick-from"), fromEl));
  $(".pick-to").addEventListener("click", () => toggleCalendar($(".pick-to"), toEl));

  // Events from the panel stop bubbling at its shadow root, so Discord's bubbling listeners on the
  // document and window never receive them.
  for (const type of [
    "keydown",
    "keyup",
    "keypress",
    "input",
    "wheel",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "contextmenu",
  ]) {
    shadowRoot.addEventListener(type, (e) => e.stopPropagation());
  }

  goEl.addEventListener("click", () => {
    if (goEl.disabled) return;
    goEl.disabled = true;
    cancelEl.style.display = "block";
    setStatus("Starting");
    handlers.onExport({
      startInput: fromEl.value,
      endInput: toEl.value,
      format: formatEl.value,
      onProgress: (line) => setStatus(line),
      onFinished: (filename) => {
        setStatus(`Saved ${filename}`, "done");
        goEl.disabled = false;
        cancelEl.style.display = "none";
      },
      onError: (message) => {
        setStatus(message, "err");
        goEl.disabled = false;
        cancelEl.style.display = "none";
      },
    });
  });

  cancelEl.addEventListener("click", () => {
    cancelEl.style.display = "none";
    setStatus("Cancelling");
    handlers.onCancel();
  });

  /** Escape closes an open calendar, or else turns the panel back from the About side. */
  function onKeydown(e) {
    if (e.key !== "Escape") return;
    if (calendar) calendar.close();
    else if (flip.classList.contains("flipped")) setFlipped(false);
  }

  return {
    onKeydown,
    setChannel: (text) => {
      channelEl.textContent = text;
    },
    setRangeDefaults: (startValue, endValue) => {
      fromEl.value = startValue;
      toEl.value = endValue;
    },
    setFormat: (value) => {
      formatEl.value = value;
    },
    setStatus,
  };
}
