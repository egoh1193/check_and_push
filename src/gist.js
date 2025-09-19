// src/gist.js

export const DEFAULT_GIST_FILENAME = "board_results.json";
export const DEFAULT_GIST_DESCRIPTION = "board-test results";
export const DEFAULT_GIST_PUBLIC = false;

export function parseBoolean(value) {
  if (typeof value !== "string") return false;
  const lowered = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(lowered);
}

export async function postGist({ token, description, filename, content, isPublic }) {
  const payload = {
    description,
    public: Boolean(isPublic),
    files: {
      [filename]: { content },
    },
  };

  const res = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "check_and_push",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Gist API failed (${res.status}): ${bodyText}`);
  }

  const body = await res.json();
  return body.html_url || body.url;
}

