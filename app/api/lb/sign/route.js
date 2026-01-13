import { put } from "@vercel/blob";

export async function POST(req) {
  const { filename, contentType } = await req.json();

  // Creates a blob and returns an upload URL + final URL
  const blob = await put(filename, new Blob([]), {
    access: "public",
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  return Response.json({ ok: true, uploadUrl: blob.uploadUrl, blobUrl: blob.url });
}
