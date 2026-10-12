// Replace the dictionary resolver when adding another locale.
export const ru = {
  appName: 'Питание и движение',
  login: 'Войти',
  logout: 'Выйти',
  email: 'Электронная почта',
  password: 'Пароль',
  navigation: 'Навигация',
  theme: 'Переключить тему',
  trainerSettings: 'Доступ тренеров',
  yazioSettings: 'Подключение YAZIO',
  loginError: 'Не удалось войти. Проверьте почту и пароль.',
  settings: {
    navigation: 'Разделы настроек',
    syncTitle: 'Синхронизация',
    description:
      'Подключение дневника питания и управление доступом к вашим данным.',
    yazioDescription: 'Подключите аккаунт YAZIO и загрузите дневник питания.',
    trainersDescription:
      'Пригласите тренера или отзовите его доступ к вашим данным.',
    ownerOnly:
      'Подключением YAZIO и доступом тренеров управляет владелец аккаунта.',
  },
  sections: [
    {
      href: '/',
      title: 'Обзор',
      description: 'Ваше пространство для питания, здоровья и движения.',
      area: 'dashboard',
    },
    {
      href: '/diary',
      title: 'Дневник питания',
      description: 'Здесь появятся приёмы пищи и записи за день.',
      area: 'nutrition',
    },
    {
      href: '/measurements',
      title: 'Замеры',
      description: 'Здесь появится история физических показателей.',
      area: 'measurements',
    },
    {
      href: '/workouts',
      title: 'Тренировки',
      description: 'Здесь появятся тренировки и планы занятий.',
      area: 'workouts',
    },
    {
      href: '/analytics',
      title: 'Аналитика',
      description: 'Здесь появятся тенденции и динамика ваших показателей.',
      area: 'analytics',
    },
    {
      href: '/reports',
      title: 'Отчёты',
      description: 'Здесь появятся отчёты для вас и вашего тренера.',
      area: 'reports',
    },
    {
      href: '/settings',
      title: 'Настройки',
      description: 'Здесь появятся настройки подключения и доступа.',
      area: 'settings',
    },
  ],
};

export const workoutTitleMessages = { unnamed: 'Тренировка' } as const;
