// PostgREST builders are thenables, not full Promises: do not call .catch().
export async function releaseModelLease(admin, lease) {
  try {
    await admin.rpc("dobao_release_lease", { p_slot: "model", p_id: lease });
  } catch {
    /* Lease expires automatically if the best-effort release fails. */
  }
}
