/** Preserve test evidence even when the official host's cleanup throws. */
export async function finishStockGui(gui) {
  const testsPassed=gui.report.passed===true;
  Object.assign(gui.report,{testsPassed,passed:false,teardownComplete:false});
  await gui.writeReport();
  try {
    await gui.shutdown();
    gui.report.teardownComplete=true;
    gui.report.passed=testsPassed;
  } catch(error) {
    gui.report.teardownError=`${error.code??error.name}: ${String(error.stack??error.message).replace(/https?:\/\/\S+/g,'[URL omitted]')}`;
    gui.report.error??=gui.report.teardownError;
  }
  await gui.writeReport();
  return gui.report.passed;
}
