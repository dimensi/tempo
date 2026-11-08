import {
  ActionIcon,
  Button,
  Group,
  Collapse,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import {
  IconBarbell,
  IconBodyScan,
  IconChevronDown,
  IconNote,
  IconPlus,
  IconRuler2,
  IconRulerMeasure,
  IconRun,
  IconScaleOutline,
  IconShirt,
  IconX,
} from '@tabler/icons-react';
import { useId, useState } from 'react';
import {
  measurementMetrics,
  type MeasurementMetric,
} from '@/contracts/measurements';
import { measurementMessages as m } from './messages';
import styles from './measurements.module.css';

const metricIcons = {
  weight: IconScaleOutline,
  waist: IconRulerMeasure,
  chest: IconShirt,
  hips: IconBodyScan,
  neck: IconRuler2,
  biceps: IconBarbell,
  thigh: IconRun,
};

export type MeasurementDraftValues = Partial<Record<MeasurementMetric, string>>;

export function MeasurementFields({
  date,
  full,
  note,
  values,
  onDateChange,
  onNoteChange,
  onValuesChange,
}: {
  date: string;
  full: boolean;
  note: string;
  values: MeasurementDraftValues;
  onDateChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onValuesChange: (values: MeasurementDraftValues) => void;
}) {
  const [pickerOpened, setPickerOpened] = useState(false);
  const pickerId = useId();
  const [noteOpened, setNoteOpened] = useState(Boolean(note));
  const included = measurementMetrics.filter((key) => key in values);
  const selected: readonly MeasurementMetric[] = full
    ? measurementMetrics
    : included.length
      ? included
      : ['weight'];
  const available = measurementMetrics.filter((key) => !selected.includes(key));
  const dateInput = (
    <TextInput
      className={styles.dateInput}
      type="date"
      label={m.date}
      value={date}
      onChange={(e) => onDateChange(e.currentTarget.value)}
      required
    />
  );

  return (
    <Stack gap="md">
      {!full && dateInput}
      <Stack gap="xs">
        <div>
          <Text fw={650}>{m.whatMeasured}</Text>
          <Text size="sm" c="dimmed">
            {m.valueHint}
          </Text>
        </div>
        <SimpleGrid
          cols={full ? 2 : selected.length > 1 ? { base: 1, xs: 2 } : 1}
          spacing="xs"
        >
          {full && dateInput}
          {selected.map((key) => {
            const Icon = metricIcons[key];
            const unit = m.units[key === 'weight' ? 'kg' : 'cm'];
            return (
              <Group key={key} wrap="nowrap" align="end" gap={4}>
                <TextInput
                  className={styles.metricInput}
                  label={m.metrics[key]}
                  aria-label={`${m.metrics[key]}, ${unit}`}
                  leftSection={<Icon size={18} aria-hidden />}
                  inputMode="decimal"
                  value={values[key] ?? ''}
                  rightSection={unit}
                  rightSectionPointerEvents="none"
                  onChange={(e) =>
                    onValuesChange({ ...values, [key]: e.currentTarget.value })
                  }
                />
                {!full && selected.length > 1 && (
                  <ActionIcon
                    size={44}
                    variant="subtle"
                    color="gray"
                    aria-label={m.removeMetric(m.metrics[key])}
                    onClick={() => {
                      const next = { ...values };
                      delete next[key];
                      onValuesChange(next);
                    }}
                  >
                    <IconX size={17} aria-hidden />
                  </ActionIcon>
                )}
              </Group>
            );
          })}
        </SimpleGrid>
        {available.length > 0 && (
          <>
            <Button
              className={styles.fieldAction}
              mih={44}
              size="sm"
              variant="light"
              leftSection={<IconPlus size={18} aria-hidden />}
              rightSection={<IconChevronDown size={15} aria-hidden />}
              aria-expanded={pickerOpened}
              aria-controls={pickerId}
              onClick={() => setPickerOpened(!pickerOpened)}
            >
              {m.addMetric}
            </Button>
            <Collapse expanded={pickerOpened} id={pickerId}>
              <SimpleGrid cols={2} spacing={6}>
                {available.map((key) => {
                  const Icon = metricIcons[key];
                  return (
                    <Button
                      key={key}
                      classNames={{
                        root: styles.pickerOption,
                        inner: styles.pickerInner,
                      }}
                      mih={44}
                      size="sm"
                      variant="default"
                      leftSection={<Icon size={18} aria-hidden />}
                      onClick={() => {
                        onValuesChange({
                          ...values,
                          ...(included.length === 0 ? { weight: '' } : {}),
                          [key]: '',
                        });
                        setPickerOpened(false);
                      }}
                    >
                      {key === 'biceps' ? m.bicepsShort : m.metrics[key]}
                    </Button>
                  );
                })}
              </SimpleGrid>
            </Collapse>
          </>
        )}
      </Stack>
      {full || noteOpened ? (
        <Textarea
          label={m.note}
          autosize
          minRows={2}
          value={note}
          maxLength={2000}
          onChange={(e) => onNoteChange(e.currentTarget.value)}
        />
      ) : (
        <Button
          className={styles.fieldAction}
          mih={44}
          size="sm"
          variant="subtle"
          color="gray"
          leftSection={<IconNote size={18} aria-hidden />}
          onClick={() => setNoteOpened(true)}
        >
          {m.addNote}
        </Button>
      )}
      {selected.includes('neck') && (
        <Text size="sm" c="dimmed">
          {m.neckHint}
        </Text>
      )}
    </Stack>
  );
}
