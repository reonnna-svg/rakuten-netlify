// netlify/functions/rakuten.js

export default async (req, context) => {
  // OPTIONS プリフライト
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(req.url);

  // keyword
  const keyword = url.searchParams.get("keyword")?.trim();
  if (!keyword) return json({ error: "keyword is required" }, 400);

  // params
  const hits = clamp(Number(url.searchParams.get("hits") ?? 10), 1, 30);
  const page = clamp(Number(url.searchParams.get("page") ?? 1), 1, 100);
  const sort = sanitizeSort(url.searchParams.get("sort") ?? "standard");

  // ENV（重要：trim）
  const rawAppId = process.env.RAKUTEN_APP_ID;
  const appId = (rawAppId ?? "").trim();

  console.log("ENV OK:", {
    hasAppId: !!appId,
    appIdLen: appId.length,
    // デバッグしやすいように「改行混入」などを疑える情報だけ出す（値そのものは出さない）
    rawLen: rawAppId ? rawAppId.length : 0,
    hasWhitespace: rawAppId ? rawAppId !== rawAppId.trim() : false,
  });

  if (!appId) {
    console.error("ENV: RAKUTEN_APP_ID is missing/empty");
    return json({ error: "Server configuration error" }, 500);
  }

  try {
    const api = new URL("https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601");
    api.searchParams.set("format", "json");
    api.searchParams.set("applicationId", appId); // ←ここが最重要
    api.searchParams.set("keyword", keyword);
    api.searchParams.set("hits", String(hits));
    api.searchParams.set("page", String(page));
    api.searchParams.set("sort", sort);
    api.searchParams.set("imageFlag", "1");
    api.searchParams.set("formatVersion", "2");

    console.log("Rakuten URL:", api.toString().replace(appId, "***")); // 伏せる 

    const r = await fetch(api.toString());
    const text = await r.text();
    console.log("Rakuten status:", r.status, "body(200char):", text.slice(0, 200)); // まず状況把握 

    if (!r.ok) {
      return json(
        { error: "Upstream API error", rakutenStatus: r.status, detail: text.slice(0, 300) },
        502
      );
    }

    const raw = JSON.parse(text);

    const items = (raw.Items ?? []).map((i) => ({
      itemName: i.itemName,
      itemPrice: i.itemPrice,
      itemUrl: i.itemUrl,
      imageUrl:
        Array.isArray(i.mediumImageUrls) && i.mediumImageUrls.length > 0
          ? (typeof i.mediumImageUrls[0] === "string"
              ? i.mediumImageUrls[0]
              : i.mediumImageUrls[0]?.imageUrl ?? null)
          : null,
      shopName: i.shopName,
      reviewAverage: i.reviewAverage,
      reviewCount: i.reviewCount,
    }));

    return new Response(
      JSON.stringify({
        keyword, hits, page, sort,
        count: raw.count ?? 0,
        pageCount: raw.pageCount ?? 0,
        items,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, s-maxage=60, max-age=30",
        },
      }
    );
  } catch (e) {
    console.error("Function crash:", e?.message ?? String(e));
    return json({ error: "Internal server error", detail: e?.message ?? String(e) }, 500);
  }
};

// helpers（元ファイル踏襲）
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
  });
}
function clamp(n, min, max) {
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : min;
}
const VALID_SORTS = new Set([
  "standard", "-price", "+price", "-reviewCount",
  "-reviewAverage", "-itemPrice", "+itemPrice",
  "affiliate", "-updateTimestamp",
]);
function sanitizeSort(s) {
  return VALID_SORTS.has(s) ? s : "standard";
}
