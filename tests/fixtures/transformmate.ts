// Synthetic, test-only wire fixtures based on observed GET responses.
export const source = 'demo' as const;

export function trainingSummaryFixture() {
  return {
    id: 101,
    name: 'Demo training',
    description: 'Demo description',
    author: 201,
    is_mine: true,
    date: '2026-01-01',
    started: null,
    finished: null,
    progress: 'idle',
    has_tokens: false,
    has_access_for_copy: true,
    has_access_for_sharing: true,
    is_from_subscription: false,
    is_from_curator: false,
    label: '',
    week: '',
  };
}
function metric(id: number, key: string, value: string) {
  return {
    id,
    type: 'straight',
    measure: { id: key === 'weight' ? 3 : 4, key, name: key, short_name: key },
    metric_values: [{ id: id + 1000, value }],
  };
}
export function trainingDetailFixture(completed = false) {
  const { is_from_curator: _omitted, ...summary } = trainingSummaryFixture();
  void _omitted;
  const actual = [metric(601, 'weight', '12.5'), metric(602, 'reps', '8')];
  return {
    ...summary,
    started: completed ? '2026-01-01T10:00:00.123456Z' : null,
    finished: completed ? '2026-01-01T10:30:00Z' : null,
    progress: completed ? 'done' : 'idle',
    has_access_for_replacing: true,
    protocols: [
      {
        id: 301,
        order: 1,
        workout_exercises: [
          {
            id: 401,
            exercise: { id: 501, name: 'Demo exercise' },
            order: 1,
            comment: 'Demo comment',
            warmup_metrics: {},
            target_indication: null,
            videoreport_required: false,
            exercise_metrics: [
              { id: 3, name: 'weight' },
              { id: 4, name: 'reps' },
            ],
            metrics: [
              {
                id: 701,
                type: 'plan',
                sets: [
                  {
                    id: 801,
                    order: 1,
                    techniques: [],
                    set_metrics: [
                      metric(603, 'weight', '10'),
                      metric(604, 'reps', '8'),
                    ],
                  },
                ],
              },
              {
                id: 702,
                type: 'fact',
                sets: [
                  {
                    id: 802,
                    order: 1,
                    techniques: [],
                    set_metrics: completed ? actual : [],
                    is_done: completed,
                  },
                ],
              },
            ],
            best_result: {},
            last_results: completed
              ? {
                  type: 'fact',
                  sets: [
                    {
                      set_metrics: actual.map((item) => ({
                        type: item.type,
                        measure: { id: item.measure.id },
                        metric_values: item.metric_values,
                      })),
                    },
                  ],
                }
              : {},
            mediareports: [],
            is_checked: false,
          },
        ],
      },
    ],
    mediareport_url: '',
    start_check: null,
    end_check: null,
    report_time: null,
    report_msg: '',
    updated_at: '2026-01-01T10:30:01.123456Z',
  };
}
