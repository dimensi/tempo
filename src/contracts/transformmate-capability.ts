/** Scalar plan publication supports precisely weight/reps; advanced set types
 * advertised by provider detail do not exclude the verified scalar straight representation.
 * Projection still emits an explicit straight type.
 */
export function transformMatePublicationCapability(
  metrics: readonly { id: number; key: string }[] | null,
) {
  if (metrics === null) return { state: 'unknown' as const, reason: null };
  if (metrics.length !== 2)
    return { state: 'unsupported' as const, reason: 'metric_count' as const };
  if (!metrics.some((metric) => metric.id === 3 && metric.key === 'weight'))
    return { state: 'unsupported' as const, reason: 'weight_metric' as const };
  if (!metrics.some((metric) => metric.id === 4 && metric.key === 'reps'))
    return { state: 'unsupported' as const, reason: 'reps_metric' as const };
  return { state: 'supported' as const, reason: null };
}
