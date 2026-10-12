# Health reads

Operate-mode extension of the existing Mantine surfaces. `StepsPanel` accepts a safe `StepsSummary`; `compact` displays the final selected day and hides the detailed table. `WeightHistoryPanel` accepts `WeightHistory` and combines local and imported records chronologically, with source labels and unknown imported units explained. Manual measurement editing and kilogram charts remain owned by measurements. `HealthOverviewSteps` loads a browser-local seven-day range and refreshes on focus, visibility, and local midnight; pending requests abort and old data clears before refresh.

Server readers select the data owner internally and require `measurements:read` before and after database reads. API queries accept exactly one `from` and `to` and no owner parameter. The existing Analytics range contract limits reads to 366 calendar days. All response paths use `no-store`. No reader calls the SDK.

Steps totals use Decimal arithmetic and transport decimal strings. Zero is observed; missing/null steps are gaps and excluded from averages. YAZIO weight units remain unknown regardless of the account's unit preference; records never enter a kilogram chart or manual CRUD.

Page composition: Overview uses the compact seven-day steps panel; Analytics uses its selected range and rerenders the steps panel on the existing URL navigation; Measurements appends the combined source-labelled weight history below the existing manual panel. The read-only history covers the trailing 366 days. The manual editor and kilogram chart remain unchanged.
