export class RequestBodyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Bound raw UTF-8 bytes before decoding/JSON parsing, even without Content-Length.
export async function readJsonObject(request, maxBytes = 32768) {
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    if (request.body) void request.body.cancel().catch(() => {});
    throw new RequestBodyError(413, '请求内容过大');
  }
  if (!request.body) throw new RequestBodyError(400, '请求格式无效');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        // Do not read another chunk or await an untrusted cancellation promise.
        void reader.cancel().catch(() => {});
        throw new RequestBodyError(413, '请求内容过大');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400, '请求内容读取失败');
  } finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new RequestBodyError(400, '请求格式无效'); }
}
