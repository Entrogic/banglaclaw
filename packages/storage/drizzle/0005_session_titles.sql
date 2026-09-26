ALTER TABLE "sessions" ADD COLUMN "title" text;--> statement-breakpoint
-- Existing sessions: title from the first user message whose content is plain text (docs/06).
UPDATE "sessions" AS s
SET "title" = CASE WHEN char_length(first_message.text) > 80 THEN left(first_message.text, 79) || '…' ELSE first_message.text END
FROM (
  SELECT DISTINCT ON (m."session_id") m."session_id", btrim(regexp_replace(m."data" -> 'data' ->> 'content', '\s+', ' ', 'g')) AS text
  FROM "messages" AS m
  WHERE m."role" = 'human' AND jsonb_typeof(m."data" -> 'data' -> 'content') = 'string' AND btrim(m."data" -> 'data' ->> 'content') <> ''
  ORDER BY m."session_id", m."id"
) AS first_message
WHERE first_message."session_id" = s."id" AND s."title" IS NULL;
