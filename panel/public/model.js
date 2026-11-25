const customId = /^[a-z0-9]{8,16}-[a-f0-9]{8}$/;
const sessionId = value => value === "1" || value === "2" || (typeof value === "string" && customId.test(value));
const label = (value, limit) => typeof value === "string" && value.trim().length > 0 && value.length <= limit;

function validProgressEntry(key, value) {
  if (key.startsWith("session-meta:")) return customId.test(key.slice(13)) && (value === null || label(value, 100));
  if (key.startsWith("scene-meta:")) return /^[A-Z0-9-]{2,24}$/.test(key.slice(11)) &&
    (value === null || (typeof value === "object" && label(value.title, 100) &&
      typeof value.place === "string" && value.place.length <= 100 && sessionId(value.session)));
  if (key.startsWith("thread-meta:")) return customId.test(key.slice(12)) &&
    (value === null || (typeof value === "object" && label(value.title, 100) &&
      typeof value.text === "string" && value.text.length <= 400));
  if (/^note:[a-zA-Z0-9-]{1,45}$/.test(key)) return typeof value === "string" && value.length <= 8000;
  if (/^scene:[A-Z0-9-]{2,24}$/.test(key)) return ["pending", "done", "skipped"].includes(value);
  if (/^thread:[a-z0-9-]{1,32}$/.test(key)) return ["open", "active", "closed"].includes(value);
  if (key.startsWith("session:") && sessionId(key.slice(8))) return ["planned", "active", "done"].includes(value);
  if (/^puzzle:Z[1-3]$/.test(key)) return typeof value === "boolean";
  if (/^hp:[01]$/.test(key)) return Number.isInteger(value) && value >= 0 && value <= 6;
  if (key === "current") return typeof value === "string" && /^[A-Z0-9-]{2,24}$/.test(value);
  return false;
}

