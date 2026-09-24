-- Closure harvesting (CORE_API §6C.2): the Core stores every POST /closure, so the
-- backend remembers which resolution note and resolver it last sent for a ticket.
ALTER TABLE tickets ADD COLUMN core_closure_key text;
