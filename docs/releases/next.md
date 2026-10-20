# PeopleSoft Studio 0.9.7 — unreleased

Development starts from [0.9.6](0.9.6.md), published October 20, 2026.
The `v0.9.6` tag and published VSIX remain the released build.

The PeopleCode language server's follow-ups are in: definition references
(`Record.X`, `Page.X`, `Component.X`, `SQL.X` ...) are checked against the
connection -- as notes, since native probes showed App Designer compiles them
unchecked, except `Image.X`'s 2,68 warning -- and completion offers a record's
fields after `RECORD.`, every built-in function, and an application class's
own and inherited members after `%This.`/`%Super.`. This also fixes 0.9.6
reporting `SQL.X` and `Page.X` as undefined fields.

Migration adapters for the remaining project member types follow.

Track the remaining project completion gates in
[1.0 readiness](../RELEASE_1_0_READINESS.md). No 1.0 delivery date is committed.
