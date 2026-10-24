export const roles = ['OWNER', 'TRAINER'] as const;
export type Role = (typeof roles)[number];
export const permissions = [
  'nutrition:read',
  'nutrition:write',
  'measurements:read',
  'measurements:write',
  'workouts:read',
  'workouts:plan',
  'workouts:log',
  'comments:write',
  'reports:export',
  'anamnesis:read',
  'anamnesis:write',
  'anamnesis:report',
  'yazio:manage',
  'transformmate:manage',
  'trainers:manage',
  'settings:manage',
] as const;
export type Permission = (typeof permissions)[number];
const trainerPermissions: readonly Permission[] = [
  'nutrition:read',
  'measurements:read',
  'workouts:read',
  'workouts:plan',
  'workouts:log',
  'comments:write',
  'reports:export',
  // Тренер читает анамнез и строит отчёты только по выданным грантам;
  // запись (загрузка, правки, управление доступом) — владелец.
  'anamnesis:read',
  'anamnesis:report',
];
export function hasPermission(role: string, permission: Permission): boolean {
  return (
    role === 'OWNER' ||
    (role === 'TRAINER' && trainerPermissions.includes(permission))
  );
}
