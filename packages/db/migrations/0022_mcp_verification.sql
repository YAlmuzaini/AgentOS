-- Record whether an MCP connection has ever actually answered.
--
-- The catalogue can only claim a server is *cataloged*: a URL, a transport and
-- an auth kind read from the vendor's documentation. Whether this project's
-- copy of it works — right URL, right credential, reachable from here — is a
-- different question, and until now the UI had no way to tell the two apart.
-- These three columns are that answer, written by an explicit, operator-run
-- handshake and by nothing else.
--
-- All three are additive and safe on existing rows: NULL `verified_at` means
-- "never checked", which is exactly true of every connection that predates
-- this migration, and is deliberately distinct from "checked and broken".
--
-- `verified_tools` holds tool *names* only, and `verify_error` is written from
-- a message the verifier has already stripped of any credential.
ALTER TABLE "mcp_connections" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD COLUMN "verified_tools" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD COLUMN "verify_error" text;
