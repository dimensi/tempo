// Account-specific knowledge: this application's single OWNER explicitly
// confirmed that their YAZIO weights are always entered in kilograms.
// Apply at read projection only. The SDK does not establish a universal unit;
// raw stored values/units and provider identities must remain unchanged.
export const ownerConfirmedYazioWeightUnit = {
  unit: 'kg',
  unitStatus: 'OWNER_CONFIRMED',
} as const;
export const ownerConfirmedYazioWeightPolicyVersion = 'owner-confirmed-kg/v1';
