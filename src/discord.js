// src/discord.js

export async function postDiscordWebhook({ webhookUrl, content, username, avatarUrl }) {
  if (!webhookUrl) throw new Error("Discord webhook URL is required");
  if (!content) throw new Error("Discord message content is required");

  const payload = {
    content,
  };
  if (username) payload.username = username;
  if (avatarUrl) payload.avatar_url = avatarUrl;

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Discord webhook failed (${res.status}): ${bodyText}`);
  }

  return res;
}

