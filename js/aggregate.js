// Pure counting rules for the Mapa Bíblico (plan 2026-10-18-mapa-biblico.md).
// Heat counts distinct sermons, never citations; a whole-chapter ref (v1 === null)
// lights its chapter and book but no verse.

export const ALL_SERIES = "Todos";

export function buildIndex(data, series = ALL_SERIES) {
  const all = !series || series === ALL_SERIES;
  const sermons = all ? data.sermons : data.sermons.filter((s) => s.series === series);
  const bookOrder = new Map(data.books.map((b, i) => [b.id, i]));
  const bookSets = new Map(); // b -> Set<sermonId>
  const chapterSets = new Map(); // "b/c" -> Set<sermonId>
  const verseSets = new Map(); // "b/c" -> Map<v, Set<sermonId>>
  const add = (map, key, id) => {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(id);
  };
  for (const s of sermons) {
    for (const r of s.refs) {
      add(bookSets, r.b, s.id);
      add(chapterSets, `${r.b}/${r.c}`, s.id);
      if (r.v1 === null) continue;
      let byVerse = verseSets.get(`${r.b}/${r.c}`);
      if (!byVerse) verseSets.set(`${r.b}/${r.c}`, (byVerse = new Map()));
      for (let v = r.v1; v <= r.v2; v++) add(byVerse, v, s.id);
    }
  }
  const index = { data, sermons, bookOrder, bookSets, chapterSets, verseSets };
  index.maxima = {
    book: maxSize(bookSets.values()),
    chapter: maxSize(chapterSets.values()),
    verse: maxSize([...verseSets.values()].flatMap((m) => [...m.values()])),
  };
  return index;
}

function maxSize(sets) {
  let m = 0;
  for (const s of sets) if (s.size > m) m = s.size;
  return m;
}

export function bookCount(index, b) {
  return index.bookSets.get(b)?.size ?? 0;
}

// Array indexed by chapter - 1.
export function chapterCounts(index, b) {
  const book = index.data.books.find((x) => x.id === b);
  return book.verses.map((_, i) => index.chapterSets.get(`${b}/${i + 1}`)?.size ?? 0);
}

// Array indexed by verse - 1, length from the book's verse table.
export function verseCounts(index, b, c) {
  const book = index.data.books.find((x) => x.id === b);
  const byVerse = index.verseSets.get(`${b}/${c}`);
  return Array.from({ length: book.verses[c - 1] }, (_, i) => byVerse?.get(i + 1)?.size ?? 0);
}

// sel: { b, c?, v? }. Returns [{ sermon, ref, wholeChapter }] in sermon date
// order; a whole-chapter ref is included for a chapter selection but not a verse one.
export function citations(index, sel) {
  const out = [];
  for (const sermon of index.sermons) {
    for (const ref of sermon.refs) {
      if (ref.b !== sel.b) continue;
      if (sel.c != null && ref.c !== sel.c) continue;
      const wholeChapter = ref.v1 === null;
      if (sel.v != null && (wholeChapter || sel.v < ref.v1 || sel.v > ref.v2)) continue;
      out.push({ sermon, ref, wholeChapter });
    }
  }
  return out;
}

export function passageLabel(index, b, c, v1, v2) {
  const name = index.data.books.find((x) => x.id === b).name;
  return `${name} ${c}:${v1}${v2 > v1 ? `-${v2}` : ""}`;
}

// Top passages by sermon count. Consecutive verses in one chapter with the
// identical sermon set collapse into one passage, so 8:37 and 8:38-39 don't
// compete as unrelated entries. Ties fall back to canonical Bible order.
export function ranking(index, limit = 10) {
  const passages = [];
  for (const [key, byVerse] of index.verseSets) {
    const slash = key.lastIndexOf("/");
    const b = key.slice(0, slash);
    const c = Number(key.slice(slash + 1));
    let run = null;
    const flush = () => {
      if (run) passages.push(run);
      run = null;
    };
    for (const v of [...byVerse.keys()].sort((x, y) => x - y)) {
      const ids = [...byVerse.get(v)].sort();
      const sig = ids.join("|");
      if (run && run.sig === sig && v === run.v2 + 1) run.v2 = v;
      else {
        flush();
        run = { b, c, v1: v, v2: v, count: ids.length, sermonIds: ids, sig };
      }
    }
    flush();
  }
  const order = (p) => index.bookOrder.get(p.b);
  passages.sort((p, q) => q.count - p.count || order(p) - order(q) || p.c - q.c || p.v1 - q.v1);
  return passages.slice(0, limit).map(({ sig, ...p }) => ({
    ...p,
    label: passageLabel(index, p.b, p.c, p.v1, p.v2),
  }));
}

export function stats(index) {
  const { books } = index.data;
  return {
    sermons: index.sermons.length,
    books: { cited: index.bookSets.size, total: books.length },
    chapters: {
      cited: index.chapterSets.size,
      total: books.reduce((n, b) => n + b.verses.length, 0),
    },
    verses: {
      cited: [...index.verseSets.values()].reduce((n, m) => n + m.size, 0),
      total: books.reduce((n, b) => n + b.verses.reduce((x, y) => x + y, 0), 0),
    },
  };
}

// Heat bins for one level ("book" | "chapter" | "verse"), sized from that
// level's max so the scale never saturates. bins[i] = { min, max } for bin
// index i + 1; bin(count) maps a count to 0 (unlit) or 1..bins.length.
export function heatScale(index, level, maxBins = 5) {
  const max = index.maxima[level];
  const n = Math.min(maxBins, max);
  const bins = [];
  let min = 1;
  for (let k = 1; k <= n; k++) {
    const hi = Math.ceil((max * k) / n);
    if (hi >= min) {
      bins.push({ min, max: hi });
      min = hi + 1;
    }
  }
  const bin = (count) => {
    if (count <= 0) return 0;
    const i = bins.findIndex((b) => count <= b.max);
    return i === -1 ? bins.length : i + 1;
  };
  return { max, bins, bin };
}
