import { after, NextRequest } from 'next/server';
import { createExtractiveSummary, extractDocument, summarizeDocument } from '@/lib/document-ingestion';
import { deleteDocument, indexDocumentEmbeddings, listDocuments, saveDocument, updateDocumentSummary, type StoredDocument } from '@/lib/document-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const SAFE_WORKSPACE_ID = /^[a-zA-Z0-9-]{16,64}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** Form fields carry JSON strings; a malformed value is treated as absent. */
function parseJsonField(entry: FormDataEntryValue | null): unknown {
  if (typeof entry !== 'string' || !entry) return undefined;
  try {
    return JSON.parse(entry);
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId') || '';
  if (!SAFE_WORKSPACE_ID.test(workspaceId)) return Response.json({ error: 'Invalid workspace id' }, { status: 400 });
  try {
    const documents = await listDocuments(workspaceId);
    return Response.json({ documents });
  } catch {
    return Response.json({ error: 'Document storage is unavailable. Check the database configuration.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > MAX_UPLOAD_BYTES + 256_000) return Response.json({ error: 'File exceeds the 15 MB upload limit' }, { status: 413 });

  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ error: 'Upload must use multipart form data' }, { status: 400 }); }
  const workspaceId = String(form.get('workspaceId') || '');
  const file = form.get('file');
  if (!SAFE_WORKSPACE_ID.test(workspaceId)) return Response.json({ error: 'Invalid workspace id' }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: 'Choose a file to upload' }, { status: 400 });
  if (!file.size) return Response.json({ error: 'The selected file is empty' }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: 'File exceeds the 15 MB upload limit' }, { status: 413 });

  const safeName = file.name.normalize('NFKC').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 180) || 'uploaded-file';
  const bytes = new Uint8Array(await file.arrayBuffer());
  let extracted: Awaited<ReturnType<typeof extractDocument>>;
  try {
    extracted = await extractDocument(safeName, bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = message.startsWith('Unsupported file type') ? 415 : 422;
    return Response.json({ error: message || 'Could not read this file. Try an unlocked, text-readable document.' }, { status });
  }

  const summary = createExtractiveSummary(extracted.chunks);
  const id = crypto.randomUUID();
  try {
    const storedId = await saveDocument({
      id,
      workspaceId,
      name: safeName,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      sha256: extracted.sha256,
      originalBlob: bytes,
      extractedText: extracted.extractedText,
      summary,
      outline: extracted.outline,
      chunks: extracted.chunks,
      createdAt: Date.now(),
    });
    if (storedId === id) {
      const instructions = String(form.get('instructions') || '');
      const apiKey = String(form.get('apiKey') || '').slice(0, 500);
      const providerId = parseJsonField(form.get('providerId')) || String(form.get('providerId') || '') || parseJsonField(form.get('provider'));
      const customProviders = parseJsonField(form.get('customProviders'));
      const apiKeys = parseJsonField(form.get('apiKeys'));
      after(async () => {
        const indexing = indexDocumentEmbeddings(workspaceId, [id]).catch(() => undefined);
        try {
          const generated = await summarizeDocument({
            name: safeName,
            chunks: extracted.chunks,
            userInstructions: instructions,
            providerId,
            customProviders,
            apiKeys,
            apiKey,
          });
          await updateDocumentSummary(workspaceId, id, generated, 'ready');
        } catch {
          await updateDocumentSummary(workspaceId, id, summary, 'failed').catch(() => undefined);
        }
        await indexing;
      });
    }
    const documents = await listDocuments(workspaceId);
    const document = documents.find((item: StoredDocument) => item.id === storedId);
    return Response.json({ document, duplicate: storedId !== id }, { status: storedId === id ? 201 : 200 });
  } catch {
    return Response.json({ error: 'Could not store the file in the document database' }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid request body' }, { status: 400 });
  const value = body as { workspaceId?: unknown; documentId?: unknown };
  if (typeof value.workspaceId !== 'string' || !SAFE_WORKSPACE_ID.test(value.workspaceId) || typeof value.documentId !== 'string' || !UUID.test(value.documentId)) {
    return Response.json({ error: 'Invalid workspace or document id' }, { status: 400 });
  }
  try {
    const deleted = await deleteDocument(value.workspaceId, value.documentId);
    return deleted ? Response.json({ ok: true }) : Response.json({ error: 'Document not found' }, { status: 404 });
  } catch {
    return Response.json({ error: 'Could not remove the file from the document database' }, { status: 503 });
  }
}
