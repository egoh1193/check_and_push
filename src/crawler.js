// src/crawler.js
export class Crawler {
  constructor(data1) {
    this.data1 = data1;
    this.baseOrigin = `https://${data1.URLS.K.BASE}`;
    this.basePath = data1.URLS.K.TOKYO;
    this.searchWords = Crawler.toWordList(data1.search?.area); // app.js で上書き可
  }

  /* ---------- factory ---------- */
  static async fromApi(apiUrl) {
    const data1 = await Crawler.fetchJson(apiUrl, "1st API");
    return new Crawler(data1);
  }

  /* ---------- fetch utils ---------- */
  static async fetchJson(targetUrl, label = "API") {
    const res = await fetch(targetUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${label}`);
    return await res.json();
  }

  static async fetchHtml(targetUrl, label = "HTML") {
    const res = await fetch(targetUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${label}`);
    return await res.text();
  }

  /* ---------- helpers ---------- */
  static toWordList(x) {
    if (Array.isArray(x)) return x.filter(Boolean).map(String);
    if (typeof x === "string") return x.split(",").map(s => s.trim()).filter(Boolean);
    return [];
  }

  static get DEFAULT_MAX_POST_AGE_HOURS() {
    return 4;
  }

  static parsePostDate(dateStr) {
    if (!dateStr) return null;
    const trimmed = String(dateStr).trim();
    if (!trimmed) return null;

    // 末尾にタイムゾーン指定がある場合はそのまま Date に渡す
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
      const tzParsed = new Date(trimmed);
      if (!Number.isNaN(tzParsed.getTime())) return tzParsed;
    }

    const normalized = trimmed.replace("T", " ");
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (match) {
      const [, y, m, d, hh, mm, ss] = match;
      // 入力にタイムゾーンが無い場合は板の表記に合わせて JST(+09:00) とみなす
      const isoLike = `${y}-${m}-${d}T${hh}:${mm}:${ss ? ss : "00"}`;
      const jstDate = new Date(`${isoLike}+09:00`);
      if (!Number.isNaN(jstDate.getTime())) return jstDate;

      const fallbackLocal = new Date(
        Number(y),
        Number(m) - 1,
        Number(d),
        Number(hh),
        Number(mm),
        ss ? Number(ss) : 0
      );
      if (!Number.isNaN(fallbackLocal.getTime())) return fallbackLocal;
    }

    const fallback = new Date(trimmed);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  static resolveNowMs(input, fallbackMs = Date.now()) {
    if (input instanceof Date && !Number.isNaN(input.getTime())) {
      return input.getTime();
    }
    if (typeof input === "number" && Number.isFinite(input)) {
      return input;
    }
    if (typeof input === "string") {
      const parsed = Crawler.parsePostDate(input);
      if (parsed) return parsed.getTime();
    }
    return fallbackMs;
  }

  static appendPageParam(pathWithQuery, p) {
    const joint = pathWithQuery.includes("?") ? "&" : "?";
    return `${pathWithQuery}${joint}p=${p}`;
  }

  buildListUrls(pages = [1, 2, 3]) {
    return pages.map(p => `${this.baseOrigin}${Crawler.appendPageParam(this.basePath, p)}`);
  }

  buildThreadUrl(id) {
    return `${this.baseOrigin}/public/thread/index?id=${encodeURIComponent(id)}`;
  }

  /* ---------- extractors (regex via RegExp constructor) ---------- */

  // 一覧HTMLからスレッド(id,title)を抽出
  static extractThreads(html) {
    const out = [];
    const re = new RegExp(
      String.raw`<a\s+href="https:\/\/[^"]*\/public\/thread\/index\?id=([^"]+)".*?>\s*<span class="thread-title">([^<]+)<\/span>`,
      "g"
    );
    let m;
    while ((m = re.exec(html)) !== null) {
      out.push({ id: m[1], title: m[2] });
    }
    return out;
  }

  // スレッド詳細HTMLから投稿ブロック群を抽出
  static extractPosts(html) {
    const posts = [];

    const blockRegex = new RegExp(String.raw`<font size="4">\s*([\s\S]*?)(?=<hr\b|$)`, "g");
    const idRe     = new RegExp(String.raw`^\s*(\d+)\b`, "m");
    const nameRe   = new RegExp(String.raw`\[(?:<a[^>]*href="([^"]+)"[^>]*>([^<]+)</a>|([^<\]]+))\]`);
    const bodyRe   = new RegExp(String.raw`\](?:<font[^>]*>new!<\/font>)?<br\s*\/?>\s*([\s\S]*?)(?=\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})`);
    const dateRe   = new RegExp(String.raw`(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})`);
    const ageRe    = new RegExp(String.raw`年齢\s*：\s*([^<\r\n]+)`);
    const sexRe    = new RegExp(String.raw`性別\s*：\s*([^<\r\n]+)`);
    const looksRe  = new RegExp(String.raw`ﾙｯｸｽ\s*：\s*([^<\r\n]+)`);
    const msgRe    = new RegExp(String.raw`補足\s*：\s*([^<\r\n]+)`);
    const willRe   = new RegExp(String.raw`<font[^>]*color=["']?pink["']?[^>]*>\s*([^<]+)\s*<\/font>`, "i");

    let blockMatch;
    while ((blockMatch = blockRegex.exec(html)) !== null) {
      const block = blockMatch[1];

      const idMatch    = block.match(idRe);
      const nameMatch  = block.match(nameRe);
      const bodyMatch  = block.match(bodyRe);
      const dateMatch  = block.match(dateRe);
      const ageMatch   = block.match(ageRe);
      const sexMatch   = block.match(sexRe);
      const looksMatch = block.match(looksRe);
      const msgMatch   = block.match(msgRe);
      const willMatch  = block.match(willRe);

      const bodyRaw = bodyMatch?.[1] || "";
      const images = Array.from(
        bodyRaw.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi),
        m => m[1].trim()
      );
      const bodyText = bodyRaw
        .replace(/<img\b[^>]*>/gi, "")
        .replace(/<\/?a[^>]*>/gi, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/\r\n?/g, "\n")
        .replace(/\u00A0/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      const mailLink = nameMatch?.[1] ? nameMatch[1].trim() : "";
      const displayName = (nameMatch?.[2] || nameMatch?.[3] || "").trim();

      posts.push({
        id:    idMatch?.[1]?.trim()    || "",
        name:  displayName,
        maillink: mailLink,
        body:  bodyText,
        date:  dateMatch?.[1]          || "",
        age:   ageMatch?.[1]?.trim()   || "",
        sex:   sexMatch?.[1]?.trim()   || "",
        looks: looksMatch?.[1]?.trim() || "",
        msg:   msgMatch?.[1]?.trim()   || "",
        will:  willMatch?.[1]?.trim()  || "",
        images,
      });
    }

    return posts;
  }

  /* ---------- pipeline ---------- */

  // 一覧(p=1..N)を並列fetch → スレッド抽出 → 重複除去 → タイトルフィルタ → {id,title,url}配列
  async collectUrl2List(pages = [1, 2, 3]) {
    const listUrls = this.buildListUrls(pages);
    const settled = await Promise.allSettled(
      listUrls.map((u, i) => Crawler.fetchHtml(u, `List p=${pages[i]}`))
    );

    const threadsRaw = settled.flatMap((r, idx) => {
      if (r.status !== "fulfilled") {
        console.warn(`p=${pages[idx]} 取得失敗:`, r.reason?.message || r.reason);
        return [];
      }
      return Crawler.extractThreads(r.value);
    });

    // id基準で重複除去
    const map = new Map();
    for (const t of threadsRaw) if (!map.has(t.id)) map.set(t.id, t);
    const threads = Array.from(map.values());

    // タイトルに searchWords のいずれかを含む（case-insensitive）
    const inc = this.searchWords.map(w => w.toLowerCase());
    const filtered = inc.length === 0
      ? []
      : threads.filter(t => inc.some(w => t.title.toLowerCase().includes(w)));

    // ★ ここで {id, title, url} で返す
    return filtered.map(t => ({
      id: t.id,
      title: t.title,
      url: this.buildThreadUrl(t.id),
    }));
  }

  // URL2 を並列fetch → 投稿抽出（ignore_words_* と経過時間フィルタを適用）→ threadTitle も含めて返す
  async crawlThreads(threadList, options = {}) {
    const rawMaxAge = Number(options.maxPostAgeHours);
    const maxAgeHours = Number.isFinite(rawMaxAge) ? rawMaxAge : Crawler.DEFAULT_MAX_POST_AGE_HOURS;
    const disableAgeFilter = maxAgeHours <= 0;
    const maxAgeMs = disableAgeFilter ? Number.POSITIVE_INFINITY : maxAgeHours * 60 * 60 * 1000;
    const nowMs = Crawler.resolveNowMs(options.now ?? this.data1?.now);

    const settled = await Promise.allSettled(
      threadList.map((t, i) => Crawler.fetchHtml(t.url, `Thread ${i + 1}`))
    );

    // 除外語（age/sex/name）
    const ageNg  = Crawler.toWordList(this.data1.search?.["i:a"]).map(x => x.toLowerCase());
    const sexNg  = Crawler.toWordList(this.data1.search?.["i:s"]).map(x => x.toLowerCase());
    const nameNg = Crawler.toWordList(this.data1.search?.["i:n"]).map(x => x.toLowerCase());

    const results = [];
    settled.forEach((r, i) => {
      const meta = threadList[i]; // { id, title, url }
      if (r.status === "fulfilled") {
        const posts = Crawler.extractPosts(r.value);

        // age / sex / name の除外語を適用（部分一致・case-insensitive）
        const filteredPosts = posts.filter(p => {
          const ageHit = ageNg.length ? ageNg.some(w => (p.age || "").toLowerCase().includes(w)) : false;
          const sexHit = sexNg.length ? sexNg.some(w => (p.sex || "").toLowerCase().includes(w)) : false;
          const nameHit = nameNg.length ? nameNg.some(w => (p.name || "").toLowerCase().includes(w)) : false;
          const dateObj = Crawler.parsePostDate(p.date);
          const tooOld = disableAgeFilter
            ? false
            : dateObj
              ? nowMs - dateObj.getTime() > maxAgeMs
              : false;
          return !ageHit && !sexHit && !nameHit && !tooOld;
        });

        results.push({
          threadUrl: meta.url,
          threadTitle: meta.title,   // ★ ここで必ずタイトルを出力
          posts: filteredPosts,
        });
      } else {
        console.warn(`Thread fetch failed (${meta.url}):`, r.reason?.message || r.reason);
      }
    });

    return results;
  }
}
