export async function register() {
  if (
    process.env.NEXT_RUNTIME !== 'nodejs' ||
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.ENABLE_NUTRITION_SCHEDULER !== 'true'
  )
    return;
  const { startNutritionScheduler } =
    await import('@/server/jobs/nutrition-scheduler');
  startNutritionScheduler();
}
