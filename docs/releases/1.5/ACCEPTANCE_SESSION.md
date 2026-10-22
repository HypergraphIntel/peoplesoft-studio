# 1.5 developer acceptance session

Everything left for 1.5 needs the developer: a password, a sign-in, a
spec approval or an installed-window click. It is batched into this one session,
in this order. Steps marked **(agent)** are driven by the agent once the step
before has unblocked it. Evidence goes to `tools/lab/results/`.

## 0. Build the candidate (agent)

`npm run package` produces `peoplesoft-studio.vsix` from the current branch
(unit tests, smoke and editor checks run first). Record its SHA-256; every
installed check below uses this one file.

## 1. Gateway TLS (V15-5 RT-L1) — developer, on gundam-server-01

```bash
cd ~/peoplesoft-studio-lab   # any copy of tools/lab/process-runtime/nginx-soap-tls.py
sudo python3 nginx-soap-tls.py inspect
```

`inspect` changes nothing. Check the output: the connector route is absent,
`chain[...]` shows psapp01's certificate and its issuer, the `openssl verify`
line says `OK`, and the locations list still contains
`location = /SchedulerTransfer/HCMDMO` (the earlier posting fix). If
all of that holds, run the `apply` line it prints, which carries both hashes:

```bash
sudo python3 nginx-soap-tls.py apply <config-sha256> <ca-sha256>
```

It backs up the site, installs the dedicated CA file, runs `nginx -t` and
reloads, and restores everything if any step fails. To undo it later:
`sudo python3 nginx-soap-tls.py rollback <backup path it printed>`.

**(agent)** Then re-run the native read-only probe
(`tools/lab/process-runtime/preflight.mts`); passing means it advances past
`(158,554)` to operator authentication.

## 2. Run and Monitor (V15-5 RT-L2–RT-L4) — installed candidate

1. Install the candidate in a separate VS Code window on Linux. Connect
   HRDMO and sign in as JARED when Run and Monitor asks; the password is typed
   by the developer.
2. **(agent)** Prepare one run of `ZZ_BC_EXPORT` with run control
   `ZZ_BC_ACC01`. The developer confirms the consent prompt **once**. Expect
   exactly one new instance, Success / Posted.
3. **(agent)** RT-L3: open stdout in the UI; use **Download** for the CSV. The
   saved file must be the exact 123 bytes with SHA-256
   `62d92d414fc02901271744facb65c61b5d9bbecc6f7edfecc31fc734f11b6367`.
4. **(agent)** RT-L4: reload the window (history is kept), then try a dirty,
   read-only and stale request and a double click (all refused, no new
   instance), and run the uncertain-outcome recovery (it links the instance
   without scheduling again).

## 3. Windows handoff setup (V15-3) — developer, on ps-win-client

From the VM's PowerShell (it has VS Code; Node, git, Claude Code and Codex are
missing):

```powershell
winget install --id OpenJS.NodeJS.LTS -e
# open a new PowerShell so npm is on PATH
npm install -g @anthropic-ai/claude-code @openai/codex
claude    # sign in, then /exit
codex login
```

Copy `peoplesoft-studio.vsix` to the VM (the candidate from step 0) and run
`code --install-extension peoplesoft-studio.vsix`. In VS Code:

1. Add an Oracle connection named HRDMO, connect string
   `192.168.122.206:1521/hrdmo`, with the access ID typed by the developer;
   set it Writable with operator JARED.
2. Run **PeopleSoft: Configure AI Client** for Claude Code and for Codex.

## 4. Representative business request (V15-3) — Windows

The request is [benefits-eligibility](../../build-requests/samples/benefits-eligibility/):
a business user's requirements (.docx), the administrator's file
specification (.xlsx) and a covering email. All names and figures are
invented; it only creates `ZZ_` objects.

1. **Developer:** New Build Request on the Windows window. Title: *Monthly
   benefits eligibility file*. Attach the three files with the file picker.
2. **Developer:** **Analyze with Claude Code**. A Windows terminal opens with
   the agent. **(agent in that terminal)** It reads the attachments, asks
   anything it needs (answer in the request), and proposes a spec: an App
   Engine that writes `ZZ_BENELIG_YYYYMMDD.csv`, a run-control record, page,
   component and process definition, a new permission list, and one project.
3. **Developer:** review and **approve** the spec on the page.
4. **Developer:** **Build with Codex** (proves the second client on Windows).
   Approve each reviewed write it stages in Change Review.
5. **Developer:** run the process once from Run and Monitor (or PIA) with
   as-of date `2026-11-02` and company blank; download the CSV.
6. **(agent)** Compare it with the independent verifier:
   `npx tsx tools/lab/benelig-expected.mts 2026-11-02 --compare <downloaded csv>`.
   It must print `MATCH`. The verifier records its own reading of the request
   (hire date `LAST_HIRE_DT`, non-COBRA program, primary name). If the approved
   spec chose differently, change the verifier to match the spec before
   comparing; the spec decides, not the verifier.
7. **Developer:** **Promote Project** to HRDEV and apply it there. **(agent)**
   Verify that every definition reads back identical on HRDEV (deployment
   evidence) and that undo is available.

## 5. Installed structural Change Review (V15-1, V15-2) — Linux candidate

One Change Set, one inverse, one redo, as listed in
[PROGRESS.md](PROGRESS.md#batched-installed-acceptance-one-developer-session),
plus:

- Format Document on a ZZ_ PeopleCode program (Shift+Alt+F), then Validate
  in App Designer: nothing changes.
- The Query designer on the new families: an effective-date operator, HAVING
  OR, date Min/Max, a `#N` expression criterion, a nested subquery.

## 6. PeopleTools 8.61 Query (V15-4) — HCDEV RDP

**Developer:** start the university RDP session the usual way (xfreerdp3 on
`DISPLAY=:99`, password typed by the developer). **(agent)** Drive Windows
Query on HCDEV with `XX_QRY_` objects only. For each family that 8.62.09 has
(criteria operators, number and date fields, prompts, joins, aggregates and
HAVING, expressions, subqueries, unions, translates, effective dating), save
an App Designer version and a Studio version, compare the rows and the SQL,
and lift the 8.61 gate family by family. HCDEV stays read-only except for
those `XX_` queries.
