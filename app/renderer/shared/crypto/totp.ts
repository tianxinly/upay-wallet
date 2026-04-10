const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(input: string) {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

function counterToBytes(counter: number) {
  const buf = new Uint8Array(8);
  let value = counter;
  for (let i = 7; i >= 0; i -= 1) {
    buf[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return buf;
}

export async function generateTotp(
  secretBase32: string,
  timeMs: number,
  stepSeconds = 30,
  digits = 6
) {
  const keyBytes = decodeBase32(secretBase32);
  if (!keyBytes.length) return "";
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  const counterBytes = counterToBytes(counter);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, [
    "sign"
  ]);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = 10 ** digits;
  const otp = (binCode % mod).toString().padStart(digits, "0");
  return otp;
}

export async function verifyTotp(
  secretBase32: string,
  code: string,
  window = 1,
  stepSeconds = 30,
  digits = 6
) {
  if (!secretBase32) return false;
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d+$/.test(normalized)) return false;
  const now = Date.now();
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = await generateTotp(secretBase32, now + offset * stepSeconds * 1000, stepSeconds, digits);
    if (candidate && candidate === normalized) return true;
  }
  return false;
}

export function buildOtpAuthUrl(params: { secret: string; issuer: string; label: string }) {
  const label = encodeURIComponent(`${params.issuer}:${params.label}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
