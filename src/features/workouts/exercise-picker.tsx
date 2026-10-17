'use client';
import { useState } from 'react';
import { Button } from '@mantine/core';
import type { WorkoutExercise } from '@/contracts/workouts';
import type { TransformMateCatalogItem } from '@/contracts/transformmate';
import { ExerciseBrowser } from './exercise-browser';
import { selectCatalogExercise } from './transformmate-exercises';
import { workoutMessages as m } from './messages';
import styles from './exercise-browser.module.css';
export function ExercisePicker({
  ownerId,
  capacity,
  onAdd,
}: {
  ownerId: string;
  capacity: number;
  onAdd: (items: WorkoutExercise[]) => void;
}) {
  const [chosen, setChosen] = useState<TransformMateCatalogItem[]>([]);
  const empty = (name = ''): WorkoutExercise => ({
    id: crypto.randomUUID(),
    name,
    sets: [{ reps: 10, weightKg: null }],
  });
  return (
    <ExerciseBrowser
      ownerId={ownerId}
      capacity={capacity}
      chosen={chosen}
      onChoose={(item) =>
        setChosen((current) =>
          current.some((value) => value.id === item.id)
            ? current.filter((value) => value.id !== item.id)
            : [...current, item],
        )
      }
      onManual={(name) => onAdd([empty(name)])}
      footer={
        <Button
          className={styles.solid}
          fullWidth
          mih={48}
          disabled={!chosen.length}
          onClick={() =>
            onAdd(chosen.map((item) => selectCatalogExercise(empty(), item)))
          }
        >
          {m.addSelected}
          {chosen.length ? ` · ${chosen.length}` : ''}
        </Button>
      }
    />
  );
}
