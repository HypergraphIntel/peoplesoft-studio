# MCP mutation inventory

Generated from registrations by `npx tsx tools/change-review/inventory.mts`.
Static routing evidence, not proof of complete snapshots, staging or reversibility.
Read-only annotated tools with incidental local state are outside this mutation table.

| Tool | Annotation | Registration | Direct writer-like calls |
|---|---|---|---|
| `psft_admin_save` | Write | [administrationTools.ts:53](../../src/mcp/administrationTools.ts#L53) | `saveAdministration`, `saved` |
| `psft_ae_create` | Write | [appEngineTools.ts:171](../../src/mcp/appEngineTools.ts#L171) | Inspect delegated callback |
| `psft_ae_edit` | Write | [appEngineTools.ts:186](../../src/mcp/appEngineTools.ts#L186) | Inspect delegated callback |
| `psft_ae_copy` | Write | [appEngineTools.ts:208](../../src/mcp/appEngineTools.ts#L208) | Inspect delegated callback |
| `psft_ae_rename` | Destructive | [appEngineTools.ts:221](../../src/mcp/appEngineTools.ts#L221) | `renameAppEngineProgram`, `saved` |
| `psft_ae_delete` | Destructive | [appEngineTools.ts:238](../../src/mcp/appEngineTools.ts#L238) | `deleteAppEngineProgram`, `saved` |
| `psft_prepare_remaining_work` | Write | [changeReviewTools.ts:9](../../src/mcp/changeReviewTools.ts#L9) | Inspect delegated callback |
| `psft_create_change_set` | Write | [changeReviewTools.ts:11](../../src/mcp/changeReviewTools.ts#L11) | `create` |
| `psft_set_change_plan` | Write | [changeReviewTools.ts:12](../../src/mcp/changeReviewTools.ts#L12) | Inspect delegated callback |
| `psft_stage_object_change` | Write | [changeReviewTools.ts:13](../../src/mcp/changeReviewTools.ts#L13) | Inspect delegated callback |
| `psft_validate_change_set` | Write | [changeReviewTools.ts:16](../../src/mcp/changeReviewTools.ts#L16) | Inspect delegated callback |
| `psft_prepare_revert` | Write | [changeReviewTools.ts:23](../../src/mcp/changeReviewTools.ts#L23) | Inspect delegated callback |
| `psft_prepare_redo` | Write | [changeReviewTools.ts:24](../../src/mcp/changeReviewTools.ts#L24) | Inspect delegated callback |
| `psft_channel_create` | Write | [channelTools.ts:110](../../src/mcp/channelTools.ts#L110) | Inspect delegated callback |
| `psft_channel_edit` | Write | [channelTools.ts:126](../../src/mcp/channelTools.ts#L126) | Inspect delegated callback |
| `psft_channel_copy` | Write | [channelTools.ts:147](../../src/mcp/channelTools.ts#L147) | Inspect delegated callback |
| `psft_channel_rename` | Destructive | [channelTools.ts:160](../../src/mcp/channelTools.ts#L160) | `renameChannelDefinition`, `saved` |
| `psft_channel_delete` | Destructive | [channelTools.ts:178](../../src/mcp/channelTools.ts#L178) | `deleteChannelDefinition`, `saved` |
| `psft_ci_create` | Write | [ciTools.ts:122](../../src/mcp/ciTools.ts#L122) | Inspect delegated callback |
| `psft_ci_edit` | Write | [ciTools.ts:142](../../src/mcp/ciTools.ts#L142) | Inspect delegated callback |
| `psft_ci_copy` | Write | [ciTools.ts:163](../../src/mcp/ciTools.ts#L163) | Inspect delegated callback |
| `psft_ci_rename` | Destructive | [ciTools.ts:176](../../src/mcp/ciTools.ts#L176) | `renameCiDefinition`, `saved` |
| `psft_ci_delete` | Destructive | [ciTools.ts:193](../../src/mcp/ciTools.ts#L193) | `deleteCiDefinition`, `saved` |
| `psft_discovery_record` | Write | [discoveryTools.ts:145](../../src/mcp/discoveryTools.ts#L145) | Inspect delegated callback |
| `psft_drop_zone_save` | Write | [dropZoneTools.ts:51](../../src/mcp/dropZoneTools.ts#L51) | `saveDropZoneConfiguration`, `saved` |
| `psft_event_mapping_save` | Write | [eventMappingTools.ts:81](../../src/mcp/eventMappingTools.ts#L81) | `saveEventMappingConfiguration`, `saved` |
| `psft_event_mapping_create_service` | Write | [eventMappingTools.ts:116](../../src/mcp/eventMappingTools.ts#L116) | `createEventMappingService`, `saved` |
| `psft_event_mapping_remove` | Destructive | [eventMappingTools.ts:157](../../src/mcp/eventMappingTools.ts#L157) | `removeEventMappingConfiguration`, `saved` |
| `psft_ib_create` | Write | [ibTools.ts:76](../../src/mcp/ibTools.ts#L76) | Inspect delegated callback |
| `psft_ib_save` | Write | [ibTools.ts:81](../../src/mcp/ibTools.ts#L81) | Inspect delegated callback |
| `psft_menu_create` | Write | [menuTools.ts:123](../../src/mcp/menuTools.ts#L123) | Inspect delegated callback |
| `psft_menu_edit` | Write | [menuTools.ts:137](../../src/mcp/menuTools.ts#L137) | Inspect delegated callback |
| `psft_menu_copy` | Write | [menuTools.ts:160](../../src/mcp/menuTools.ts#L160) | Inspect delegated callback |
| `psft_menu_rename` | Destructive | [menuTools.ts:173](../../src/mcp/menuTools.ts#L173) | `renameMenuDefinition`, `saved` |
| `psft_menu_delete` | Destructive | [menuTools.ts:190](../../src/mcp/menuTools.ts#L190) | `deleteMenuDefinition`, `saved` |
| `psft_page_field_config_save` | Write | [pfcTools.ts:97](../../src/mcp/pfcTools.ts#L97) | `savePageFieldConfiguration`, `saved` |
| `psft_portal_create_folder` | Write | [portalTools.ts:52](../../src/mcp/portalTools.ts#L52) | Inspect delegated callback |
| `psft_portal_create_content_reference` | Write | [portalTools.ts:57](../../src/mcp/portalTools.ts#L57) | Inspect delegated callback |
| `psft_portal_edit` | Write | [portalTools.ts:62](../../src/mcp/portalTools.ts#L62) | Inspect delegated callback |
| `psft_process_save` | Write | [processTools.ts:38](../../src/mcp/processTools.ts#L38) | `saveProcessDocument`, `saved` |
| `psft_query_save` | Write | [queryTools.ts:113](../../src/mcp/queryTools.ts#L113) | Inspect delegated callback |
| `psft_query_create` | Write | [queryTools.ts:118](../../src/mcp/queryTools.ts#L118) | Inspect delegated callback |
| `psft_query_copy` | Write | [queryTools.ts:126](../../src/mcp/queryTools.ts#L126) | Inspect delegated callback |
| `psft_oauth_save` | Write | [securityTools.ts:43](../../src/mcp/securityTools.ts#L43) | `saveOAuth` |
| `psft_save_peoplecode` | Write | [writeTools.ts:197](../../src/mcp/writeTools.ts#L197) | `savePeopleCode` |
| `psft_save_text_definition` | Write | [writeTools.ts:234](../../src/mcp/writeTools.ts#L234) | `saveSqlDefinition`, `saveStyleSheet`, `saveHtmlDefinition` |
| `psft_edit_page` | Write | [writeTools.ts:284](../../src/mcp/writeTools.ts#L284) | `savePage` |
| `psft_create_record` | Write | [writeTools.ts:318](../../src/mcp/writeTools.ts#L318) | `saveRecord` |
| `psft_edit_record` | Write | [writeTools.ts:338](../../src/mcp/writeTools.ts#L338) | `saveRecord` |
| `psft_delete_record` | Destructive | [writeTools.ts:371](../../src/mcp/writeTools.ts#L371) | `deleteRecord` |
| `psft_create_field` | Write | [writeTools.ts:386](../../src/mcp/writeTools.ts#L386) | `createField` |
| `psft_edit_field` | Write | [writeTools.ts:409](../../src/mcp/writeTools.ts#L409) | `saveField` |
| `psft_edit_translate` | Write | [writeTools.ts:436](../../src/mcp/writeTools.ts#L436) | `saveTranslate` |
| `psft_create_project` | Write | [writeTools.ts:460](../../src/mcp/writeTools.ts#L460) | `createProject` |
| `psft_add_to_project` | Write | [writeTools.ts:473](../../src/mcp/writeTools.ts#L473) | `saveProject` |
| `psft_create_package` | Write | [writeTools.ts:494](../../src/mcp/writeTools.ts#L494) | `createPackage` |

## Commit boundary inventory

Each listed file contains explicit commit/rollback calls. These are separate
writer transactions, not a multi-object atomic transaction. Counts are static;
inspect each branch before assigning a transaction guarantee.

| Module | Commit calls | Rollback calls |
|---|---|---|
| [administrationWriter.ts](../../src/providers/administrationWriter.ts) | 1 | 1 |
| [appEngineWriter.ts](../../src/providers/appEngineWriter.ts) | 3 | 5 |
| [channelWriter.ts](../../src/providers/channelWriter.ts) | 3 | 4 |
| [ciWriter.ts](../../src/providers/ciWriter.ts) | 3 | 4 |
| [componentWriter.ts](../../src/providers/componentWriter.ts) | 1 | 1 |
| [database.ts](../../src/providers/database.ts) | 1 | 5 |
| [dropZoneWriter.ts](../../src/providers/dropZoneWriter.ts) | 1 | 2 |
| [eventMappingWriter.ts](../../src/providers/eventMappingWriter.ts) | 2 | 3 |
| [fieldWriter.ts](../../src/providers/fieldWriter.ts) | 2 | 2 |
| [htmlWriter.ts](../../src/providers/htmlWriter.ts) | 1 | 1 |
| [ibWriter.ts](../../src/providers/ibWriter.ts) | 1 | 2 |
| [menuWriter.ts](../../src/providers/menuWriter.ts) | 3 | 4 |
| [packageWriter.ts](../../src/providers/packageWriter.ts) | 1 | 1 |
| [pageWriter.ts](../../src/providers/pageWriter.ts) | 2 | 4 |
| [peopleCodeWriter.ts](../../src/providers/peopleCodeWriter.ts) | 1 | 1 |
| [pfcWriter.ts](../../src/providers/pfcWriter.ts) | 1 | 3 |
| [portalWriter.ts](../../src/providers/portalWriter.ts) | 1 | 2 |
| [processWriter.ts](../../src/providers/processWriter.ts) | 1 | 3 |
| [projectWriter.ts](../../src/providers/projectWriter.ts) | 2 | 2 |
| [queryWriter.ts](../../src/providers/queryWriter.ts) | 1 | 3 |
| [rcServiceWriter.ts](../../src/providers/rcServiceWriter.ts) | 1 | 2 |
| [recordWriter.ts](../../src/providers/recordWriter.ts) | 3 | 3 |
| [securityWriter.ts](../../src/providers/securityWriter.ts) | 1 | 2 |
| [sqlWriter.ts](../../src/providers/sqlWriter.ts) | 1 | 1 |
| [styleSheetWriter.ts](../../src/providers/styleSheetWriter.ts) | 1 | 1 |
| [translateWriter.ts](../../src/providers/translateWriter.ts) | 1 | 1 |
