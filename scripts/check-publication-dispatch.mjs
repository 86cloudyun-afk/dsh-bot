import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function checkPublicationDispatch({ref, packageVersion, version, commentId, mainRunId}) {
  const inputs = [version, commentId, mainRunId];
  if (inputs.every(value => value === '' || value === undefined)) return {qualified: false};
  assert.equal(version, packageVersion, 'Publication version must equal the checked out package');
  assert.equal(ref, `refs/tags/v${packageVersion}`, 'Publication requires the exact version tag');
  for (const [name, value] of [['comment', commentId], ['main run', mainRunId]]) {
    assert.equal(typeof value, 'string', `Publication ${name} must be a string`);
    assert.match(value, /^[1-9]\d*$/, `Publication ${name} must be a canonical positive ID`);
    assert.ok(Number.isSafeInteger(Number(value)), `Publication ${name} exceeds the safe integer range`);
  }
  return {qualified: true, version, commentId, mainRunId};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {version: packageVersion} = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(JSON.stringify(checkPublicationDispatch({
    ref: process.env.GITHUB_REF,
    packageVersion,
    version: process.env.PUBLICATION_VERSION,
    commentId: process.env.PUBLICATION_COMMENT,
    mainRunId: process.env.PUBLICATION_MAIN_RUN,
  })));
}
