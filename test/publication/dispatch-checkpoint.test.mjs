import assert from 'node:assert/strict';
import test from 'node:test';
import {checkPublicationDispatch} from '../../scripts/check-publication-dispatch.mjs';

const valid = () => ({ref: 'refs/tags/v1.3.0', packageVersion: '1.3.0', version: '1.3.0', commentId: '6106000000', mainRunId: '38113823988'});
test('publication dispatch binds checked out version, canonical tag and both original IDs', () => {
  assert.deepEqual(checkPublicationDispatch(valid()), {qualified: true, version: '1.3.0', commentId: '6106000000', mainRunId: '38113823988'});
});
test('ordinary manual checks need no publication checkpoint', () => {
  assert.deepEqual(checkPublicationDispatch({ref: 'refs/heads/main', packageVersion: '1.3.0', version: '', commentId: '', mainRunId: ''}), {qualified: false});
});
for (const [name, changes] of [
  ['branch masquerading as tag', {ref: 'refs/heads/v1.3.0'}],
  ['different tag', {ref: 'refs/tags/v1.2.0'}],
  ['different version', {version: '1.2.0'}],
  ['incomplete version', {version: ''}],
  ['missing comment', {commentId: ''}],
  ['missing main run', {mainRunId: ''}],
  ['noncanonical ID', {mainRunId: '038113823988'}],
  ['unsafe ID', {commentId: '9007199254740992'}],
]) test(`publication dispatch rejects ${name}`, () => assert.throws(() => checkPublicationDispatch({...valid(), ...changes})));
