export async function collectStableSnapshot({attempts, collect, inventory, sameInventory, fingerprint}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const inventoryBefore = await inventory();
    const value = await collect();
    const [fingerprints, inventoryAfter] = await Promise.all([fingerprint(value), inventory()]);
    if (!sameInventory(inventoryBefore, inventoryAfter)) continue;
    return {value, fingerprints, inventory: inventoryAfter, attempt};
  }
  return undefined;
}
