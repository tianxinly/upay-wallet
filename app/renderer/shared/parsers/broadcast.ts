function decodeBytesToUtf8(bytes: Uint8Array) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return decoder.decode(bytes);
}

export function decodeMaybeBase64(text: string) {
  if (!text) return "";
  const trimmed = text.trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed) || trimmed.length % 4 !== 0) return text;
  try {
    const bin = atob(trimmed);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return decodeBytesToUtf8(bytes);
  } catch {
    return text;
  }
}

export function decodeMaybeHex(text: string) {
  if (!text) return "";
  const trimmed = text.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length % 2 !== 0) return text;
  try {
    const bytes = new Uint8Array(trimmed.length / 2);
    for (let i = 0; i < trimmed.length; i += 2) {
      bytes[i / 2] = parseInt(trimmed.slice(i, i + 2), 16);
    }
    return decodeBytesToUtf8(bytes);
  } catch {
    return text;
  }
}

export function formatBroadcastErrors(results: any[]) {
  if (!Array.isArray(results)) return "";
  const failed = results
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => !(r && r.result === true));
  if (failed.length === 0) return "";

  const lines = failed.slice(0, 10).map(({ r, idx }) => {
    const code = r?.code ? `code=${r.code}` : "";
    const msgRaw = r?.message ?? r?.error ?? "";
    const msg = msgRaw ? decodeMaybeHex(decodeMaybeBase64(String(msgRaw))) : "";
    const txid = r?.txid ? `txid=${r.txid}` : "";
    const parts = [code, msg, txid].filter(Boolean).join(" | ");
    return `${idx + 1}. ${parts || "未知错误"}`;
  });

  const more = failed.length > 10 ? `... 还有 ${failed.length - 10} 条失败` : "";
  return [lines.join("\n"), more].filter(Boolean).join("\n");
}
