import { Alert, Text } from '@mantine/core';
import type { MeasurementPrecisionIssue } from '@/contracts/yazio-body';
import { groupPrecisionIssues } from './history';
import { measurementMessages as m } from './messages';

export function MeasurementPrecisionWarnings({
  issues,
}: {
  issues: MeasurementPrecisionIssue[];
}) {
  return groupPrecisionIssues(issues).map((issue) => (
    <Alert key={issue.key} color="yellow">
      {m.precisionIssue} {m.metrics[issue.metric]}: {issue.value} ({issue.date})
      <Text size="sm" mt="xs">
        {m.precisionObservations}: {issue.observations.length}
      </Text>
      {issue.observations.map((observation) => (
        <Text
          key={observation.id}
          size="sm"
          data-observation-id={observation.id}
        >
          {observation.dateTime.slice(11)}
        </Text>
      ))}
    </Alert>
  ));
}
