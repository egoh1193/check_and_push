// app.js
// 実行: node --env-file=.env app.js
// .env 例:
//   API_URL=https://example.com/api
//   PAGES=1,2,3
//   MODE=BASIC   ← または WIDE
//   MAX_POST_AGE_HOURS=4
//   GIST_TOKEN=ghp_xxx           ← 設定時のみGist投稿
//   GIST_DESCRIPTION=任意の説明
//   GIST_FILENAME=board_results.json
//   GIST_PUBLIC=false
//   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
//   DISCORD_WEBHOOK_USERNAME=bot-name
//   DISCORD_WEBHOOK_AVATAR=https://...
//   DISCORD_MESSAGE_PREFIX=Gist created:
//   SILENT_MODE=true                ← ログ完全抑制（未指定時は NODE_ENV=production で有効）

import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import process from "node:process";

import { Crawler } from "./src/crawler.js";
import {
  DEFAULT_GIST_FILENAME,
  DEFAULT_GIST_DESCRIPTION,
  DEFAULT_GIST_PUBLIC,
  parseBoolean,
  postGist,
} from "./src/gist.js";
import { postDiscordWebhook } from "./src/discord.js";

function loadEnvFile(filePath = ".env") {
  try {
    const abs = resolvePath(process.cwd(), filePath);
    if (!existsSync(abs)) return;
    const raw = readFileSync(abs, "utf8");
    raw.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) return;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!key) return;
      if (process.env[key] !== undefined) return;
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    });
  } catch (err) {
    console.warn(".env 読み込み失敗:", err?.message || err);
  }
}

loadEnvFile(process.env.ENV_FILE || ".env");

// -------- アプリの可変設定（ここを書き換えて使う） --------
const DEFAULT_MODE = "BASIC";              // MODE が未指定時のフォールバック
const DEFAULT_PAGES = [1, 2, 3];           // PAGES が未指定時に巡回するページ番号
const DEFAULT_MAX_POST_AGE_HOURS = 4;      // 投稿許容経過時間（時間）
const DEFAULT_DISCORD_MESSAGE_PREFIX = "Gist created:";

const envSilent = process.env.SILENT_MODE;
const SILENT_MODE = envSilent !== undefined
  ? parseBoolean(envSilent)
  : (process.env.NODE_ENV?.toLowerCase() === "production");

if (SILENT_MODE) {
  const noop = () => {};
  console.log = noop;
  console.error = noop;
  console.warn = noop;
  console.info = noop;
  console.debug = noop;
}
const API_URL = process.env.API_URL;
if (!API_URL) {
  console.error("環境変数 API_URL が未設定です");
  process.exit(1);
}

// ページ設定
const parsePages = input => input
  .split(",")
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n) && n > 0);

const envPagesRaw = process.env.PAGES?.trim();
const PAGES = (() => {
  if (envPagesRaw && envPagesRaw.length) {
    const parsed = parsePages(envPagesRaw);
    if (parsed.length > 0) return parsed;
  }
  return [...DEFAULT_PAGES];
})();

// モード設定（デフォルトはBASIC）
const MODE = (process.env.MODE || DEFAULT_MODE).toUpperCase();

(async () => {
  try {
    // 1) APIから初期情報を取得してクローラ生成
    const crawler = await Crawler.fromApi(API_URL);

    // search_words_a をモードに応じて制御
    let searchWords = crawler.searchWords ?? [];
    if (MODE === "BASIC") {
      searchWords = searchWords.slice(0, 2);
    }
    crawler.searchWords = searchWords; // 上書き

    // 除外語
    const ignore_words_a = Crawler.toWordList(crawler.data1.search?.["i:a"]);
    const ignore_words_s = Crawler.toWordList(crawler.data1.search?.["i:s"]);
    const ignore_words_n = Crawler.toWordList(crawler.data1.search?.["i:n"]);

    // 投稿の最大許容経過時間（時間）
    const maxPostAgeHours = (() => {
      const raw = Number(process.env.MAX_POST_AGE_HOURS);
      if (!Number.isFinite(raw)) return DEFAULT_MAX_POST_AGE_HOURS;
      if (raw <= 0) return 0; // 0 以下ならフィルタ無効
      return raw;
    })();

    // API側で現在時刻が提供されている場合はそれを優先
    const referenceNow = Crawler.parsePostDate(crawler.data1?.now) ?? new Date();

    console.log("MODE:", MODE);
    console.log("search_words_a:", searchWords);
    console.log("ignore_words_a (age NG):", ignore_words_a);
    console.log("ignore_words_s (sex NG):", ignore_words_s);
    console.log("ignore_words_n (name NG):", ignore_words_n);
    console.log("max_post_age_hours:", maxPostAgeHours);
    console.log(
      "reference_now:",
      referenceNow.toISOString(),
      "(local:", referenceNow.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }), ")"
    );

    // 2) 一覧ページからスレッド収集 (URLとTitle両方持つ)
    const threadList = await crawler.collectUrl2List(PAGES);
    console.log("スレッド抽出件数:", threadList.length);

    if (threadList.length === 0) {
      console.log("スレッドが0件のため終了します。");
      process.exit(0);
    }

    // 3) 各スレッドURLを巡回して投稿抽出
    const threadResults = await crawler.crawlThreads(threadList, {
      maxPostAgeHours,
      now: referenceNow,
    });

    // 4) 集計
    const allPosts = threadResults.flatMap(r => r.posts);
    console.log("投稿総数(フィルタ後):", allPosts.length);

    // サンプル出力
    console.log(JSON.stringify(threadResults.slice(0, 2), null, 2));

    const hasTopics = threadResults.length > 0;
    if (hasTopics) {
      const gistToken = process.env.GIST_TOKEN?.trim();
      if (gistToken) {
        const gistFilename = process.env.GIST_FILENAME?.trim() || DEFAULT_GIST_FILENAME;
        const gistDescription = process.env.GIST_DESCRIPTION?.trim() || DEFAULT_GIST_DESCRIPTION;
        const gistPublic = process.env.GIST_PUBLIC !== undefined
          ? parseBoolean(process.env.GIST_PUBLIC)
          : DEFAULT_GIST_PUBLIC;
        const gistContent = JSON.stringify({
          generatedAt: referenceNow.toISOString(),
          mode: MODE,
          pages: PAGES,
          maxPostAgeHours,
          results: threadResults,
        }, null, 2);

        try {
          const gistUrl = await postGist({
            token: gistToken,
            description: gistDescription,
            filename: gistFilename,
            content: gistContent,
            isPublic: gistPublic,
          });
          console.log("Gist created:", gistUrl);

          const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
          if (discordWebhookUrl) {
            const prefix = process.env.DISCORD_MESSAGE_PREFIX?.trim() || DEFAULT_DISCORD_MESSAGE_PREFIX;
            const ageLabel = maxPostAgeHours > 0 ? `${maxPostAgeHours}h` : "no-limit";
            const discordContent = `${prefix} [MODE=${MODE}] [AGE<=${ageLabel}] ${gistUrl}`.trim();
            const discordUsername = process.env.DISCORD_WEBHOOK_USERNAME?.trim();
            const discordAvatar = process.env.DISCORD_WEBHOOK_AVATAR?.trim();
            try {
              await postDiscordWebhook({
                webhookUrl: discordWebhookUrl,
                content: discordContent,
                username: discordUsername,
                avatarUrl: discordAvatar,
              });
              console.log("Discord通知送信済み");
            } catch (discordErr) {
              console.error("Discord通知失敗:", discordErr?.message || discordErr);
            }
          }
        } catch (gistErr) {
          console.error("Gist投稿失敗:", gistErr?.message || gistErr);
        }
      }
    }
  } catch (err) {
    console.error("エラー:", err?.message || err);
    process.exit(1);
  }
})();
