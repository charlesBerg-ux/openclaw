/*
 * Which sidebar rows are machinery rather than conversations.
 *
 * The sidebar listed every session an agent has ever had, so a handful of real
 * chats sat under a pile of rows nobody opens: a research agent's helper
 * copies, one row per Control UI tab, and a plugin's bookkeeping. They are not
 * deleted and not hidden anywhere else — Automations and Tasks still show them.
 * This only keeps them out of the list of things you talk to.
 *
 * Cron rows are deliberately absent here. The sidebar already has its own
 * automation toggle for those, and owning them twice would mean two switches
 * fighting over the same rows.
 *
 * ⚠ Do not reach for `createdVia` to do this job. It looks like the right
 * field and it is empty on almost every session we have: 64 of 70 rows on this
 * box carry no value, because the field was added later and nothing filled it
 * in for sessions that already existed. A filter written against it would look
 * correct in review and hide nothing. The session key and `spawnedBy` are
 * written at creation and are present on every row.
 */

/** A helper copy an agent started to work on part of a question. */
function isSpawnedHelper(row: { spawnedBy?: string; isChild?: boolean }): boolean {
  return Boolean(row.spawnedBy) || row.isChild === true;
}

/** One row per browser tab that opened the Control UI, named after the tab's id. */
function isDashboardRow(key: string): boolean {
  return key.includes(":dashboard:");
}

/** A plugin's own bookkeeping session, such as a model-catalog adoption run. */
function isPluginRow(key: string): boolean {
  return key.includes(":plugin:");
}

export function isMachineSessionRow(row: {
  key: string;
  spawnedBy?: string;
  isChild?: boolean;
}): boolean {
  return isSpawnedHelper(row) || isDashboardRow(row.key) || isPluginRow(row.key);
}
