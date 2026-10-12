# Health reads

Operate-mode extension of the existing Mantine surfaces. `StepsPanel` accepts a safe `StepsSummary`; `compact` displays the final selected day and hides the detailed table. `WeightHistoryPanel` accepts `WeightHistory` and combines local and imported records chronologically, with source labels and unknown imported units explained. Manual measurement editing and kilogram charts remain owned by measurements. `HealthOverviewSteps` loads a browser-local seven-day range and refreshes on focus, visibility, and local midnight; pending requests abort and old data clears before refresh.

Server readers select the data owner internally and require `measurements:read` before and after database reads. API queries accept exactly one `from` and `to` and no owner parameter. The existing Analytics range contract limits reads to 366 calendar days. All response paths use `no-store`. No reader calls the SDK.

Steps totals use Decimal arithmetic and transport decimal strings. Zero is observed; missing/null steps are gaps and excluded from averages. YAZIO weight units remain unknown regardless of the account's unit preference; records never enter a kilogram chart or manual CRUD.

Planned composition, pending the coordinator's measurements freeze: Overview uses the compact seven-day steps panel; Analytics uses its selected range; Measurements appends imported history below the existing manual panel. No shared page changes are included in this stage.
