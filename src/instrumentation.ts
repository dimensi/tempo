export async function register() {
  if (
    process.env.NEXT_RUNTIME !== 'nodejs' ||
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  )
    return;
  const { startTransformMateReplicaWorker } =
    await import('@/server/transformmate/replica-worker');
  startTransformMateReplicaWorker();
  if (process.env.ENABLE_NUTRITION_SCHEDULER === 'true') {
    const { startNutritionScheduler } =
      await import('@/server/jobs/nutrition-scheduler');
    startNutritionScheduler();
  }
  if (process.env.ENABLE_ANAMNESIS_WORKER === 'true') {
    const { startAnamnesisWorkerLoop } =
      await import('@/server/anamnesis/worker');
    startAnamnesisWorkerLoop();
  }
}
