if (process.env.FAST_JEV_CODEX_ENABLED === '1') {
  try {
    const { main } = await import('../dist/codex.js');
    await main();
  } catch {
    // A missing build must not interrupt native compaction.
  }
}
