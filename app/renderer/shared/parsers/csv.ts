function detectDelimiter(line: string) {
  if (line.includes("，")) return /，/;
  if (line.includes("\t")) return /\t/;
  return /,/;
}

function normalizeToken(value: string) {
  return value.replace(/^\uFEFF/, "").replace(/\u200B/g, "").trim();
}

function splitCsv(line: string, delimiter: RegExp) {
  const cleaned = line.replace(/^\uFEFF/, "");
  return cleaned.split(delimiter).map((s) => normalizeToken(s));
}

function findHeaderIndex(headers: string[], aliases: string[]) {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseAddressAmountCsv(csvText: string) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const firstLine = lines[0].replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(firstLine);
  const first = firstLine.toLowerCase();
  const hasHeader = /address|addr|地址/.test(first) && /amount|金额/.test(first);
  const dataLines = hasHeader ? lines.slice(1) : lines;
  let indexPos = -1;
  let addressPos = 0;
  let amountPos = 1;

  if (hasHeader) {
    const headers = splitCsv(firstLine, delimiter).map((s) => s.toLowerCase());
    addressPos = findHeaderIndex(headers, ["address", "addr", "地址"]);
    amountPos = findHeaderIndex(headers, ["amount", "金额"]);
    indexPos = findHeaderIndex(headers, ["index", "idx", "序号"]);
    if (addressPos < 0 || amountPos < 0) {
      throw new Error("CSV 表头必须包含 address(或地址) 与 amount(或金额)");
    }
  }

  return dataLines.map((line) => {
    const parts = splitCsv(line, delimiter);
    if (indexPos >= 0) {
      const idxRaw = parts[indexPos];
      const index = idxRaw !== undefined && idxRaw !== "" ? Number(idxRaw) : NaN;
      return {
        index: Number.isFinite(index) ? index : undefined,
        address: parts[addressPos] || "",
        amount: parts[amountPos] || ""
      };
    }
    if (parts.length >= 3) {
      const index = Number(parts[0]);
      return {
        index: Number.isFinite(index) ? index : undefined,
        address: parts[1] || "",
        amount: parts[2] || ""
      };
    }
    return { address: parts[0] || "", amount: parts[1] || "" };
  });
}

export function parseAddressCsv(csvText: string) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const firstLine = lines[0].replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(firstLine);
  const first = firstLine.toLowerCase();
  const hasHeader = /address|addr|地址/.test(first);
  const dataLines = hasHeader ? lines.slice(1) : lines;
  let indexPos = -1;
  let addressPos = 0;

  if (hasHeader) {
    const headers = splitCsv(firstLine, delimiter).map((s) => s.toLowerCase());
    addressPos = findHeaderIndex(headers, ["address", "addr", "地址"]);
    indexPos = findHeaderIndex(headers, ["index", "idx", "序号"]);
    if (addressPos < 0) {
      throw new Error("CSV 表头必须包含 address(或地址)");
    }
  }

  return dataLines
    .map((line) => {
      const parts = splitCsv(line, delimiter);
      if (indexPos >= 0) {
        const idxRaw = parts[indexPos];
        const index = idxRaw !== undefined && idxRaw !== "" ? Number(idxRaw) : NaN;
        return {
          index: Number.isFinite(index) ? index : undefined,
          address: parts[addressPos] || ""
        };
      }
      if (parts.length >= 2) {
        const index = Number(parts[0]);
        return {
          index: Number.isFinite(index) ? index : undefined,
          address: parts[1] || ""
        };
      }
      return { address: parts[0] || "" };
    })
    .filter((row) => row.address);
}
