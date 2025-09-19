// app.js
// 実行: node --env-file=.env app.js
// .env 例:
//   API_URL=https://example.com/api
//   PAGES=1,2,3
//   MODE=BASIC   ← または WIDE

import { Crawler } from "./src/crawler.js";

const API_URL = process.env.API_URL;
if (!API_URL) {
  console.error("環境変数 API_URL が未設定です");
  process.exit(1);
}

// ページ設定
const PAGES = (process.env.PAGES || "1,2,3")
  .split(",")
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n) && n > 0);

// モード設定
const MODE = (process.env.MODE || "BASIC").toUpperCase(); // デフォルトBASIC

(async () => {
  try {
    // 1) APIから初期情報を取得してクローラ生成
    const crawler = await Crawler.fromApi(API_URL);

    // search_words_a をモードに応じて制御
    let searchWords = crawler.searchWords ?? [];
    if (MODE === "BASIC") {
      searchWords = searchWords.slice(0, 2);
    }
    // クローラの検索語を上書き
    crawler.searchWords = searchWords;

    // 除外語
    const ignore_words_a = Crawler.toWordList(crawler.data1.search?.["i:a"]);
    const ignore_words_s = Crawler.toWordList(crawler.data1.search?.["i:s"]);

    console.log("MODE:", MODE);
    console.log("search_words_a:", searchWords);
    console.log("ignore_words_a (age NG):", ignore_words_a);
    console.log("ignore_words_s (sex NG):", ignore_words_s);

    // 2) 一覧ページからスレッド収集
    const threadList = await crawler.collectUrl2List(PAGES);
    console.log("スレッド抽出件数:", threadList.length);
    console.log("スレッド一覧:", threadList);

    if (threadList.length === 0) {
      console.log("スレッドが0件のため終了します。");
      process.exit(0);
    }

    // 3) 各スレッドURLを巡回して投稿抽出
    const threadResults = await crawler.crawlThreads(threadList);

    // 4) 集計
    const allPosts = threadResults.flatMap(r => r.posts);
    console.log("投稿総数(フィルタ後):", allPosts.length);

    // サンプル出力
    console.log(JSON.stringify(threadResults.slice(0, 2), null, 2));

  } catch (err) {
    console.error("エラー:", err?.message || err);
    process.exit(1);
  }
})();