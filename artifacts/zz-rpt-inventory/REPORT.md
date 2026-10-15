# Record inventory Application Engine

Created in HRDMO on October 14, 2026.

Project: **ZZ_RPT_INVENTORY**. Program: **ZZ_RPT_INV**.

The program reads PSRECDEFN, counts definitions by RECTYPE, executes PeopleCode for every returned group, and writes a UTF8 CSV with a final total. It changes no application data. The report is named record_inventory_<process-instance>.csv.

| Definition | Purpose |
| --- | --- |
| ZZ_RPT_AET | Derived default state: process instance, current record type/count, filename, running total |
| ZZ_RPT_LINE | Derived detail work record instantiated by PeopleCode |
| ZZ_RPT_SUM | Derived summary work record instantiated by PeopleCode |
| ZZ_RPT_COUNT | Number(10,0), current group count |
| ZZ_RPT_TOTAL | Number(10,0), total count |
| ZZ_RPT_LABEL | Mixed-case character(40), record-type label |
| ZZ_RPT_FILE | Mixed-case character(128), output filename |

PROCESS_INSTANCE and RECTYPE reuse existing delivered fields. All three records are Derived/Work; no physical SQL table build, temporary-table allocation, seed data, or custom run-control table is needed.

MAIN runs INIT, DETAIL, FINISH in that order. DETAIL uses a Select/Fetch Do Select action with %Select into the default state record, followed by PeopleCode. INIT creates the header. DETAIL appends each type/count. FINISH appends the total and logs completion. File-open failures abort the program. Restart is disabled; a fresh run regenerates the file.

Validation completed:

- Stored program matches the requested spec, with no differences.
- Structure, references, and PeopleCode compilation validation reported no errors or warnings.
- All three records were read back with the expected fields and Derived/Work type.
- Project readback contains 12 items: four custom fields, three records, the program, MAIN section, and three PeopleCode actions.

Runtime execution has **not** been performed. Studio's connector does not launch Application Engine or register Process Scheduler processes. No runtime CSV or live inventory counts are claimed here.

## Launch from a PeopleTools host

Use an initialized PeopleTools server environment connected to HRDMO. PS_SERVER_CFG must point to the correctly configured Process Scheduler PSPRCS.CFG. Set PS_SERVDIR as required by that environment. Use an authorized PeopleSoft operator.

The following is a command template; angle-bracket values must be supplied on the PeopleTools host:

```text
psae -CT ORACLE -CD HRDMO -CO <operator> -CP <password> -R ZZ_RPT_INV -AI ZZ_RPT_INV -I 0
```

For credential handling, PSAE also accepts a locally protected options file containing those arguments: invoke `psae <options-file>`. Keep that file outside this source package. For this standalone test the CSV name is record_inventory_0.csv; use a writable relative-file location configured in the server environment. Concurrent standalone runs using instance zero must use separate output directories.

An App Designer runtime test on a host with PSAE installed is another option. Open ZZ_RPT_INV and use its Run command with this environment's signon and runtime configuration.

## Optional Process Scheduler registration

To schedule from PIA, create a Process Definition through PeopleTools > Process Scheduler > Processes:

1. Process Type: Application Engine. Process Name: ZZ_RPT_INV.
2. Description: Record inventory CSV report. Retain the environment's standard Application Engine process type command and parameter defaults.
3. Assign a process group accessible to the operator and configure the approved request component/security according to the installation's scheduler conventions.
4. Submit through an authorized process request page with a run-control ID. No custom input rows are read by this program.
5. Use a configured report output destination and distribution access. After Success/Posted, check Process Monitor's View Log/Trace for record_inventory_<instance>.csv.

Scheduler registration and security are environment setup steps and were not created by this connector. Command-line/App Designer execution does not require a custom run-control page.

Files opened for writing by GetFile under Process Scheduler are managed by the Report Repository according to [Oracle's GetFile reference](https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/peoplecode-language-reference/getfile.html). Runtime command/environment requirements follow [Oracle's command-line AE reference](https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/application-engine/using-command-line-invoke-application-engine-programs.html).

## Runtime acceptance

Confirm a successful exit/run status, a CSV header, one detail row for each RECTYPE present, and a TOTAL row equal to the detail counts. Independently compare the result against:

```sql
SELECT RECTYPE, COUNT(*) FROM PSRECDEFN GROUP BY RECTYPE ORDER BY RECTYPE;
SELECT COUNT(*) FROM PSRECDEFN;
```

The report includes the newly created definitions because it reads the current database. Unsupported/unrecognized record-type codes retain their numeric value and receive the label Other. An interrupted run can leave a partial CSV; accept it only after successful completion with its TOTAL row.

## Source package

program.json is the creation/verification spec; INIT.pcode, DETAIL.pcode, FINISH.pcode and DETAIL.sql contain the action sources. records.json contains live record readbacks. These files document/reproduce the definitions through Studio tools; they are not an App Designer project export. The project is already saved in HRDMO and can be exported from App Designer for migration.
