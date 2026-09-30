const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Splits a datetime-local value into its date and time parts; a field with no time takes noon. */
function partsOf(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(T[\d:]+)?$/.exec(value || "");
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]), time: match[4] ?? "T12:00" };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/**
 * Opens a month grid under `anchor`. Picking a day writes it into `input` and keeps the time
 * already there, so the grid changes the date without resetting the hour. The grid closes on a
 * pick or through the returned function, and calls `onClose` either way.
 * @param {{container: Node, anchor: Element, input: HTMLInputElement, onClose?: Function}} options
 * @returns {Function} Closes the grid; calling it again does nothing.
 */
export function openCalendar({ container, anchor, input, onClose }) {
  const existing = partsOf(input.value);
  const today = new Date();
  let viewYear = existing ? existing.y : today.getFullYear();
  let viewMonth = existing ? existing.m - 1 : today.getMonth();

  const pop = document.createElement("div");
  pop.className = "cal";
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    pop.remove();
    onClose?.();
  }

  const style = document.createElement("style");
  style.textContent = `
    .cal {
      position: fixed; z-index: 2147483647; width: 248px; padding: 10px;
      background: #16161e; border: 1px solid #2f334d; border-radius: 10px;
      box-shadow: 0 14px 44px rgba(0,0,0,.6); color: #c0caf5;
      font-family: "Inter", "Segoe UI", sans-serif; font-size: 12px;
      user-select: none;
    }
    .cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .cal-title { font-weight: 700; letter-spacing: .03em; }
    .cal-nav {
      background: none; border: 1px solid #2f334d; border-radius: 6px; color: #9aa5ce;
      width: 26px; height: 24px; cursor: pointer; font-size: 13px; line-height: 1;
    }
    .cal-nav:hover { color: #7aa2f7; border-color: #7aa2f7; }
    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
    .cal-dow { text-align: center; color: #565f89; font-size: 10px; padding: 3px 0; }
    .cal-day {
      background: none; border: none; border-radius: 6px; color: #c0caf5;
      padding: 5px 0; cursor: pointer; font-size: 11px;
    }
    .cal-day:hover { background: #24283b; }
    .cal-day.dim { color: #3b4261; }
    .cal-day.today { border: 1px solid #565f89; }
    .cal-day.sel { background: #7aa2f7; color: #1a1b26; font-weight: 700; }
  `;
  pop.appendChild(style);

  function draw() {
    pop.querySelectorAll(".cal-head, .cal-grid").forEach((el) => el.remove());

    const head = document.createElement("div");
    head.className = "cal-head";
    const prev = document.createElement("button");
    prev.className = "cal-nav";
    prev.textContent = "‹";
    prev.addEventListener("click", () => {
      viewMonth -= 1;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear -= 1;
      }
      draw();
    });
    const title = document.createElement("span");
    title.className = "cal-title";
    title.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
    const next = document.createElement("button");
    next.className = "cal-nav";
    next.textContent = "›";
    next.addEventListener("click", () => {
      viewMonth += 1;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear += 1;
      }
      draw();
    });
    head.append(prev, title, next);
    pop.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "cal-grid";
    for (const d of WEEKDAYS) {
      const dow = document.createElement("div");
      dow.className = "cal-dow";
      dow.textContent = d;
      grid.appendChild(dow);
    }

    const first = new Date(viewYear, viewMonth, 1);
    // Weeks start on Monday: the number of days shown from the previous month.
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysPrev = new Date(viewYear, viewMonth, 0).getDate();

    const cells = [];
    for (let i = lead - 1; i >= 0; i--) cells.push({ d: daysPrev - i, dim: true });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ d });
    while (cells.length % 7 !== 0) cells.push({ d: cells.length, dim: true, nextFill: true });

    for (let i = 0; i < cells.length / 7; i++) {
      for (let j = i * 7; j < i * 7 + 7; j++) {
        const c = cells[j];
        if (c.nextFill) c.d = j - (lead + daysInMonth) + 1;
        const cell = document.createElement("button");
        cell.className = "cal-day" + (c.dim ? " dim" : "");
        cell.textContent = String(c.d);
        if (!c.dim) {
          const isToday =
            viewYear === today.getFullYear() &&
            viewMonth === today.getMonth() &&
            c.d === today.getDate();
          const isSel =
            existing && existing.y === viewYear && existing.m === viewMonth + 1 && existing.d === c.d;
          if (isToday) cell.classList.add("today");
          if (isSel) cell.classList.add("sel");
          cell.addEventListener("click", () => {
            input.value = `${viewYear}-${pad(viewMonth + 1)}-${pad(c.d)}${partsOf(input.value)?.time ?? "T12:00"}`;
            input.focus();
            close();
          });
        }
        grid.appendChild(cell);
      }
    }
    pop.appendChild(grid);
  }

  // The grid is fixed to the viewport under its button and kept inside the window's right edge.
  function place() {
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${Math.max(8, r.bottom + 6)}px`;
    pop.style.left = `${Math.min(r.left, (window.innerWidth ?? 1280) - 264)}px`;
  }

  draw();
  container.appendChild(pop);
  place();
  return close;
}
