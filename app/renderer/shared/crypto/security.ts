const ENC_PREFIX = "enc:v1:";

export function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

export function fromBase64(text: string) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveKey"
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100_000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits"
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  return toBase64(new Uint8Array(bits));
}

export async function encryptSecret(plain: string, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  const cipherBytes = new Uint8Array(ciphertext);
  return `${ENC_PREFIX}${toBase64(salt)}:${toBase64(iv)}:${toBase64(cipherBytes)}`;
}

export async function decryptSecret(encValue: string, password: string) {
  if (!encValue.startsWith(ENC_PREFIX)) {
    throw new Error("密文格式不正确");
  }
  const parts = encValue.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("密文格式不正确");
  }
  const [saltB64, ivB64, dataB64] = parts;
  const salt = fromBase64(saltB64);
  const iv = fromBase64(ivB64);
  const data = fromBase64(dataB64);
  const key = await deriveKey(password, salt);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("钱包加密密码错误");
  }
}
