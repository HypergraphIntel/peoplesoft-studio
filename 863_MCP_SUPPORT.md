Make the local MCP translate for the PeopleTools 8.63 MCP when the user is on that tools version. 

Must be compatible with legacy. 


Oracle Documentation for 8.63 MCP:

https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/application-designer-developer-s-guide/using-mcp-tools-exposed-mcp-server.html#GUID-8FCBC8E9-6B88-4D5C-8DC5-A2A646FFFA22


The clean way to do this is to make **PeopleSoft Studio act as a compatibility façade** over both implementations.

You do **not** want two separate conceptual APIs. You want one stable MCP contract exposed by PeopleSoft Studio, with an adapter that maps to either:

```text
A) PeopleSoft Studio's own provider / decoder stack
B) Delivered PeopleTools 8.63 MCP
```

based on what the connected environment supports.

The architecture should look like this:

```text
AI Client
   |
   v
PeopleSoft Studio MCP
   |
   +--> Native PeopleSoft Studio provider
   |
   +--> PeopleTools 8.63 MCP adapter
            |
            +--> get_record_details
            +--> get_component_details
            +--> get_record_peoplecode
            +--> get_application_class_peoplecode
            +--> ...
```

The key is: **your public tool names stay stable**.

For example, keep:

```text
psft_get_record_peoplecode
psft_get_component_peoplecode
psft_get_application_class
psft_get_definition
```

and internally translate them.

---

## 1. Add a backend capability abstraction

I would add a small interface, something like:

```ts
export interface PeopleSoftMcpBackend {
  readonly kind:
    | 'studio'
    | 'peopletools-863';

  readonly mode:
    | 'read'
    | 'compile'
    | 'write';

  getRecordPeopleCode(
    request: RecordPeopleCodeRequest
  ): Promise<PeopleCodeResult>;

  getComponentPeopleCode(
    request: ComponentPeopleCodeRequest
  ): Promise<PeopleCodeResult>;

  getApplicationClassPeopleCode(
    request: ApplicationClassRequest
  ): Promise<PeopleCodeResult>;
}
```

Then implement:

```text
StudioBackend
PeopleTools863Backend
```

Your tools call the interface, not Oracle directly.

---

## 2. Detect whether 8.63 MCP exists

When connecting to an environment, determine whether the remote delivered MCP is available.

Conceptually:

```ts
interface EnvironmentCapabilities {
  peopleToolsVersion?: string;
  deliveredMcpAvailable: boolean;
  deliveredMcpMode?:
    | 'read'
    | 'compile'
    | 'write';
}
```

Then:

```ts
if (
  capabilities.deliveredMcpAvailable &&
  capabilities.peopleToolsVersion?.startsWith('8.63')
) {
  backend =
    new PeopleTools863Backend(...);
} else {
  backend =
    new StudioBackend(...);
}
```

I would not key the behavior solely on the version string.

Better:

```text
Detect capability first.
Use version second.
```

Because later an 8.64 system may expose the same API.

---

## 3. Normalize the delivered 8.63 names

What Oracle exposes:

```text
get_record_peoplecode
get_page_peoplecode
get_page_field_peoplecode
get_component_peoplecode
get_component_record_peoplecode
get_component_record_field_peoplecode
get_application_class_peoplecode
get_app_engine_peoplecode
```

What your local MCP currently exposes is broader/coarser:

```text
psft_get_record_peoplecode
psft_get_component_peoplecode
psft_get_application_class
psft_get_peoplecode
```

I would build a translation table.

For example:

```ts
export const PT863_TOOL_MAP = {
  recordPeopleCode:
    'get_record_peoplecode',

  pagePeopleCode:
    'get_page_peoplecode',

  pageFieldPeopleCode:
    'get_page_field_peoplecode',

  componentPeopleCode:
    'get_component_peoplecode',

  componentRecordPeopleCode:
    'get_component_record_peoplecode',

  componentRecordFieldPeopleCode:
    'get_component_record_field_peoplecode',

  applicationClassPeopleCode:
    'get_application_class_peoplecode',

  appEnginePeopleCode:
    'get_app_engine_peoplecode'
} as const;
```

---

## 4. Normalize the result too

This is just as important as translating tool names.

PeopleTools 8.63 behaves differently depending on mode:

### read

It returns source directly.

### compile/write

According to the documentation you provided, PeopleCode retrieval writes the source to:

```text
output_dir
WORKSPACE_DIR
current working directory
```

and returns the path.

Your local MCP should hide that difference.

Your AI-facing result should always look like:

```ts
interface PeopleCodeResult {
  source?: string;
  filePath?: string;

  origin:
    | 'studio'
    | 'peopletools-863';

  mode:
    | 'read'
    | 'compile'
    | 'write';

  definition: {
    kind: string;
    parts: string[];
  };
}
```

Then ideally, when 8.63 returns a file path, **your adapter reads the file and gives the AI the source too**:

```ts
{
  source: "...PeopleCode...",
  filePath: "/workspace/XYZ.peoplecode",
  origin: "peopletools-863",
  mode: "compile"
}
```

That gives the AI the same experience regardless of backend.

---

# 5. Map your existing record tool

Your current:

```text
psft_get_record_peoplecode
```

takes approximately:

```ts
{
  connection,
  record,
  field?,
  event?
}
```

The adapter can decide which 8.63 tool to call.

Pseudo-code:

```ts
async getRecordPeopleCode(
  request: RecordPeopleCodeRequest
) {
  if (request.field) {
    // Depending on delivered semantics,
    // this may need the record-level call
    // with field parameters.
  }

  return this.call(
    'get_record_peoplecode',
    {
      record_name:
        request.record,

      field_name:
        request.field,

      event_name:
        request.event
    }
  );
}
```

The exact parameter names are the one thing the documentation excerpt you gave does **not** specify.

So we should not invent those yet.

Once you have access to an 8.63 instance, interrogate the MCP tool schemas and record them.

---

# 6. Component translation is straightforward

Your current:

```text
psft_get_component_peoplecode
```

currently combines component and component-record PeopleCode.

For 8.63, split internally depending on the request.

For example:

```ts
if (
  request.record &&
  request.field
) {
  return call(
    'get_component_record_field_peoplecode',
    ...
  );
}

if (
  request.record
) {
  return call(
    'get_component_record_peoplecode',
    ...
  );
}

return call(
  'get_component_peoplecode',
  ...
);
```

So the AI still calls:

```text
psft_get_component_peoplecode
```

but the adapter chooses among:

```text
get_component_peoplecode
get_component_record_peoplecode
get_component_record_field_peoplecode
```

That's exactly where the translation layer earns its keep.

---

# 7. Application Class maps almost one-to-one

You currently have:

```text
psft_get_application_class
```

Oracle provides:

```text
get_application_package_details
get_application_class_peoplecode
```

Your adapter can do both.

For example:

```ts
async getApplicationClass(
  request: ApplicationClassRequest
) {
  const structure =
    await remote.call(
      'get_application_package_details',
      ...
    );

  const peopleCode =
    await remote.call(
      'get_application_class_peoplecode',
      ...
    );

  return {
    structure,
    peopleCode
  };
}
```

That is actually better than what your local implementation can expose today because the delivered MCP has an explicit package-details API.

---

# 8. Add metadata compatibility too

The delivered MCP gives you:

```text
get_field_details
get_record_details
get_page_details
get_component_details
get_application_package_details
get_app_engine_details
get_project_details
```

These map naturally to a more structured version of your current:

```text
psft_get_definition
psft_list_children
psft_list_project_items
```

For example:

```text
psft_get_definition
```

could route:

```ts
switch (type) {
  case Field:
    -> get_field_details

  case Record:
    -> get_record_details

  case Page:
    -> get_page_details

  case Component:
    -> get_component_details

  case ApplicationPackage:
    -> get_application_package_details

  case AppEngineProgram:
    -> get_app_engine_details

  case Project:
    -> get_project_details
}
```

This means your **generic API can become a compatibility superset**.

---

# 9. Do not expose Oracle's MODE directly as your core design

I would support it, but not make your entire MCP dependent on it.

Use:

```ts
interface BackendCapabilities {
  canRead: boolean;
  canCompile: boolean;
  canWrite: boolean;
}
```

For your current Studio backend:

```ts
{
  canRead: true,
  canCompile: false,   // until your compiler is promoted
  canWrite: false
}
```

For delivered 8.63:

```text
read mode:
  read = true
  compile = false
  write = false

compile mode:
  read = true
  compile = true
  write = false

write mode:
  read = true
  compile = true
  write = true
```

Then register or advertise tools based on capabilities.

---

# 10. Eventually you can translate compile mode too

Once you want to support delivered compile operations:

Your generic API could be:

```text
psft_compile_peoplecode
```

with:

```ts
{
  connection,
  kind:
    "record"
    | "page"
    | "page-field"
    | "component"
    | "component-record"
    | "component-record-field"
    | "application-class"
    | "app-engine",

  key: {...},

  sourceFile: string
}
```

The 8.63 adapter translates that into:

```text
compile_record_peoplecode
compile_page_peoplecode
compile_page_field_peoplecode
...
```

Your own Studio backend could later use your encoder/compiler.

That is especially valuable for your project because you are already building the PeopleCode encoder independently.

You could eventually have:

```text
psft_compile_peoplecode
       |
       +--> PT 8.63 delivered compiler
       |
       +--> PeopleSoft Studio compiler
```

Same AI workflow.

---

# 11. Same strategy for write mode

Do not copy Oracle's eight staging calls into your public contract unless you want to.

You could expose:

```text
psft_stage_peoplecode
psft_list_staged_peoplecode
psft_clear_staged_peoplecode
psft_save_all_peoplecode
```

and have:

```ts
psft_stage_peoplecode({
  kind: 'component-record-field',
  ...
})
```

translate to:

```text
stage_component_record_field_peoplecode
```

That keeps your API dramatically cleaner.

---

# 12. I would add one capability tool

Add:

```text
psft_get_capabilities
```

Example response for your current environment:

```json
{
  "backend": "studio",
  "peopleToolsVersion": "8.61",
  "capabilities": {
    "read": true,
    "compile": false,
    "write": false
  }
}
```

On an 8.63 environment:

```json
{
  "backend": "peopletools-mcp",
  "peopleToolsVersion": "8.63",
  "capabilities": {
    "read": true,
    "compile": true,
    "write": false
  },
  "remoteMode": "compile"
}
```

Then agents know what they can safely request.

---

# The implementation split I would use

Keep it small:

```text
src/mcp/
├── tools.ts
├── server.ts
├── backends/
│   ├── backend.ts
│   ├── studio.ts
│   └── peopletools863.ts
└── capabilities.ts
```

Not a sprawling rewrite.

The flow becomes:

```text
psft_get_component_peoplecode
            |
            v
    PeopleSoftMcpBackend
            |
       +----+-----+
       |          |
       v          v
   Studio      PT 8.63 MCP
   Provider       Adapter
```

## The most important design decision

Do **not** make your local MCP imitate Oracle's API verbatim.

Make Oracle's 8.63 MCP one backend implementation of your API.

That gives you compatibility in both directions:

```text
Older PeopleTools
    -> PeopleSoft Studio implements the functionality itself

PeopleTools 8.63+
    -> PeopleSoft Studio can delegate to delivered MCP

AI Agent
    -> sees the same PeopleSoft Studio tools either way
```

That is the strongest long-term architecture for this project.

One caveat: from the 8.63 documentation you provided, we know the delivered **tool names, modes, and behavior**, but not the exact MCP input/output schemas for each tool. Before implementing the actual remote adapter, you'll want to capture the `tools/list` schema from a real 8.63 environment. Everything above can be built now except that final argument-mapping layer.
