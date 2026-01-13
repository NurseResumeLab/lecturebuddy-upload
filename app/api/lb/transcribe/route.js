export async function POST(req) {
  const { blobUrl, user_email, title, scriptApiUrl } = await req.json();

  // 1) fetch uploaded file
  const fileRes = await fetch(blobUrl);
  if (!fileRes.ok) return Response.json({ ok:false, error:"Could not fetch uploaded file" }, { status: 400 });

  const arrayBuffer = await fileRes.arrayBuffer();
  const fileBytes = Buffer.from(arrayBuffer);

  // 2) transcribe with OpenAI
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("file", new Blob([fileBytes]), "lecture");

  const openaiRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  const json = await openaiRes.json();
  if (!openaiRes.ok) {
    return Response.json({ ok:false, error: JSON.stringify(json).slice(0, 500) }, { status: 500 });
  }

  const transcript_text = json.text || "";
  const words = json.words || [];
  const duration_sec = json.duration || 0;

  // 3) quick timeline (simple buckets)
  const timeline = buildTimeline(words, duration_sec);

  // 4) send transcript to Apps Script (no file upload)
  const payload = {
    action: "createLectureFromTranscript",
    user_email,
    title,
    transcript_text,
    duration_sec,
    timeline_json: JSON.stringify(timeline),
  };

  const asRes = await fetch(scriptApiUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const asText = await asRes.text();
  let asJson;
  try { asJson = JSON.parse(asText); }
  catch { return Response.json({ ok:false, error:"Apps Script returned non-JSON: " + asText.slice(0, 200) }, { status: 500 }); }

  if (!asJson.ok) return Response.json({ ok:false, error: asJson.error || "Apps Script error" }, { status: 500 });

  return Response.json({ ok:true, lecture_id: asJson.lecture_id });
}

function buildTimeline(words, durationSec) {
  const total = Math.max(1, Number(durationSec || 0));
  let segments = 8;
  if (total >= 5400) segments = 12;
  else if (total >= 3600) segments = 10;

  const segSize = total / segments;
  const buckets = Array.from({ length: segments }, (_, i) => ({
    start: Math.floor(i * segSize),
    end: Math.floor((i + 1) * segSize),
    text: "",
  }));

  for (const w of words) {
    const ws = Number(w.start || 0);
    const t = String(w.word || w.text || "").trim();
    if (!t) continue;
    const bi = Math.min(segments - 1, Math.max(0, Math.floor(ws / segSize)));
    buckets[bi].text += (buckets[bi].text ? " " : "") + t;
  }

  return buckets.map((b) => ({
    start: b.start,
    end: b.end,
    title: `Section (${fmt(b.start)})`,
    summary: ""
  }));
}

function fmt(sec) {
  sec = Math.max(0, Math.floor(Number(sec || 0)));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? "0" + s : s}`;
}
