// netlify/functions/rakuten.js

const CACHE_TTL_MS = 30_000;
const cache = new Map(); // key -> { expiresAt, bodyText }

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    const url = new URL(req.url);

    const keyword = (url.searchParams.get("keyword") ?? "ベッド").trim();
    const hits = (url.searchParams.get("hits") ?? "3").trim();

    const rawAppId = process.env.RAKUTEN_APP_ID;
    const rawAccessKey = process.env.RAKUTEN_ACCESS_KEY;

    const appId = (rawAppId ?? "").trim();
    const accessKey = (rawAccessKey ?? "").trim();

    if (!appId || !accessKey) {
      return json({ error: "Missing env vars: RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY" }, 500);
    }

    const cacheKey = JSON.stringify({ keyword, hits });
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return new Response(cached.bodyText, {
        status: 200,
        headers: {
          ...corsHeaders(),
          "content-type": "application/json; charset=utf-8",
          "x-cache": "HIT",
        },
      });
    }

    // 楽天API
    const api = new URL("https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601");
    api.searchParams.set("format", "json");
    api.searchParams.set("applicationId", appId);
    api.searchParams.set("accessKey", accessKey);
    api.searchParams.set("keyword", keyword);
    api.searchParams.set("hits", hits);

    // ★秘密値を伏せたURLログ（壊れてたので修正）
    console.log(
      "Rakuten URL:",
      api.toString().replaceAll(appId, ",[object Object],*")
    );

    // 429リトライ
    const maxAttempts = 3;
    let lastText = "";
    let lastStatus = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const r = await fetch(api.toString(), {
        headers: {
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

      if (r.ok) {
        // ★ここで「フロントが期待する items 形式」に整形する
        const raw = JSON.parse(text);

        const items = (raw.Items ?? []).map((wrap) => {
          const it = wrap?.Item ?? wrap ?? {};
          const imageUrl =
            (Array.isArray(it.mediumImageUrls) && it.mediumImageUrls[0]?.imageUrl) ||
            (Array.isArray(it.smallImageUrls) && it.smallImageUrls[0]?.imageUrl) ||
            "";

          return {
            itemName: it.itemName ?? "",
            itemPrice: it.itemPrice ?? 0,
            itemUrl: it.itemUrl ?? "",
            shopName: it.shopName ?? "",
            imageUrl,
            reviewAverage: it.reviewAverage ?? null,
            reviewCount: it.reviewCount ?? null,
          };
        });

        const bodyText = JSON.stringify({ items });

        cache.set(cacheKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          bodyText,
        });

        return new Response(bodyText, {
          status: 200,
          headers: {
            ...corsHeaders(),
            "content-type": "application/json; charset=utf-8",
            "x-cache": "MISS",
          },
        });
      }

      if (r.status !== 429) {
        return json(
          { error: "Rakuten API error", rakutenStatus: r.status, detail: text.slice(0, 500) },
          r.status
        );
      }

      if (attempt < maxAttempts) {
        await sleep(computeWaitMs(attempt, retryAfter));
        continue;
      }

      return json(
        { error: "Rakuten API rate limited (429)", rakutenStatus: 429, retryAfter: retryAfter ?? null },
        429
      );
    }

    return json(
      { error: "Rakuten API error", rakutenStatus: lastStatus, detail: lastText.slice(0, 200) },
      lastStatus || 502
    );
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

function computeWaitMs(attempt, retryAfterHeader) {
  const sec = Number(retryAfterHeader);
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  return 1000 * Math.pow(2, attempt - 1);
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
