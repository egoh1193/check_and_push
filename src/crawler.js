// src/crawler.js
export class Crawler {
  constructor(data1) {
    this.data1 = data1;
    this.baseOrigin = `https://${data1.URLS.K.BASE}`;
    this.basePath = data1.URLS.K.TOKYO;
    this.searchWords = Crawler.toWordList(data1.search?.area);
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

    // 1投稿ブロック: <font size="4"> ... 次の <hr もしくは文末まで
    const blockRegex = new RegExp(String.raw`<font size="4">\s*([\s\S]*?)(?=<hr\b|$)`, "g");

    // 各項目のパターン
    const idRe     = new RegExp(String.raw`^\s*(\d+)\b`, "m");
    const nameRe   = new RegExp(String.raw`\[<a href="/mail/\?type=comment&id=\d+">([^<]+)</a>\]`);
    const bodyRe   = new RegExp(String.raw`</a>\](?:<font[^>]*>new!<\/font>)?<br>\s*([\s\S]*?)(?=\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})`);
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

      const bodyText = (bodyMatch?.[1] || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/\u00A0/g, " ")
        .trim();

      posts.push({
        id:    idMatch?.[1]?.trim()    || "",
        name:  nameMatch?.[1]?.trim()  || "",
        body:  bodyText,
        date:  dateMatch?.[1]          || "",
        age:   ageMatch?.[1]?.trim()   || "",
        sex:   sexMatch?.[1]?.trim()   || "",
        looks: looksMatch?.[1]?.trim() || "",
        msg:   msgMatch?.[1]?.trim()   || "",
        will:  willMatch?.[1]?.trim()  || "",
      });
    }

    return posts;
  }

  /* ---------- pipeline ---------- */

  // 一覧(p=1..N)を並列fetch → スレッド抽出 → 重複除去 → タイトルフィルタ → URL2配列
  // crawler.js 内

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

  // 重複除去
  const map = new Map();
  for (const t of threadsRaw) if (!map.has(t.id)) map.set(t.id, t);
  const threads = Array.from(map.values());

  // タイトルに searchWords のどれかを含む
  const inc = this.searchWords.map(w => w.toLowerCase());
  const filtered = inc.length === 0
    ? []
    : threads.filter(t => inc.some(w => t.title.toLowerCase().includes(w)));

  return filtered.map(t => this.buildThreadUrl(t.id));
}

async crawlThreads(url2List) {
  const settled = await Promise.allSettled(
    url2List.map((u, i) => Crawler.fetchHtml(u, `Thread ${i + 1}`))
  );

  const results = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      const posts = Crawler.extractPosts(r.value);

      // ★ここで ignore_words_a (age) と ignore_words_s (sex) を適用
      const filteredPosts = posts.filter(p => {
        const ageNg = this.data1.search?.["i:a"] || [];
        const sexNg = this.data1.search?.["i:s"] || [];
        const ageList = Crawler.toWordList(ageNg).map(x => x.toLowerCase());
        const sexList = Crawler.toWordList(sexNg).map(x => x.toLowerCase());

        const ageHit = ageList.some(w => p.age.toLowerCase().includes(w));
        const sexHit = sexList.some(w => p.sex.toLowerCase().includes(w));

        return !ageHit && !sexHit;
      });

      results.push({ threadUrl: url2List[i], posts: filteredPosts });
    } else {
      console.warn(`Thread fetch failed (${url2List[i]}):`, r.reason?.message || r.reason);
    }
  });

  return results;
}
}