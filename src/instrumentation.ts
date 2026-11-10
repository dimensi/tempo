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
  const { startWorkoutVideoWorker } = await import('@/server/workouts/videos');
  startWorkoutVideoWorker();
  // Let the scheduler report why it is disabled as well as successful registration.
  const { startNutritionScheduler } =
    await import('@/server/jobs/nutrition-scheduler');
  startNutritionScheduler();
  if (process.env.ENABLE_ANAMNESIS_WORKER === 'true') {
    const { startAnamnesisWorkerLoop } =
      await import('@/server/anamnesis/worker');
    startAnamnesisWorkerLoop();
  }
}
