import { h, render } from "preact";
import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import htm from "htm";
import * as A from "./aggregate.js";

const html = htm.bind(h);

// Book group -> jewel hue (CSS class hue-<name>); validated in css/app.css.
const HUE = {
  Ley: "emerald",
  "Históricos": "indigo",
  "Poéticos": "garnet",
  "Profetas Mayores": "teal",
  "Profetas Menores": "amber",
  Evangelios: "amethyst",
  Hechos: "copper",
  "Cartas de Pablo": "sapphire",
  "Cartas Generales": "rose",
  Apocalipsis: "gold",
};
const SERIES = [A.ALL_SERIES, "Culto", "Ayuno", "Guerra"];
const TESTAMENT = { AT: "Antiguo Testamento", NT: "Nuevo Testamento" };
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const PAGE = 20;

const n = (x) => x.toLocaleString("es-CO");
const plural = (k, one, many) => `${n(k)} ${k === 1 ? one : many}`;
const sermonsLabel = (k) => (k === 0 ? "ningún sermón" : plural(k, "sermón", "sermones"));
const dateLabel = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

// ---- routing: everything the user chose lives in the hash, e.g. #Rom/8/28?serie=Ayuno&vista=filas
function parseHash(data) {
  const [path, query = ""] = location.hash.slice(1).split("?");
  const [b, c, v] = path.split("/");
  const params = new URLSearchParams(query);
  const book = data?.books.find((x) => x.id === b);
  let sel = null;
  if (book) {
    sel = { b };
    const ch = Number(c);
    if (Number.isInteger(ch) && ch >= 1 && ch <= book.verses.length) {
      sel.c = ch;
      const vs = Number(v);
      if (Number.isInteger(vs) && vs >= 1 && vs <= book.verses[ch - 1]) sel.v = vs;
    }
  }
  const serie = SERIES.includes(params.get("serie")) ? params.get("serie") : A.ALL_SERIES;
  return { sel, serie, vista: params.get("vista") === "filas" ? "filas" : "vitral", soloCitados: params.get("citados") === "1" };
}
function hrefFor(route, patch = {}) {
  const r = { ...route, ...patch };
  const path = r.sel ? [r.sel.b, r.sel.c, r.sel.v].filter((x) => x != null).join("/") : "";
  const q = new URLSearchParams();
  if (r.serie !== A.ALL_SERIES) q.set("serie", r.serie);
  if (r.vista === "filas") q.set("vista", "filas");
  if (r.soloCitados) q.set("citados", "1");
  const qs = q.toString();
  return `#${path}${qs ? `?${qs}` : ""}`;
}
const selKey = (s) => (s ? [s.b, s.c, s.v].filter((x) => x != null).join("/") : "");
// "On the path": a selected verse also marks its chapter and book.
const isSel = (sel, b, c, v) => !!sel && sel.b === b && (c === undefined || sel.c === c) && (v === undefined || sel.v === v);

// ---- keyboard: one tab stop per grid, arrow keys move between cells geometrically
function navKeys(e) {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const cells = [...e.currentTarget.querySelectorAll("[data-cell]")];
  const i = cells.indexOf(document.activeElement);
  if (i < 0) return;
  let next = null;
  if (e.key === "ArrowLeft") next = cells[i - 1];
  else if (e.key === "ArrowRight") next = cells[i + 1];
  else if (e.key === "Home") next = cells[0];
  else if (e.key === "End") next = cells[cells.length - 1];
  else {
    const cur = cells[i];
    const down = e.key === "ArrowDown";
    const rowOf = (el) => el.getBoundingClientRect().top;
    const x = cur.getBoundingClientRect().left;
    const y = rowOf(cur);
    const cand = cells.filter((el) => (down ? rowOf(el) > y + 2 : rowOf(el) < y - 2));
    if (cand.length) {
      const edge = down ? Math.min(...cand.map(rowOf)) : Math.max(...cand.map(rowOf));
      next = cand.filter((el) => Math.abs(rowOf(el) - edge) < 3)
        .sort((p, q) => Math.abs(p.getBoundingClientRect().left - x) - Math.abs(q.getBoundingClientRect().left - x))[0];
    }
  }
  if (!next) return;
  e.preventDefault();
  setTabStop(cells, next);
  next.focus();
}
function setTabStop(cells, next) {
  for (const c of cells) c.tabIndex = c === next ? 0 : -1;
}
// Tab stop: the selected cell if the grid holds one, else the first.
const tabStops = (flags) => {
  const at = flags.indexOf(true);
  return flags.map((_, i) => (i === (at < 0 ? 0 : at) ? 0 : -1));
};

// ---- small components
function Legend({ scale, hue = "sapphire", note }) {
  const items = [{ b: 0, label: "0" }, ...scale.bins.map((x, i) => ({ b: i + 1, label: x.min === x.max ? `${x.min}` : `${x.min}–${x.max}` }))];
  return html`<div class=${`legend hue-${hue}`} role="group" aria-label="Leyenda: sermones por celda">
    <span>Menos</span>
    <ol>${items.map((it) => html`<li data-b=${it.b}><span></span><span>${it.label}</span></li>`)}</ol>
    <span>Más</span>
    ${note && html`<span class="range">${note}</span>`}
  </div>`;
}

function groupsOf(books) {
  const out = [];
  for (const b of books) {
    let t = out[out.length - 1];
    if (!t || t.testament !== b.testament) out.push((t = { testament: b.testament, groups: [] }));
    let g = t.groups[t.groups.length - 1];
    if (!g || g.name !== b.group) t.groups.push((g = { name: b.group, books: [] }));
    g.books.push(b);
  }
  return out;
}

function GroupHead({ g, idx }) {
  const cited = g.books.filter((b) => A.bookCount(idx, b.id) > 0).length;
  return html`<h3><span class="chip" aria-hidden="true"></span>${g.name}
    <small>${cited} de ${g.books.length} ${g.books.length === 1 ? "libro citado" : "libros citados"}</small></h3>`;
}

function Vitral({ idx, route }) {
  const flags = idx.data.books.map((b) => isSel(route.sel, b.id));
  const stops = tabStops(flags);
  let k = -1;
  return html`<div onKeyDown=${navKeys}>
    ${groupsOf(idx.data.books).map((t) => html`<section class="testament" key=${t.testament}>
      <h2>${TESTAMENT[t.testament]}</h2>
      ${t.groups.map((g) => html`<div class=${`group hue-${HUE[g.name]}`} key=${g.name}>
        <${GroupHead} g=${g} idx=${idx} />
        <div class="panes">
          ${g.books.map((b) => {
            k++;
            const i = idx.bookOrder.get(b.id);
            const count = A.bookCount(idx, b.id);
            const label = `${b.name}: ${sermonsLabel(count)}`;
            return html`<a class="pane" key=${b.id} data-cell data-b=${idx.scales.book.bin(count)} style=${`flex-grow:${b.verses.length};--i:${i}`}
              href=${hrefFor(route, { sel: { b: b.id } })} tabindex=${stops[i]} aria-label=${label} title=${label}
              aria-current=${flags[i] ? "true" : null}>
              <span class="pane-name">${b.name}</span><span class="pane-n">${count || ""}</span></a>`;
          })}
        </div>
      </div>`)}
    </section>`)}
  </div>`;
}

function Filas({ idx, route }) {
  const books = idx.data.books;
  const shown = (b) => !route.soloCitados || A.bookCount(idx, b.id) > 0;
  const flags = books.map((b) => isSel(route.sel, b.id));
  const stops = tabStops(flags);
  const anyShown = books.some(shown);
  if (!anyShown) return html`<${Empty} title="Ningún libro citado todavía" text="Quita el filtro «Mostrar solo libros citados» para ver todos los libros." />`;
  return html`<div onKeyDown=${navKeys}>
    ${groupsOf(books).map((t) => html`<section class="testament" key=${t.testament}>
      <h2>${TESTAMENT[t.testament]}</h2>
      ${t.groups.filter((g) => g.books.some(shown)).map((g) => html`<div class=${`group hue-${HUE[g.name]}`} key=${g.name}>
        <${GroupHead} g=${g} idx=${idx} />
        <div class="rows">
          ${g.books.filter(shown).map((b) => {
            const counts = A.chapterCounts(idx, b.id);
            const total = A.bookCount(idx, b.id);
            const bi = idx.bookOrder.get(b.id);
            return html`<div class="brow" key=${b.id}>
              <a class="brow-name" data-cell href=${hrefFor(route, { sel: { b: b.id } })} tabindex=${stops[bi]} aria-current=${flags[bi] ? "true" : null}
                aria-label=${`${b.name}: ${sermonsLabel(total)}`}><span>${b.name}</span><span class="n">${total || ""}</span></a>
              <div class="brow-cells">
                ${counts.map((cnt, ci) => {
                  const label = `${b.name} ${ci + 1}: ${sermonsLabel(cnt)}`;
                  return html`<a class="cell" key=${ci} data-cell tabindex="-1" data-b=${idx.scales.chapter.bin(cnt)}
                    href=${hrefFor(route, { sel: { b: b.id, c: ci + 1 } })} aria-label=${label} title=${label}
                    aria-current=${isSel(route.sel, b.id, ci + 1) ? "true" : null}></a>`;
                })}
              </div>
            </div>`;
          })}
        </div>
      </div>`)}
    </section>`)}
  </div>`;
}

function Empty({ title, text }) {
  return html`<div class="empty" role="status"><strong>${title}</strong>${text}</div>`;
}

function NumGrid({ idx, route, counts, scale, book, c, level }) {
  const flags = counts.map((_, i) => (level === "chapter" ? isSel(route.sel, book.id, i + 1) : isSel(route.sel, book.id, c, i + 1)));
  const stops = tabStops(flags);
  return html`<div class="mosaic num-grid" onKeyDown=${navKeys}>
    ${counts.map((cnt, i) => {
      const num = i + 1;
      const name = level === "chapter" ? `${book.name} ${num}` : `${book.name} ${c}:${num}`;
      const label = `${name}: ${sermonsLabel(cnt)}`;
      const sel = level === "chapter" ? { b: book.id, c: num } : { b: book.id, c, v: num };
      return html`<a class="cell" key=${num} data-cell data-b=${scale.bin(cnt)} tabindex=${stops[i]} href=${hrefFor(route, { sel })}
        aria-label=${label} title=${label} aria-current=${flags[i] ? "true" : null}>${num}</a>`;
    })}
  </div>`;
}

function Citations({ idx, sel, route }) {
  const [shown, setShown] = useState(PAGE);
  const book = idx.data.books.find((x) => x.id === sel.b);
  const cites = A.citations(idx, sel).reverse(); // newest first
  const where = sel.v != null ? `${book.name} ${sel.c}:${sel.v}` : sel.c != null ? `${book.name} ${sel.c}` : book.name;
  const distinct = new Set(cites.map((x) => x.sermon.id)).size;
  return html`<h3>Citas en ${where}</h3>
    ${cites.length === 0
      ? html`<${Empty} title=${"Sin citas"} text="Ningún sermón analizado ha citado esta parte todavía." />`
      : html`<p class="hint" style="margin:0 0 .75rem">${plural(cites.length, "cita", "citas")} en ${plural(distinct, "sermón", "sermones")}, de la más reciente a la más antigua.</p>
        <ul class="cites">
          ${cites.slice(0, shown).map(({ sermon, ref, wholeChapter }, i) => {
            const name = wholeChapter ? `${book.name} ${ref.c}` : A.passageLabel(idx, ref.b, ref.c, ref.v1, ref.v2);
            return html`<li class="cita" key=${`${sermon.id}-${i}`}>
              <div class="cita-head">
                <span class="chip-ref">${name}</span>
                ${wholeChapter && html`<span class="chip-cap">capítulo completo</span>`}
                <time datetime=${sermon.date}>${dateLabel(sermon.date)}</time><span>${sermon.series}</span>
              </div>
              <h4>${sermon.title}</h4>
              <p>${ref.sum}</p>
              ${ref.sec && html`<details><summary>Punto del sermón</summary><p>${ref.sec}</p></details>`}
              <a class="open" href=${sermon.page}>Abrir análisis completo →</a>
            </li>`;
          })}
        </ul>
        ${shown < cites.length && html`<button class="more" onClick=${() => setShown(shown + PAGE)}>Mostrar más citas (${cites.length - shown} restantes)</button>`}`}`;
}

function Detail({ idx, route }) {
  const { sel } = route;
  if (!sel) {
    return html`<section class="panel detail" id="detalle" aria-labelledby="detalle-h"><h2 id="detalle-h" style="font-size:1.125rem">Detalle</h2>
      <p class="hint" style="margin:0">Elige un libro del mapa para ver sus capítulos, versículos y los sermones que lo citan.</p></section>`;
  }
  const book = idx.data.books.find((x) => x.id === sel.b);
  const hue = HUE[book.group];
  const total = A.bookCount(idx, book.id);
  const chapters = book.verses.length;
  const countNow = sel.v != null ? A.verseCounts(idx, sel.b, sel.c)[sel.v - 1]
    : sel.c != null ? A.chapterCounts(idx, sel.b)[sel.c - 1] : total;
  const title = sel.v != null ? `${book.name} ${sel.c}:${sel.v}` : sel.c != null ? `${book.name} ${sel.c}` : book.name;
  const base = (patch) => hrefFor(route, { sel: patch });
  return html`<section class=${`panel detail hue-${hue}`} id="detalle" aria-labelledby="detalle-h" key=${selKey(sel)}>
    <nav aria-label="Ubicación"><ol class="crumbs">
      <li><a href=${hrefFor(route, { sel: null })}>Mapa</a></li>
      <li>${sel.c == null ? html`<span aria-current="page">${book.name}</span>` : html`<a href=${base({ b: book.id })}>${book.name}</a>`}</li>
      ${sel.c != null && html`<li>${sel.v == null ? html`<span aria-current="page">Capítulo ${sel.c}</span>` : html`<a href=${base({ b: book.id, c: sel.c })}>Capítulo ${sel.c}</a>`}</li>`}
      ${sel.v != null && html`<li><span aria-current="page">Versículo ${sel.v}</span></li>`}
    </ol></nav>
    <h2 id="detalle-h">${title}</h2>
    <p class="meta">${book.group} · ${plural(chapters, "capítulo", "capítulos")} · ${sermonsLabel(countNow)}${sel.c != null || sel.v != null ? ` en esta selección` : ` en el libro`}</p>
    <h3>Capítulos</h3>
    <${NumGrid} idx=${idx} route=${route} counts=${A.chapterCounts(idx, book.id)} scale=${idx.scales.chapter} book=${book} level="chapter" />
    <${Legend} scale=${idx.scales.chapter} hue=${hue} />
    ${sel.c != null && html`<h3>Versículos de ${book.name} ${sel.c}</h3>
      <${NumGrid} idx=${idx} route=${route} counts=${A.verseCounts(idx, book.id, sel.c)} scale=${idx.scales.verse} book=${book} c=${sel.c} level="verse" />
      <${Legend} scale=${idx.scales.verse} hue=${hue} />`}
    ${sel.c == null && html`<p class="hint">Elige un capítulo para ver sus versículos.</p>`}
    <${Citations} idx=${idx} sel=${sel} route=${route} key=${selKey(sel)} />
  </section>`;
}

function Ranking({ idx, route }) {
  const rows = useMemo(() => A.ranking(idx, 10), [idx]);
  const max = rows[0]?.count || 1;
  return html`<section class="panel" aria-labelledby="rank-h"><h2 id="rank-h">Pasajes más citados</h2>
    ${rows.length === 0
      ? html`<p class="hint" style="margin:0">Aún no hay versículos citados en esta selección.</p>`
      : html`<ol class="rank">${rows.map((r, i) => {
          const book = idx.data.books.find((x) => x.id === r.b);
          return html`<li key=${`${r.b}${r.c}${r.v1}`} class=${`hue-${HUE[book.group]}`}><a href=${hrefFor(route, { sel: { b: r.b, c: r.c, v: r.v1 } })}
            aria-label=${`${r.label}: ${sermonsLabel(r.count)}`}>
            <span class="rk">${i + 1}</span><span class="lbl">${r.label}</span><span class="cnt">${plural(r.count, "sermón", "sermones")}</span>
            <span class="bar" aria-hidden="true"><i style=${`width:${(100 * r.count) / max}%`}></i></span></a></li>`;
        })}</ol>`}
  </section>`;
}

function Stats({ idx }) {
  const s = A.stats(idx);
  const tile = (value, label, of) => html`<li class="stat"><span class="num">${n(value)}${of != null && html` <span class="of">/ ${n(of)}</span>`}</span><span class="lbl">${label}</span></li>`;
  return html`<ul class="stats" aria-label="Resumen">
    ${tile(s.sermons, "sermones analizados")}${tile(s.books.cited, "libros citados", s.books.total)}
    ${tile(s.chapters.cited, "capítulos citados", s.chapters.total)}${tile(s.verses.cited, "versículos citados", s.verses.total)}
  </ul>`;
}

function Footer({ data }) {
  const dates = data.sermons.map((s) => s.date).sort();
  const gen = data.generated ? dateLabel(data.generated.slice(0, 10)) : null;
  return html`<footer class="foot">
    <p>${n(data.sermons.length)} análisis de sermones${dates.length ? ` (${dateLabel(dates[0])} – ${dateLabel(dates[dates.length - 1])})` : ""}.
      Cada celda cuenta sermones distintos, no citas; un capítulo completo cuenta en el capítulo y el libro, nunca en un versículo.</p>
    ${gen && html`<p>Datos generados el ${gen}.</p>`}
    ${data.unresolved.length > 0 && html`<p>${plural(data.unresolved.length, "referencia no pudo", "referencias no pudieron")} interpretarse y no está en el mapa.</p>`}
  </footer>`;
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("mapa-tema", t); } catch {}
}
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [hash, setHash] = useState(location.hash);
  const [dark, setDark] = useState(isDark);

  useEffect(() => {
    fetch("data/mapa.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData, (e) => setError(e.message));
    const onHash = () => setHash(location.hash);
    addEventListener("hashchange", onHash);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onMq = () => setDark(isDark());
    mq.addEventListener("change", onMq);
    return () => { removeEventListener("hashchange", onHash); mq.removeEventListener("change", onMq); };
  }, []);

  const route = useMemo(() => (data ? parseHash(data) : null), [data, hash]);
  const idx = useMemo(() => {
    if (!data) return null;
    const i = A.buildIndex(data, route.serie);
    i.scales = { book: A.heatScale(i, "book"), chapter: A.heatScale(i, "chapter"), verse: A.heatScale(i, "verse") };
    return i;
  }, [data, route?.serie]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    // On a phone the detail sits below the map; bring it into view after a pick.
    if (route?.sel && matchMedia("(max-width: 980px)").matches) {
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById("detalle")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }, [selKey(route?.sel)]);

  if (error) {
    return html`<main class="wrap"><${Empty} title="No se pudieron cargar los datos" text=${`No se encontró data/mapa.json (${error}). Genera el sitio con build_site.py y sírvelo por HTTP; los módulos no cargan desde file://.`} /></main>`;
  }
  if (!data) return html`<p class="boot">Cargando el mapa…</p>`;

  const go = (patch) => { location.hash = hrefFor(route, patch); };
  const sc = (s) => (s === A.ALL_SERIES ? data.sermons.length : data.sermons.filter((x) => x.series === s).length);
  const level = route.vista === "vitral" ? "book" : "chapter";
  const empty = idx.sermons.length === 0;

  return html`<div class="wrap">
    <a class="skip" href="#mapa">Saltar al mapa</a>
    <header class="top">
      <div class="top-row">
        <p class="eyebrow">Mapa de referencias bíblicas</p>
        <button class="theme-btn" onClick=${() => { const next = dark ? "light" : "dark"; setTheme(next); setDark(next === "dark"); }}>${dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}</button>
      </div>
      <h1>¿De dónde predica tu iglesia?</h1>
      <p class="sub">Mapa de calor de las Escrituras a partir de los sermones analizados. Toca un libro para bajar a capítulos, versículos y sermones.</p>
      <span class="pill">${data.church}<b>${plural(idx.sermons.length, "sermón", "sermones")}</b></span>
      <div class="leaded" aria-hidden="true">${Object.values(HUE).map((hu) => html`<i class=${`hue-${hu}`}></i>`)}</div>
    </header>

    <${Stats} idx=${idx} />

    <div class="controls">
      <div role="group" aria-label="Vista"><div class="seg">
        <button aria-pressed=${route.vista === "vitral"} onClick=${() => go({ vista: "vitral" })}>Vitral</button>
        <button aria-pressed=${route.vista === "filas"} onClick=${() => go({ vista: "filas" })}>Filas por capítulo</button>
      </div></div>
      <div role="group" aria-label="Serie"><span class="ctl-label">Serie</span><div class="seg">
        ${SERIES.map((s) => html`<button key=${s} aria-pressed=${route.serie === s} onClick=${() => go({ serie: s })}>${s}<small>${sc(s)}</small></button>`)}
      </div></div>
      ${route.vista === "filas" && html`<label class="toggle"><input type="checkbox" checked=${route.soloCitados} onChange=${(e) => go({ soloCitados: e.currentTarget.checked })} />Mostrar solo libros citados</label>`}
    </div>

    <div class="layout">
      <main class="main" id="mapa" tabindex="-1">
        ${empty
          ? html`<${Empty} title=${`Todavía no hay sermones de la serie ${route.serie}`} text="Cuando se analice uno, aparecerá aquí. Mientras tanto, elige otra serie." />`
          : html`<${Legend} scale=${idx.scales[level]} hue="sapphire" note=${level === "book"
              ? "Sermones que citan el libro. Cada color es un grupo de libros; más intenso, más sermones."
              : "Sermones que citan el capítulo. Cada color es un grupo de libros; más intenso, más sermones."} />
            ${route.vista === "vitral" ? html`<${Vitral} idx=${idx} route=${route} />` : html`<${Filas} idx=${idx} route=${route} />`}`}
      </main>
      <aside class="aside" aria-label="Detalle y ranking">
        <${Detail} idx=${idx} route=${route} />
        <${Ranking} idx=${idx} route=${route} />
      </aside>
    </div>
    <${Footer} data=${data} />
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
