import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
/** Current invocation's fresh npm pack; the existing safety environment is unchanged. */
export async function packageSnapshotOptions(){
 return {packagePlacement:'snapshot',packageSnapshot:JSON.parse(await readFile(join(process.env.DSH_BOT_TEST_ROOT,'current-package-snapshot.json'),'utf8'))};
}
