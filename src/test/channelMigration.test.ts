import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelDocumentFor, portableChannel } from '../providers/channelMigration.js';
import type { ChannelDocument } from '../model/channelDocument.js';

const doc = (over: Partial<ChannelDocument> = {}): ChannelDocument => ({ name: 'ZZ_CH', descr: 'Channel', descrlong: null, owner: ' ', status: 1, archive: false, thruput: 2,
  pubTimeoutMin: 0, subTimeoutMin: 0, pubRetrySec: 0, subRetrySec: 0, errorThreshold: 0, qualityOfService: 0, messages: ['ZZ_MSG'],
  partitions: [{ field: 'EMPLID', checked: true }, { field: 'MSGNAME', checked: false }], dropped: [], languages: [], nodes: [], ...over });

test('a channel migrates its properties and every stored partition field, including ones no target message offers', () => {
  const data = portableChannel(doc({ dropped: ['OLD_FLD'] }));
  assert.deepEqual(data.partitions, ['EMPLID', 'OLD_FLD']);
  // A target without the messages offers nothing: the payload's fields become added partitions, the rest unchecked.
  const target = channelDocumentFor(doc({ messages: [], partitions: [{ field: 'MSGNAME', checked: true }] }), data);
  assert.deepEqual(target.partitions, [{ field: 'MSGNAME', checked: false }, { field: 'EMPLID', checked: true, added: true }, { field: 'OLD_FLD', checked: true, added: true }]);
  assert.equal(target.status, 1); assert.equal(target.thruput, 2); assert.deepEqual(target.dropped, []);
  assert.throws(() => portableChannel(doc({ nodes: [{ CHNLNAME: 'ZZ_CH', MSGNODENAME: 'N' }] })), /environment specific/);
  assert.throws(() => portableChannel(doc({ languages: [{ CHNLNAME: 'ZZ_CH', LANGUAGE_CD: 'FRA' }] })), /translations/);
});
