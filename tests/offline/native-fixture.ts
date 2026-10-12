import { transformMateNativeSnapshotSchema } from '@/contracts/transformmate-native';
export function nativeFixture(date = '2026-10-12', remoteTrainingId = 101) {
  return transformMateNativeSnapshotSchema.parse({
    source: 'transformmate',
    remoteTrainingId,
    date,
    title: 'Synthetic native phone',
    progress: 'idle',
    started: null,
    finished: null,
    remoteUpdatedAt: '2026-10-12T12:00:00Z',
    exercises: [
      {
        protocolId: 11,
        protocolOrder: 1,
        remoteExerciseId: 21,
        exerciseId: 31,
        order: 1,
        name: 'Synthetic native movement',
        comment: 'Literal note',
        metrics: [
          {
            type: 'plan',
            sets: [
              {
                order: 1,
                done: null,
                metrics: [
                  {
                    key: 'duration',
                    name: 'Duration',
                    unit: 'мин',
                    type: 'range',
                    values: ['01–03'],
                  },
                ],
              },
            ],
          },
          {
            type: 'fact',
            sets: [
              {
                order: 1,
                done: false,
                metrics: [
                  {
                    key: 'weight',
                    name: 'Weight',
                    unit: 'кг',
                    type: 'number',
                    values: ['0'],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}
