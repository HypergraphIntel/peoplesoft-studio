# Integration Broker: messages, services, service operations

Integration Broker definitions on HRDMO (PeopleTools 8.62.09: 4,272
messages, 1,075 services, 2,160 service operations) and what PeopleSoft
Studio shows from them (`src/model/ibDefinitions.ts`). Read-only.

## Messages

| Table | Holds |
|---|---|
| `PSMSGDEFN` | the message: description, default version (blank on HRDMO's), owner |
| `PSMSGVER` | its versions (`APMSGVER`): `IB_MSGTYPE`, root element, document package |
| `PSMSGREC` | a rowset version's records: `RECNAME`, `PRNTRECNAME` (`--` at the top), `SEQNO` |

`IB_MSGTYPE` has no PSXLATITEM labels: 1 is Rowset (all 910 such versions
have records), 2 Nonrowset (none of 3,515 does), 6 Document (all 157 name a
package); 3, 4 and 5 are shown as stored.

## Services and service operations

| Table | Holds |
|---|---|
| `PSSERVICE` | the service: namespace, alias, REST |
| `PSSERVICEOPR` | its operations |
| `PSOPERATION` | the operation: service, `RTNGTYPE`, default version, REST method |
| `PSOPRVERDFN` | its versions, active or not |
| `PSOPRVERDFNPARM` | each version's messages (REQUEST, RESPONSE ...), queue, transforms |
| `PSOPRHDLR` | handlers: `HANDLERTYPE` (stored as words: ApplicationClass, ComponentInterface ...), active |
| `PSIBRTNGDEFN` | routings (latest effective date): sender and receiver nodes, status |

`RTNGTYPE` (PSXLATITEM): A Asynchronous - One Way, S Synchronous, R Asynch
Request/Response, N Synchronous Non-Blocking, X Asynch to Synch.

## Projects

| OBJECTTYPE | Item | OBJECTID1 |
|---|---|---|
| 37 | message | 60 |
| 79 | service | 138 |
| 80 | service operation | 139 |

Every message, service and service operation on HRDMO renders without an
error. All three are in the Definition Browser and Open Definition.
