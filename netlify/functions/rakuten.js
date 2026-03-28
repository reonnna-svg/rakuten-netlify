// netlify/functions/rakuten.js

export default async (req, context) => {
  // OPTIONS（必要なら）
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    const url = new URL(req.url);

    // keyword（元コード踏襲：無ければベッド）
    const keyword = (url.searchParams.get("keyword") ?? "ベッド").trim();

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

    // 楽天API（元コード踏襲：openapi）
    const api = new URL(
      "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601"
    );
    api.searchParams.set("format", "json");
    api.searchParams.set("applicationId", appId);
    api.searchParams.set("accessKey", accessKey);
    api.searchParams.set("keyword", keyword);
    api.searchParams.set("hits", url.searchParams.get("hits") ?? "1");

    // 秘密値を伏せたURLログ
    console.log(
      "Rakuten URL:",
      api
        .toString()
        .replaceAll(appId, "***")
        .replaceAll(accessKey, "***")
    );

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

    console.log("Rakuten status:", r.status, "body(200char):", text.slice(0, 200));

    // 400などエラー時：フロントでも原因が追えるように返す
    if (!r.ok) {
      return json(
        {
          error: "Rakuten API error",
          rakutenStatus: r.status,
          detail: text.slice(0, 500),
        },
        r.status
      );
    }

    // 成功時：楽天の返却をそのまま返す（元コード踏襲）
    return new Response(text, {
      status: 200,
      headers: {
        ...corsHeaders(),
        "content-type": "application/json; charset=utf-8",
      },
    });
  } catch (e) {
    console.error("Function crash:", e?.message ?? String(e));
    return json({ error: String(e) }, 500);
  }
};

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
