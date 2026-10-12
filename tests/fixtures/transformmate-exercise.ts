// Synthetic wire response. Source: demo; never persist or render in production.
export const source = 'demo' as const;
export function exerciseDetailFixture() {
  return {
    id: 501,
    author: null,
    name: 'Demo exercise',
    other_names: [],
    description: 'Demo description',
    image: 'https://media.example.test/poster.jpg',
    video_link: '',
    youtube_link: 'https://youtu.be/demo',
    vimeo_link: '12345',
    kinescope_data: [
      {
        id: 'demo-video',
        url: 'https://media.example.test/video.mp4?sign=demo',
        resolution: '1280x720',
        quality: '720p',
        filetype: 'mp4',
        video_id: 'demo-provider-video',
        file_size: 1234,
        created_at: '2026-01-01T00:00:00.123456Z',
        download_link: 'https://media.example.test/download',
        original_name: '720p.mp4',
      },
    ],
    exercise_type: { id: 2, name: 'Demo type' },
    equipments: [
      {
        id: 39,
        name: 'Demo equipment',
        equipment_group: { id: 2, name: 'Demo group', equipments: [] },
        equipment_groups: [],
      },
    ],
    muscles: [
      {
        id: 197,
        muscle: {
          id: 20,
          name: 'Demo muscle',
          image: null,
          muscle_group: { id: 13, name: 'Demo muscle group', image: null },
        },
        position: { id: 1, name: 'Demo position', is_main: true },
      },
    ],
    muscle_groups_main_position: ['Demo muscle group'],
    restrictions: [],
    warm_up: { id: 1, name: 'Demo warmup', description: '' },
    metrics: [
      {
        id: 3,
        name: 'Weight',
        short_name: 'Weight',
        key: 'weight',
        value_type: 'float',
        set_metric_types: [
          {
            name: 'Demo plus',
            type: 'two_in_one',
            key: '+',
            friendly_techniques: [5],
          },
        ],
      },
    ],
    sports: [
      {
        id: 12,
        name: 'Demo sport',
        sport_type: { id: 1, name: 'Demo sport type', short_name: 'Demo' },
      },
    ],
    accents: [{ id: 45, name: 'Demo accent' }],
    favorite_id: null,
    completed: true,
    is_new: false,
    is_updated: false,
  };
}
