// netlify/functions/rakuten.js

// しょぼいメモリキャッシュ（同一インスタンス内のみ有効）
const CACHE_TTL_MS = 30_000; // 30秒
const cache = new Map(); // key -> { expiresAt, bodyText }

export default async (req, context) => {
  // OPTIONS（必要なら）
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    const url = new URL(req.url);

    // keyword（元コード踏襲：無ければベッド）
    const keyword = (url.searchParams.get("keyword") ?? "ベッド").trim();
    const hits = (url.searchParams.get("hits") ?? "1").trim();

    // ENV（重要：trim）
    const rawAppId = process.env.RAKUTEN_APP_ID;
    const rawAccessKey = process.env.RAKUTEN_ACCESS_KEY;

    const appId = (rawAppId ?? "").trim();
    const accessKey = (rawAccessKey ?? "").trim();

    console.log("ENV OK:", {
      hasAppId: !!appId,
      appIdLen: appId.length,
      appIdHasWhitespace: rawAppId ? rawAppId !== rawAppId.trim() : false,
      hasAccessKey: !!accessKey,
      accessKeyLen: accessKey.length,
      accessKeyHasWhitespace: rawAccessKey ? rawAccessKey !== rawAccessKey.trim() : false,
    });

    if (!appId || !accessKey) {
      return json(
        { error: "Missing env vars: RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY" },
        500
      );
    }

    // ---- 簡易キャッシュ（429対策：同じ条件の連打を減らす） ----
    const cacheKey = JSON.stringify({ keyword, hits });
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return new Response(cached.bodyText, {
        status: 200,
        headers: {
          ...corsHeaders(),
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=10",
          "x-cache": "HIT",
        },
      });
    }

    // 楽天API（openapi）
    const api = new URL(
      "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601"
    );
    api.searchParams.set("format", "json");
    api.searchParams.set("applicationId", appId);
    api.searchParams.set("accessKey", accessKey);
    api.searchParams.set("keyword", keyword);
    api.searchParams.set("hits", hits);

    // 秘密値を伏せたURLログ
    console.log(
      "Rakuten URL:",
      api.toString().replaceAll(appId, ",[object Object],*")
    );

    // ---- 429リトライ（指数バックオフ + Retry-After尊重） ----
    const maxAttempts = 3; // 1回目 + リトライ2回
    let lastText = "";
    let lastStatus = 0;
    let lastRetryAfter = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const r = await fetch(api.toString(), {
        headers: {
          // 元コード踏襲（参照元チェック対策）
          "Referer": "https://cheerful-beijinho-a24d70.netlify.app/",
          "Origin": "https://cheerful-beijinho-a24d70.netlify.app",
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json",
        },
      });

      const text = await r.text();
      lastText = text;
      lastStatus = r.status;

      const retryAfter = r.headers.get("retry-after");
      lastRetryAfter = retryAfter ?? null;

      console.log(
        "Rakuten attempt:",
        attempt,
        "status:",
        r.status,
        "retry-after:",
        retryAfter,
        "body(200char):",
        text.slice(0, 200)
      );

      if (r.ok) {
        // 成功：キャッシュ保存して返す
        cache.set(cacheKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          bodyText: text,
        });

        return new Response(text, {
          status: 200,
          headers: {
            ...corsHeaders(),
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=10",
            "x-cache": "MISS",
          },
        });
      }

      // 429以外はリトライせず即返す
      if (r.status !== 429) {
        return json(
          {
            error: "Rakuten API error",
            rakutenStatus: r.status,
            retryAfter: retryAfter ?? null,
            detail: text.slice(0, 500),
          },
          r.status
        );
      }

      // 429：次の試行があるなら待つ
      if (attempt < maxAttempts) {
        const waitMs = computeWaitMs(attempt, retryAfter);
        await sleep(waitMs);
        continue;
      }

      // 429でリトライ尽きた
      return json(
        {
          error: "Rakuten API rate limited (429)",
          rakutenStatus: 429,
          retryAfter: retryAfter ?? null,
          detail: text.slice(0, 500),
        },
        429
      );
    }

    // ここには基本来ないが保険
    return json(
      {
        error: "Rakuten API error",
        rakutenStatus: lastStatus,
        retryAfter: lastRetryAfter,
        detail: lastText.slice(0, 500),
      },
      lastStatus || 502
    );
  } catch (e) {
    console.error("Function crash:", e?.message ?? String(e));
    return json({ error: String(e) }, 500);
  }
};

function computeWaitMs(attempt, retryAfterHeader) {
  // Retry-After が秒で来るケースが多いので優先
  const sec = Number(retryAfterHeader);
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;

  // なければ指数バックオフ（1s, 2s, 4s くらい）
  const base = 1000;
  return base * Math.pow(2, attempt - 1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
  };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8" },
  });
}
